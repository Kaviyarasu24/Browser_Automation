import React, { useEffect, useRef, useState, useCallback } from 'react'
import type { AgentEvent, ContentBounds, DownloadRecord, PublicConfig, TabState } from '../../shared/types.js'
import {
  IconBack,
  IconForward,
  IconReload,
  IconHome,
  IconLock,
  IconGlobe,
  IconSearch,
  IconClose,
  IconPlus,
  IconDownload,
  IconCopy,
  IconCheck,
  IconFolder,
  IconFile,
  IconStop,
  IconShield,
  IconStar,
  IconSpinner,
  IconTerminal,
  IconChevronRight,
  IconChevronDown,
  IconPlay
} from './components/Icons.js'

const QUICK_COMMANDS = [
  { label: 'Summarize page content and key findings', text: 'Summarize the main content and key takeaways of this page.' },
  { label: 'Extract table data and export to CSV', text: 'Extract all data tables on this page and export the results to CSV.' },
  { label: 'Inspect documentation and outline steps', text: 'Read the documentation on this page and outline step-by-step instructions.' },
  { label: 'Search current topic for latest updates', text: 'Search for recent news and updates on this topic and summarize.' }
]

export function App(): React.JSX.Element {
  const [tabs, setTabs] = useState<TabState[]>([])
  const [activeTabId, setActiveTabId] = useState<string | null>(null)
  const [urlInput, setUrlInput] = useState('')
  const [isOmniboxFocused, setOmniboxFocused] = useState(false)
  const [copiedUrl, setCopiedUrl] = useState(false)
  const [isBookmarked, setIsBookmarked] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [config, setConfig] = useState<PublicConfig | null>(null)
  const [taskPrompt, setTaskPrompt] = useState('')
  const [agentStatus, setAgentStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle')
  const [events, setEvents] = useState<AgentEvent[]>([])
  const [expandedThoughts, setExpandedThoughts] = useState<Record<number, boolean>>({})
  const [pingStatus, setPingStatus] = useState<string | null>(null)
  const [downloads, setDownloads] = useState<DownloadRecord[]>([])
  const [showDownloadsDrawer, setShowDownloadsDrawer] = useState(false)
  const [activeConfirmation, setActiveConfirmation] = useState<{
    id: string
    title: string
    description: string
    action: string
    target?: string
  } | null>(null)
  const [tokenStats, setTokenStats] = useState<{
    prompt: number
    completion: number
    total: number
  } | null>(null)

  const contentRef = useRef<HTMLDivElement>(null)
  const feedEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null

  // Keep URL bar in sync with active tab URL when not actively editing
  useEffect(() => {
    if (activeTab && !isOmniboxFocused) {
      setUrlInput(activeTab.url === 'about:blank' ? '' : activeTab.url)
    }
  }, [activeTab?.id, activeTab?.url, isOmniboxFocused])

  // Sync content bounds to main process whenever layout or sidebar changes
  const updateBounds = useCallback(() => {
    if (!contentRef.current) return
    const rect = contentRef.current.getBoundingClientRect()
    const bounds: ContentBounds = {
      x: Math.round(rect.left),
      y: Math.round(rect.top),
      width: Math.round(rect.width),
      height: Math.round(rect.height)
    }
    window.api?.tabs.setBounds(bounds)
  }, [])

  useEffect(() => {
    if (!contentRef.current) return
    const observer = new ResizeObserver(() => updateBounds())
    observer.observe(contentRef.current)
    updateBounds()
    return () => observer.disconnect()
  }, [updateBounds, sidebarOpen])

  // Initial load and listeners
  useEffect(() => {
    if (!window.api) return

    // Get config
    window.api.config.get().then(setConfig).catch(console.error)

    // Listen for tabs updates
    const unbindTabs = window.api.tabs.onUpdated(({ tabs, activeId }) => {
      setTabs(tabs)
      setActiveTabId(activeId)
    })

    // Listen for initial tabs
    window.api.tabs
      .list()
      .then(({ tabs, activeId }) => {
        setTabs(tabs)
        setActiveTabId(activeId)
      })
      .catch(console.error)

    // Listen for agent events
    const unbindAgent = window.api.agent.onEvent((event) => {
      setEvents((prev) => [...prev, event])
      if (event.type === 'start') {
        setAgentStatus('running')
        setActiveConfirmation(null)
        setTokenStats(null)
      } else if (event.type === 'usage') {
        setTokenStats({
          prompt: event.prompt,
          completion: event.completion,
          total: event.total
        })
      } else if (event.type === 'navigating') {
        // Animate URL typing into address bar at 2x speed
        let typed = ''
        const url = event.url
        const chunk = 2
        let idx = 0
        const timer = setInterval(() => {
          if (idx >= url.length) {
            clearInterval(timer)
            setUrlInput(url)
            return
          }
          typed += url.slice(idx, idx + chunk)
          idx += chunk
          setUrlInput(typed)
        }, 25)
      } else if (event.type === 'confirmation_required') {
        setActiveConfirmation({
          id: event.id,
          title: event.title,
          description: event.description,
          action: event.action,
          target: event.target
        })
      } else if (event.type === 'done') {
        setAgentStatus('done')
        setActiveConfirmation(null)
      } else if (event.type === 'error') {
        setAgentStatus('error')
        setActiveConfirmation(null)
      } else if (event.type === 'cancelled') {
        setAgentStatus('idle')
        setActiveConfirmation(null)
      }
    })

    // Listen for downloads
    window.api?.downloads.list().then(setDownloads).catch(console.error)
    const unbindDownloads = window.api?.downloads.onUpdated((records) => {
      setDownloads(records)
    })

    return () => {
      unbindTabs()
      unbindAgent()
      unbindDownloads?.()
    }
  }, [])

  const formatBytes = (bytes: number): string => {
    if (!bytes || bytes <= 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`
  }

  // Auto-scroll event feed
  useEffect(() => {
    feedEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [events])

  const handleNavigate = (e: React.FormEvent) => {
    e.preventDefault()
    if (!activeTabId || !urlInput.trim()) return
    let target = urlInput.trim()

    // Smart omnibox resolution (like Chrome)
    if (!/^https?:\/\//i.test(target) && !target.startsWith('about:')) {
      if (target.includes('.') && !target.includes(' ')) {
        target = `https://${target}`
      } else {
        target = `https://www.google.com/search?q=${encodeURIComponent(target)}`
      }
    }
    window.api?.tabs.navigate(activeTabId, target)
  }

  const handleCreateTab = () => {
    window.api?.tabs.create('https://www.google.com')
  }

  const handleCloseTab = (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    window.api?.tabs.close(id)
  }

  const handleGoHome = () => {
    if (activeTabId) {
      window.api?.tabs.navigate(activeTabId, 'https://www.google.com')
    }
  }

  const handleCopyUrl = () => {
    if (!activeTab?.url) return
    navigator.clipboard.writeText(activeTab.url)
    setCopiedUrl(true)
    setTimeout(() => setCopiedUrl(false), 2000)
  }

  const handleClearUrl = () => {
    setUrlInput('')
  }

  const handleRunAgent = async (promptOverride?: string) => {
    const promptToRun = (promptOverride || taskPrompt).trim()
    if (!promptToRun || agentStatus === 'running') return
    setTaskPrompt(promptToRun)
    setEvents([])
    setExpandedThoughts({})
    setAgentStatus('running')
    setSidebarOpen(true)
    const res = await window.api?.agent.run(promptToRun)
    if (!res?.ok && res?.error) {
      setAgentStatus('error')
      setEvents((prev) => [...prev, { type: 'error', message: res.error! }])
    }
  }

  const handleApprove = async () => {
    if (!activeConfirmation) return
    const id = activeConfirmation.id
    setActiveConfirmation(null)
    await window.api?.agent.confirm(id, true)
  }

  const handleDeny = async () => {
    if (!activeConfirmation) return
    const id = activeConfirmation.id
    setActiveConfirmation(null)
    await window.api?.agent.confirm(id, false)
  }

  const handleCancelAgent = async () => {
    setActiveConfirmation(null)
    await window.api?.agent.cancel()
    setAgentStatus('idle')
  }

  const handlePing = async () => {
    setPingStatus('Testing...')
    const res = await window.api?.config.ping()
    setPingStatus(res ? (res.ok ? '✓ OK' : `✕ Err`) : 'Failed')
    setTimeout(() => setPingStatus(null), 3000)
  }

  const isHttps = activeTab?.url.startsWith('https://')
  const isDownloading = downloads.some((d) => d.state === 'progressing')

  return (
    <div className="app-container">
      {/* Header Bar */}
      <div className="header-bar">
        {/* Chrome-Style Tab Strip */}
        <div className="tab-strip">
          {tabs.map((tab) => (
            <div
              key={tab.id}
              className={`tab-item ${tab.id === activeTabId ? 'active' : ''}`}
              onClick={() => window.api?.tabs.activate(tab.id)}
              title={tab.title || 'New Tab'}
            >
              {tab.loading ? (
                <IconSpinner size={14} style={{ color: 'var(--accent)', flexShrink: 0 }} />
              ) : tab.favicon ? (
                <img
                  className="tab-favicon"
                  src={tab.favicon}
                  alt=""
                  onError={(e) => ((e.target as HTMLElement).style.display = 'none')}
                />
              ) : (
                <div className="tab-favicon">
                  <IconGlobe size={14} />
                </div>
              )}
              <span className="tab-title">{tab.title || (tab.loading ? 'Loading…' : 'New Tab')}</span>
              <button
                className="tab-close"
                title="Close tab"
                onClick={(e) => handleCloseTab(e, tab.id)}
              >
                <IconClose size={12} />
              </button>
            </div>
          ))}
          <button className="btn-new-tab" title="New tab (Ctrl+T)" onClick={handleCreateTab}>
            <IconPlus size={15} />
          </button>
        </div>

        {/* Chrome Navigation & Omnibox Bar */}
        <div className="nav-bar">
          <div className="nav-buttons">
            <button
              className="btn-icon"
              title="Click to go back"
              disabled={!activeTab?.canGoBack}
              onClick={() => activeTabId && window.api?.tabs.goBack(activeTabId)}
            >
              <IconBack size={16} />
            </button>
            <button
              className="btn-icon"
              title="Click to go forward"
              disabled={!activeTab?.canGoForward}
              onClick={() => activeTabId && window.api?.tabs.goForward(activeTabId)}
            >
              <IconForward size={16} />
            </button>
            <button
              className="btn-icon"
              title={activeTab?.loading ? 'Reloading...' : 'Reload this page'}
              onClick={() => activeTabId && window.api?.tabs.reload(activeTabId)}
            >
              <IconReload size={15} className={activeTab?.loading ? 'spin-animation' : ''} />
            </button>
            <button className="btn-icon" title="Open home page" onClick={handleGoHome}>
              <IconHome size={16} />
            </button>
          </div>

          {/* Chrome-Style Pill Omnibox */}
          <form className="address-form" onSubmit={handleNavigate}>
            <div className={`omnibox-container ${isOmniboxFocused ? 'focused' : ''}`}>
              <button
                type="button"
                className={`omnibox-security-btn ${isHttps ? 'secure' : ''}`}
                title={isHttps ? 'Connection is secure' : 'Search or enter address'}
              >
                {isHttps ? (
                  <IconLock size={13} />
                ) : urlInput.trim().length === 0 || urlInput.startsWith('about:') ? (
                  <IconSearch size={13} />
                ) : (
                  <IconGlobe size={13} />
                )}
              </button>

              <input
                type="text"
                className="address-input"
                value={urlInput}
                placeholder="Search Google or type a URL"
                onFocus={() => setOmniboxFocused(true)}
                onBlur={() => setOmniboxFocused(false)}
                onChange={(e) => setUrlInput(e.target.value)}
              />

              <div className="omnibox-actions">
                {urlInput.length > 0 && isOmniboxFocused && (
                  <button
                    type="button"
                    className="omnibox-action-btn"
                    title="Clear address"
                    onMouseDown={(e) => {
                      e.preventDefault()
                      handleClearUrl()
                    }}
                  >
                    <IconClose size={13} />
                  </button>
                )}
                <button
                  type="button"
                  className="omnibox-action-btn"
                  title="Copy page URL"
                  onClick={handleCopyUrl}
                >
                  {copiedUrl ? (
                    <IconCheck size={13} style={{ color: 'var(--success)' }} />
                  ) : (
                    <IconCopy size={13} />
                  )}
                </button>
                <button
                  type="button"
                  className={`omnibox-action-btn ${isBookmarked ? 'active' : ''}`}
                  title={isBookmarked ? 'Bookmarked' : 'Bookmark this tab'}
                  onClick={() => setIsBookmarked((prev) => !prev)}
                >
                  <IconStar size={13} fill={isBookmarked ? 'currentColor' : 'none'} />
                </button>
              </div>
            </div>
          </form>

          {/* Right Toolbar Actions */}
          <div className="nav-buttons">
            <button
              className={`btn-icon ${showDownloadsDrawer ? 'active' : ''}`}
              title="Downloads"
              onClick={() => setShowDownloadsDrawer((prev) => !prev)}
            >
              <IconDownload size={16} />
              {isDownloading ? (
                <span className="download-active-dot" />
              ) : downloads.length > 0 ? (
                <span className="download-badge-count">{downloads.length}</span>
              ) : null}
            </button>

            <button
              className={`btn-agent-toggle ${sidebarOpen ? 'active' : ''}`}
              title="Toggle Agent Console"
              onClick={() => setSidebarOpen((prev) => !prev)}
            >
              <IconTerminal size={14} />
              <span className={`agent-dot ${agentStatus === 'running' ? 'running' : ''}`} />
              <span>Console</span>
            </button>
          </div>
        </div>

        {/* Chrome Downloads Drawer Popover */}
        {showDownloadsDrawer && (
          <div className="downloads-popover">
            <div className="downloads-popover-header">
              <span>Downloads ({downloads.length})</span>
              <button
                className="btn-icon"
                style={{ width: 22, height: 22 }}
                onClick={() => setShowDownloadsDrawer(false)}
              >
                <IconClose size={13} />
              </button>
            </div>
            <div className="downloads-list">
              {downloads.length === 0 ? (
                <div style={{ padding: '24px 16px', textAlign: 'center', fontSize: 12, color: 'var(--text-muted)' }}>
                  <IconDownload size={28} style={{ opacity: 0.35, marginBottom: 8 }} />
                  <div>No downloads in this session</div>
                </div>
              ) : (
                downloads.map((d) => (
                  <div key={d.id} className="download-item-card">
                    <div className="download-item-top">
                      <div className="download-file-icon">
                        <IconFile size={18} />
                      </div>
                      <div className="download-item-details">
                        <div className="download-item-title" title={d.filename}>
                          {d.filename}
                        </div>
                        <div className="download-item-meta">
                          <span>{formatBytes(d.totalBytes || d.receivedBytes)}</span>
                          <span>•</span>
                          <span
                            style={{
                              textTransform: 'capitalize',
                              fontWeight: 600,
                              color:
                                d.state === 'completed'
                                  ? 'var(--success)'
                                  : d.state === 'progressing'
                                    ? 'var(--info)'
                                    : 'var(--error)'
                            }}
                          >
                            {d.state}
                          </span>
                        </div>
                        {d.state === 'progressing' && d.totalBytes > 0 && (
                          <div className="download-progress-bar-bg">
                            <div
                              className="download-progress-bar-fill"
                              style={{ width: `${Math.min(100, Math.round((d.receivedBytes / d.totalBytes) * 100))}%` }}
                            />
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="download-item-actions">
                      {d.state === 'completed' && (
                        <button
                          className="btn-file-action"
                          onClick={() => window.api?.downloads.openFile(d.savePath)}
                        >
                          <IconFile size={12} /> Open
                        </button>
                      )}
                      <button
                        className="btn-file-action"
                        onClick={() => window.api?.downloads.showInFolder(d.savePath)}
                      >
                        <IconFolder size={12} /> Show in Folder
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        )}
      </div>

      {/* Main Viewport */}
      <div className="main-viewport">
        {/* Placeholder container where TabManager positions active WebContentsView */}
        <div className="web-content-placeholder" ref={contentRef} />

        {/* Professional Developer Agent Console */}
        {sidebarOpen && (
          <aside className="sidebar">
            <div className="sidebar-header">
              <div className="sidebar-title-group">
                <IconTerminal size={15} className="sidebar-term-icon" />
                <span className="sidebar-title">Agent Console</span>
                <span className={`status-badge ${agentStatus}`}>{agentStatus}</span>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                {events.length > 0 && (
                  <button
                    className="btn-icon"
                    style={{ width: 24, height: 24, fontSize: 11 }}
                    title="Clear console output"
                    onClick={() => {
                      setEvents([])
                      setExpandedThoughts({})
                    }}
                  >
                    Clear
                  </button>
                )}
                <button
                  className="btn-icon"
                  style={{ width: 24, height: 24 }}
                  title="Close console"
                  onClick={() => setSidebarOpen(false)}
                >
                  <IconClose size={13} />
                </button>
              </div>
            </div>

            <div className="sidebar-model-info">
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span>TARGET:</span>
                <strong className="model-name">{config?.model || 'default'}</strong>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                {tokenStats && (
                  <span
                    className="token-counter-pill"
                    title={`Prompt: ${tokenStats.prompt.toLocaleString()} | Completion: ${tokenStats.completion.toLocaleString()}`}
                  >
                    {tokenStats.total.toLocaleString()} tok
                  </span>
                )}
                <button className="btn-ping" onClick={handlePing}>
                  {pingStatus || 'Ping'}
                </button>
              </div>
            </div>

            <div className="event-feed">
              {events.length === 0 ? (
                <div className="console-empty-state">
                  <div className="console-empty-icon">
                    <IconTerminal size={20} />
                  </div>
                  <div className="console-empty-title">Ready for instructions</div>
                  <div className="console-empty-subtitle">
                    Enter a task command below to control this browser session autonomously.
                  </div>
                  <div className="console-templates-list">
                    <div className="console-templates-header">Quick Commands</div>
                    {QUICK_COMMANDS.map((cmd, idx) => (
                      <button
                        key={idx}
                        className="console-template-item"
                        onClick={() => {
                          setTaskPrompt(cmd.text)
                          textareaRef.current?.focus()
                        }}
                      >
                        <span className="template-prefix">$</span>
                        <span className="template-label">{cmd.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              ) : (
                events.map((ev, i) => {
                  switch (ev.type) {
                    case 'start':
                      return (
                        <div key={i} className="log-entry start">
                          <div className="log-entry-header">
                            <span className="log-tag">INIT</span>
                            <span className="log-meta">TASK</span>
                          </div>
                          <div className="log-entry-body">{ev.task}</div>
                        </div>
                      )
                    case 'navigating':
                      return (
                        <div key={i} className="log-entry nav">
                          <div className="log-entry-header">
                            <span className="log-tag nav">NAVIGATE</span>
                            <span className="log-meta">HTTP</span>
                          </div>
                          <div className="log-url-box">{ev.url}</div>
                        </div>
                      )
                    case 'thinking': {
                      const isExpanded = expandedThoughts[ev.step] ?? false
                      return (
                        <div key={i} className="log-entry thinking">
                          <button
                            type="button"
                            className="log-disclosure-btn"
                            onClick={() =>
                              setExpandedThoughts((prev) => ({ ...prev, [ev.step]: !isExpanded }))
                            }
                          >
                            {isExpanded ? <IconChevronDown size={13} /> : <IconChevronRight size={13} />}
                            <span>Reasoning (Step {ev.step})</span>
                          </button>
                          {isExpanded && (
                            <div className="log-thought-content">{ev.text}</div>
                          )}
                        </div>
                      )
                    }
                    case 'tool':
                      return (
                        <div key={i} className="log-entry tool">
                          <div className="log-entry-header">
                            <span className="log-tag tool">STEP {ev.step}</span>
                            <span className="log-tool-name">{ev.name}</span>
                          </div>
                          <pre className="log-code-block">{JSON.stringify(ev.args, null, 2)}</pre>
                        </div>
                      )
                    case 'result':
                      return (
                        <div key={i} className="log-entry result">
                          <div className="log-entry-header">
                            <span className={`log-tag ${ev.ok ? 'success' : 'fail'}`}>
                              {ev.ok ? '✓ OK' : '✕ FAILED'}
                            </span>
                            <span className="log-meta">{ev.name}</span>
                          </div>
                          <div className="log-entry-body">{ev.summary}</div>
                        </div>
                      )
                    case 'download':
                      return (
                        <div key={i} className="log-entry download">
                          <div className="log-entry-header">
                            <span className="log-tag info">DOWNLOAD</span>
                            <span className="log-meta">{formatBytes(ev.size)}</span>
                          </div>
                          <div className="log-file-name">{ev.filename}</div>
                          <div className="log-file-path">{ev.path}</div>
                          <div className="log-actions-row">
                            {ev.state === 'completed' && (
                              <button
                                className="btn-log-action"
                                onClick={() => window.api?.downloads.openFile(ev.path)}
                              >
                                <IconFile size={12} /> Open
                              </button>
                            )}
                            <button
                              className="btn-log-action"
                              onClick={() => window.api?.downloads.showInFolder(ev.path)}
                            >
                              <IconFolder size={12} /> Reveal
                            </button>
                          </div>
                        </div>
                      )
                    case 'confirmation_required':
                      return (
                        <div key={i} className="log-entry security">
                          <div className="log-entry-header">
                            <span className="log-tag warning">
                              <IconShield size={11} /> SECURITY CHECK
                            </span>
                            <span className="log-meta">Authorization Required</span>
                          </div>
                          <div className="log-security-title">{ev.title}</div>
                          <div className="log-entry-body">{ev.description}</div>
                          {ev.target && (
                            <div className="log-security-target">
                              Target: <code>{ev.target}</code>
                            </div>
                          )}
                        </div>
                      )
                    case 'done':
                      return (
                        <div key={i} className="log-entry done">
                          <div className="log-entry-header">
                            <span className="log-tag success">COMPLETE</span>
                            <span className="log-meta">
                              {ev.steps} steps · {ev.totalTokens?.toLocaleString()} tok
                            </span>
                          </div>
                          <div className="log-summary-content">{ev.summary}</div>
                          <div className="log-export-row">
                            <button
                              className="btn-log-export"
                              onClick={async () => {
                                const res = await window.api?.export.saveToFile({
                                  content: ev.summary,
                                  filename: `strawberry-summary-${Date.now()}.md`,
                                  format: 'markdown'
                                })
                                if (res?.ok && res.path) {
                                  window.api?.downloads.showInFolder(res.path)
                                }
                              }}
                              title="Export summary as Markdown file"
                            >
                              Export .md
                            </button>
                            <button
                              className="btn-log-export"
                              onClick={async () => {
                                const res = await window.api?.export.saveToFile({
                                  content: JSON.stringify(
                                    { summary: ev.summary, steps: ev.steps, totalTokens: ev.totalTokens },
                                    null,
                                    2
                                  ),
                                  filename: `strawberry-summary-${Date.now()}.json`,
                                  format: 'json'
                                })
                                if (res?.ok && res.path) {
                                  window.api?.downloads.showInFolder(res.path)
                                }
                              }}
                              title="Export summary as JSON"
                            >
                              Export .json
                            </button>
                            <button
                              className="btn-log-export"
                              onClick={async () => {
                                const res = await window.api?.export.saveToFile({
                                  content: ev.summary,
                                  filename: `strawberry-summary-${Date.now()}.txt`,
                                  format: 'text'
                                })
                                if (res?.ok && res.path) {
                                  window.api?.downloads.showInFolder(res.path)
                                }
                              }}
                              title="Export summary as Plain Text"
                            >
                              Export .txt
                            </button>
                          </div>
                        </div>
                      )
                    case 'error':
                      return (
                        <div key={i} className="log-entry error">
                          <div className="log-entry-header">
                            <span className="log-tag error">ERROR</span>
                          </div>
                          <div className="log-error-text">{ev.message}</div>
                          {ev.hint && <div className="log-error-hint">{ev.hint}</div>}
                        </div>
                      )
                    case 'cancelled':
                      return (
                        <div key={i} className="log-entry">
                          <div className="log-entry-header">
                            <span className="log-tag">ABORTED</span>
                          </div>
                          <div style={{ color: '#71717a', fontSize: 11 }}>Task stopped by user.</div>
                        </div>
                      )
                    default:
                      return null
                  }
                })
              )}
              <div ref={feedEndRef} />
            </div>

            {/* Active Confirmation Gate Banner */}
            {activeConfirmation && (
              <div className="confirmation-banner">
                <div className="confirmation-header">
                  <span className="confirmation-badge">
                    <IconShield size={11} /> SECURITY CHECK
                  </span>
                  <span className="confirmation-title">{activeConfirmation.title}</span>
                </div>
                <div className="confirmation-desc">{activeConfirmation.description}</div>
                {activeConfirmation.target && (
                  <div className="confirmation-target">
                    Target: <code>{activeConfirmation.target}</code>
                  </div>
                )}
                <div className="confirmation-actions">
                  <button className="btn-approve" onClick={handleApprove}>
                    Authorize Action
                  </button>
                  <button className="btn-deny" onClick={handleDeny}>
                    Reject
                  </button>
                </div>
              </div>
            )}

            {/* Terminal Command Input Footer */}
            <div className="sidebar-footer">
              <div className="terminal-input-wrapper">
                <div className="terminal-input-prefix">&gt;</div>
                <textarea
                  ref={textareaRef}
                  className="terminal-textarea"
                  placeholder="Enter instruction (e.g., 'Extract all pricing tiers from this page and export to CSV')..."
                  value={taskPrompt}
                  disabled={agentStatus === 'running'}
                  onChange={(e) => setTaskPrompt(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault()
                      void handleRunAgent()
                    }
                  }}
                />
              </div>
              <div className="terminal-footer-actions">
                <span className="terminal-kbd-hint">
                  <kbd>↵</kbd> run • <kbd>Shift</kbd>+<kbd>↵</kbd> newline
                </span>
                {agentStatus === 'running' ? (
                  <button className="btn-term-stop" onClick={handleCancelAgent}>
                    <IconStop size={12} /> Abort
                  </button>
                ) : (
                  <button
                    className="btn-term-run"
                    disabled={!taskPrompt.trim()}
                    onClick={() => handleRunAgent()}
                  >
                    <IconPlay size={11} /> Run
                  </button>
                )}
              </div>
            </div>
          </aside>
        )}
      </div>
    </div>
  )
}
