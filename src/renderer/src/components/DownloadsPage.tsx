import React, { useMemo, useState } from 'react'
import type { DownloadRecord } from '../../../shared/types'
import { IconDownload, IconFile, IconFolder, IconSearch } from './Icons.js'

interface DownloadsPageProps {
  downloads: DownloadRecord[]
}

function formatBytes(bytes: number): string {
  if (!bytes || bytes <= 0) return '0 B'
  const k = 1024
  const sizes = ['B', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`
}

export const DownloadsPage: React.FC<DownloadsPageProps> = ({ downloads }) => {
  const [search, setSearch] = useState('')

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return downloads
    return downloads.filter(
      (d) =>
        d.filename.toLowerCase().includes(q) ||
        (d.url && d.url.toLowerCase().includes(q))
    )
  }, [downloads, search])

  return (
    <div className="downloads-page">
      <div className="downloads-page-inner">
        <header className="downloads-page-header">
          <div className="downloads-page-title-row">
            <IconDownload size={20} />
            <h1>Downloads</h1>
          </div>

          <div className="downloads-page-controls">
            <div className="downloads-search-box">
              <IconSearch size={14} />
              <input
                type="text"
                placeholder="Search downloads"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
            <button
              type="button"
              className="settings-btn-secondary"
              onClick={() => void window.api?.downloads.showInFolder('')}
            >
              <IconFolder size={14} />
              <span>Open downloads folder</span>
            </button>
          </div>
        </header>

        {filtered.length === 0 ? (
          <div className="downloads-empty">
            <IconDownload size={32} style={{ opacity: 0.35 }} />
            <div className="downloads-empty-title">
              {downloads.length === 0 ? 'No downloads yet' : 'No matching downloads'}
            </div>
            <div className="downloads-empty-desc">
              {downloads.length === 0
                ? 'Files you download from the web will appear here.'
                : 'Try a different search term.'}
            </div>
          </div>
        ) : (
          <div className="downloads-page-list">
            {filtered.map((d) => {
              let host = d.url
              try {
                host = d.url ? new URL(d.url).hostname : ''
              } catch {
                /* keep raw */
              }
              const pct =
                d.totalBytes > 0
                  ? Math.min(100, Math.round((d.receivedBytes / d.totalBytes) * 100))
                  : 0

              return (
                <div key={d.id} className="downloads-page-card">
                  <div className="downloads-page-icon">
                    <IconFile size={20} />
                  </div>

                  <div className="downloads-page-info">
                    <div className="downloads-page-filename" title={d.filename}>
                      {d.filename}
                    </div>
                    <div className="downloads-page-meta">
                      <span>{formatBytes(d.totalBytes || d.receivedBytes)}</span>
                      {host && (
                        <>
                          <span>·</span>
                          <span title={d.url}>{host}</span>
                        </>
                      )}
                      <span>·</span>
                      <span
                        className={`downloads-page-state ${
                          d.state === 'completed'
                            ? 'ok'
                            : d.state === 'progressing'
                              ? 'prog'
                              : 'err'
                        }`}
                      >
                        {d.state}
                      </span>
                    </div>

                    {d.state === 'progressing' && d.totalBytes > 0 && (
                      <div className="download-progress-bar-bg" style={{ marginTop: 8 }}>
                        <div
                          className="download-progress-bar-fill"
                          style={{ width: `${pct}%` }}
                        />
                      </div>
                    )}
                  </div>

                  <div className="downloads-page-actions">
                    {d.state === 'completed' && (
                      <button
                        type="button"
                        className="settings-btn-primary"
                        onClick={() => void window.api?.downloads.openFile(d.savePath)}
                      >
                        Open file
                      </button>
                    )}
                    <button
                      type="button"
                      className="settings-btn-secondary"
                      onClick={() => void window.api?.downloads.showInFolder(d.savePath)}
                    >
                      Show in folder
                    </button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
