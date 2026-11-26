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
        'Explicitly re-read the active page: URL, title, numbered interactive elements, and visible text. Use this when you need fresh element indices after scrolling, or when you are unsure what changed.',
      parameters: { type: 'object', properties: {}, required: [] }
    }
  },
  {
    type: 'function',
    function: {
      name: 'navigate',
      description:
        'Navigate the active tab to a URL (e.g. direct domain or search URL https://www.google.com/search?q=...). Automatically returns the fresh page state and elements — you do NOT need to call read_page after navigate.',
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
        'Click an interactive element by its index from the most recent page snapshot. Scrolls element into view automatically and returns the updated page state — you do NOT need to call read_page after click.',
      parameters: {
        type: 'object',
        properties: {
          index: {
            type: 'integer',
            description: 'Element index from the most recent page snapshot.'
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
      name: 'export_data',
      description:
        'Save extracted data, tables, reports, or findings directly to a local file in the user\'s Downloads/Strawberry folder. Format can be "csv", "json", "md", or "txt". Use this whenever the user asks to save, download, or export data.',
      parameters: {
        type: 'object',
        properties: {
          content: { type: 'string', description: 'The text, markdown, CSV table, or JSON content to save.' },
          filename: { type: 'string', description: 'Suggested filename, e.g. "odi_match_schedule.csv" or "report.md".' },
          format: { type: 'string', enum: ['csv', 'json', 'md', 'txt'], description: 'File extension/format. Defaults to "txt" or "md".' }
        },
        required: ['content']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'scan_form',
      description:
        'Scan the active page, including iframes, shadow DOM, and custom controls, for form inputs (text, email, tel, number, textarea, select, custom dropdowns, radio, checkbox, date, file). Returns the structured list of fields and validation errors.',
      parameters: {
        type: 'object',
        properties: {},
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'fill_form',
      description:
        'Fill detected form fields using profile data, cached answers, and intelligent mapping. Dispatches native hardware input events with 2x typing speed, animates the virtual cursor, and verifies each input acceptance.',
      parameters: {
        type: 'object',
        properties: {
          dryRun: {
            type: 'boolean',
            description: 'If true, maps and enters values but will never allow final form submission.'
          },
          reviewFirst: {
            type: 'boolean',
            description: 'If true, asks the user for review before filling fields with confidence < 0.7 or sensitive topics.'
          }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'upload_file',
      description:
        'Attach a file (such as candidate resume or cover letter) to a form file input. Handles hidden file inputs behind styled "Upload" buttons without opening system dialogs.',
      parameters: {
        type: 'object',
        properties: {
          fileType: {
            type: 'string',
            enum: ['resume', 'cover_letter'],
            description: 'Type of document to upload from user profile.'
          },
          fieldId: {
            type: 'string',
            description: 'Specific field ID of the file input (optional; defaults to first file input).'
          },
          customPath: {
            type: 'string',
            description: 'Optional explicit local file path override.'
          }
        },
        required: ['fileType']
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'next_step',
      description:
        'Click the Next / Continue / Save & Next button on a multi-step job application form, wait for the next section to load, and automatically re-scan new form fields.',
      parameters: {
        type: 'object',
        properties: {},
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'review_form',
      description:
        'Display a comprehensive review summary of mapped fields (showing proposed values, sources, and confidence) in the user\'s sidebar for manual inspection and approval before advancing.',
      parameters: {
        type: 'object',
        properties: {
          note: {
            type: 'string',
            description: 'Brief note to user explaining what requires review.'
          }
        },
        required: []
      }
    }
  },
  {
    type: 'function',
    function: {
      name: 'submit_form',
      description:
        'Submit the completed job application. REQUIRES EXPLICIT USER APPROVAL. Will be rejected if user has not authorized submission.',
      parameters: {
        type: 'object',
        properties: {
          confirmed: {
            type: 'boolean',
            description: 'Must be true to proceed with final submission.'
          }
        },
        required: ['confirmed']
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
