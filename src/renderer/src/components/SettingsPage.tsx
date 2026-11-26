import React, { useEffect, useState } from 'react'
import type {
  BrowserRuntimeInfo,
  BrowserSettings,
  PublicConfig,
  UserProfile
} from '../../../shared/types'
import {
  IconCheck,
  IconDownload,
  IconFile,
  IconFolder,
  IconGlobe,
  IconHome,
  IconSearch,
  IconSettings,
  IconShield,
  IconSparkles
} from './Icons.js'

type SettingsSection =
  | 'appearance'
  | 'startup'
  | 'search'
  | 'privacy'
  | 'downloads'
  | 'agent'
  | 'profile'
  | 'about'

interface SettingsPageProps {
  settings: BrowserSettings
  onUpdateSettings: (patch: Partial<BrowserSettings>) => Promise<void>
  onResetSettings: () => Promise<void>
  config: PublicConfig | null
  onConfigSaved: (cfg: PublicConfig) => void
}

const NAV_ITEMS: Array<{ id: SettingsSection; label: string; icon: React.ReactNode }> = [
  { id: 'appearance', label: 'Appearance', icon: <IconSettings size={15} /> },
  { id: 'startup', label: 'On startup', icon: <IconHome size={15} /> },
  { id: 'search', label: 'Search engine', icon: <IconSearch size={15} /> },
  { id: 'privacy', label: 'Privacy & security', icon: <IconShield size={15} /> },
  { id: 'downloads', label: 'Downloads', icon: <IconDownload size={15} /> },
  { id: 'agent', label: 'EDITH & Automation', icon: <IconSparkles size={15} /> },
  { id: 'profile', label: 'Profile & Autofill', icon: <IconFile size={15} /> },
  { id: 'about', label: 'About EDITH', icon: <IconGlobe size={15} /> }
]

const MODEL_PRESETS = [
  { label: 'Claude Sonnet 4.5 (OpenRouter)', value: 'anthropic/claude-sonnet-4.5' },
  { label: 'GPT-4o (OpenAI / OpenRouter)', value: 'openai/gpt-4o' },
  { label: 'Gemini 2.0 Flash', value: 'google/gemini-2.0-flash-001' },
  { label: 'Nemotron 3 Super (Free)', value: 'nvidia/nemotron-3-super-120b-a12b:free' }
]

