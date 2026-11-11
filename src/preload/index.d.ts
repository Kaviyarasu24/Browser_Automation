import type { StrawberryApi } from './index.js'

declare global {
  interface Window {
    api: StrawberryApi
  }
}

