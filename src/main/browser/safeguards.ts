import type { PageElement } from './page-state.js'

export interface SafeguardCheck {
  sensitive: boolean
  title: string
  description: string
}

const SENSITIVE_KEYWORDS = [
  // Financial & Purchases
  'pay',
  'payment',
  'purchase',
  'buy now',
  'place order',
  'confirm order',
  'checkout',
  'complete order',
  'charge',
  'subscribe',
  'transfer funds',
  'send money',
  'billing',

  // Destructive Actions
  'delete',
  'destroy',
  'terminate',
  'wipe',
  'remove account',
  'delete account',
  'close account',
  'cancel subscription',
  'drop database',
  'erase',

  // Security & Credentials
  'reset password',
  'change password',
  'revoke key',
  'delete key',
  'make public'
]

/**
 * Checks whether clicking an element should trigger a human confirmation gate.
 */
export function checkSensitiveClick(element: PageElement): SafeguardCheck {
  const label = (element.label || '').toLowerCase().trim()
  const role = (element.role || '').toLowerCase()
  const tag = element.tag.toLowerCase()

  // Match against high-risk action words
  for (const keyword of SENSITIVE_KEYWORDS) {
    // Regex for word boundary so "payment" or "pay" matches, but unrelated strings do not
    const regex = new RegExp(`\\b${keyword}\\b`, 'i')
    if (regex.test(label)) {
      return {
        sensitive: true,
        title: 'Sensitive Action Detected',
        description: `The agent is attempting to click an action with keyword "${keyword}" on <${tag}>: "${element.label}".`
      }
    }
  }

  return { sensitive: false, title: '', description: '' }
}

/**
 * Checks whether typing into an element should trigger a human confirmation gate
 * (e.g. password fields or credit card inputs).
 */
export function checkSensitiveType(element: PageElement, text: string): SafeguardCheck {
  const type = (element.type || '').toLowerCase()
  const label = (element.label || '').toLowerCase()

  if (type === 'password' || label.includes('password') || label.includes('cvv') || label.includes('card number')) {
    return {
      sensitive: true,
      title: 'Credential / Financial Input',
      description: `The agent is about to type into a sensitive input field (${element.label || type}).`
    }
  }

  return { sensitive: false, title: '', description: '' }
}

/**
 * Checks whether navigating to a URL crosses into an unexpected domain.
 */
export function checkSensitiveNavigation(targetUrl: string, currentUrl: string): SafeguardCheck {
  try {
    const current = new URL(currentUrl)
    const target = new URL(targetUrl)

    // Ignore about:blank or same-host navigations
    if (!currentUrl || currentUrl === 'about:blank' || current.hostname === target.hostname) {
      return { sensitive: false, title: '', description: '' }
    }

    // Flag cross-domain navigation if leaving an established domain
    if (current.hostname && target.hostname !== current.hostname) {
      const isSubdomain =
        target.hostname.endsWith(`.${current.hostname}`) ||
        current.hostname.endsWith(`.${target.hostname}`)
      if (!isSubdomain) {
        return {
          sensitive: true,
          title: 'Cross-Domain Navigation',
          description: `The agent wants to navigate away from "${current.hostname}" to external domain "${target.hostname}".`
        }
      }
    }
  } catch {
    /* ignore unparseable URLs */
  }

  return { sensitive: false, title: '', description: '' }
}