export const SettingsPage: React.FC<SettingsPageProps> = ({
  settings,
  onUpdateSettings,
  onResetSettings,
  config,
  onConfigSaved
}) => {
  const [section, setSection] = useState<SettingsSection>('appearance')
  const [runtimeInfo, setRuntimeInfo] = useState<BrowserRuntimeInfo | null>(null)

  // LLM Config local form
  const [baseUrl, setBaseUrl] = useState(config?.baseUrl || '')
  const [apiKey, setApiKey] = useState(config?.apiKey || '')
  const [model, setModel] = useState(config?.model || '')
  const [showKey, setShowKey] = useState(false)
  const [pingResult, setPingResult] = useState<{ ok: boolean; text: string } | null>(null)
  const [savingConfig, setSavingConfig] = useState(false)
  const [configSavedNotice, setConfigSavedNotice] = useState(false)

  // Profile local form
  const [profile, setProfile] = useState<UserProfile | null>(null)
  const [profileSaving, setProfileSaving] = useState(false)
  const [profileSavedNotice, setProfileSavedNotice] = useState(false)

  // Clear browsing data checkboxes
  const [clearCache, setClearCache] = useState(true)
  const [clearCookies, setClearCookies] = useState(false)
  const [clearHistory, setClearHistory] = useState(false)
  const [clearAnswers, setClearAnswers] = useState(false)
  const [clearNotice, setClearNotice] = useState<string | null>(null)

  useEffect(() => {
    window.api?.settings.runtimeInfo().then(setRuntimeInfo).catch(() => {})
    window.api?.profile.get().then(setProfile).catch(() => {})
  }, [])

  useEffect(() => {
    if (config) {
      setBaseUrl(config.baseUrl || '')
      setApiKey(config.apiKey || '')
      setModel(config.model || '')
    }
  }, [config])

  const handleSaveLlmConfig = async (e: React.FormEvent) => {
    e.preventDefault()
    setSavingConfig(true)
    setConfigSavedNotice(false)
    try {
      const res = await window.api?.config.update({
        baseUrl: baseUrl.trim(),
        apiKey: apiKey.trim(),
        model: model.trim()
      })
      if (res?.ok && res.config) {
        onConfigSaved(res.config)
        setConfigSavedNotice(true)
        setTimeout(() => setConfigSavedNotice(false), 2500)
      }
    } finally {
      setSavingConfig(false)
    }
  }

  const handleTestConnection = async () => {
    setPingResult({ ok: true, text: 'Testing connection...' })
    const started = performance.now()
    const res = await window.api?.config.ping()
    const ms = Math.round(performance.now() - started)
    if (res?.ok) {
      setPingResult({ ok: true, text: `Connected (${ms} ms)` })
    } else {
      setPingResult({ ok: false, text: res?.detail || 'Connection failed' })
    }
  }

  const handlePickDownloadDir = async () => {
    const dir = await window.api?.settings.pickDirectory()
    if (dir) {
      await onUpdateSettings({ downloadPath: dir })
    }
  }

  const handlePickResume = async () => {
    if (!profile) return
    const file = await window.api?.settings.pickFile([
      { name: 'Resume Documents', extensions: ['pdf', 'doc', 'docx'] }
    ])
    if (file) {
      setProfile({ ...profile, resumePath: file })
    }
  }

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!profile) return
    setProfileSaving(true)
    setProfileSavedNotice(false)
    try {
      const res = await window.api?.profile.save(profile)
      if (res?.ok && res.profile) {
        setProfile(res.profile)
        setProfileSavedNotice(true)
        setTimeout(() => setProfileSavedNotice(false), 2500)
      }
    } finally {
      setProfileSaving(false)
    }
  }

  const handleClearData = async () => {
    setClearNotice(null)
    await window.api?.privacy.clearData({
      cache: clearCache,
      cookies: clearCookies,
      history: clearHistory,
      answersCache: clearAnswers
    })
    setClearNotice('Selected browsing data cleared.')
    setTimeout(() => setClearNotice(null), 3000)
  }

  return (
    <div className="settings-page">
      {/* Left Navigation Rail */}
      <aside className="settings-nav">
        <div className="settings-nav-header">
          <h1>Settings</h1>
        </div>
        <nav className="settings-nav-list">
          {NAV_ITEMS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`settings-nav-item ${section === item.id ? 'active' : ''}`}
              onClick={() => setSection(item.id)}
            >
              {item.icon}
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
      </aside>

      {/* Main Content */}
      <main className="settings-main">
        <div className="settings-container">
          {section === 'appearance' && (
            <section className="settings-section">
              <h2 className="settings-heading">Appearance</h2>
              <div className="settings-card">
                <div className="settings-row">
                  <div className="settings-row-info">
                    <div className="settings-row-title">Theme</div>
                    <div className="settings-row-desc">
                      Choose how EDITH Browser looks. System follows your OS appearance.
                    </div>
                  </div>
                  <div className="settings-segmented">
                    {(['system', 'dark', 'light'] as const).map((mode) => (
                      <button
                        key={mode}
                        type="button"
                        className={`settings-seg-btn ${settings.theme === mode ? 'active' : ''}`}
                        onClick={() => void onUpdateSettings({ theme: mode })}
                      >
                        {mode.charAt(0).toUpperCase() + mode.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="settings-row">
                  <div className="settings-row-info">
                    <div className="settings-row-title">Show Home button</div>
                    <div className="settings-row-desc">
                      Display the Home button next to the address bar.
                    </div>
                  </div>
                  <label className="settings-switch">
                    <input
                      type="checkbox"
                      checked={settings.showHomeButton}
                      onChange={(e) => void onUpdateSettings({ showHomeButton: e.target.checked })}
                    />
                    <span className="settings-slider" />
                  </label>
                </div>

                <div className="settings-row">
                  <div className="settings-row-info">
                    <div className="settings-row-title">Default page zoom</div>
                    <div className="settings-row-desc">
                      Default magnification level applied to web pages.
                    </div>
                  </div>
                  <select
                    className="settings-select"
                    value={String(settings.defaultZoom)}
                    onChange={(e) => void onUpdateSettings({ defaultZoom: Number(e.target.value) })}
                  >
                    <option value="0.75">75%</option>
                    <option value="0.9">90%</option>
                    <option value="1">100% (Default)</option>
                    <option value="1.1">110%</option>
                    <option value="1.25">125%</option>
                    <option value="1.5">150%</option>
                  </select>
                </div>

                <div className="settings-row">
                  <div className="settings-row-info">
                    <div className="settings-row-title">Remember sidebar state</div>
                    <div className="settings-row-desc">
                      Keep the EDITH side panel open across browser restarts.
                    </div>
                  </div>
                  <label className="settings-switch">
                    <input
                      type="checkbox"
                      checked={settings.rememberSidebar}
                      onChange={(e) => void onUpdateSettings({ rememberSidebar: e.target.checked })}
                    />
                    <span className="settings-slider" />
                  </label>
                </div>
              </div>
            </section>
          )}

          {section === 'startup' && (
            <section className="settings-section">
              <h2 className="settings-heading">On startup</h2>
              <div className="settings-card">
                <label className="settings-radio-row">
                  <input
                    type="radio"
                    name="startupBehavior"
                    checked={settings.startupBehavior === 'newtab'}
                    onChange={() => void onUpdateSettings({ startupBehavior: 'newtab' })}
                  />
                  <div>
                    <div className="settings-row-title">Open the New Tab page</div>
                    <div className="settings-row-desc">Start fresh with the EDITH New Tab dashboard.</div>
                  </div>
                </label>

                <label className="settings-radio-row">
                  <input
                    type="radio"
                    name="startupBehavior"
                    checked={settings.startupBehavior === 'restore'}
                    onChange={() => void onUpdateSettings({ startupBehavior: 'restore' })}
                  />
                  <div>
                    <div className="settings-row-title">Continue where you left off</div>
                    <div className="settings-row-desc">
                      Reopen the tabs that were open when you closed the browser.
                    </div>
                  </div>
                </label>

                <label className="settings-radio-row">
                  <input
                    type="radio"
                    name="startupBehavior"
                    checked={settings.startupBehavior === 'specific'}
                    onChange={() => void onUpdateSettings({ startupBehavior: 'specific' })}
                  />
                  <div style={{ flex: 1 }}>
                    <div className="settings-row-title">Open a specific page</div>
                    <input
                      type="text"
                      className="settings-input"
                      style={{ marginTop: 8 }}
                      value={settings.startupUrl}
                      disabled={settings.startupBehavior !== 'specific'}
                      onChange={(e) => void onUpdateSettings({ startupUrl: e.target.value })}
                      placeholder="https://www.google.com"
                    />
                  </div>
                </label>
              </div>
            </section>
          )}

          {section === 'search' && (
            <section className="settings-section">
              <h2 className="settings-heading">Search engine</h2>
              <div className="settings-card">
                <div className="settings-row">
                  <div className="settings-row-info">
                    <div className="settings-row-title">Search engine used in the address bar</div>
                    <div className="settings-row-desc">
                      Used when you enter search queries into the omnibox or New Tab bar.
                    </div>
                  </div>
                  <select
                    className="settings-select"
                    value={settings.searchEngine}
                    onChange={(e) =>
                      void onUpdateSettings({
                        searchEngine: e.target.value as BrowserSettings['searchEngine']
                      })
                    }
                  >
                    <option value="google">Google</option>
                    <option value="duckduckgo">DuckDuckGo</option>
                    <option value="bing">Bing</option>
                    <option value="brave">Brave Search</option>
                    <option value="custom">Custom URL</option>
                  </select>
                </div>

                {settings.searchEngine === 'custom' && (
                  <div className="settings-row">
                    <div className="settings-row-info" style={{ width: '100%' }}>
                      <div className="settings-row-title">Custom search URL</div>
                      <div className="settings-row-desc">Use %s in place of the query string.</div>
                      <input
                        type="text"
                        className="settings-input"
                        style={{ marginTop: 8 }}
                        value={settings.customSearchUrl}
                        onChange={(e) => void onUpdateSettings({ customSearchUrl: e.target.value })}
                        placeholder="https://example.com/search?q=%s"
                      />
                    </div>
                  </div>
                )}
              </div>
            </section>
          )}

          {section === 'privacy' && (
            <section className="settings-section">
              <h2 className="settings-heading">Privacy &amp; security</h2>
              <div className="settings-card">
                <div className="settings-row">
                  <div className="settings-row-info">
                    <div className="settings-row-title">Confirm cross-domain navigation</div>
                    <div className="settings-row-desc">
                      Ask before EDITH navigates away from the starting domain (trusted ATS sites are exempt).
                    </div>
                  </div>
                  <label className="settings-switch">
                    <input
                      type="checkbox"
                      checked={settings.crossDomainConfirm}
                      onChange={(e) =>
                        void onUpdateSettings({ crossDomainConfirm: e.target.checked })
                      }
                    />
                    <span className="settings-slider" />
                  </label>
                </div>
              </div>

              <h3 className="settings-subheading">Clear browsing data</h3>
              <div className="settings-card">
                <div className="settings-checklist">
                  <label className="settings-check-item">
                    <input
                      type="checkbox"
                      checked={clearCache}
                      onChange={(e) => setClearCache(e.target.checked)}
                    />
                    <span>Cached images and files</span>
                  </label>
                  <label className="settings-check-item">
                    <input
                      type="checkbox"
                      checked={clearCookies}
                      onChange={(e) => setClearCookies(e.target.checked)}
                    />
                    <span>Cookies and site storage (logs you out of websites)</span>
                  </label>
                  <label className="settings-check-item">
                    <input
                      type="checkbox"
                      checked={clearHistory}
                      onChange={(e) => setClearHistory(e.target.checked)}
                    />
                    <span>EDITH task history</span>
                  </label>
                  <label className="settings-check-item">
                    <input
                      type="checkbox"
                      checked={clearAnswers}
                      onChange={(e) => setClearAnswers(e.target.checked)}
                    />
                    <span>Cached form-filling answers (answers-cache.json)</span>
                  </label>
                </div>
                <div className="settings-actions-bar">
                  <button type="button" className="settings-btn-primary" onClick={handleClearData}>
                    Clear data
                  </button>
                  {clearNotice && <span className="settings-feedback ok">{clearNotice}</span>}
                </div>
              </div>
            </section>
          )}

          {section === 'downloads' && (
            <section className="settings-section">
              <h2 className="settings-heading">Downloads</h2>
              <div className="settings-card">
                <div className="settings-row">
                  <div className="settings-row-info">
                    <div className="settings-row-title">Location</div>
                    <div className="settings-row-desc">
                      <code>
                        {settings.downloadPath ||
                          runtimeInfo?.defaultDownloadsPath ||
                          'Downloads/EDITH'}
                      </code>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {settings.downloadPath && (
                      <button
                        type="button"
                        className="settings-btn-secondary"
                        onClick={() => void onUpdateSettings({ downloadPath: '' })}
                      >
                        Reset
                      </button>
                    )}
                    <button
                      type="button"
                      className="settings-btn-secondary"
                      onClick={() => void handlePickDownloadDir()}
                    >
                      <IconFolder size={13} />
                      <span>Change</span>
                    </button>
                  </div>
                </div>

                <div className="settings-row">
                  <div className="settings-row-info">
                    <div className="settings-row-title">
                      Ask where to save each file before downloading
                    </div>
                    <div className="settings-row-desc">
                      When disabled, files save automatically into your Downloads folder.
                    </div>
                  </div>
                  <label className="settings-switch">
                    <input
                      type="checkbox"
                      checked={settings.askWhereToSave}
                      onChange={(e) => void onUpdateSettings({ askWhereToSave: e.target.checked })}
                    />
                    <span className="settings-slider" />
                  </label>
                </div>
              </div>
            </section>
          )}

          {section === 'agent' && (
            <section className="settings-section">
              <h2 className="settings-heading">EDITH &amp; Automation</h2>

              <form className="settings-card" onSubmit={handleSaveLlmConfig}>
                <div className="settings-field">
                  <label>API Base URL</label>
                  <input
                    type="text"
                    className="settings-input"
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                    placeholder="https://openrouter.ai/api/v1"
                  />
                </div>

                <div className="settings-field">
                  <label>API Key</label>
                  <div className="settings-input-row">
                    <input
                      type={showKey ? 'text' : 'password'}
                      className="settings-input"
                      value={apiKey}
                      onChange={(e) => setApiKey(e.target.value)}
                      placeholder="sk-..."
                    />
                    <button
                      type="button"
                      className="settings-btn-secondary"
                      onClick={() => setShowKey((prev) => !prev)}
                    >
                      {showKey ? 'Hide' : 'Show'}
                    </button>
                  </div>
                </div>

                <div className="settings-field">
                  <label>Model Identifier</label>
                  <input
                    type="text"
                    className="settings-input"
                    value={model}
                    onChange={(e) => setModel(e.target.value)}
                    placeholder="anthropic/claude-sonnet-4.5"
                  />
                  <div className="settings-presets">
                    {MODEL_PRESETS.map((p) => (
                      <button
                        key={p.value}
                        type="button"
                        className={`settings-preset-btn ${model === p.value ? 'active' : ''}`}
                        onClick={() => setModel(p.value)}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>
                </div>

                <div className="settings-actions-bar">
                  <button
                    type="submit"
                    className="settings-btn-primary"
                    disabled={savingConfig}
                  >
                    {savingConfig ? 'Saving...' : 'Save provider'}
                  </button>
                  <button
                    type="button"
                    className="settings-btn-secondary"
                    onClick={() => void handleTestConnection()}
                  >
                    Test connection
                  </button>
                  {configSavedNotice && (
                    <span className="settings-feedback ok">
                      <IconCheck size={13} /> Saved
                    </span>
                  )}
                  {pingResult && (
                    <span className={`settings-feedback ${pingResult.ok ? 'ok' : 'err'}`}>
                      {pingResult.text}
                    </span>
                  )}
                </div>
              </form>

              <h3 className="settings-subheading">Behavior &amp; Guardrails</h3>
              <div className="settings-card">
                <div className="settings-row">
                  <div className="settings-row-info">
                    <div className="settings-row-title">Show virtual cursor</div>
                    <div className="settings-row-desc">
                      Display the animated pointer and action badges while EDITH operates a page.
                    </div>
                  </div>
                  <label className="settings-switch">
                    <input
                      type="checkbox"
                      checked={settings.showVirtualCursor}
                      onChange={(e) =>
                        void onUpdateSettings({ showVirtualCursor: e.target.checked })
                      }
                    />
                    <span className="settings-slider" />
                  </label>
                </div>

                <div className="settings-row">
                  <div className="settings-row-info">
                    <div className="settings-row-title">Typing animation speed</div>
                    <div className="settings-row-desc">
                      Controls keystroke pacing when filling forms.
                    </div>
                  </div>
                  <select
                    className="settings-select"
                    value={settings.typingSpeed}
                    onChange={(e) =>
                      void onUpdateSettings({
                        typingSpeed: e.target.value as BrowserSettings['typingSpeed']
                      })
                    }
                  >
                    <option value="normal">Normal (38ms/char)</option>
                    <option value="fast">Fast (16ms/char)</option>
                    <option value="instant">Instant</option>
                  </select>
                </div>

                <div className="settings-row">
                  <div className="settings-row-info">
                    <div className="settings-row-title">Default Dry-Run mode</div>
                    <div className="settings-row-desc">
                      Fill and verify job applications without submitting them.
                    </div>
                  </div>
                  <label className="settings-switch">
                    <input
                      type="checkbox"
                      checked={settings.defaultDryRun}
                      onChange={(e) => void onUpdateSettings({ defaultDryRun: e.target.checked })}
                    />
                    <span className="settings-slider" />
                  </label>
                </div>

                <div className="settings-row">
                  <div className="settings-row-info">
                    <div className="settings-row-title">EEO &amp; demographic questions</div>
                    <div className="settings-row-desc">
                      How EDITH handles voluntary self-identification fields.
                    </div>
                  </div>
                  <select
                    className="settings-select"
                    value={settings.eeoPolicy}
                    onChange={(e) =>
                      void onUpdateSettings({
                        eeoPolicy: e.target.value as BrowserSettings['eeoPolicy']
                      })
                    }
                  >
                    <option value="prefer_not_to_say">Select "Prefer not to say"</option>
                    <option value="leave_blank">Leave blank for review</option>
                  </select>
                </div>

                <div className="settings-row">
                  <div className="settings-row-info">
                    <div className="settings-row-title">Max steps per task</div>
                    <div className="settings-row-desc">
                      Maximum tool steps before an automation task stops automatically.
                    </div>
                  </div>
                  <input
                    type="number"
                    min={10}
                    max={150}
                    className="settings-input"
                    style={{ width: 90 }}
                    value={settings.maxAgentSteps}
                    onChange={(e) =>
                      void onUpdateSettings({ maxAgentSteps: Number(e.target.value) || 60 })
                    }
                  />
                </div>
              </div>
            </section>
          )}

          {section === 'profile' && (
            <section className="settings-section">
              <h2 className="settings-heading">Profile &amp; Autofill</h2>
              {profile ? (
                <form className="settings-card" onSubmit={handleSaveProfile}>
                  <div className="settings-grid-2">
                    <div className="settings-field">
                      <label>Full Name</label>
                      <input
                        type="text"
                        className="settings-input"
                        value={profile.fullName || ''}
                        onChange={(e) => setProfile({ ...profile, fullName: e.target.value })}
                      />
                    </div>
                    <div className="settings-field">
                      <label>Email</label>
                      <input
                        type="email"
                        className="settings-input"
                        value={profile.email || ''}
                        onChange={(e) => setProfile({ ...profile, email: e.target.value })}
                      />
                    </div>
                    <div className="settings-field">
                      <label>Phone</label>
                      <input
                        type="text"
                        className="settings-input"
                        value={profile.phone || ''}
                        onChange={(e) => setProfile({ ...profile, phone: e.target.value })}
                      />
                    </div>
                    <div className="settings-field">
                      <label>City</label>
                      <input
                        type="text"
                        className="settings-input"
                        value={profile.city || ''}
                        onChange={(e) => setProfile({ ...profile, city: e.target.value })}
                      />
                    </div>
                    <div className="settings-field">
                      <label>LinkedIn URL</label>
                      <input
                        type="text"
                        className="settings-input"
                        value={profile.linkedin || ''}
                        onChange={(e) => setProfile({ ...profile, linkedin: e.target.value })}
                      />
                    </div>
                    <div className="settings-field">
                      <label>GitHub URL</label>
                      <input
                        type="text"
                        className="settings-input"
                        value={profile.github || ''}
                        onChange={(e) => setProfile({ ...profile, github: e.target.value })}
                      />
                    </div>
                    <div className="settings-field">
                      <label>Notice Period</label>
                      <input
                        type="text"
                        className="settings-input"
                        value={profile.noticePeriod || ''}
                        onChange={(e) => setProfile({ ...profile, noticePeriod: e.target.value })}
                      />
                    </div>
                    <div className="settings-field">
                      <label>Expected CTC</label>
                      <input
                        type="text"
                        className="settings-input"
                        value={profile.expectedCTC || ''}
                        onChange={(e) => setProfile({ ...profile, expectedCTC: e.target.value })}
                      />
                    </div>
                  </div>

                  <div className="settings-field">
                    <label>Resume File</label>
                    <div className="settings-input-row">
                      <input
                        type="text"
                        className="settings-input"
                        value={profile.resumePath || ''}
                        onChange={(e) => setProfile({ ...profile, resumePath: e.target.value })}
                        placeholder="Path to PDF or DOCX resume"
                      />
                      <button
                        type="button"
                        className="settings-btn-secondary"
                        onClick={() => void handlePickResume()}
                      >
                        Browse
                      </button>
                    </div>
                  </div>

                  <div className="settings-actions-bar">
                    <button
                      type="submit"
                      className="settings-btn-primary"
                      disabled={profileSaving}
                    >
                      {profileSaving ? 'Saving...' : 'Save profile'}
                    </button>
                    {profileSavedNotice && (
                      <span className="settings-feedback ok">
                        <IconCheck size={13} /> Profile saved
                      </span>
                    )}
                  </div>
                </form>
              ) : (
                <div className="settings-card">
                  <div className="settings-row">
                    <div className="settings-row-info">
                      <div className="settings-row-title">No profile found</div>
                      <div className="settings-row-desc">
                        Create profile.json in the project root or userData directory to enable form autofill.
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </section>
          )}

          {section === 'about' && (
            <section className="settings-section">
              <h2 className="settings-heading">About EDITH Browser</h2>
              <div className="settings-card">
                <div className="settings-row">
                  <div className="settings-row-info">
                    <div className="settings-row-title">EDITH Browser</div>
                    <div className="settings-row-desc">
                      Version {runtimeInfo?.appVersion || '0.1.0'}
                    </div>
                  </div>
                </div>
                <div className="settings-row">
                  <div className="settings-row-info">
                    <div className="settings-row-title">Engine</div>
                    <div className="settings-row-desc">
                      Chromium {runtimeInfo?.chromeVersion || '—'} · Electron{' '}
                      {runtimeInfo?.electronVersion || '—'} · Node{' '}
                      {runtimeInfo?.nodeVersion || '—'}
                    </div>
                  </div>
                </div>
                <div className="settings-row">
                  <div className="settings-row-info">
                    <div className="settings-row-title">User Data Directory</div>
                    <div className="settings-row-desc">
                      <code>{runtimeInfo?.userDataPath || '—'}</code>
                    </div>
                  </div>
                </div>
                <div className="settings-row">
                  <div className="settings-row-info">
                    <div className="settings-row-title">Reset settings</div>
                    <div className="settings-row-desc">
                      Restore all browser preferences to their default values (keeps API keys and profile).
                    </div>
                  </div>
                  <button
                    type="button"
                    className="settings-btn-secondary"
                    onClick={() => void onResetSettings()}
                  >
                    Reset to defaults
                  </button>
                </div>
              </div>
            </section>
          )}
        </div>
      </main>
    </div>
  )
}
