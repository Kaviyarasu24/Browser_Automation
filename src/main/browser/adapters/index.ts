import type { AtsAdapter } from './types.js'
import { greenhouseAdapter } from './greenhouse.js'
import { leverAdapter } from './lever.js'
import { workdayAdapter } from './workday.js'
import { ashbyAdapter } from './ashby.js'
import { smartrecruitersAdapter } from './smartrecruiters.js'
import { linkedinAdapter } from './linkedin.js'
import { naukriAdapter } from './naukri.js'

export const ATS_ADAPTERS: AtsAdapter[] = [
  greenhouseAdapter,
  leverAdapter,
  workdayAdapter,
  ashbyAdapter,
  smartrecruitersAdapter,
  linkedinAdapter,
  naukriAdapter
]

export function getAdapter(url: string, title?: string): AtsAdapter | null {
  for (const adapter of ATS_ADAPTERS) {
    if (adapter.detect(url, title)) {
      return adapter
    }
  }
  return null
}

export * from './types.js'
