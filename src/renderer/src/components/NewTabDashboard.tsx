import React, { useEffect, useRef, useState } from 'react'
import { IconClose, IconGlobe, IconPlus, IconSearch, IconSparkles, IconFile } from './Icons.js'

export interface ShortcutItem {
  title: string
  url: string
}

interface NewTabDashboardProps {
  onNavigate: (urlOrQuery: string) => void
  onRunAgent: (prompt: string) => void
  onOpenQueue: () => void
}

const STORAGE_KEY = 'edith_newtab_shortcuts'
const QUICK_LINKS_KEY = 'edith_newtab_quick_links'
const BG_STORAGE_KEY = 'edith_newtab_background'

const DEFAULT_QUICK_LINKS: ShortcutItem[] = [
  { title: 'Live cricket scores', url: 'https://www.cricbuzz.com' },
  { title: 'Hacker News', url: 'https://news.ycombinator.com' },
  { title: 'GitHub trending', url: 'https://github.com/trending' }
]

const DEFAULT_SHORTCUTS: ShortcutItem[] = [
  { title: 'Google', url: 'https://www.google.com' },
  { title: 'GitHub', url: 'https://github.com' },
  { title: 'LinkedIn', url: 'https://www.linkedin.com/jobs' },
  { title: 'Naukri', url: 'https://www.naukri.com' },
  { title: 'YouTube', url: 'https://www.youtube.com' }
]

function loadShortcuts(): ShortcutItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as ShortcutItem[]
      if (Array.isArray(parsed) && parsed.length > 0) return parsed
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_SHORTCUTS
}

function loadQuickLinks(): ShortcutItem[] {
  try {
    const raw = localStorage.getItem(QUICK_LINKS_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as ShortcutItem[]
      if (Array.isArray(parsed)) return parsed
    }
  } catch {
    /* ignore */
  }
  return DEFAULT_QUICK_LINKS
}

function getHostname(rawUrl: string): string {
  try {
    return new URL(rawUrl).hostname.replace(/^www\./, '')
  } catch {
    return rawUrl
  }
}

function loadBackground(): string | null {
  try {
    return localStorage.getItem(BG_STORAGE_KEY)
  } catch {
    return null
  }
}

function compressImageToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(new Error('Failed to read image'))
    reader.onload = () => {
      const dataUrl = String(reader.result || '')
      // Keep small images / GIFs untouched
      if (file.size <= 1.5 * 1024 * 1024 || file.type === 'image/gif') {
        resolve(dataUrl)
        return
      }
      const img = new Image()
      img.onerror = () => resolve(dataUrl)
      img.onload = () => {
        const maxW = 1920
        const scale = img.width > maxW ? maxW / img.width : 1
        const canvas = document.createElement('canvas')
        canvas.width = Math.round(img.width * scale)
        canvas.height = Math.round(img.height * scale)
        const ctx = canvas.getContext('2d')
        if (!ctx) {
          resolve(dataUrl)
          return
        }
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height)
        resolve(canvas.toDataURL('image/jpeg', 0.88))
      }
      img.src = dataUrl
    }
    reader.readAsDataURL(file)
  })
}

