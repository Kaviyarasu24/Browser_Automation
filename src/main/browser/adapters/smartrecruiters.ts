import type { AtsAdapter } from './types.js'

export const smartrecruitersAdapter: AtsAdapter = {
  name: 'SmartRecruiters',
  detect: (url: string) => {
    return url.includes('smartrecruiters.com') || url.includes('jobs.smartrecruiters.com')
  },
  quirks: {
    name: 'SmartRecruiters',
    isMultiPage: true,
    fileInputSelector: 'input#resume-upload, input[type="file"]',
    nextSelector: 'button#next-step, button[data-test="next-step-button"]',
    submitSelector: 'button#submit-btn, button[data-test="submit-button"]'
  }
}
