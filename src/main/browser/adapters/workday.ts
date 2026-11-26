import type { AtsAdapter } from './types.js'

export const workdayAdapter: AtsAdapter = {
  name: 'Workday',
  detect: (url: string) => {
    return url.includes('myworkdayjobs.com') || url.includes('workday.com')
  },
  quirks: {
    name: 'Workday',
    isMultiPage: true,
    requiresAccountCreation: true,
    fileInputSelector: 'input[data-automation-id="file-upload-input-ref"], input[type="file"]',
    nextSelector: 'button[data-automation-id="bottom-navigation-next-button"], button[data-automation-id="page-footer-next-button"]',
    submitSelector: 'button[data-automation-id="bottom-navigation-submit-button"], button[data-automation-id="page-footer-submit-button"]',
    beforeFill: async (wc) => {
      // Workday has custom dropdowns that use data-automation-id
      await wc.executeJavaScript(`(() => {
        // Expand any collapsed sections if present
        const expanders = document.querySelectorAll('[data-automation-id*="expansion-panel-header"]');
        expanders.forEach(e => {
          if (e.getAttribute('aria-expanded') === 'false') (e as HTMLElement).click();
        });
      })()`, true).catch(() => {})
    }
  }
}
