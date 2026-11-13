import React, { useEffect, useRef, useState, useCallback } from 'react'
import type {
  AgentEvent,
  ContentBounds,
  DownloadRecord,
  PublicConfig,
  TabState,
  TaskHistoryItem
} from '../../shared/types.js'
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
  IconMenu,
  IconMoreHorizontal,
  IconSend,
  IconChevronRight,
  IconChevronDown,
  IconSettings,
  IconTrash,
  IconHistory,
  IconEye,
  IconEyeOff
} from './components/Icons.js'

const COPILOT_SUGGESTIONS = [
  'Summarize the main points on this page.',
  'Play a trivia game with me about [topic], asking one question at a time, tracking my score, and explaining each answer after I respond.',
  'Track the price of a product for me, compare recent changes, and tell me whether it looks like a good time to buy.'
]

const MODEL_PRESETS = [
  'nvidia/nemotron-3.5-lightning:free',
  'anthropic/claude-3.5-sonnet',
  'openai/gpt-4o',
  'google/gemini-2.0-flash-exp:free',
  'meta-llama/llama-3.3-70b-instruct:free'
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
  const [showMoreMenu, setShowMoreMenu] = useState(false)
  const [showHistoryDrawer, setShowHistoryDrawer] = useState(false)
  const [historyItems, setHistoryItems] = useState<TaskHistoryItem[]>([])
  const [showSettingsDrawer, setShowSettingsDrawer] = useState(false)
  const [settingsBaseUrl, setSettingsBaseUrl] = useState('')
  const [settingsApiKey, setSettingsApiKey] = useState('')
  const [settingsModel, setSettingsModel] = useState('')
  const [showApiKeyText, setShowApiKeyText] = useState(false)
  const [settingsPingStatus, setSettingsPingStatus] = useState<string | null>(null)
  const [settingsSaving, setSettingsSaving] = useState(false)
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

  const loadHistory = useCallback(() => {
    if (!window.api?.history) return
    window.api.history.list().then(setHistoryItems).catch(console.error)
  }, [])

  // Initial load and listeners
  useEffect(() => {
    if (!window.api) return

    // Get config
    window.api.config.get().then(setConfig).catch(console.error)

    // Load initial history
    loadHistory()

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
        loadHistory()
      } else if (event.type === 'error') {
        setAgentStatus('error')
        setActiveConfirmation(null)
        loadHistory()
      } else if (event.type === 'cancelled') {
        setAgentStatus('idle')
        setActiveConfirmation(null)
        loadHistory()
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
  }, [loadHistory])

  const formatBytes = (bytes: number): string => {
    if (!bytes || bytes <= 0) return '0 B'
    const k = 1024
    const sizes = ['B', 'KB', 'MB', 'GB']
    const i = Math.floor(Math.log(bytes) / Math.log(k))
    return `${(bytes / Math.pow(k, i)).toFixed(1)} ${sizes[i]}`
  }

  const formatTimeAgo = (timestamp: number): string => {
    const elapsedSecs = Math.floor((Date.now() - timestamp) / 1000)
    if (elapsedSecs < 60) return 'Just now'
    const mins = Math.floor(elapsedSecs / 60)
    if (mins < 60) return `${mins}m ago`
    const hours = Math.floor(mins / 60)
    if (hours < 24) return `${hours}h ago`
    const days = Math.floor(hours / 24)
    if (days < 7) return `${days}d ago`
    return new Date(timestamp).toLocaleDateString()
  }

  // Auto-scroll event feed
  useEffect(() => {
    feedEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [events])

  const handleNavigate = (e: React.FormEvent) => {
    e.preventDefault()
    if (!activeTabId || !urlInput.trim()) return
    let target = urlInput.trim()

    // Smart omnibox resolution
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
    setTaskPrompt('')
    setEvents([])
    setExpandedThoughts({})
    setShowMoreMenu(false)
    setShowHistoryDrawer(false)
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
    setPingStatus(res ? (res.ok ? '✓ Connected' : `✕ ${res.detail}`) : 'Failed')
    setTimeout(() => setPingStatus(null), 3000)
  }

  // History operations
  const handleSelectHistory = (item: TaskHistoryItem) => {
    setEvents(item.events)
    setExpandedThoughts({})
    setShowHistoryDrawer(false)
    setShowMoreMenu(false)
    setAgentStatus(item.status === 'completed' ? 'done' : item.status === 'error' ? 'error' : 'idle')
  }

  const handleDeleteHistory = async (e: React.MouseEvent, id: string) => {
    e.stopPropagation()
    await window.api?.history.delete(id)
    setHistoryItems((prev) => prev.filter((item) => item.id !== id))
  }

  const handleClearAllHistory = async () => {
    await window.api?.history.clear()
    setHistoryItems([])
  }

  // Settings operations
  const handleOpenSettings = () => {
    setSettingsBaseUrl(config?.baseUrl || '')
    setSettingsApiKey(config?.apiKey || '')
    setSettingsModel(config?.model || '')
    setShowApiKeyText(false)
    setSettingsPingStatus(null)
    setShowSettingsDrawer(true)
    setShowMoreMenu(false)
    setShowHistoryDrawer(false)
  }

  const handleSaveSettings = async () => {
    setSettingsSaving(true)
    try {
      const res = await window.api?.config.update({
        baseUrl: settingsBaseUrl.trim(),
        apiKey: settingsApiKey.trim(),
        model: settingsModel.trim()
      })
      if (res?.ok && res.config) {
        setConfig(res.config)
        setShowSettingsDrawer(false)
      }
    } finally {
      setSettingsSaving(false)
    }
  }

  const handleSettingsPing = async () => {
    setSettingsPingStatus('Testing...')
    // Temporarily save to test or call ping
    await window.api?.config.update({
      baseUrl: settingsBaseUrl.trim(),
      apiKey: settingsApiKey.trim(),
      model: settingsModel.trim()
    })
    const res = await window.api?.config.ping()
    setSettingsPingStatus(res ? (res.ok ? '✓ Connected' : `✕ ${res.detail}`) : 'Failed')
    setTimeout(() => setSettingsPingStatus(null), 4000)
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
              title="Toggle Copilot"
              onClick={() => setSidebarOpen((prev) => !prev)}
            >
              <span className={`agent-dot ${agentStatus === 'running' ? 'running' : ''}`} />
              <span>Copilot</span>
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

        {/* Microsoft Edge Copilot Style Side Panel */}
        {sidebarOpen && (
          <aside className="sidebar">
            {/* Top Bar (Hamburger, Ellipsis, Close) */}
            <div className="copilot-header">
              <button
                className={`copilot-header-btn ${showHistoryDrawer ? 'active' : ''}`}
                title="Chat History"
                onClick={() => {
                  setShowHistoryDrawer((prev) => !prev)
                  loadHistory()
                  setShowMoreMenu(false)
                }}
              >
                <IconMenu size={18} />
              </button>

              <div className="copilot-header-actions">
                <button
                  className="copilot-header-btn"
                  title="More options"
                  onClick={() => setShowMoreMenu((prev) => !prev)}
                >
                  <IconMoreHorizontal size={18} />
                </button>
                <button
                  className="copilot-header-btn"
                  title="Close panel"
                  onClick={() => {
                    setSidebarOpen(false)
                    setShowMoreMenu(false)
                    setShowHistoryDrawer(false)
                    setShowSettingsDrawer(false)
                  }}
                >
                  <IconClose size={16} />
                </button>

                {/* More Options Dropdown */}
                {showMoreMenu && (
                  <div className="copilot-menu-popover">
                    <button
                      className="copilot-menu-item"
                      onClick={() => {
                        setEvents([])
                        setExpandedThoughts({})
                        setShowMoreMenu(false)
                      }}
                    >
                      <span>New topic</span>
                      <span style={{ fontSize: 10, color: '#888' }}>Clear</span>
                    </button>
                    <button
                      className="copilot-menu-item"
                      onClick={() => {
                        setShowHistoryDrawer(true)
                        loadHistory()
                        setShowMoreMenu(false)
                      }}
                    >
                      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <IconHistory size={13} /> Chat History
                      </span>
                      {historyItems.length > 0 && (
                        <span style={{ fontSize: 10, color: '#888' }}>{historyItems.length}</span>
                      )}
                    </button>
                    <button
                      className="copilot-menu-item"
                      onClick={() => {
                        handleOpenSettings()
                      }}
                    >
                      <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <IconSettings size={13} /> Settings
                      </span>
                    </button>
                    <div className="copilot-menu-divider" />
                    <div className="copilot-menu-info-row">
                      <div className="copilot-menu-info-label">Active Model</div>
                      <div className="copilot-menu-info-value" title={config?.model}>
                        {config?.model || 'default'}
                      </div>
                    </div>
                    {tokenStats && (
                      <div className="copilot-menu-item" style={{ cursor: 'default' }}>
                        <span style={{ color: '#888' }}>Usage:</span>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11 }}>
                          {(tokenStats.total / 1000).toFixed(1)}k tok
                        </span>
                      </div>
                    )}
                    <button
                      className="copilot-menu-item"
                      onClick={() => {
                        void handlePing()
                      }}
                    >
                      <span>Test Connection</span>
                      <span style={{ fontSize: 10, color: 'var(--success)' }}>
                        {pingStatus || 'Ping'}
                      </span>
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* History Slide-Over Drawer */}
            {showHistoryDrawer && (
              <div className="copilot-history-drawer">
                <div className="history-drawer-header">
                  <div className="history-drawer-title-group">
                    <IconHistory size={16} />
                    <span>Recent Chats ({historyItems.length})</span>
                  </div>
                  <div className="history-drawer-actions">
                    <button
                      className="copilot-header-btn"
                      title="Settings"
                      onClick={handleOpenSettings}
                    >
                      <IconSettings size={15} />
                    </button>
                    <button
                      className="copilot-header-btn"
                      title="New topic"
                      onClick={() => {
                        setEvents([])
                        setExpandedThoughts({})
                        setShowHistoryDrawer(false)
                        setTaskPrompt('')
                        textareaRef.current?.focus()
                      }}
                    >
                      <IconPlus size={16} />
                    </button>
                    <button
                      className="copilot-header-btn"
                      title="Close history"
                      onClick={() => setShowHistoryDrawer(false)}
                    >
                      <IconClose size={16} />
                    </button>
                  </div>
                </div>

                <div className="history-list">
                  {historyItems.length === 0 ? (
                    <div style={{ padding: '36px 16px', textAlign: 'center', fontSize: 12, color: '#888' }}>
                      <IconHistory size={30} style={{ opacity: 0.3, marginBottom: 8 }} />
                      <div>No conversation history yet</div>
                    </div>
                  ) : (
                    historyItems.map((item) => (
                      <div
                        key={item.id}
                        className="history-item-card"
                        onClick={() => handleSelectHistory(item)}
                      >
                        <div className="history-item-header">
                          <span className="history-item-task" title={item.task}>
                            {item.task}
                          </span>
                          <button
                            className="history-item-delete"
                            title="Delete this chat"
                            onClick={(e) => handleDeleteHistory(e, item.id)}
                          >
                            <IconTrash size={12} />
                          </button>
                        </div>
                        <div className="history-item-meta">
                          <span>{formatTimeAgo(item.timestamp)}</span>
                          <span>•</span>
                          <span>{item.stepsCount} steps</span>
                          {item.totalTokens ? (
                            <>
                              <span>•</span>
                              <span>{(item.totalTokens / 1000).toFixed(1)}k tok</span>
                            </>
                          ) : null}
                        </div>
                      </div>
                    ))
                  )}
                </div>

                <div className="history-drawer-footer">
                  <button className="btn-history-footer" onClick={handleOpenSettings}>
                    <IconSettings size={14} /> Settings
                  </button>
                  {historyItems.length > 0 && (
                    <button
                      className="btn-history-footer"
                      style={{ color: '#ef4444' }}
                      onClick={handleClearAllHistory}
                    >
                      <IconTrash size={13} /> Clear All
                    </button>
                  )}
                </div>
              </div>
            )}

            {/* Settings Slide-Over Drawer */}
            {showSettingsDrawer && (
              <div className="copilot-settings-drawer">
                <div className="settings-drawer-header">
                  <div className="settings-drawer-title-group">
                    <IconSettings size={16} />
                    <span>Settings</span>
                  </div>
                  <button
                    className="copilot-header-btn"
                    title="Close settings"
                    onClick={() => setShowSettingsDrawer(false)}
                  >
                    <IconClose size={16} />
                  </button>
                </div>

                <div className="settings-drawer-body">
                  {/* Base URL */}
                  <div className="settings-field-group">
                    <label className="settings-field-label">
                      <span>API Base URL</span>
                    </label>
                    <div className="settings-input-wrapper">
                      <input
                        type="text"
                        className="settings-input"
                        placeholder="https://openrouter.ai/api/v1"
                        value={settingsBaseUrl}
                        onChange={(e) => setSettingsBaseUrl(e.target.value)}
                      />
                    </div>
                    <span className="settings-field-hint">
                      Supports OpenRouter, OpenAI, Groq, Ollama, vLLM.
                    </span>
                  </div>

                  {/* API Key */}
                  <div className="settings-field-group">
                    <label className="settings-field-label">
                      <span>API Key</span>
                    </label>
                    <div className="settings-input-wrapper">
                      <input
                        type={showApiKeyText ? 'text' : 'password'}
                        className="settings-input"
                        placeholder="sk-or-v1-..."
                        value={settingsApiKey}
                        onChange={(e) => setSettingsApiKey(e.target.value)}
                      />
                      <button
                        type="button"
                        className="settings-input-btn"
                        title={showApiKeyText ? 'Hide API key' : 'Show API key'}
                        onClick={() => setShowApiKeyText((prev) => !prev)}
                      >
                        {showApiKeyText ? <IconEyeOff size={15} /> : <IconEye size={15} />}
                      </button>
                    </div>
                    <span className="settings-field-hint">
                      Saved locally to .env. Never sent to any third party.
                    </span>
                  </div>

                  {/* Model */}
                  <div className="settings-field-group">
                    <label className="settings-field-label">
                      <span>Model Identifier</span>
                    </label>
                    <div className="settings-input-wrapper">
                      <input
                        type="text"
                        className="settings-input"
                        placeholder="nvidia/nemotron-3.5-lightning:free"
                        value={settingsModel}
                        onChange={(e) => setSettingsModel(e.target.value)}
                      />
                    </div>
                    <div className="settings-model-chips">
                      {MODEL_PRESETS.map((m) => (
                        <button
                          key={m}
                          type="button"
                          className={`settings-model-chip ${settingsModel === m ? 'active' : ''}`}
                          onClick={() => setSettingsModel(m)}
                        >
                          {m.split('/').pop() || m}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="settings-drawer-footer">
                  <button
                    type="button"
                    className="btn-settings-ping"
                    onClick={handleSettingsPing}
                  >
                    {settingsPingStatus || 'Test Connection'}
                  </button>
                  <div className="settings-drawer-actions">
                    <button
                      type="button"
                      className="btn-settings-cancel"
                      onClick={() => setShowSettingsDrawer(false)}
                    >
                      Cancel
                    </button>
                    <button
                      type="button"
                      className="btn-settings-save"
                      disabled={settingsSaving}
                      onClick={handleSaveSettings}
                    >
                      {settingsSaving ? 'Saving...' : 'Save'}
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Scrollable Conversation Content */}
            <div className="copilot-content">
              {events.length === 0 ? (
                /* Hero Greeting Screen (Matches User's Reference Screenshot Exactly) */
                <div className="copilot-hero">
                  <h1 className="copilot-greeting">Hi, how can I help?</h1>
                  <p className="copilot-subtitle">
                    I'm here to help when you need me. Tell me what you're working on, and we can get started.
                  </p>

                  <div className="copilot-suggestions">
                    {COPILOT_SUGGESTIONS.map((suggestion, idx) => (
                      <div
                        key={idx}
                        className="copilot-suggestion-card"
                        onClick={() => {
                          void handleRunAgent(suggestion)
                        }}
                      >
                        {suggestion}
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                /* Active Conversation Stream */
                <div className="copilot-feed">
                  {events.map((ev, i) => {
                    switch (ev.type) {
                      case 'start':
                        return (
                          <div key={i} className="user-message-bubble">
                            {ev.task}
                          </div>
                        )
                      case 'navigating':
                        return (
                          <div key={i} className="assistant-response-container">
                            <div className="assistant-step-card">
                              <div className="assistant-step-header">
                                <span className="assistant-step-badge">Navigating</span>
                              </div>
                              <div
                                style={{
                                  wordBreak: 'break-all',
                                  fontFamily: 'var(--font-mono)',
                                  fontSize: 11,
                                  color: 'var(--accent)'
                                }}
                              >
                                {ev.url}
                              </div>
                            </div>
                          </div>
                        )
                      case 'thinking': {
                        const isExpanded = expandedThoughts[ev.step] ?? false
                        return (
                          <div key={i} className="assistant-response-container">
                            <button
                              type="button"
                              className="copilot-thought-btn"
                              onClick={() =>
                                setExpandedThoughts((prev) => ({
                                  ...prev,
                                  [ev.step]: !isExpanded
                                }))
                              }
                            >
                              {isExpanded ? <IconChevronDown size={13} /> : <IconChevronRight size={13} />}
                              <span>Reasoning (Step {ev.step})</span>
                            </button>
                            {isExpanded && (
                              <div className="copilot-thought-content">{ev.text}</div>
                            )}
                          </div>
                        )
                      }
                      case 'tool':
                        return (
                          <div key={i} className="assistant-response-container">
                            <div className="assistant-step-card">
                              <div className="assistant-step-header">
                                <span className="assistant-step-badge">Step {ev.step}</span>
                                <span style={{ fontFamily: 'var(--font-mono)', color: '#fff' }}>
                                  {ev.name}
                                </span>
                              </div>
                              <pre className="copilot-code-block">{JSON.stringify(ev.args, null, 2)}</pre>
                            </div>
                          </div>
                        )
                      case 'result':
                        return (
                          <div key={i} className="assistant-response-container">
                            <div className="assistant-step-card">
                              <div className="assistant-step-header">
                                <span
                                  className="assistant-step-badge"
                                  style={{
                                    color: ev.ok ? 'var(--success)' : 'var(--error)',
                                    background: ev.ok ? 'rgba(16,185,129,0.12)' : 'rgba(239,68,68,0.12)'
                                  }}
                                >
                                  {ev.ok ? '✓ Action Completed' : '✕ Action Failed'}
                                </span>
                              </div>
                              <div style={{ fontSize: 12.5, color: '#e5e5e5' }}>{ev.summary}</div>
                            </div>
                          </div>
                        )
                      case 'download':
                        return (
                          <div key={i} className="assistant-response-container">
                            <div className="assistant-step-card">
                              <div className="assistant-step-header">
                                <span className="assistant-step-badge">Downloaded</span>
                                <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                                  {formatBytes(ev.size)}
                                </span>
                              </div>
                              <div style={{ fontWeight: 600, fontSize: 13, color: '#fff' }}>
                                {ev.filename}
                              </div>
                              <div
                                style={{
                                  fontSize: 10,
                                  fontFamily: 'var(--font-mono)',
                                  color: 'var(--text-muted)',
                                  wordBreak: 'break-all'
                                }}
                              >
                                {ev.path}
                              </div>
                              <div style={{ display: 'flex', gap: 6, marginTop: 4 }}>
                                {ev.state === 'completed' && (
                                  <button
                                    className="copilot-btn-pill"
                                    onClick={() => window.api?.downloads.openFile(ev.path)}
                                  >
                                    <IconFile size={12} /> Open
                                  </button>
                                )}
                                <button
                                  className="copilot-btn-pill"
                                  onClick={() => window.api?.downloads.showInFolder(ev.path)}
                                >
                                  <IconFolder size={12} /> Reveal
                                </button>
                              </div>
                            </div>
                          </div>
                        )
                      case 'confirmation_required':
                        return (
                          <div key={i} className="assistant-response-container">
                            <div className="confirmation-banner">
                              <div className="confirmation-header">
                                <span className="confirmation-badge">
                                  <IconShield size={11} /> Confirm
                                </span>
                                <span className="confirmation-title">{ev.title}</span>
                              </div>
                              <div className="confirmation-desc">{ev.description}</div>
                              {ev.target && (
                                <div className="confirmation-target">
                                  Target: <code>{ev.target}</code>
                                </div>
                              )}
                            </div>
                          </div>
                        )
                      case 'done':
                        return (
                          <div key={i} className="assistant-response-container">
                            <div className="copilot-summary-body">{ev.summary}</div>
                            <div className="copilot-export-pills">
                              <button
                                className="copilot-btn-pill"
                                onClick={async () => {
                                  const res = await window.api?.export.saveToFile({
                                    content: ev.summary,
                                    filename: `copilot-summary-${Date.now()}.md`,
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
                                className="copilot-btn-pill"
                                onClick={async () => {
                                  const res = await window.api?.export.saveToFile({
                                    content: JSON.stringify(
                                      { summary: ev.summary, steps: ev.steps, totalTokens: ev.totalTokens },
                                      null,
                                      2
                                    ),
                                    filename: `copilot-summary-${Date.now()}.json`,
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
                                className="copilot-btn-pill"
                                onClick={async () => {
                                  const res = await window.api?.export.saveToFile({
                                    content: ev.summary,
                                    filename: `copilot-summary-${Date.now()}.txt`,
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
                          <div key={i} className="assistant-response-container">
                            <div
                              style={{
                                color: 'var(--error)',
                                background: 'rgba(244,63,94,0.1)',
                                padding: 12,
                                borderRadius: 10,
                                fontSize: 13
                              }}
                            >
                              {ev.message}
                              {ev.hint && (
                                <div style={{ fontSize: 11, color: '#aaa', marginTop: 4 }}>
                                  {ev.hint}
                                </div>
                              )}
                            </div>
                          </div>
                        )
                      case 'cancelled':
                        return (
                          <div
                            key={i}
                            style={{
                              color: '#888',
                              fontSize: 12,
                              textAlign: 'center',
                              margin: '8px 0'
                            }}
                          >
                            Task stopped by user.
                          </div>
                        )
                      default:
                        return null
                    }
                  })}
                </div>
              )}
              <div ref={feedEndRef} />
            </div>

            {/* Active Confirmation Gate Banner */}
            {activeConfirmation && (
              <div style={{ padding: '0 16px 10px 16px' }}>
                <div className="confirmation-banner">
                  <div className="confirmation-header">
                    <span className="confirmation-badge">
                      <IconShield size={11} /> Confirm
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
                      Authorize
                    </button>
                    <button className="btn-deny" onClick={handleDeny}>
                      Reject
                    </button>
                  </div>
                </div>
              </div>
            )}

            {/* Bottom Rounded Pill Input (Matches Reference Screenshot) */}
            <div className="copilot-footer">
              <div className="copilot-input-pill">
                <button
                  type="button"
                  className="copilot-plus-btn"
                  title="New topic"
                  onClick={() => {
                    setEvents([])
                    setExpandedThoughts({})
                    setTaskPrompt('')
                    textareaRef.current?.focus()
                  }}
                >
                  <IconPlus size={16} />
                </button>

                <textarea
                  ref={textareaRef}
                  className="copilot-textarea"
                  placeholder="Message Copilot"
                  rows={1}
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

                {agentStatus === 'running' ? (
                  <button
                    type="button"
                    className="copilot-stop-btn"
                    title="Stop generating"
                    onClick={handleCancelAgent}
                  >
                    <IconStop size={14} />
                  </button>
                ) : (
                  <button
                    type="button"
                    className={`copilot-send-btn ${taskPrompt.trim() ? 'active' : ''}`}
                    disabled={!taskPrompt.trim()}
                    title="Send message"
                    onClick={() => handleRunAgent()}
                  >
                    <IconSend size={15} />
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
