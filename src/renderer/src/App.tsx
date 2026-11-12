import React, { useEffect, useRef, useState, useCallback } from 'react'
import type { AgentEvent, ContentBounds, PublicConfig, TabState } from '../../shared/types.js'

export function App(): React.JSX.Element {
  const [tabs, setTabs] = useState<TabState[]>([])
  const [activeTabId, setActiveTabId] = useState<string | null>(null)
  const [urlInput, setUrlInput] = useState('')
  const [sidebarOpen, setSidebarOpen] = useState(true)
  const [config, setConfig] = useState<PublicConfig | null>(null)
  const [taskPrompt, setTaskPrompt] = useState('')
  const [agentStatus, setAgentStatus] = useState<'idle' | 'running' | 'done' | 'error'>('idle')
  const [events, setEvents] = useState<AgentEvent[]>([])
  const [pingStatus, setPingStatus] = useState<string | null>(null)
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

  const activeTab = tabs.find((t) => t.id === activeTabId) ?? null

  // Keep URL bar in sync with active tab URL when not actively editing
  useEffect(() => {
    if (activeTab) {
      setUrlInput(activeTab.url === 'about:blank' ? '' : activeTab.url)
    }
  }, [activeTab?.id, activeTab?.url])

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
    window.api.tabs.list().then(({ tabs, activeId }) => {
      setTabs(tabs)
      setActiveTabId(activeId)
    }).catch(console.error)

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

    return () => {
      unbindTabs()
      unbindAgent()
    }
  }, [])

  // Auto-scroll event feed
  useEffect(() => {
    feedEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [events])

  const handleNavigate = (e: React.FormEvent) => {
    e.preventDefault()
    if (!activeTabId || !urlInput.trim()) return
    let target = urlInput.trim()
    if (!/^https?:\/\//i.test(target) && !target.startsWith('about:')) {
      target = `https://${target}`
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

  const handleRunAgent = async () => {
    if (!taskPrompt.trim() || agentStatus === 'running') return
    setEvents([])
    setAgentStatus('running')
    setSidebarOpen(true)
    const res = await window.api?.agent.run(taskPrompt.trim())
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
    setPingStatus('Testing connection...')
    const res = await window.api?.config.ping()
    setPingStatus(res ? (res.ok ? '✓ Connected' : `✕ ${res.detail}`) : 'Failed')
    setTimeout(() => setPingStatus(null), 4000)
  }

  return (
    <div className="app-container">
      {/* Header Bar */}
      <div className="header-bar">
        {/* Tab Strip */}
        <div className="tab-strip">
          {tabs.map((tab) => (
            <div
              key={tab.id}
              className={`tab-item ${tab.id === activeTabId ? 'active' : ''}`}
              onClick={() => window.api?.tabs.activate(tab.id)}
            >
              {tab.favicon && (
                <img
                  className="tab-favicon"
                  src={tab.favicon}
                  alt=""
                  onError={(e) => ((e.target as HTMLElement).style.display = 'none')}
                />
              )}
              <span className="tab-title">{tab.loading ? 'Loading…' : tab.title || 'Untitled'}</span>
              <button
                className="tab-close"
                title="Close tab"
                onClick={(e) => handleCloseTab(e, tab.id)}
              >
                ×
              </button>
            </div>
          ))}
          <button className="btn-new-tab" title="New tab" onClick={handleCreateTab}>
            +
          </button>
        </div>

        {/* Navigation & Address Bar */}
        <div className="nav-bar">
          <div className="nav-buttons">
            <button
              className="btn-icon"
              title="Back"
              disabled={!activeTab?.canGoBack}
              onClick={() => activeTabId && window.api?.tabs.goBack(activeTabId)}
            >
              ←
            </button>
            <button
              className="btn-icon"
              title="Forward"
              disabled={!activeTab?.canGoForward}
              onClick={() => activeTabId && window.api?.tabs.goForward(activeTabId)}
            >
              →
            </button>
            <button
              className="btn-icon"
              title="Reload"
              onClick={() => activeTabId && window.api?.tabs.reload(activeTabId)}
            >
              ↻
            </button>
          </div>

          <form className="address-form" onSubmit={handleNavigate}>
            <input
              type="text"
              className="address-input"
              value={urlInput}
              placeholder="Search or enter web address"
              onChange={(e) => setUrlInput(e.target.value)}
            />
          </form>

          <button
            className={`btn-agent-toggle ${sidebarOpen ? 'active' : ''}`}
            onClick={() => setSidebarOpen((prev) => !prev)}
          >
            <span className={`agent-dot ${agentStatus === 'running' ? 'running' : ''}`} />
            Strawberry AI
          </button>
        </div>
      </div>

      {/* Main Viewport */}
      <div className="main-viewport">
        {/* Placeholder container where TabManager positions active WebContentsView */}
        <div className="web-content-placeholder" ref={contentRef} />

        {/* AI Agent Sidebar */}
        {sidebarOpen && (
          <aside className="sidebar">
            <div className="sidebar-header">
              <div className="sidebar-title-group">
                <span className="sidebar-title">Strawberry Agent</span>
                <span className={`status-badge ${agentStatus}`}>{agentStatus}</span>
              </div>
            </div>

            <div className="sidebar-model-info">
              <span>Model: <strong className="model-name">{config?.model || 'not set'}</strong></span>
              {tokenStats && (
                <span
                  className="token-counter-pill"
                  title={`Prompt: ${tokenStats.prompt.toLocaleString()} | Output: ${tokenStats.completion.toLocaleString()}`}
                >
                  ⚡ {(tokenStats.total / 1000).toFixed(1)}k tok
                </span>
              )}
              <button className="btn-ping" onClick={handlePing}>
                {pingStatus || 'Test API'}
              </button>
            </div>

            <div className="event-feed">
              {events.length === 0 ? (
                <div style={{ color: 'var(--text-muted)', textAlign: 'center', marginTop: 40, fontSize: 12 }}>
                  Enter a task below to let Strawberry operate the browser.
                </div>
              ) : (
                events.map((ev, i) => {
                  switch (ev.type) {
                    case 'start':
                      return (
                        <div key={i} className="event-card">
                          <div className="event-header">🚀 Task started</div>
                          <div>{ev.task}</div>
                        </div>
                      )
                    case 'navigating':
                      return (
                        <div key={i} className="event-card">
                          <div className="event-header">🌐 Navigating to Address</div>
                          <div style={{ wordBreak: 'break-all', fontFamily: 'var(--font-mono)', fontSize: 11 }}>{ev.url}</div>
                        </div>
                      )
                    case 'thinking':
                      return (
                        <div key={i} className="event-card thinking">
                          <div className="event-header">💭 Step {ev.step} Thinking</div>
                          <div>{ev.text}</div>
                        </div>
                      )
                    case 'tool':
                      return (
                        <div key={i} className="event-card tool">
                          <div className="event-header">
                            <span>🔧 Step {ev.step}: <strong>{ev.name}</strong></span>
                          </div>
                          <pre className="event-code">{JSON.stringify(ev.args, null, 2)}</pre>
                        </div>
                      )
                    case 'result':
                      return (
                        <div key={i} className="event-card result">
                          <div className="event-header">
                            <span>{ev.ok ? '✓' : '✕'} {ev.name}</span>
                          </div>
                          <div>{ev.summary}</div>
                        </div>
                      )
                    case 'confirmation_required':
                      return (
                        <div key={i} className="event-card confirmation">
                          <div className="event-header">
                            <span>🛡️ Confirmation Required</span>
                          </div>
                          <div style={{ fontWeight: 600 }}>{ev.title}</div>
                          <div style={{ marginTop: 2 }}>{ev.description}</div>
                          {ev.target && (
                            <div style={{ marginTop: 4, fontSize: 11, color: 'var(--text-muted)' }}>
                              Target: {ev.target}
                            </div>
                          )}
                        </div>
                      )
                    case 'done':
                      return (
                        <div key={i} className="event-card done">
                          <div className="event-header">
                            <span>🎉 Completed in {ev.steps} steps</span>
                            {ev.totalTokens && (
                              <span style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                                {ev.totalTokens.toLocaleString()} tokens
                              </span>
                            )}
                          </div>
                          <div style={{ whiteSpace: 'pre-wrap' }}>{ev.summary}</div>
                        </div>
                      )
                    case 'error':
                      return (
                        <div key={i} className="event-card error">
                          <div className="event-header">⚠️ Error</div>
                          <div>{ev.message}</div>
                          {ev.hint && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{ev.hint}</div>}
                        </div>
                      )
                    case 'cancelled':
                      return (
                        <div key={i} className="event-card">
                          <div className="event-header">⏹ Cancelled by user</div>
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
                  <span className="confirmation-badge">🛡️ Safeguard Alert</span>
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
                    ✓ Approve Action
                  </button>
                  <button className="btn-deny" onClick={handleDeny}>
                    ✕ Deny (Block)
                  </button>
                </div>
              </div>
            )}

            <div className="sidebar-footer">
              <textarea
                className="task-textarea"
                placeholder="What should the agent do? (e.g. 'Search for recent AI news and summarize the top article')"
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
              <div className="action-buttons">
                {agentStatus === 'running' ? (
                  <button className="btn-cancel" onClick={handleCancelAgent}>
                    Stop
                  </button>
                ) : (
                  <button
                    className="btn-primary"
                    disabled={!taskPrompt.trim()}
                    onClick={handleRunAgent}
                  >
                    Run Agent
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