export const NewTabDashboard: React.FC<NewTabDashboardProps> = ({
  onNavigate,
  onRunAgent,
  onOpenQueue
}) => {
  const [query, setQuery] = useState('')
  const [mode, setMode] = useState<'web' | 'agent'>('web')
  const [now, setNow] = useState(() => new Date())
  const [shortcuts, setShortcuts] = useState<ShortcutItem[]>(loadShortcuts)
  const [quickLinks, setQuickLinks] = useState<ShortcutItem[]>(loadQuickLinks)
  const [failedIcons, setFailedIcons] = useState<Record<string, boolean>>({})
  const [backgroundUrl, setBackgroundUrl] = useState<string | null>(loadBackground)
  const bgInputRef = useRef<HTMLInputElement>(null)

  // Add shortcut / quick-access modal state
  const [addTarget, setAddTarget] = useState<'shortcut' | 'quick' | null>(null)
  const [newTitle, setNewTitle] = useState('')
  const [newUrl, setNewUrl] = useState('')

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30000)
    return () => clearInterval(timer)
  }, [])

  const saveShortcuts = (next: ShortcutItem[]) => {
    setShortcuts(next)
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
    } catch {
      /* ignore */
    }
  }

  const saveQuickLinks = (next: ShortcutItem[]) => {
    setQuickLinks(next)
    try {
      localStorage.setItem(QUICK_LINKS_KEY, JSON.stringify(next))
    } catch {
      /* ignore */
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    const trimmed = query.trim()
    if (!trimmed) return
    if (mode === 'agent' || trimmed.startsWith('>')) {
      const prompt = trimmed.startsWith('>') ? trimmed.slice(1).trim() : trimmed
      if (prompt) onRunAgent(prompt)
    } else {
      onNavigate(trimmed)
    }
    setQuery('')
  }

  const handleAddItem = (e: React.FormEvent) => {
    e.preventDefault()
    let rawUrl = newUrl.trim()
    if (!rawUrl) return
    if (!/^https?:\/\//i.test(rawUrl)) {
      rawUrl = `https://${rawUrl}`
    }
    const host = getHostname(rawUrl)
    const title = newTitle.trim() || host
    if (addTarget === 'quick') {
      saveQuickLinks([...quickLinks, { title, url: rawUrl }])
    } else {
      saveShortcuts([...shortcuts, { title, url: rawUrl }])
    }
    setNewTitle('')
    setNewUrl('')
    setAddTarget(null)
  }

  const handleRemoveShortcut = (e: React.MouseEvent, idx: number) => {
    e.stopPropagation()
    saveShortcuts(shortcuts.filter((_, i) => i !== idx))
  }

  const handleRemoveQuickLink = (e: React.MouseEvent, idx: number) => {
    e.stopPropagation()
    saveQuickLinks(quickLinks.filter((_, i) => i !== idx))
  }

  const handleBackgroundFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    try {
      const dataUrl = await compressImageToDataUrl(file)
      localStorage.setItem(BG_STORAGE_KEY, dataUrl)
      setBackgroundUrl(dataUrl)
    } catch {
      /* ignore */
    }
  }

  const handleResetBackground = () => {
    try {
      localStorage.removeItem(BG_STORAGE_KEY)
    } catch {
      /* ignore */
    }
    setBackgroundUrl(null)
  }

  const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const dateStr = now.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })

  return (
    <div
      className={`newtab-dashboard ${backgroundUrl ? 'has-bg' : ''}`}
      style={
        backgroundUrl
          ? {
              backgroundImage: `linear-gradient(rgba(16, 17, 20, 0.56), rgba(16, 17, 20, 0.68)), url(${backgroundUrl})`,
              backgroundSize: 'cover',
              backgroundPosition: 'center'
            }
          : undefined
      }
    >
      <input
        ref={bgInputRef}
        type="file"
        accept="image/*"
        style={{ display: 'none' }}
        onChange={(e) => void handleBackgroundFileChange(e)}
      />

      <div className="newtab-topbar">
        <div className="newtab-bg-controls">
          <button
            type="button"
            className="newtab-bg-btn"
            onClick={() => bgInputRef.current?.click()}
          >
            {backgroundUrl ? 'Change background' : 'Set background'}
          </button>
          {backgroundUrl && (
            <button
              type="button"
              className="newtab-bg-btn"
              onClick={handleResetBackground}
            >
              Reset
            </button>
          )}
        </div>
        <span className="newtab-time">
          {dateStr} · {timeStr}
        </span>
      </div>

      <div className="newtab-inner">
        <div className="newtab-brand">
          <h1 className="newtab-wordmark">EDITH</h1>
        </div>

        {/* Search / Command Bar */}
        <form className="newtab-search-form" onSubmit={handleSubmit}>
          <span className="newtab-search-icon">
            {mode === 'agent' ? <IconSparkles size={15} /> : <IconSearch size={15} />}
          </span>
          <input
            type="text"
            className="newtab-search-input"
            placeholder={
              mode === 'agent'
                ? 'Describe a task for EDITH...'
                : 'Search Google or type a URL'
            }
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
          />
          <div className="newtab-mode-toggle" role="group" aria-label="Input mode">
            <button
              type="button"
              className={`newtab-mode-btn ${mode === 'web' ? 'active' : ''}`}
              onClick={() => setMode('web')}
            >
              <IconGlobe size={12} />
              <span>Web</span>
            </button>
            <button
              type="button"
              className={`newtab-mode-btn ${mode === 'agent' ? 'active' : ''}`}
              onClick={() => setMode('agent')}
            >
              <IconSparkles size={12} />
              <span>Agent</span>
            </button>
          </div>
        </form>

        {/* Shortcuts with Favicons + Add Button */}
        <div className="newtab-shortcuts">
          {shortcuts.map((site, idx) => {
            const host = getHostname(site.url)
            const faviconUrl = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`
            const showFallback = failedIcons[site.url]

            return (
              <div
                key={`${site.url}-${idx}`}
                role="button"
                tabIndex={0}
                className="newtab-shortcut-tile"
                onClick={() => onNavigate(site.url)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onNavigate(site.url)
                  }
                }}
                title={site.url}
              >
                <button
                  type="button"
                  className="newtab-shortcut-remove"
                  title="Remove shortcut"
                  onClick={(e) => handleRemoveShortcut(e, idx)}
                >
                  <IconClose size={11} />
                </button>
                <div className="newtab-shortcut-icon">
                  {!showFallback ? (
                    <img
                      src={faviconUrl}
                      alt=""
                      className="newtab-shortcut-img"
                      onError={() =>
                        setFailedIcons((prev) => ({ ...prev, [site.url]: true }))
                      }
                    />
                  ) : (
                    <span>{(site.title || host).charAt(0).toUpperCase()}</span>
                  )}
                </div>
                <span className="newtab-shortcut-title">{site.title || host}</span>
              </div>
            )
          })}

          <button
            type="button"
            className="newtab-shortcut-tile newtab-shortcut-add"
            onClick={() => setAddTarget('shortcut')}
            title="Add shortcut"
          >
            <div className="newtab-shortcut-icon">
              <IconPlus size={18} />
            </div>
            <span className="newtab-shortcut-title">Add shortcut</span>
          </button>
        </div>

        {/* Quick Access Links (Direct URL navigation, 0 tokens) */}
        <div className="newtab-actions-row">
          {quickLinks.map((item, idx) => {
            const host = getHostname(item.url)
            const faviconUrl = `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=32`
            const showFallback = failedIcons[item.url]

            return (
              <div
                key={`${item.url}-${idx}`}
                role="button"
                tabIndex={0}
                className="newtab-action-link"
                title={item.url}
                onClick={() => onNavigate(item.url)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    onNavigate(item.url)
                  }
                }}
              >
                {!showFallback ? (
                  <img
                    src={faviconUrl}
                    alt=""
                    className="newtab-action-img"
                    onError={() =>
                      setFailedIcons((prev) => ({ ...prev, [item.url]: true }))
                    }
                  />
                ) : (
                  <IconGlobe size={12} />
                )}
                <span>{item.title}</span>
                <button
                  type="button"
                  className="newtab-action-remove"
                  title="Remove quick link"
                  onClick={(e) => handleRemoveQuickLink(e, idx)}
                >
                  <IconClose size={10} />
                </button>
              </div>
            )
          })}
          <button type="button" className="newtab-action-link" onClick={onOpenQueue}>
            <IconFile size={12} />
            <span>Job Queue</span>
          </button>
          <button
            type="button"
            className="newtab-action-link newtab-action-add"
            onClick={() => setAddTarget('quick')}
            title="Add quick access link"
          >
            <IconPlus size={12} />
            <span>Add link</span>
          </button>
        </div>
      </div>

      {/* Add Shortcut / Quick Access Dialog */}
      {addTarget && (
        <div className="newtab-modal-backdrop" onClick={() => setAddTarget(null)}>
          <form
            className="newtab-modal"
            onClick={(e) => e.stopPropagation()}
            onSubmit={handleAddItem}
          >
            <div className="newtab-modal-header">
              <h2>{addTarget === 'quick' ? 'Add quick access link' : 'Add shortcut'}</h2>
              <button
                type="button"
                className="newtab-modal-close"
                onClick={() => setAddTarget(null)}
              >
                <IconClose size={14} />
              </button>
            </div>
            <div className="settings-field">
              <label>Name</label>
              <input
                type="text"
                className="settings-input"
                placeholder={addTarget === 'quick' ? 'e.g. MDN Docs' : 'e.g. Gmail'}
                value={newTitle}
                onChange={(e) => setNewTitle(e.target.value)}
                autoFocus
              />
            </div>
            <div className="settings-field">
              <label>URL</label>
              <input
                type="text"
                className="settings-input"
                placeholder="https://example.com"
                value={newUrl}
                onChange={(e) => setNewUrl(e.target.value)}
                required
              />
            </div>
            <div className="newtab-modal-actions">
              <button
                type="button"
                className="settings-btn-secondary"
                onClick={() => setAddTarget(null)}
              >
                Cancel
              </button>
              <button type="submit" className="settings-btn-primary">
                Done
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}
