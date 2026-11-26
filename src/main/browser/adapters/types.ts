import type { WebContents } from 'electron'

export interface AdapterQuirks {
  name: string
  isMultiPage?: boolean
  fileInputSelector?: string
  submitSelector?: string
  nextSelector?: string
  requiresAccountCreation?: boolean
  beforeFill?: (wc: WebContents) => Promise<void>
  afterFill?: (wc: WebContents) => Promise<void>
}

export interface AtsAdapter {
  name: string
  detect: (url: string, title?: string) => boolean
  quirks: AdapterQuirks
}
