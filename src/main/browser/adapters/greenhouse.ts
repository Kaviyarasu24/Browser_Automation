import type { AtsAdapter } from './types.js'

export const greenhouseAdapter: AtsAdapter = {
  name: 'Greenhouse',
  detect: (url: string) => {
    return url.includes('boards.greenhouse.io') || url.includes('greenhouse.io') || url.includes('gh_jid=')
  },
  quirks: {
    name: 'Greenhouse',
    isMultiPage: false,
    fileInputSelector: 'input#resume, input[name="resume"], input[data-qa="resume"]',
    submitSelector: 'input#submit_app, button#submit_app, button[data-qa="submit-app"]',
    beforeFill: async (wc) => {
      // Greenhouse forms often have styled drop zones or buttons
      await wc.executeJavaScript(`(() => {
        const attachBtns = document.querySelectorAll('button[data-source="attach"]');
        attachBtns.forEach(b => (b.style.pointerEvents = 'auto'));
      })()`, true).catch(() => {})
    }
  }
}
