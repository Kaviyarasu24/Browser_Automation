import type { WebContents } from 'electron'
import type { FormField, FormFieldOption, FormFieldCoordinates } from '../../shared/types.js'

export interface ScanResult {
  url: string
  title: string
  fields: FormField[]
  repeaters: Array<{
    id: string
    label: string
    coordinates: FormFieldCoordinates
  }>
  validationErrors: string[]
  hasSubmitButton: boolean
  hasNextButton: boolean
  submitButtonCoordinates?: FormFieldCoordinates
  nextButtonCoordinates?: FormFieldCoordinates
}

const FORM_SCANNER_SCRIPT = `(() => {
  const isVisible = (el) => {
    if (!el) return false;
    if (el.id === '__strawberry_cursor_host' || el.closest && el.closest('#__strawberry_cursor_host')) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) {
      // Check if it's an invisible file input that might still be valid for automation
      if (el.tagName === 'INPUT' && el.type === 'file') return true;
      return false;
    }
    const style = window.getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none') return false;
    if (parseFloat(style.opacity || '1') === 0 && el.type !== 'file') return false;
    return true;
  };

  const getLabelFor = (el) => {
    // 1. aria-label
    const ariaLabel = el.getAttribute('aria-label');
    if (ariaLabel && ariaLabel.trim()) return ariaLabel.trim();

    // 2. aria-labelledby
    const ariaLabelledBy = el.getAttribute('aria-labelledby');
    if (ariaLabelledBy) {
      const parts = ariaLabelledBy.split(/\\s+/);
      const text = parts.map(id => {
        const target = document.getElementById(id);
        return target ? target.textContent.trim() : '';
      }).filter(Boolean).join(' ');
      if (text) return text.slice(0, 150);
    }

    // 3. label[for=id]
    if (el.id) {
      const labelEl = document.querySelector(\`label[for="\${CSS.escape(el.id)}"]\`);
      if (labelEl && labelEl.textContent) {
        return labelEl.textContent.replace(/\\s+/g, ' ').trim().slice(0, 150);
      }
    }

    // 4. Closest parent label
    const parentLabel = el.closest('label');
    if (parentLabel) {
      // Clone label and remove input inside it to avoid label containing input's value
      const clone = parentLabel.cloneNode(true);
      const inputs = clone.querySelectorAll('input, select, textarea');
      inputs.forEach(i => i.remove());
      const labelText = (clone.textContent || '').replace(/\\s+/g, ' ').trim();
      if (labelText) return labelText.slice(0, 150);
    }

    // 5. Container fieldset / legend or preceding heading / div.label
    const fieldContainer = el.closest('.form-group, .field, [class*="form-item"], [class*="form-field"], .form-row, fieldset');
    if (fieldContainer) {
      const legend = fieldContainer.querySelector('legend, label, .label, [class*="label"], [class*="title"], h3, h4');
      if (legend && legend !== el) {
        const t = (legend.textContent || '').replace(/\\s+/g, ' ').trim();
        if (t && t.length < 150) return t;
      }
    }

    // 6. Preceding sibling or previous element text
    let prev = el.previousElementSibling;
    while (prev) {
      if (prev.tagName === 'LABEL' || prev.classList?.contains('label') || prev.getAttribute('role') === 'label') {
        const text = (prev.textContent || '').replace(/\\s+/g, ' ').trim();
        if (text) return text.slice(0, 150);
      }
      prev = prev.previousElementSibling;
    }

    // 7. placeholder
    const placeholder = el.getAttribute('placeholder');
    if (placeholder && placeholder.trim()) return placeholder.trim();

    // 8. name or id fallback
    const name = el.getAttribute('name');
    if (name) return name.replace(/[_-]/g, ' ').trim();

    return el.id ? el.id.replace(/[_-]/g, ' ').trim() : '';
  };

  // Helper to detect validation error messages near the element
  const getValidationError = (el) => {
    if (el.getAttribute('aria-invalid') === 'true') {
      const descId = el.getAttribute('aria-describedby');
      if (descId) {
        const descEl = document.getElementById(descId);
        if (descEl && descEl.textContent) return descEl.textContent.trim();
      }
    }
    const container = el.closest('.form-group, .field, [class*="field"], .form-row, [class*="form-item"]');
    if (container) {
      const err = container.querySelector('[class*="error"], [class*="invalid"], [class*="danger"], [role="alert"]');
      if (err && isVisible(err)) {
        return (err.textContent || '').trim().slice(0, 120);
      }
    }
    return '';
  };

  // Traversal to pierce open shadow roots and same-origin iframes
  const allElements = [];
  const walk = (node, offsetX = 0, offsetY = 0) => {
    if (!node) return;
    const children = node.children || node.childNodes;
    for (let i = 0; i < children.length; i++) {
      const child = children[i];
      if (child.nodeType !== 1) continue;

      allElements.push({ el: child, offsetX, offsetY });

      if (child.shadowRoot) {
        walk(child.shadowRoot, offsetX, offsetY);
      }

      if (child.tagName === 'IFRAME') {
        try {
          const doc = child.contentDocument || child.contentWindow?.document;
          if (doc) {
            const rect = child.getBoundingClientRect();
            walk(doc.body, offsetX + rect.left, offsetY + rect.top);
          }
        } catch {
          // Cross-origin iframe, ignore
        }
      }
    }
  };

  walk(document.body);

  const scannedFields = [];
  const repeaters = [];
  const validationErrors = [];
  let submitBtnCoords = null;
  let nextBtnCoords = null;
  let hasSubmit = false;
  let hasNext = false;

  const seenIds = new Set();
  let fieldSeq = 0;

  for (const { el, offsetX, offsetY } of allElements) {
    if (!el || el.id === '__strawberry_cursor_host') continue;

    const tag = el.tagName.toLowerCase();
    const role = el.getAttribute('role') || '';
    const rect = el.getBoundingClientRect();
    const coords = {
      x: Math.round(rect.left + offsetX + rect.width / 2),
      y: Math.round(rect.top + offsetY + rect.height / 2),
      width: Math.round(rect.width),
      height: Math.round(rect.height)
    };

    // 1. Detect Submit / Next buttons
    if (tag === 'button' || tag === 'input' && (el.type === 'submit' || el.type === 'button') || role === 'button') {
      const btnText = (el.innerText || el.value || el.textContent || '').trim().toLowerCase();
      if (btnText && isVisible(el)) {
        if (
          btnText.includes('submit') ||
          btnText.includes('apply now') ||
          btnText.includes('send application') ||
          btnText.includes('finish application')
        ) {
          hasSubmit = true;
          submitBtnCoords = coords;
        } else if (
          btnText.includes('next') ||
          btnText.includes('continue') ||
          btnText.includes('save & continue') ||
          btnText.includes('save and continue') ||
          btnText.includes('next step')
        ) {
          hasNext = true;
          nextBtnCoords = coords;
        }

        // Repeater detector: "Add another", "Add education", "Add experience"
        if (/add (another|more|education|experience|employer|school|job|section|entry)/i.test(btnText) ||
            el.getAttribute('data-automation-id')?.includes('add')) {
          repeaters.push({
            id: el.id || \`repeater-\${repeaters.length}\`,
            label: btnText,
            coordinates: coords
          });
        }
      }
    }

    // 2. Form Inputs
    const isInput = tag === 'input';
    const isSelect = tag === 'select';
    const isTextarea = tag === 'textarea';
    const isCustomSelect =
      role === 'combobox' ||
      el.getAttribute('aria-haspopup') === 'listbox' ||
      el.classList.contains('select__control') ||
      el.classList.contains('ant-select-selector') ||
      (el.getAttribute('data-automation-id') || '').includes('select') ||
      (el.getAttribute('data-automation-id') || '').includes('dropdown') ||
      el.classList.contains('css-1hwfws3'); // React-select inner container

    if (!isInput && !isSelect && !isTextarea && !isCustomSelect) continue;
    if (!isVisible(el) && !(isInput && el.type === 'file')) continue;

    const inputType = isInput ? (el.type || 'text').toLowerCase() : tag;
    if (['hidden', 'submit', 'button', 'reset', 'image'].includes(inputType)) continue;

    let fieldType = 'text';
    if (isInput) {
      if (inputType === 'email') fieldType = 'email';
      else if (inputType === 'tel') fieldType = 'tel';
      else if (inputType === 'number') fieldType = 'number';
      else if (inputType === 'checkbox') fieldType = 'checkbox';
      else if (inputType === 'radio') fieldType = 'radio';
      else if (inputType === 'date' || inputType === 'datetime-local') fieldType = 'date';
      else if (inputType === 'file') fieldType = 'file';
    } else if (isTextarea) {
      fieldType = 'textarea';
    } else if (isSelect) {
      fieldType = 'select';
    } else if (isCustomSelect) {
      fieldType = 'custom_dropdown';
    }

    let fieldId = el.id || el.name || '';
    if (!fieldId || seenIds.has(fieldId)) {
      fieldId = \`field_\${fieldSeq++}_\${fieldType}\`;
    }
    seenIds.add(fieldId);

    const label = getLabelFor(el);
    const required = el.required || el.getAttribute('aria-required') === 'true' || label.includes('*');
    const valError = getValidationError(el);
    if (valError) validationErrors.push(\`\${label || fieldId}: \${valError}\`);

    let currentValue = null;
    let options = undefined;

    if (fieldType === 'checkbox') {
      currentValue = el.checked;
    } else if (fieldType === 'radio') {
      currentValue = el.checked ? (el.value || 'on') : null;
      // Get all sibling radio options with the same name if possible
      if (el.name) {
        const group = Array.from(document.querySelectorAll(\`input[type="radio"][name="\${CSS.escape(el.name)}"]\`));
        options = group.map(r => ({
          value: r.value || (getLabelFor(r) || ''),
          label: getLabelFor(r) || r.value || ''
        }));
      }
    } else if (fieldType === 'select') {
      currentValue = el.value || '';
      options = Array.from(el.options || []).map(opt => ({
        value: opt.value,
        label: opt.text.trim()
      }));
    } else if (fieldType === 'custom_dropdown') {
      currentValue = (el.innerText || el.textContent || '').replace(/\\s+/g, ' ').trim();
    } else {
      currentValue = el.value || '';
    }

    scannedFields.push({
      id: fieldId,
      name: el.name || undefined,
      label: label || fieldId,
      type: fieldType,
      options,
      required: Boolean(required),
      currentValue,
      coordinates: coords,
      isCustomDropdown: fieldType === 'custom_dropdown',
      validationError: valError || undefined
    });
  }

  // Deduplicate radio buttons into single composite fields if multiple share the same name
  const consolidatedFields = [];
  const radioGroups = new Map();

  for (const field of scannedFields) {
    if (field.type === 'radio' && field.name) {
      if (!radioGroups.has(field.name)) {
        radioGroups.set(field.name, {
          ...field,
          id: \`radio_group_\${field.name}\`,
          options: field.options || [{ value: field.label, label: field.label }]
        });
        consolidatedFields.push(radioGroups.get(field.name));
      } else {
        const group = radioGroups.get(field.name);
        if (field.currentValue) {
          group.currentValue = field.currentValue;
        }
        if (field.options && field.options.length > (group.options?.length || 0)) {
          group.options = field.options;
        }
      }
    } else {
      consolidatedFields.push(field);
    }
  }

  return {
    url: window.location.href,
    title: document.title,
    fields: consolidatedFields,
    repeaters,
    validationErrors,
    hasSubmitButton: hasSubmit,
    hasNextButton: hasNext,
    submitButtonCoordinates: submitBtnCoords || undefined,
    nextButtonCoordinates: nextBtnCoords || undefined
  };
})()`;

