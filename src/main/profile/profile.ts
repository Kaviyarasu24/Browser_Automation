import { app } from 'electron'
import { join } from 'node:path'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import type { UserProfile } from '../../shared/types.js'

let cachedProfile: UserProfile | null = null

export function getProfilePath(): string {
  // Primary location is in Electron userData
  return join(app.getPath('userData'), 'profile.json')
}

function getCandidatePaths(): string[] {
  const candidates: string[] = [getProfilePath()]
  try {
    candidates.push(join(process.cwd(), 'profile.json'))
    candidates.push(join(app.getAppPath(), 'profile.json'))
  } catch {
    /* ignore outside electron app */
  }
  return candidates
}

export function loadProfile(forceReload = false): UserProfile | null {
  if (cachedProfile && !forceReload) {
    return cachedProfile
  }

  for (const p of getCandidatePaths()) {
    if (existsSync(p)) {
      try {
        const raw = readFileSync(p, 'utf8')
        const parsed = JSON.parse(raw) as Partial<UserProfile>
        if (parsed && typeof parsed === 'object') {
          cachedProfile = sanitizeProfile(parsed)
          // Intentionally do not log profile contents
          console.log(`[profile] Loaded user profile from: ${p}`)
          return cachedProfile
        }
      } catch (err) {
        console.warn(`[profile] Error reading profile from ${p}:`, (err as Error).message)
      }
    }
  }

  return null
}

export function saveProfile(profile: UserProfile): boolean {
  try {
    const savePath = getProfilePath()
    const sanitized = sanitizeProfile(profile)
    writeFileSync(savePath, JSON.stringify(sanitized, null, 2), 'utf8')
    cachedProfile = sanitized
    console.log(`[profile] Saved user profile to ${savePath}`)
    return true
  } catch (err) {
    console.warn('[profile] Failed to save profile:', (err as Error).message)
    return false
  }
}

export function hasProfile(): boolean {
  return loadProfile() !== null
}

function sanitizeProfile(p: Partial<UserProfile>): UserProfile {
  return {
    fullName: p.fullName || '',
    firstName: p.firstName || (p.fullName ? p.fullName.split(' ')[0] || '' : ''),
    lastName: p.lastName || (p.fullName ? p.fullName.split(' ').slice(1).join(' ') || '' : ''),
    email: p.email || '',
    phone: p.phone || '',
    address: p.address || '',
    city: p.city || '',
    state: p.state || '',
    country: p.country || '',
    zip: p.zip || '',
    linkedin: p.linkedin || '',
    github: p.github || '',
    portfolio: p.portfolio || '',
    education: Array.isArray(p.education) ? p.education : [],
    skills: Array.isArray(p.skills) ? p.skills : [],
    experience: Array.isArray(p.experience) ? p.experience : [],
    summary: p.summary || '',
    noticePeriod: p.noticePeriod || '',
    currentCTC: p.currentCTC || '',
    expectedCTC: p.expectedCTC || '',
    workAuthorization: p.workAuthorization || '',
    willingToRelocate: p.willingToRelocate ?? 'Yes',
    resumePath: p.resumePath || '',
    coverLetterTemplate: p.coverLetterTemplate || '',
    customAnswers: p.customAnswers && typeof p.customAnswers === 'object' ? p.customAnswers : {}
  }
}

/**
 * Trims the user profile down to ONLY the minimum subset of information
 * needed for a specific set of unmapped form questions, saving tokens and
 * preventing unnecessary PII leakage to LLM providers.
 */
export function getTrimmedProfileForPrompt(
  profile: UserProfile,
  unmappedLabels: string[]
): Record<string, unknown> {
  const labelsText = unmappedLabels.join(' ').toLowerCase()
  const trimmed: Record<string, unknown> = {}

  // Basic contact info only if asked
  if (labelsText.includes('name') || labelsText.includes('first') || labelsText.includes('last')) {
    trimmed.fullName = profile.fullName
    trimmed.firstName = profile.firstName
    trimmed.lastName = profile.lastName
  }
  if (labelsText.includes('email')) trimmed.email = profile.email
  if (labelsText.includes('phone') || labelsText.includes('mobile') || labelsText.includes('contact')) {
    trimmed.phone = profile.phone
  }
  if (
    labelsText.includes('city') ||
    labelsText.includes('address') ||
    labelsText.includes('state') ||
    labelsText.includes('zip') ||
    labelsText.includes('country') ||
    labelsText.includes('location')
  ) {
    trimmed.address = profile.address
    trimmed.city = profile.city
    trimmed.state = profile.state
    trimmed.country = profile.country
    trimmed.zip = profile.zip
  }

  // Links
  if (labelsText.includes('linkedin')) trimmed.linkedin = profile.linkedin
  if (labelsText.includes('github') || labelsText.includes('git')) trimmed.github = profile.github
  if (labelsText.includes('portfolio') || labelsText.includes('website') || labelsText.includes('url')) {
    trimmed.portfolio = profile.portfolio
  }

  // Work authorization / visa
  if (
    labelsText.includes('authoriz') ||
    labelsText.includes('visa') ||
    labelsText.includes('sponsor') ||
    labelsText.includes('citizen') ||
    labelsText.includes('eligible')
  ) {
    trimmed.workAuthorization = profile.workAuthorization
  }

  // Relocation
  if (labelsText.includes('relocat')) {
    trimmed.willingToRelocate = profile.willingToRelocate
  }

  // Notice period / availability
  if (labelsText.includes('notice') || labelsText.includes('start date') || labelsText.includes('available')) {
    trimmed.noticePeriod = profile.noticePeriod
  }

  // Salary / compensation
  if (
    labelsText.includes('salary') ||
    labelsText.includes('compensation') ||
    labelsText.includes('ctc') ||
    labelsText.includes('pay') ||
    labelsText.includes('rate')
  ) {
    trimmed.currentCTC = profile.currentCTC
    trimmed.expectedCTC = profile.expectedCTC
  }

  // Education
  if (
    labelsText.includes('educat') ||
    labelsText.includes('degree') ||
    labelsText.includes('university') ||
    labelsText.includes('college') ||
    labelsText.includes('gpa')
  ) {
    trimmed.education = profile.education
  }

  // Experience & Skills
  if (
    labelsText.includes('experien') ||
    labelsText.includes('employ') ||
    labelsText.includes('work') ||
    labelsText.includes('role') ||
    labelsText.includes('company') ||
    labelsText.includes('title') ||
    labelsText.includes('why') ||
    labelsText.includes('tell us')
  ) {
    trimmed.experience = profile.experience
    trimmed.skills = profile.skills
    trimmed.summary = profile.summary
  }

  // If labelsText asks for custom questions or why role
  if (labelsText.includes('why') || labelsText.includes('about') || Object.keys(trimmed).length === 0) {
    trimmed.skills = profile.skills
    trimmed.summary = profile.summary
    trimmed.customAnswers = profile.customAnswers
  }

  return trimmed
}
