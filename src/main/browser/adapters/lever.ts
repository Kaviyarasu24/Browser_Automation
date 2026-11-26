import type { AtsAdapter } from './types.js'

export const leverAdapter: AtsAdapter = {
  name: 'Lever',
  detect: (url: string) => {
    return url.includes('jobs.lever.co') || url.includes('lever.co')
  },
  quirks: {
    name: 'Lever',
    isMultiPage: false,
    fileInputSelector: 'input[name="resume"], input#resume-upload-input',
    submitSelector: 'button#btn-submit, button[data-qa="btn-submit"]',
    beforeFill: async (wc) => {
      // If on the job description page, click "Apply for this job" button to open application form
      await wc.executeJavaScript(`(() => {
        const applyBtn = document.querySelector('.postings-btn, a[href*="/apply"]');
        if (applyBtn && !document.querySelector('form.application-form')) {
          applyBtn.click();
        }
      })()`, true).catch(() => {})
    }
  }
}