export async function scanForm(wc: WebContents): Promise<ScanResult> {
  if (wc.isDestroyed()) {
    return {
      url: '',
      title: '',
      fields: [],
      repeaters: [],
      validationErrors: [],
      hasSubmitButton: false,
      hasNextButton: false
    }
  }

  try {
    const result = (await wc.executeJavaScript(FORM_SCANNER_SCRIPT, true)) as ScanResult
    return result
  } catch (err) {
    console.warn('[form-scanner] execute failed:', (err as Error).message)
    return {
      url: wc.getURL() || '',
      title: wc.getTitle() || '',
      fields: [],
      repeaters: [],
      validationErrors: [],
      hasSubmitButton: false,
      hasNextButton: false
    }
  }
}

/**
 * Handles custom dropdowns (React-Select, Workday, Ant Design, etc.):
 * 1. Clicks on the dropdown toggle coordinates.
 * 2. Waits for the dropdown overlay / menu / portal to appear.
 * 3. Scans and returns the visible list of option labels and values.
 */
export async function readCustomDropdownOptions(
  wc: WebContents,
  coordinates: FormFieldCoordinates
): Promise<FormFieldOption[]> {
  if (wc.isDestroyed()) return []

  const SCRIPT = `(() => {
    // Collect options from open menus/listboxes/popovers
    const selectors = [
      '[role="listbox"] [role="option"]',
      '.select__menu [class*="option"]',
      '.ant-select-item-option',
      '[data-automation-id*="menu-item"]',
      '[data-automation-id*="select-option"]',
      'ul[role="listbox"] li',
      '.dropdown-menu li, .dropdown-menu a'
    ].join(',');

    const optionNodes = Array.from(document.querySelectorAll(selectors));
    return optionNodes.map(node => {
      const text = (node.innerText || node.textContent || '').trim();
      const val = node.getAttribute('data-value') || node.getAttribute('value') || text;
      const rect = node.getBoundingClientRect();
      return {
        value: val,
        label: text,
        x: Math.round(rect.left + rect.width / 2),
        y: Math.round(rect.top + rect.height / 2)
      };
    }).filter(o => Boolean(o.label));
  })()`;

  try {
    // Wait for dropdown popover to mount in DOM
    await new Promise((r) => setTimeout(r, 250))
    const options = (await wc.executeJavaScript(SCRIPT, true)) as Array<
      FormFieldOption & { x: number; y: number }
    >
    return options
  } catch {
    return []
  }
}

