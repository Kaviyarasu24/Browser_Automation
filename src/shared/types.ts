/**
 * Types shared across main, preload and renderer.
 * Kept dependency-free so both tsconfig projects can include it.
 */

export interface TabState {
  id: string
  title: string
  url: string
  loading: boolean
  canGoBack: boolean
  canGoForward: boolean
  /** Favicon URL, when the page provides one. */
  favicon: string | null
}

export interface ContentBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface PublicConfig {
  baseUrl: string
  model: string
  /** Never the key itself over insecure wire, but available in local desktop settings */
  hasApiKey: boolean
  apiKey?: string
}

/* ── Task History ─────────────────────────────────────────────────── */

export interface TaskHistoryItem {
  id: string
  task: string
  timestamp: number
  status: 'completed' | 'error' | 'cancelled'
  stepsCount: number
  totalTokens?: number
  summary?: string
  events: AgentEvent[]
}

/* ── Downloads & Exports ────────────────────────────────────────────── */

export interface DownloadRecord {
  id: string
  filename: string
  savePath: string
  state: 'progressing' | 'completed' | 'cancelled' | 'interrupted'
  totalBytes: number
  receivedBytes: number
  mimeType: string
  url: string
  startTime: number
}

/* ── Agent ─────────────────────────────────────────────────────────── */

export type AgentEvent =
  | { type: 'start'; task: string; model: string }
  | { type: 'navigating'; url: string }
  | { type: 'thinking'; step: number; text: string }
  | { type: 'tool'; step: number; name: string; args: Record<string, unknown> }
  | { type: 'result'; step: number; name: string; ok: boolean; summary: string }
  | {
      type: 'confirmation_required'
      id: string
      step: number
      title: string
      description: string
      action: string
      target?: string
    }
  | {
      type: 'form_review_required'
      id: string
      step: number
      jobUrl?: string
      fields: FormFieldReviewItem[]
    }
  | {
      type: 'form_scan_completed'
      step: number
      fieldsCount: number
      fields: FormFieldSummary[]
    }
  | {
      type: 'form_fill_progress'
      step: number
      fieldId: string
      label: string
      value: string
      status: 'filling' | 'filled' | 'verified' | 'failed'
    }
  | {
      type: 'user_intervention_required'
      id: string
      reason: 'captcha' | 'login' | 'otp' | 'verification' | 'other'
      title: string
      message: string
    }
  | {
      type: 'download'
      filename: string
      path: string
      size: number
      state: 'started' | 'completed' | 'failed'
    }
  | { type: 'usage'; prompt: number; completion: number; total: number; step: number }
  | { type: 'done'; summary: string; steps: number; totalTokens?: number }
  | { type: 'error'; message: string; hint?: string }
  | { type: 'cancelled' }

/* ── Form Filling & Profile Types ───────────────────────────────────── */

export type FormFieldType =
  | 'text'
  | 'email'
  | 'tel'
  | 'number'
  | 'textarea'
  | 'select'
  | 'custom_dropdown'
  | 'radio'
  | 'checkbox'
  | 'date'
  | 'file'
  | 'unknown'

export interface FormFieldOption {
  value: string
  label: string
}

export interface FormFieldCoordinates {
  x: number
  y: number
  width: number
  height: number
}

export interface FormField {
  id: string
  name?: string
  label: string
  type: FormFieldType
  options?: FormFieldOption[]
  required: boolean
  currentValue: string | boolean | null
  coordinates: FormFieldCoordinates
  selector?: string
  containerSelector?: string
  isCustomDropdown?: boolean
  isRepeater?: boolean
  validationError?: string
}

export interface FormFieldSummary {
  id: string
  label: string
  type: FormFieldType
  required: boolean
  hasValue: boolean
}

export interface FormFieldReviewItem {
  id: string
  fieldId: string
  label: string
  type: FormFieldType
  currentValue: string | boolean | null
  proposedValue: string | boolean | null
  source: 'rule' | 'cache' | 'llm' | 'manual' | 'unmapped'
  confidence: number
  required: boolean
  approved: boolean
  options?: FormFieldOption[]
  error?: string
}

export interface UserEducation {
  school: string
  degree: string
  fieldOfStudy?: string
  startDate?: string
  endDate?: string
  gpa?: string
}

export interface UserExperience {
  company: string
  title: string
  location?: string
  startDate?: string
  endDate?: string
  current?: boolean
  description?: string
}

export interface UserProfile {
  fullName: string
  firstName: string
  lastName: string
  email: string
  phone: string
  address: string
  city: string
  state: string
  country: string
  zip: string
  linkedin: string
  github: string
  portfolio: string
  education: UserEducation[]
  skills: string[]
  experience: UserExperience[]
  summary: string
  noticePeriod: string
  currentCTC: string
  expectedCTC: string
  workAuthorization: string
  willingToRelocate: boolean | string
  resumePath: string
  coverLetterTemplate: string
  customAnswers: Record<string, string>
}

/* ── Job Queue & Application Tracker ────────────────────────────────── */

export type JobStatus =
  | 'queued'
  | 'navigating'
  | 'filling'
  | 'needs_review'
  | 'needs_manual'
  | 'submitted'
  | 'skipped'
  | 'failed'

export interface JobQueueItem {
  id: string
  url: string
  company?: string
  role?: string
  status: JobStatus
  error?: string
  notes?: string
  timestamp: number
  updatedAt: number
}

export interface ApplicationTrackerRecord {
  date: string
  company: string
  role: string
  url: string
  status: string
  notes: string
}
