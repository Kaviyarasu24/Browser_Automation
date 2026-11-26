import { app } from 'electron'
import { join } from 'node:path'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import type { FormField, UserProfile, FormFieldOption } from '../../shared/types.js'
import { getTrimmedProfileForPrompt } from '../profile/profile.js'
import { complete, type ChatMessage } from './llm.js'
import type { RuntimeConfig } from '../config.js'

export interface MappedField {
  fieldId: string
  label: string
  type: string
  value: string | boolean | null
  source: 'rule' | 'cache' | 'llm' | 'manual' | 'unmapped'
  confidence: number
  reason?: string
  needsReview: boolean
  isSensitiveEEO?: boolean
  options?: FormFieldOption[]
}

const EEO_KEYWORDS = [
  'gender',
  'race',
  'ethnicity',
  'hispanic',
  'latino',
  'veteran',
  'military status',
  'disability',
  'handicap',
  'sexual orientation',
  'pronoun',
  'criminal',
  'conviction'
]

function getCachePath(): string {
  try {
    return join(app.getPath('userData'), 'answers-cache.json')
  } catch {
    return join(process.cwd(), 'answers-cache.json')
  }
}

function loadAnswersCache(): Record<string, string> {
  const p = getCachePath()
  if (!existsSync(p)) return {}
  try {
    const raw = readFileSync(p, 'utf8')
    const parsed = JSON.parse(raw)
    return typeof parsed === 'object' && parsed !== null ? parsed : {}
  } catch {
    return {}
  }
}

export function saveAnswerToCache(label: string, value: string): void {
  try {
    const cache = loadAnswersCache()
    const cleanKey = normalizeLabel(label)
    if (!cleanKey) return
    cache[cleanKey] = value
    writeFileSync(getCachePath(), JSON.stringify(cache, null, 2), 'utf8')
  } catch (err) {
    console.warn('[field-mapper] failed to save answer cache:', (err as Error).message)
  }
}

