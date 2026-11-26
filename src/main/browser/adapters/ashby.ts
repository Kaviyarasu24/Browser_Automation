import type { AtsAdapter } from './types.js'

export const ashbyAdapter: AtsAdapter = {
  name: 'Ashby',
  detect: (url: string) => {
    return url.includes('ashbyhq.com') || url.includes('jobs.ashbyhq.com')
  },
  quirks: {
    name: 'Ashby',
    isMultiPage: false,
    fileInputSelector: 'input[type="file"]',
    submitSelector: 'button[type="submit"], button._submitButton',
    beforeFill: async (wc) => {
      // Ensure application form container is scrolled into view
      await wc.executeJavaScript(`(() => {
        const form = document.querySelector('form');
        if (form) form.scrollIntoView({ behavior: 'smooth' });
      })()`, true).catch(() => {})
    }
  }
}