/**
 * Selects an option inside an already open custom dropdown by matching text.
 */
export async function selectCustomDropdownOption(
  wc: WebContents,
  targetText: string
): Promise<{ ok: boolean; selectedText?: string }> {
  if (wc.isDestroyed()) return { ok: false }

  const SCRIPT = `((text) => {
    const cleanTarget = text.toLowerCase().trim();
    const selectors = [
      '[role="listbox"] [role="option"]',
      '.select__menu [class*="option"]',
      '.ant-select-item-option',
      '[data-automation-id*="menu-item"]',
      '[data-automation-id*="select-option"]',
      'ul[role="listbox"] li',
      '.dropdown-menu li, .dropdown-menu a, .dropdown-item'
    ].join(',');

    const options = Array.from(document.querySelectorAll(selectors));
    // Exact or best substring match
    let match = options.find(o => (o.innerText || o.textContent || '').trim().toLowerCase() === cleanTarget);
    if (!match) {
      match = options.find(o => (o.innerText || o.textContent || '').trim().toLowerCase().includes(cleanTarget));
    }

    if (match) {
      const rect = match.getBoundingClientRect();
      // Scroll into view if needed
      match.scrollIntoView({ block: 'nearest' });
      const x = Math.round(rect.left + rect.width / 2);
      const y = Math.round(rect.top + rect.height / 2);
      return { found: true, text: (match.innerText || match.textContent || '').trim(), x, y };
    }
    return { found: false };
  })(${JSON.stringify(targetText)})`;

  try {
    const res = (await wc.executeJavaScript(SCRIPT, true)) as {
      found: boolean
      text?: string
      x?: number
      y?: number
    }
    if (res.found && res.x !== undefined && res.y !== undefined) {
      // Dispatch real click on the matched option
      wc.sendInputEvent({ type: 'mouseMove', x: res.x, y: res.y })
      wc.sendInputEvent({ type: 'mouseDown', x: res.x, y: res.y, button: 'left', clickCount: 1 })
      wc.sendInputEvent({ type: 'mouseUp', x: res.x, y: res.y, button: 'left', clickCount: 1 })
      await new Promise((r) => setTimeout(r, 200))
      return { ok: true, selectedText: res.text }
    }
    return { ok: false }
  } catch {
    return { ok: false }
  }
}
