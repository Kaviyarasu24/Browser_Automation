import type { AtsAdapter } from './types.js'

export const naukriAdapter: AtsAdapter = {
  name: 'Naukri',
  detect: (url: string) => {
    return url.includes('naukri.com')
  },
  quirks: {
    name: 'Naukri',
    isMultiPage: false,
    fileInputSelector: 'input[type="file"], input#attachCV',
    submitSelector: 'button#apply-button, .apply-button, button.waves-effect',
    beforeFill: async (wc) => {
      // Dismiss any popups or chat overlays on Naukri
      await wc.executeJavaScript(`(() => {
        const closeCross = document.querySelector('.crossIcon, .close-btn');
        if (closeCross) (closeCross as HTMLElement).click();
      })()`, true).catch(() => {})
    }
  }
}
