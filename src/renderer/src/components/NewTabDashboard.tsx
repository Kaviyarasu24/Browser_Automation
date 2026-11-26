import React, { useEffect, useState } from 'react'
import type { PublicConfig, UserProfile, ApplicationTrackerRecord } from '../../../shared/types'
import { IconSearch, IconGlobe, IconSparkles, IconFile, IconShield } from './Icons.js'

interface BookmarkItem {
  title: string
  url: string
}

interface NewTabDashboardProps {
  bookmarks: BookmarkItem[]
  onNavigate: (urlOrQuery: string) => void
  onRunAgent: (prompt: string) => void
  onOpenSettings: () => void
  onOpenQueue: () => void
}

const QUICK_ACTIONS = [
  { label: 'Live cricket scores', prompt: 'Search Google for live cricket scores and summarize the latest match' },
  { label: 'Hacker News top stories', prompt: 'Go to Hacker News and summarize the top 5 stories' },
  { label: 'GitHub trending', prompt: 'Open github.com/trending and list the top 5 repositories today' }
]

const DEFAULT_SHORTCUTS: BookmarkItem[] = [
  { title: 'Google', url: 'https://www.google.com' },
  { title: 'GitHub', url: 'https://github.com' },
  { title: 'LinkedIn', url: 'https://www.linkedin.com/jobs' },
  { title: 'Naukri', url: 'https://www.naukri.com' },
  { title: 'YouTube', url: 'https://www.youtube.com' }
]

export const NewTabDashboard: React.FC<NewTabDashboardProps> = ({
  bookmarks,
  onNavigate,
  onRunAgent,
  onOpenSettings,
  onOpenQueue
}) => {
  const [query, setQuery] = useState('')
  const [mode, setMode] = useState<'web' | 'agent'>('web')
  const [now, setNow] = useState(() => new Date())
  const [config, setConfig] = useState<PublicConfig | null>(null)
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [appsCount, setAppsCount] = useState<number>(0)
  const [pingState, setPingState] = useState<{
    status: 'idle' | 'testing' | 'ok' | 'error'
    latencyMs?: number
    detail?: string
  }>({ status: 'idle' })

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    window.api?.config.get().then(setConfig).catch(() => {})
    window.api?.profile.get().then(setProfile).catch(() => {})
    window.api?.tracker
      .list()
      .then((list: ApplicationTrackerRecord[]) => setAppsCount(list.length))
      .catch(() => {})
  }, [])

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

  const handlePing = async () => {
    if (!window.api?.config?.ping) return
    setPingState({ status: 'testing' })
    const started = performance.now()
    try {
      const res = await window.api.config.ping()
      const elapsed = Math.round(performance.now() - started)
      if (res.ok) {
        setPingState({ status: 'ok', latencyMs: elapsed, detail: res.detail })
      } else {
        setPingState({ status: 'error', detail: res.detail || 'Connection failed' })
      }
    } catch (err) {
      setPingState({ status: 'error', detail: String(err) })
    }
  }

  const shortcuts = bookmarks.length > 0 ? bookmarks.slice(0, 8) : DEFAULT_SHORTCUTS

  const providerHost = (() => {
    if (!config?.baseUrl) return 'Not configured'
    try {
      return new URL(config.baseUrl).hostname
    } catch {
      return config.baseUrl
    }
  })()

  const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const dateStr = now.toLocaleDateString([], { weekday: 'short', month: 'short', day: 'numeric' })

  return (
    <div className="newtab-dashboard">
      <div className="newtab-topbar">
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

        {/* Shortcuts */}
        <div className="newtab-shortcuts">
          {shortcuts.map((site) => {
            let host = site.url
            try {
              host = new URL(site.url).hostname.replace(/^www\./, '')
            } catch {
              /* keep raw */
            }
            return (
              <button
                key={site.url}
                type="button"
                className="newtab-shortcut-tile"
                onClick={() => onNavigate(site.url)}
                title={site.url}
              >
                <div className="newtab-shortcut-icon">
                  {(site.title || host).charAt(0).toUpperCase()}
                </div>
                <span className="newtab-shortcut-title">{site.title || host}</span>
              </button>
            )
          })}
        </div>

        {/* Quick Actions */}
        <div className="newtab-actions-row">
          {QUICK_ACTIONS.map((item) => (
            <button
              key={item.label}
              type="button"
              className="newtab-action-link"
              onClick={() => onRunAgent(item.prompt)}
            >
              <IconSparkles size={12} />
              <span>{item.label}</span>
            </button>
          ))}
          <button type="button" className="newtab-action-link" onClick={onOpenQueue}>
            <IconFile size={12} />
            <span>Job Queue</span>
          </button>
        </div>

        {/* System Status */}
        <div className="newtab-status-grid">
          <div className="newtab-status-card">
            <div className="newtab-status-head">
              <span className="newtab-status-label">Model &amp; Provider</span>
              <span className={`newtab-dot ${config?.hasApiKey ? 'ok' : 'warn'}`}>
                {config?.hasApiKey ? 'Ready' : 'No API key'}
              </span>
            </div>
            <div className="newtab-status-rows">
              <div className="newtab-status-row">
                <span>Model</span>
                <code>{config?.model || 'Unset'}</code>
              </div>
              <div className="newtab-status-row">
                <span>Host</span>
                <code>{providerHost}</code>
              </div>
              {pingState.status !== 'idle' && (
                <div className="newtab-status-row">
                  <span>Ping</span>
                  <span
                    className={
                      pingState.status === 'ok'
                        ? 'text-success'
                        : pingState.status === 'error'
                        ? 'text-error'
                        : ''
                    }
                  >
                    {pingState.status === 'testing'
                      ? 'Checking...'
                      : pingState.status === 'ok'
                      ? `${pingState.latencyMs ?? 0} ms`
                      : pingState.detail}
                  </span>
                </div>
              )}
            </div>
            <div className="newtab-status-foot">
              <button
                type="button"
                className="newtab-text-btn"
                onClick={() => void handlePing()}
                disabled={pingState.status === 'testing'}
              >
                {pingState.status === 'testing' ? 'Testing...' : 'Test connection'}
              </button>
              <button type="button" className="newtab-text-btn" onClick={onOpenSettings}>
                Settings
              </button>
            </div>
          </div>

          <div className="newtab-status-card">
            <div className="newtab-status-head">
              <span className="newtab-status-label">Profile &amp; Session</span>
              <span className="newtab-dot ok">
                <IconShield size={11} />
                <span>Persistent</span>
              </span>
            </div>
            <div className="newtab-status-rows">
              <div className="newtab-status-row">
                <span>Profile</span>
                <span>{profile?.fullName || 'Not configured'}</span>
              </div>
              <div className="newtab-status-row">
                <span>Resume</span>
                <span>{profile?.resumePath ? 'Ready' : 'Not set'}</span>
              </div>
              <div className="newtab-status-row">
                <span>Applications</span>
                <span>{appsCount} logged</span>
              </div>
            </div>
            <div className="newtab-status-foot">
              <button
                type="button"
                className="newtab-text-btn"
                onClick={() => void window.api?.tracker.open()}
              >
                Open applications.csv
              </button>
              <button type="button" className="newtab-text-btn" onClick={onOpenQueue}>
                Open queue
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
