'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import { buildOverlayBookmarklet, type OverlayTarget } from '@/lib/overlayBookmarklet';
import type { FeedbackSession } from '@feedbackagent/shared';

const RECENT_URLS_KEY = 'feedbackagent_recent_urls';
const DEFAULT_DEBUG_URLS = ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:5173', 'http://localhost:4200'];
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

interface ChromeTab {
  title: string;
  url: string;
}

function getRecentUrls(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_URLS_KEY) || '[]');
  } catch {
    return [];
  }
}

export default function SessionsPage() {
  const router = useRouter();
  const [sessions, setSessions] = useState<FeedbackSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [createStep, setCreateStep] = useState<1 | 2>(1);
  const [title, setTitle] = useState('');
  const [targetUrl, setTargetUrl] = useState('');
  const [recentUrls, setRecentUrls] = useState<string[]>([]);
  const [chromeTabs, setChromeTabs] = useState<ChromeTab[]>([]);
  const [tabsLoading, setTabsLoading] = useState(false);
  const [tabsError, setTabsError] = useState('');
  const [handoffTarget, setHandoffTarget] = useState<OverlayTarget>('claude');
  const [creatingSession, setCreatingSession] = useState(false);

  async function loadSessions() {
    try {
      const data = await api.sessions.list();
      setSessions(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error('[sessions] Error loading:', e);
      setSessions([]); // Default to empty list on error
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadSessions();
    setRecentUrls(getRecentUrls());
  }, []);

  useEffect(() => {
    if (!showCreateModal || createStep !== 2) return;

    let isCancelled = false;

    async function loadChromeTabs() {
      setTabsLoading(true);
      setTabsError('');
      try {
        const res = await fetch(`${API_BASE}/system/chrome-tabs`);
        const json = await res.json();
        if (!res.ok) throw new Error(json.error ?? 'Failed to load Chrome tabs');
        if (!isCancelled) setChromeTabs(Array.isArray(json.data) ? json.data : []);
      } catch (error) {
        if (!isCancelled) {
          setTabsError(error instanceof Error ? error.message : 'Failed to load Chrome tabs');
          setChromeTabs([]);
        }
      } finally {
        if (!isCancelled) setTabsLoading(false);
      }
    }

    void loadChromeTabs();

    return () => {
      isCancelled = true;
    };
  }, [showCreateModal, createStep]);

  const closeCreateModal = () => {
    setShowCreateModal(false);
    setCreateStep(1);
    setTitle('');
    setTargetUrl('');
    setHandoffTarget('claude');
    setCreatingSession(false);
    setChromeTabs([]);
    setTabsError('');
    setTabsLoading(false);
  };

  const normalizeUrl = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return '';
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed;
    if (trimmed.startsWith('localhost') || trimmed.startsWith('127.0.0.1')) return `http://${trimmed}`;
    return `https://${trimmed}`;
  };

  const handleCreateSession = async () => {
    if (!title.trim()) {
      alert('Please enter a title');
      return;
    }
    if (!targetUrl.trim()) {
      alert('Paste the URL for the tab you want to debug');
      return;
    }

    setCreatingSession(true);
    try {
      const normalizedUrl = normalizeUrl(targetUrl);
      const session = await api.sessions.create('proj_demo', {
        title: title.trim(),
        visibility: 'private',
      });

      const nextRecentUrls = [normalizedUrl, ...recentUrls.filter((entry) => entry !== normalizedUrl)].slice(0, 6);
      localStorage.setItem(RECENT_URLS_KEY, JSON.stringify(nextRecentUrls));
      setRecentUrls(nextRecentUrls);

      closeCreateModal();
      // Navigate to the record page with the target URL pre-loaded.
      // The annotation overlay is already there — no bookmarklet needed.
      router.push(
        `/sessions/${session.id}/record?url=${encodeURIComponent(normalizedUrl)}&target=${handoffTarget}`,
      );
    } catch (err) {
      console.error('[sessions] Create error:', err);
      const msg = err instanceof Error ? err.message : String(err);
      alert(`Failed to create session: ${msg}\n\nCheck that the API server is running at http://localhost:3001`);
      setCreatingSession(false);
    }
  };

  // Build bookmarklet href (must be a single expression, no newlines)
  const webOrigin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';
  const bookmarkletHref = buildOverlayBookmarklet({ webOrigin });

  return (
    <main style={{ maxWidth: 1200, margin: '0 auto', padding: '24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
        <h1>Debug Sessions</h1>
        <button
          className="btn btn-primary"
          onClick={() => {
            setShowCreateModal(true);
            setCreateStep(1);
          }}
          style={{ padding: '12px 24px' }}
        >
          + Create Session
        </button>
      </div>

      {/* Bookmarklet banner — primary overlay launcher users can reuse across pages */}
      <div style={{
        marginBottom: 32, padding: '14px 18px', borderRadius: 10,
        background: '#0f172a',
        border: '1px solid #1e293b', display: 'flex', alignItems: 'center', gap: 16, flexWrap: 'wrap',
      }}>
        <div style={{ flex: 1, minWidth: 220 }}>
          <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#94a3b8', marginBottom: 2 }}>
            Overlay launcher
          </div>
          <div style={{ fontSize: '0.78rem', color: '#475569', lineHeight: 1.5 }}>
            Drag <strong style={{ color: '#818cf8' }}>⬡ FeedbackAgent</strong> to your bookmarks bar once, then click it on any page to launch the real-page overlay without leaving that product tab.
          </div>
        </div>
        {/* Draggable bookmarklet */}
        <a
          href={bookmarkletHref}
          onClick={e => e.preventDefault()}
          draggable
          style={{
            display: 'inline-flex', alignItems: 'center', gap: 6,
            padding: '8px 16px', borderRadius: 7,
            background: '#1e293b', color: '#818cf8',
            fontWeight: 700, fontSize: 13, textDecoration: 'none',
            border: '1.5px dashed #334155',
            cursor: 'grab', userSelect: 'none', flexShrink: 0,
          }}
          title="Drag this to your bookmarks bar"
        >
          ⬡ FeedbackAgent
        </a>
      </div>

      {/* Create Session Modal */}
      {showCreateModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(3, 7, 18, 0.72)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
          onClick={() => !creatingSession && closeCreateModal()}
        >
          <div
            style={{
              background: 'linear-gradient(180deg, #f8fafc 0%, #eef2ff 100%)',
              padding: '32px',
              borderRadius: '18px',
              width: 'min(720px, calc(100vw - 32px))',
              boxShadow: '0 30px 90px rgba(15, 23, 42, 0.35)',
              border: '1px solid rgba(148, 163, 184, 0.25)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
              <div>
                <div style={{ fontSize: '0.78rem', fontWeight: 800, color: '#4f46e5', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 6 }}>
                  New Debug Session
                </div>
                <h2 style={{ margin: 0, fontSize: '1.75rem', color: '#0f172a' }}>
                  {createStep === 1 ? 'Name the feedback first' : 'Pick the tab to debug'}
                </h2>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                {[1, 2].map((step) => (
                  <div
                    key={step}
                    style={{
                      width: 34,
                      height: 34,
                      borderRadius: 999,
                      display: 'grid',
                      placeItems: 'center',
                      background: createStep === step ? '#0f172a' : '#cbd5e1',
                      color: createStep === step ? '#f8fafc' : '#475569',
                      fontSize: 13,
                      fontWeight: 800,
                    }}
                  >
                    {step}
                  </div>
                ))}
              </div>
            </div>

            {createStep === 1 ? (
              <>
                <p style={{ color: '#475569', marginBottom: 20, fontSize: '0.95rem', lineHeight: 1.7 }}>
                  Start with a short title so the session, screenshots, notes, and AI handoff all use the same label.
                </p>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#334155', marginBottom: 6 }}>
                  Session title
                </label>
                <input
                  type="text"
                  className="input"
                  placeholder="e.g., Checkout flow broken on mobile"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && title.trim() && setCreateStep(2)}
                  style={{ width: '100%', marginBottom: 18 }}
                  autoFocus
                  disabled={creatingSession}
                />
                <div style={{ background: '#dbeafe', border: '1px solid #93c5fd', borderRadius: 12, padding: '14px 16px', color: '#1e3a8a', fontSize: '0.9rem', lineHeight: 1.6, marginBottom: 22 }}>
                  Next we’ll ask which browser tab or page you want to debug, then we’ll launch the overlay flow on the real page instead of trapping you inside an iframe preview.
                </div>
                <div style={{ display: 'flex', gap: 10 }}>
                  <button className="btn btn-ghost" onClick={closeCreateModal} disabled={creatingSession} style={{ flex: 1 }}>
                    Cancel
                  </button>
                  <button
                    className="btn btn-primary"
                    onClick={() => setCreateStep(2)}
                    disabled={!title.trim() || creatingSession}
                    style={{ flex: 2 }}
                  >
                    Continue
                  </button>
                </div>
              </>
            ) : (
              <>
                <p style={{ color: '#475569', marginBottom: 20, fontSize: '0.95rem', lineHeight: 1.7 }}>
                  Pick the page you want to debug, then choose whether the handoff should go to Claude or Codex after submit.
                </p>
                <label style={{ display: 'block', fontSize: '0.8rem', fontWeight: 700, color: '#334155', marginBottom: 6 }}>
                  Tab URL
                </label>
                <input
                  type="url"
                  className="input"
                  placeholder="https://yourapp.com/checkout"
                  value={targetUrl}
                  onChange={(e) => setTargetUrl(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && handleCreateSession()}
                  style={{ width: '100%', marginBottom: 14 }}
                  autoFocus
                  disabled={creatingSession}
                />

                <div style={{ marginBottom: 16 }}>
                  <div style={{ fontSize: '0.74rem', fontWeight: 700, color: '#64748b', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    Quick picks
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {[...recentUrls, ...DEFAULT_DEBUG_URLS.filter((url) => !recentUrls.includes(url))].slice(0, 6).map((url) => (
                      <button
                        key={url}
                        type="button"
                        onClick={() => setTargetUrl(url)}
                        style={{
                          padding: '7px 12px',
                          borderRadius: 999,
                          border: '1px solid #cbd5e1',
                          background: '#fff',
                          color: '#334155',
                          cursor: 'pointer',
                          fontSize: 12,
                          fontWeight: 600,
                        }}
                      >
                        {url}
                      </button>
                    ))}
                  </div>
                </div>

                <div style={{ marginBottom: 18 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <div style={{ fontSize: '0.74rem', fontWeight: 700, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                      Open Chrome Tabs
                    </div>
                    <button
                      type="button"
                      onClick={async () => {
                        setTabsLoading(true);
                        setTabsError('');
                        try {
                          const res = await fetch(`${API_BASE}/system/chrome-tabs`);
                          const json = await res.json();
                          if (!res.ok) throw new Error(json.error ?? 'Failed to load Chrome tabs');
                          setChromeTabs(Array.isArray(json.data) ? json.data : []);
                        } catch (error) {
                          setTabsError(error instanceof Error ? error.message : 'Failed to load Chrome tabs');
                          setChromeTabs([]);
                        } finally {
                          setTabsLoading(false);
                        }
                      }}
                      style={{ border: 'none', background: 'none', color: '#4f46e5', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}
                    >
                      Refresh
                    </button>
                  </div>
                  <div style={{ display: 'grid', gap: 8, maxHeight: 180, overflowY: 'auto', paddingRight: 4 }}>
                    {tabsLoading ? (
                      <div style={{ padding: '10px 12px', borderRadius: 12, background: '#eef2ff', color: '#475569', fontSize: '0.88rem' }}>
                        Reading your open Chrome tabs...
                      </div>
                    ) : tabsError ? (
                      <div style={{ padding: '10px 12px', borderRadius: 12, background: '#fef2f2', color: '#991b1b', fontSize: '0.88rem', lineHeight: 1.5 }}>
                        {tabsError}
                      </div>
                    ) : chromeTabs.length === 0 ? (
                      <div style={{ padding: '10px 12px', borderRadius: 12, background: '#f8fafc', color: '#64748b', fontSize: '0.88rem', lineHeight: 1.5 }}>
                        No Chrome tabs were returned. If Chrome is open, local tab access may be blocked on this machine. You can still paste a URL above and continue with the overlay flow.
                      </div>
                    ) : chromeTabs.map((tab) => (
                      <button
                        key={`${tab.url}-${tab.title}`}
                        type="button"
                        onClick={() => setTargetUrl(tab.url)}
                        style={{
                          textAlign: 'left',
                          padding: '10px 12px',
                          borderRadius: 12,
                          border: targetUrl === tab.url ? '1px solid #6366f1' : '1px solid #cbd5e1',
                          background: targetUrl === tab.url ? '#eef2ff' : '#fff',
                          cursor: 'pointer',
                        }}
                      >
                        <div style={{ fontSize: '0.9rem', fontWeight: 700, color: '#0f172a', marginBottom: 3 }}>
                          {tab.title}
                        </div>
                        <div style={{ fontSize: '0.78rem', color: '#64748b', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {tab.url}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                <div style={{ marginTop: -4, marginBottom: 18, padding: '12px 14px', borderRadius: 12, background: '#fff7ed', border: '1px solid #fdba74', color: '#9a3412', fontSize: '0.84rem', lineHeight: 1.6 }}>
                  Chrome tab picking is a local convenience, not a browser standard. If the list is empty, the most reliable fallback is to paste the target URL or open the page first and use the FeedbackAgent overlay launcher from that page.
                </div>

                <div style={{ marginBottom: 18 }}>
                  <div style={{ fontSize: '0.74rem', fontWeight: 700, color: '#64748b', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    Send after submit
                  </div>
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    {([
                      ['claude', 'Claude'] as const,
                      ['codex', 'Codex'] as const,
                    ]).map(([key, label]) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => setHandoffTarget(key)}
                        style={{
                          padding: '10px 16px',
                          borderRadius: 999,
                          border: handoffTarget === key ? '1px solid #312e81' : '1px solid #cbd5e1',
                          background: handoffTarget === key ? '#312e81' : '#fff',
                          color: handoffTarget === key ? '#eef2ff' : '#334155',
                          cursor: 'pointer',
                          fontWeight: 700,
                          fontSize: '0.9rem',
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                <div style={{ background: '#f8fafc', border: '1px solid #cbd5e1', borderRadius: 12, padding: '14px 16px', color: '#334155', fontSize: '0.88rem', lineHeight: 1.6, marginBottom: 22 }}>
                  We’ll open the target page in a new browser tab, then give you a ready-to-use overlay launcher that already knows this session title and whether to send it to Claude or Codex.
                </div>

                <div style={{ display: 'flex', gap: 10 }}>
                  <button className="btn btn-ghost" onClick={() => setCreateStep(1)} disabled={creatingSession} style={{ flex: 1 }}>
                    Back
                  </button>
                  <button
                    className="btn btn-primary"
                    onClick={handleCreateSession}
                    disabled={creatingSession || !title.trim() || !targetUrl.trim()}
                    style={{ flex: 2 }}
                  >
                    {creatingSession ? 'Preparing overlay...' : 'Launch Overlay'}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Sessions List */}
      {loading ? (
        <p className="muted">Loading sessions…</p>
      ) : sessions.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 24px', color: '#999' }}>
          <p style={{ fontSize: '1.1rem', marginBottom: 16 }}>No debug sessions yet.</p>
          <button className="btn btn-primary" onClick={() => { setShowCreateModal(true); setCreateStep(1); }}>
            Create your first session
          </button>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16 }}>
          {sessions.map((session) => (
            <div
              key={session.id}
              style={{
                padding: 16,
                border: '1px solid #e5e7eb',
                borderRadius: 8,
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.boxShadow = '0 4px 12px rgba(0,0,0,0.1)';
                (e.currentTarget as HTMLElement).style.transform = 'translateY(-2px)';
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.boxShadow = 'none';
                (e.currentTarget as HTMLElement).style.transform = 'none';
              }}
              onClick={() => router.push(`/sessions/${session.id}/summary`)}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: 8 }}>
                <h3 style={{ fontSize: '1rem', fontWeight: 600, flex: 1 }}>{session.title}</h3>
                <span className={`badge badge-${session.status}`}>{session.status}</span>
              </div>
              <p style={{ fontSize: '0.8rem', color: '#666', marginBottom: 8 }}>
                {new Date(session.createdAt).toLocaleDateString()}
              </p>
              <div style={{ display: 'flex', gap: 8, fontSize: '0.75rem', color: '#999' }}>
                <span>📝 {session.comments?.length || 0} notes</span>
                <span>✓ {session.tasks?.length || 0} tasks</span>
              </div>
            </div>
          ))}
        </div>
      )}
    </main>
  );
}