function normalizeLabel(label: string): string {
  return label
    .toLowerCase()
    .replace(/[^\w\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Checks if a question belongs to sensitive demographic or EEO surveys.
 */
export function isEEOQuestion(label: string): boolean {
  const norm = normalizeLabel(label)
  return EEO_KEYWORDS.some((kw) => norm.includes(kw))
}

/**
 * Pick 'Prefer not to say' or 'Decline to specify' if available for EEO questions.
 */
function findDeclineOption(options?: FormFieldOption[]): string | null {
  if (!options || options.length === 0) return null
  const DECLINE_PATTERNS = [
    'prefer not to say',
    'decline to self-identify',
    'decline to state',
    'decline to answer',
    'choose not to disclose',
    'i do not wish to answer',
    'i do not wish to self-identify',
    'do not wish',
    'not specified',
    'decline',
    'prefer not to answer'
  ]

  for (const opt of options) {
    const optLabel = opt.label.toLowerCase().trim()
    if (DECLINE_PATTERNS.some((p) => optLabel.includes(p))) {
      return opt.label
    }
  }
  return null
}

/**
 * Match best option from a list of options given a desired value string.
 */
export function matchOptionValue(desired: string, options?: FormFieldOption[]): string | null {
  if (!options || options.length === 0) return desired
  const cleanDesired = desired.toLowerCase().trim()

  // 1. Exact match
  const exact = options.find((o) => o.label.toLowerCase().trim() === cleanDesired || o.value.toLowerCase().trim() === cleanDesired)
  if (exact) return exact.label

  // 2. Substring or includes
  const partial = options.find((o) => {
    const l = o.label.toLowerCase().trim()
    const v = o.value.toLowerCase().trim()
    return l.includes(cleanDesired) || cleanDesired.includes(l) || v.includes(cleanDesired)
  })
  if (partial) return partial.label

  return options[0]?.label || null
}

/**
 * Tier A: Rule-based regex/synonym mapping
 */
function mapByRule(field: FormField, profile: UserProfile): { value: string | boolean | null; confidence: number; isSensitive: boolean } | null {
  const norm = normalizeLabel(field.label)

  // EEO & Demographic questions MUST NOT be auto-answered with personal info
  if (isEEOQuestion(field.label)) {
    const declineOpt = findDeclineOption(field.options)
    return {
      value: declineOpt,
      confidence: declineOpt ? 0.95 : 0.4,
      isSensitive: true
    }
  }

  // Check customAnswers map first
  for (const [key, val] of Object.entries(profile.customAnswers || {})) {
    if (norm.includes(normalizeLabel(key))) {
      return { value: matchOptionValue(val, field.options), confidence: 0.95, isSensitive: false }
    }
  }

  // File Uploads
  if (field.type === 'file') {
    if (norm.includes('resume') || norm.includes('cv')) {
      return { value: profile.resumePath, confidence: 1.0, isSensitive: false }
    }
    if (norm.includes('cover')) {
      return { value: profile.coverLetterTemplate, confidence: 0.9, isSensitive: false }
    }
  }

  // First / Last / Full Name
  if (norm === 'first name' || norm.startsWith('first name') || norm.includes('given name')) {
    return { value: profile.firstName, confidence: 1.0, isSensitive: false }
  }
  if (norm === 'last name' || norm.startsWith('last name') || norm.includes('family name') || norm.includes('surname')) {
    return { value: profile.lastName, confidence: 1.0, isSensitive: false }
  }
  if (norm === 'full name' || norm === 'name' || norm.includes('your name') || norm.includes('candidate name')) {
    return { value: profile.fullName, confidence: 0.95, isSensitive: false }
  }

  // Email
  if (norm.includes('email') || field.type === 'email') {
    return { value: profile.email, confidence: 1.0, isSensitive: false }
  }

  // Phone
  if (norm.includes('phone') || norm.includes('mobile') || norm.includes('contact number') || norm.includes('cell') || field.type === 'tel') {
    return { value: profile.phone, confidence: 0.98, isSensitive: false }
  }

  // Address
  if (norm === 'street' || norm === 'street address' || norm === 'address' || norm.includes('address line 1')) {
    return { value: profile.address, confidence: 0.95, isSensitive: false }
  }
  if (norm === 'city' || norm.includes('city') || norm.includes('current city')) {
    return { value: profile.city, confidence: 0.95, isSensitive: false }
  }
  if (norm === 'state' || norm.includes('state') || norm.includes('province') || norm.includes('region')) {
    return { value: matchOptionValue(profile.state, field.options), confidence: 0.95, isSensitive: false }
  }
  if (norm === 'zip' || norm.includes('postal code') || norm.includes('zip code') || norm.includes('pin code')) {
    return { value: profile.zip, confidence: 0.95, isSensitive: false }
  }
  if (norm === 'country' || norm.includes('country')) {
    return { value: matchOptionValue(profile.country, field.options), confidence: 0.95, isSensitive: false }
  }

  // Socials / Links
  if (norm.includes('linkedin')) {
    return { value: profile.linkedin, confidence: 1.0, isSensitive: false }
  }
  if (norm.includes('github') || norm.includes('git profile')) {
    return { value: profile.github, confidence: 1.0, isSensitive: false }
  }
  if (norm.includes('portfolio') || norm.includes('website') || norm.includes('personal site') || norm.includes('personal url')) {
    return { value: profile.portfolio, confidence: 0.95, isSensitive: false }
  }

  // Work Authorization / Sponsorship
  if (norm.includes('authorized to work') || norm.includes('legally authorized') || norm.includes('work authorization')) {
    const val = profile.workAuthorization.toLowerCase().includes('authorized') ? 'Yes' : 'No'
    return { value: matchOptionValue(val, field.options), confidence: 0.92, isSensitive: false }
  }
  if (norm.includes('sponsorship') || norm.includes('require sponsor') || norm.includes('visa sponsorship')) {
    const val = profile.workAuthorization.toLowerCase().includes('without sponsorship') ? 'No' : 'Yes'
    return { value: matchOptionValue(val, field.options), confidence: 0.92, isSensitive: false }
  }

  // Relocation
  if (norm.includes('willing to relocate') || norm.includes('relocation')) {
    const val = typeof profile.willingToRelocate === 'boolean' ? (profile.willingToRelocate ? 'Yes' : 'No') : String(profile.willingToRelocate)
    return { value: matchOptionValue(val, field.options), confidence: 0.95, isSensitive: false }
  }

  // Notice Period / Start Date
  if (norm.includes('notice period') || norm.includes('notice') || norm.includes('how soon') || norm.includes('start date')) {
    return { value: matchOptionValue(profile.noticePeriod, field.options), confidence: 0.9, isSensitive: false }
  }

  // CTC / Salary
  if (norm.includes('current ctc') || norm.includes('current salary') || norm.includes('current compensation')) {
    return { value: profile.currentCTC, confidence: 0.9, isSensitive: false }
  }
  if (norm.includes('expected ctc') || norm.includes('expected salary') || norm.includes('desired compensation') || norm.includes('desired salary')) {
    return { value: profile.expectedCTC, confidence: 0.9, isSensitive: false }
  }

  // Experience & Education basics
  if (norm.includes('highest degree') || norm.includes('education level') || norm.includes('highest education')) {
    const deg = profile.education[0]?.degree || "Bachelor's Degree"
    return { value: matchOptionValue(deg, field.options), confidence: 0.85, isSensitive: false }
  }
  if (norm.includes('university') || norm.includes('school') || norm.includes('college')) {
    return { value: profile.education[0]?.school || '', confidence: 0.85, isSensitive: false }
  }
  if (norm.includes('current company') || norm.includes('employer') || norm.includes('current employer')) {
    return { value: profile.experience[0]?.company || '', confidence: 0.85, isSensitive: false }
  }
  if (norm.includes('current title') || norm.includes('job title') || norm.includes('current role')) {
    return { value: profile.experience[0]?.title || '', confidence: 0.85, isSensitive: false }
  }

  // Checkbox agreement (terms / privacy)
  if (field.type === 'checkbox') {
    if (norm.includes('agree') || norm.includes('consent') || norm.includes('privacy') || norm.includes('certify') || norm.includes('acknowledge')) {
      return { value: true, confidence: 0.95, isSensitive: false }
    }
  }

  return null
}

/**
 * Maps all extracted form fields using the 3 tiers (Rule -> Cache -> LLM).
 */
export async function mapFormFields(
  fields: FormField[],
  profile: UserProfile,
  cfg: RuntimeConfig,
  jobContext?: { title?: string; company?: string; description?: string }
): Promise<MappedField[]> {
  const cache = loadAnswersCache()
  const results: MappedField[] = []
  const unmapped: FormField[] = []

  // 1. Tier A (Rule) & Tier B (Cache)
  for (const field of fields) {
    const norm = normalizeLabel(field.label)

    // Tier A: Rule match
    const ruleMatch = mapByRule(field, profile)
    if (ruleMatch) {
      const needsReview = ruleMatch.isSensitive || ruleMatch.confidence < 0.7 || ruleMatch.value === null
      results.push({
        fieldId: field.id,
        label: field.label,
        type: field.type,
        value: ruleMatch.value,
        source: 'rule',
        confidence: ruleMatch.confidence,
        needsReview,
        isSensitiveEEO: ruleMatch.isSensitive,
        options: field.options
      })
      continue
    }

    // Tier B: Cache match
    if (cache[norm]) {
      const cachedVal = cache[norm]!
      results.push({
        fieldId: field.id,
        label: field.label,
        type: field.type,
        value: matchOptionValue(cachedVal, field.options),
        source: 'cache',
        confidence: 0.88,
        needsReview: false,
        options: field.options
      })
      continue
    }

    // Otherwise mark for LLM tier
    unmapped.push(field)
  }

  // If no fields left or LLM not configured, finish
  if (unmapped.length === 0 || !cfg.apiKey) {
    for (const f of unmapped) {
      results.push({
        fieldId: f.id,
        label: f.label,
        type: f.type,
        value: null,
        source: 'unmapped',
        confidence: 0,
        needsReview: true,
        options: f.options
      })
    }
    return results
  }

  // 2. Tier C (LLM)
  try {
    const unmappedLabels = unmapped.map((u) => u.label)
    const trimmedProfile = getTrimmedProfileForPrompt(profile, unmappedLabels)

    const promptPayload = {
      jobContext: jobContext || {},
      candidateProfile: trimmedProfile,
      fieldsToAnswer: unmapped.map((f) => ({
        id: f.id,
        label: f.label,
        type: f.type,
        required: f.required,
        options: f.options?.map((o) => o.label)
      }))
    }

    const messages: ChatMessage[] = [
      {
        role: 'system',
        content: `You are an expert, precise job application form mapper.
Instructions:
1. Map each field in 'fieldsToAnswer' using ONLY the candidate profile and job details.
2. For dropdowns and radio buttons ('options' provided), pick the EXACT string from 'options'.
3. For open questions (e.g. 'Why this role?'), write a short, honest, professional 2-3 sentence answer reflecting the candidate's skills and experience.
4. For demographic, veteran, or disability questions, DO NOT answer with personal identity. Return null or choose 'Prefer not to say' / 'Decline' if available in options.
5. NEVER invent facts or past companies. If the candidate profile has no relevant answer, return null with confidence 0.
6. Return strict JSON only matching this schema:
{
  "mappings": [
    {
      "id": "field_id",
      "value": "string or boolean or null",
      "confidence": 0.0 to 1.0,
      "reason": "short explanation"
    }
  ]
}`
      },
      {
        role: 'user',
        content: JSON.stringify(promptPayload, null, 2)
      }
    ]

    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), 25000)
    const completion = await complete(cfg, messages, [], controller.signal)
    clearTimeout(timer)

    let parsed: { mappings?: Array<{ id: string; value: string | boolean | null; confidence: number; reason?: string }> } = {}
    try {
      // Find JSON block
      const match = completion.content.match(/\{[\s\S]*\}/)
      if (match) {
        parsed = JSON.parse(match[0])
      }
    } catch {
      console.warn('[field-mapper] LLM response JSON parse failed')
    }

    const mappingsMap = new Map<string, { value: string | boolean | null; confidence: number; reason?: string }>()
    for (const m of parsed.mappings || []) {
      mappingsMap.set(m.id, m)
    }

    for (const field of unmapped) {
      const match = mappingsMap.get(field.id)
      const val = match ? match.value : null
      const confidence = match ? match.confidence : 0
      const isSensitive = isEEOQuestion(field.label)

      const needsReview = isSensitive || confidence < 0.7 || val === null

      results.push({
        fieldId: field.id,
        label: field.label,
        type: field.type,
        value: typeof val === 'string' ? matchOptionValue(val, field.options) : val,
        source: match ? 'llm' : 'unmapped',
        confidence,
        reason: match?.reason,
        needsReview,
        isSensitiveEEO: isSensitive,
        options: field.options
      })
    }
  } catch (err) {
    console.warn('[field-mapper] LLM mapping error:', (err as Error).message)
    for (const f of unmapped) {
      results.push({
        fieldId: f.id,
        label: f.label,
        type: f.type,
        value: null,
        source: 'unmapped',
        confidence: 0,
        needsReview: true,
        options: f.options
      })
    }
  }

  return results
}
