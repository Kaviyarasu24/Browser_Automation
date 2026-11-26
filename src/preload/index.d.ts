import type { EdithApi } from './index.js'

declare global {
  interface Window {
    api: EdithApi
  }
}

