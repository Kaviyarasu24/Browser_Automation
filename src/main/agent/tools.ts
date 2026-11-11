import type { ToolDef } from './llm.js'

/**
 * Tools exposed to the model.
 *
 * Design notes:
 *
 * - Element references are *indices into the most recent page snapshot*, not
 *   CSS selectors or XPaths. Models pick the wrong selector from a realistic
 *   DOM constantly; they pick the right item from a numbered list reliably.
 *   The cost is that indices go stale, which the executor handles by
 *   re-reading the page and rejecting out-of-range indices loudly.
 *
 * - `done` and `ask_user` are terminal-ish and always available. Without an
 *   explicit stop signal, models loop forever "verifying" their own work.
 *
 * - Descriptions are written for the model, not for humans. They state what
 *   the tool does NOT do, because negative constraints measurably reduce
 *   tool misuse.
 */
export const BROWSER_TOOLS: ToolDef[] = [
  {
    type: 'function',
    function: {
      name: 'read_page',
      description:
        'Read the current page: URL, title, numbered interactive elements, and visible text. Call this after every navigation, click, or scroll — element indices change whenever the page changes, so an index from an earlier step may point at a different element now. Also call it when you are unsure what happened after an action.',
      parameters: { type: 'object', properties: {}, required: [] }
    }
  },
  {
    type: 'function',
    function: {
      name: 'navigate',
      description:
        'Navigate the active tab to a URL. Use a full URL including https://. This replaces the current page. After navigating, call read_page to see the new content.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Absolute URL, e.g. https://example.com/path' }
        },
        required: ['url']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'click',
      description:
        'Click an interactive element by its index from the most recent read_page output. Scrolls the element into view automatically if needed. After clicking, call read_page — pages usually change.',
      parameters: {
        type: 'object',
        properties: {
          index: {
            type: 'integer',
            description: 'Element index from the most recent read_page output.'
          },
          reason: {
            type: 'string',
            description: 'Brief note on why this element, shown to the user.'
          }
        },
        required: ['index']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'type',
      description:
        'Type text into an input, textarea, or contenteditable element, identified by its index. Clears nothing first — it focuses the element and inserts the text. Set submit=true to press Enter afterwards (use for search boxes and single-line forms).',
      parameters: {
        type: 'object',
        properties: {
          index: { type: 'integer', description: 'Element index from the most recent read_page.' },
          text: { type: 'string', description: 'The exact text to type.' },
          submit: {
            type: 'boolean',
            description: 'Press Enter after typing. Defaults to false.'
          }
        },
        required: ['index', 'text']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'scroll',
      description:
        'Scroll the page up or down. Use when the element you need is not in the element list, or to load more content. Prefer clicking the element you want over scrolling blindly.',
      parameters: {
        type: 'object',
        properties: {
          direction: { type: 'string', enum: ['up', 'down'] },
          amount: {
            type: 'integer',
            description: 'Pixels to scroll. Defaults to 800, roughly one screen.'
          }
        },
        required: ['direction']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'go_back',
      description: 'Go back one page in this tab’s history. Fails if there is no previous page.',
      parameters: { type: 'object', properties: {}, required: [] }
    }
  },
  {
    type: 'function',
    function: {
      name: 'press_key',
      description:
        'Press a single navigation key. Allowed: Enter, Escape, Tab, ArrowDown, ArrowUp, PageDown, PageUp. Use Escape to dismiss dialogs and overlays. For typing text, use the type tool instead.',
      parameters: {
        type: 'object',
        properties: {
          key: {
            type: 'string',
            enum: ['Enter', 'Escape', 'Tab', 'ArrowDown', 'ArrowUp', 'PageDown', 'PageUp']
          }
        },
        required: ['key']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'wait',
      description:
        'Pause for a few seconds so a slow page can finish loading. Prefer calling read_page instead — it is usually enough. Maximum 15 seconds.',
      parameters: {
        type: 'object',
        properties: {
          seconds: { type: 'number', description: 'Seconds to wait, 0.5 to 15.' }
        },
        required: ['seconds']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'open_tab',
      description:
        'Open a URL in a new background tab without leaving the current page. Use for research where you want to consult a source and return. The new tab is NOT active, so read_page still reads the current page until you switch.',
      parameters: {
        type: 'object',
        properties: { url: { type: 'string', description: 'Absolute URL to open.' } },
        required: ['url']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'done',
      description:
        'Finish the task and report the result. Call this exactly once when the goal is achieved OR when you conclude it cannot be achieved. Do not call it to report progress — only to end the run.',
      parameters: {
        type: 'object',
        properties: {
          summary: {
            type: 'string',
            description: 'The final answer or outcome, written for the user.'
          },
          success: {
            type: 'boolean',
            description: 'True if the goal was achieved, false if it was not possible.'
          }
        },
        required: ['summary', 'success']
      }
    }
  }
]
