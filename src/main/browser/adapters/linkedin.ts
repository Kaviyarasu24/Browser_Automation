import type { AtsAdapter } from './types.js'

export const linkedinAdapter: AtsAdapter = {
  name: 'LinkedIn Easy Apply',
  detect: (url: string) => {
    return url.includes('linkedin.com')
  },
  quirks: {
    name: 'LinkedIn Easy Apply',
    isMultiPage: true,
    fileInputSelector: 'input[type="file"]',
    nextSelector: 'button[aria-label="Continue to next step"], button[aria-label="Review your application"]',
    submitSelector: 'button[aria-label="Submit application"]',
    beforeFill: async (wc) => {
      // If Easy Apply button exists on page, click it to open modal
      await wc.executeJavaScript(`(() => {
        const easyApplyBtn = document.querySelector('.jobs-apply-button, button.jobs-apply-button--top-card');
        if (easyApplyBtn && !document.querySelector('.jobs-easy-apply-modal')) {
          (easyApplyBtn as HTMLElement).click();
        }
      })()`, true).catch(() => {})
    }
  }
}
