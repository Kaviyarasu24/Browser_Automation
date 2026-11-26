import type { PageElement } from './page-state.js'
import type { WebContents } from 'electron'

export interface SafeguardCheck {
  sensitive: boolean
  title: string
  description: string
}

export const TRUSTED_ATS_DOMAINS = [
  'greenhouse.io',
  'boards.greenhouse.io',
  'lever.co',
  'jobs.lever.co',
  'myworkdayjobs.com',
  'workday.com',
  'ashbyhq.com',
  'jobs.ashbyhq.com',
  'smartrecruiters.com',
  'jobs.smartrecruiters.com',
  'linkedin.com',
  'naukri.com',
  'icims.com',
  'jobvite.com',
  'bamboohr.com',
  'rippling.com',
  'applytojob.com',
  'breezy.hr',
  'jazzhr.com',
  'taleo.net',
  'pinpointhq.com',
  'workable.com'
]

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
      // 1. Check if target is a known trusted ATS provider
      const isTrustedAts = TRUSTED_ATS_DOMAINS.some(
        (domain) => target.hostname === domain || target.hostname.endsWith(`.${domain}`)
      )
      if (isTrustedAts) {
        return { sensitive: false, title: '', description: '' }
      }

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

/**
 * Detects presence of bot challenges, CAPTCHAs, OTP prompts, or login walls
 * that require human intervention.
 */
export async function detectUserInterventionRequired(
  wc: WebContents
): Promise<{
  required: boolean
  reason: 'captcha' | 'login' | 'otp' | 'verification' | 'other'
  title: string
  message: string
} | null> {
  if (wc.isDestroyed()) return null

  const SCRIPT = `(() => {
    const text = (document.body ? document.body.innerText : '').toLowerCase();

    // 1. CAPTCHA Detection
    const hasCaptcha =
      document.querySelector('iframe[src*="recaptcha"], iframe[src*="hcaptcha"], iframe[src*="turnstile"], div.cf-turnstile, #cf-wrapper') ||
      text.includes('verify you are human') ||
      text.includes('complete the captcha') ||
      text.includes('press & hold') ||
      text.includes('unusual traffic');

    if (hasCaptcha) {
      return {
        required: true,
        reason: 'captcha',
        title: 'CAPTCHA Verification Required',
        message: 'A security challenge or human verification check is visible. Please complete it in the browser tab to continue.'
      };
    }

    // 2. OTP / 2FA / Email code verification
    const hasOtp =
      text.includes('enter the 6-digit code') ||
      text.includes('enter security code') ||
      text.includes('one-time password') ||
      text.includes('verification code has been sent') ||
      document.querySelector('input[autocomplete="one-time-code"], input[name*="otp"], input[id*="otp"]');

    if (hasOtp) {
      return {
        required: true,
        reason: 'otp',
        title: 'Verification Code Required',
        message: 'An SMS or email verification code / OTP is requested. Please enter the code in the browser tab to continue.'
      };
    }

    // 3. Workday or ATS Account Creation / Sign-In wall
    const isWorkdaySignIn =
      (window.location.hostname.includes('myworkdayjobs.com') || window.location.hostname.includes('workday')) &&
      (text.includes('sign in') || text.includes('create account')) &&
      document.querySelector('input[type="password"]');

    if (isWorkdaySignIn) {
      return {
        required: true,
        reason: 'login',
        title: 'Account Sign In / Creation Required',
        message: 'This application requires signing into or creating an applicant account. Please sign in or create an account to proceed.'
      };
    }

    return null;
  })()`

  try {
    return (await wc.executeJavaScript(SCRIPT, true)) as {
      required: boolean
      reason: 'captcha' | 'login' | 'otp' | 'verification' | 'other'
      title: string
      message: string
    } | null
  } catch {
    return null
  }
}

