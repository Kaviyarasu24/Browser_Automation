/**
 * The single most important line in this project.
 *
 * A *persistent* partition stores cookies, localStorage and IndexedDB under
 * `userData/Partitions/strawberry`, so a login survives an app restart.
 *
 * This is the structural difference between this app and a Playwright-based
 * agent: Playwright launches a fresh, empty browser context every run unless
 * you hand it a storage-state file. Here the session *is* the user's.
 *
 * Changing this string silently logs the user out of everything.
 */
export const BROWSER_PARTITION = 'persist:strawberry'

/**
 * A normal desktop-browser User-Agent.
 *
 * Electron's default UA advertises "Electron/45.2.3" and gets sites — notably
 * Google account login — to serve a degraded or blocked experience. Stripping
 * the Electron token makes the app look like the Chrome it actually is.
 */
export function browserUserAgent(chromeVersion: string): string {
  return (
    `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 ` +
    `(KHTML, like Gecko) Chrome/${chromeVersion} Safari/537.36`
  )
}
