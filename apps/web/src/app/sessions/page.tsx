'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import type { FeedbackSession } from '@feedbackagent/shared';

const RECENT_URLS_KEY = 'feedbackagent_recent_urls';
const DEFAULT_DEBUG_URLS = ['http://127.0.0.1:3000', 'http://127.0.0.1:3001', 'http://127.0.0.1:5173', 'http://127.0.0.1:4200'];
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:3001/api';

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
  const [createStep, setCreateStep] = useState<1 | 2 | 3>(1);
  const [title, setTitle] = useState('');
  const [targetUrl, setTargetUrl] = useState('');
  const [recentUrls, setRecentUrls] = useState<string[]>([]);
  const [chromeTabs, setChromeTabs] = useState<ChromeTab[]>([]);
  const [tabsLoading, setTabsLoading] = useState(false);
  const [tabsError, setTabsError] = useState('');
  const [creatingSession, setCreatingSession] = useState(false);
  const [createdSessionId, setCreatedSessionId] = useState('');
  const [createdSessionTitle, setCreatedSessionTitle] = useState('');
  const [handoffTarget, setHandoffTarget] = useState<'claude' | 'codex'>('claude');

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
    setCreatedSessionId('');
    setCreatedSessionTitle('');
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
    const normalizedUrl = normalizeUrl(targetUrl);
    try {
      const session = await api.sessions.create('proj_demo', {
        title: title.trim(),
        visibility: 'private',
      });

      console.log('[sessions] created session', {
        sessionId: session.id,
        title: session.title,
        target: handoffTarget,
        url: normalizedUrl,
      });

      const nextRecentUrls = [normalizedUrl, ...recentUrls.filter((entry) => entry !== normalizedUrl)].slice(0, 6);
      localStorage.setItem(RECENT_URLS_KEY, JSON.stringify(nextRecentUrls));
      setRecentUrls(nextRecentUrls);

      // Stay in the modal — advance to Step 3 which confirms the native desktop flow is ready.
      setCreatedSessionId(session.id);
      setCreatedSessionTitle(session.title);
      setCreatingSession(false);
      setCreateStep(3);
    } catch (err) {
      console.error('[sessions] Create error:', err);
      const msg = err instanceof Error ? err.message : String(err);
      alert(`Failed to create session: ${msg}\n\nCheck that the API server is running at http://127.0.0.1:3001`);
      setCreatingSession(false);
    }
  };

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

      <div style={{
        marginBottom: 32,
        padding: '18px 20px',
        borderRadius: 10,
        background: 'var(--surface)',
        boxShadow: 'inset 0 0 0 1px var(--stone)',
        color: 'var(--text)',
      }}>
        <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--ash)', marginBottom: 6, letterSpacing: '0.04em', textTransform: 'uppercase' }}>
          Native app first
        </div>
        <div style={{ fontSize: 15, lineHeight: 1.47, color: 'var(--muted)' }}>
          debugr.ai is now Mac app first. Open the DMG app to capture the screen, confirm the linked repo context, and submit to Claude or Codex. This web dashboard is the review surface for saved sessions.
        </div>
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
              background: 'var(--surface)',
              padding: '32px',
              borderRadius: 10,
              width: 'min(720px, calc(100vw - 32px))',
              boxShadow: 'inset 0 0 0 1px var(--stone)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
              <div>
                <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--ash)', letterSpacing: '0.04em', textTransform: 'uppercase', marginBottom: 6 }}>
                  New Debug Session
                </div>
                <h2 style={{ margin: 0, fontSize: 23, lineHeight: 1.2, color: 'var(--text)' }}>
                  {createStep === 1 ? 'Name the feedback first' : createStep === 2 ? 'Pick the tab to debug' : 'Annotate on the real page'}
                </h2>
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                {[1, 2, 3].map((step) => (
                  <div
                    key={step}
                    style={{
                      width: 34,
                      height: 34,
                      borderRadius: 999,
                      display: 'grid',
                      placeItems: 'center',
                      background: createStep === step ? 'var(--blue)' : step < createStep ? 'rgba(0, 202, 72, 0.12)' : 'var(--stone)',
                      color: createStep === step ? '#fff' : 'var(--text)',
                      fontSize: step < createStep ? 16 : 13,
                      fontWeight: 500,
                    }}
                  >
                    {step < createStep ? '✓' : step}
                  </div>
                ))}
              </div>
            </div>

            {createStep === 3 ? (
              /* ── Step 3: Native desktop app handoff ── */
              <>
                {/* Success banner */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px', borderRadius: 10, background: 'rgba(0, 202, 72, 0.08)', boxShadow: 'inset 0 0 0 1px rgba(0, 202, 72, 0.2)', marginBottom: 22 }}>
                  <span style={{ fontSize: 22, color: 'var(--green)' }}>✓</span>
                  <div>
                    <div style={{ fontWeight: 500, color: 'var(--text)', fontSize: 15 }}>Native capture flow ready</div>
                    <div style={{ color: 'var(--muted)', fontSize: 12, marginTop: 2 }}>
                      <strong>{createdSessionTitle}</strong> · Sending to <strong>{handoffTarget === 'codex' ? 'Codex' : 'Claude'}</strong>
                    </div>
                    <div style={{ color: 'var(--muted)', fontSize: 12, marginTop: 4 }}>
                      Open the debugr.ai desktop app, freeze the right screenshot, confirm it matches the linked repo, then send it from the native canvas.
                    </div>
                  </div>
                </div>

                {/* Numbered steps */}
                <div style={{ display: 'grid', gap: 14, marginBottom: 22 }}>
                  {/* Step A: native capture */}
                  <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', padding: '16px 18px', borderRadius: 10, background: 'var(--surface-soft)', boxShadow: 'inset 0 0 0 1px var(--stone)' }}>
                    <div style={{ width: 30, height: 30, borderRadius: 999, background: 'var(--blue)', color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 500, fontSize: 13, flexShrink: 0 }}>1</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 500, color: 'var(--text)', marginBottom: 8, fontSize: 15 }}>
                        Open the desktop app
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--muted)', marginTop: 6, lineHeight: 1.58 }}>
                        Open <code style={{ background: 'var(--stone)', padding: '1px 5px', borderRadius: 4, color: 'var(--text)' }}>debugr.ai</code> on macOS and choose whether to capture a browser page or another app on screen.
                      </div>
                    </div>
                  </div>

                  {/* Step B: submit */}
                  <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', padding: '16px 18px', borderRadius: 10, background: 'var(--surface-soft)', boxShadow: 'inset 0 0 0 1px var(--stone)' }}>
                    <div style={{ width: 30, height: 30, borderRadius: 999, background: 'var(--blue)', color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 500, fontSize: 13, flexShrink: 0 }}>2</div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 500, color: 'var(--text)', marginBottom: 6, fontSize: 15 }}>
                        Confirm repo context, then submit
                      </div>
                      <div style={{ fontSize: 15, color: 'var(--muted)', lineHeight: 1.47 }}>
                        After the screenshot is frozen, Debugr asks the user to confirm it belongs to the current Claude or Codex work and linked GitHub repo before sending it.
                      </div>
                    </div>
                  </div>
                </div>

                <div style={{ display: 'flex', gap: 10 }}>
                  <button className="btn btn-ghost" onClick={closeCreateModal} style={{ flex: 1 }}>
                    Close
                  </button>
                  <button
                    className="btn btn-primary"
                    onClick={() => {
                      closeCreateModal();
                      router.push(`/sessions/${createdSessionId}/summary`);
                    }}
                    style={{ flex: 2 }}
                  >
                    Go to session summary →
                  </button>
                </div>
              </>
            ) : createStep === 1 ? (
              <>
                <p style={{ color: 'var(--muted)', marginBottom: 20, fontSize: 15, lineHeight: 1.47 }}>
                  Start with a short title so the session, screenshots, notes, and AI handoff all use the same label.
                </p>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--ash)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
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
                <div style={{ background: 'var(--blue-soft)', boxShadow: 'inset 0 0 0 1px rgba(0, 134, 252, 0.2)', borderRadius: 10, padding: '14px 16px', color: 'var(--text)', fontSize: 15, lineHeight: 1.47, marginBottom: 22 }}>
                  Next we’ll ask which browser tab or page you want to debug, then we’ll hand the session to the native desktop app instead of trapping you inside an iframe preview.
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
                <p style={{ color: 'var(--muted)', marginBottom: 20, fontSize: 15, lineHeight: 1.47 }}>
                  Pick the page you want to debug, then choose whether the handoff should go to Claude or Codex after submit.
                </p>
                <label style={{ display: 'block', fontSize: 12, fontWeight: 500, color: 'var(--ash)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
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
                  <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--ash)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
                    Quick picks
                  </div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {[...new Set([...recentUrls, ...DEFAULT_DEBUG_URLS])].slice(0, 6).map((url) => (
                      <button
                        key={url}
                        type="button"
                        onClick={() => setTargetUrl(url)}
                        style={{
                          padding: '7px 12px',
                          borderRadius: 999,
                          border: 'none',
                          boxShadow: 'inset 0 0 0 1px var(--stone)',
                          background: '#f6f4ef',
                          color: 'var(--text)',
                          cursor: 'pointer',
                          fontSize: 12,
                          fontWeight: 500,
                        }}
                      >
                        {url}
                      </button>
                    ))}
                  </div>
                </div>

                <div style={{ marginBottom: 18 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--ash)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
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
                      style={{ border: 'none', background: 'none', color: 'var(--blue)', cursor: 'pointer', fontSize: 12, fontWeight: 500 }}
                    >
                      Refresh
                    </button>
                  </div>
                  <div style={{ display: 'grid', gap: 8, maxHeight: 180, overflowY: 'auto', paddingRight: 4 }}>
                    {tabsLoading ? (
                      <div style={{ padding: '10px 12px', borderRadius: 10, background: 'var(--surface-soft)', color: 'var(--muted)', fontSize: 15 }}>
                        Reading your open Chrome tabs...
                      </div>
                    ) : tabsError ? (
                      <div style={{ padding: '10px 12px', borderRadius: 10, background: '#fdf1ef', color: 'var(--red)', fontSize: 15, lineHeight: 1.47 }}>
                        {tabsError}
                      </div>
                    ) : chromeTabs.length === 0 ? (
                      <div style={{ padding: '10px 12px', borderRadius: 10, background: 'var(--surface-soft)', color: 'var(--muted)', fontSize: 15, lineHeight: 1.47 }}>
                        No Chrome tabs were returned. If Chrome is open, local tab access may be blocked on this machine. You can still paste a URL above and continue with the native desktop flow.
                      </div>
                    ) : chromeTabs.map((tab, index) => (
                      <button
                        key={`${tab.url}-${tab.title}-${index}`}
                        type="button"
                        onClick={() => setTargetUrl(tab.url)}
                        style={{
                          textAlign: 'left',
                          padding: '10px 12px',
                          borderRadius: 12,
                          border: 'none',
                          boxShadow: targetUrl === tab.url ? 'inset 0 0 0 1px var(--blue)' : 'inset 0 0 0 1px var(--stone)',
                          background: targetUrl === tab.url ? 'var(--blue-soft)' : 'var(--surface)',
                          cursor: 'pointer',
                        }}
                      >
                        <div style={{ fontSize: 15, fontWeight: 500, color: 'var(--text)', marginBottom: 3 }}>
                          {tab.title}
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          {tab.url}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                <div style={{ marginTop: -4, marginBottom: 18, padding: '12px 14px', borderRadius: 10, background: 'rgba(255, 187, 38, 0.12)', boxShadow: 'inset 0 0 0 1px rgba(255, 187, 38, 0.28)', color: 'var(--text)', fontSize: 15, lineHeight: 1.47 }}>
                  Chrome tab picking is only a convenience for finding a page quickly. The product now completes annotation inside the native desktop app.
                </div>

                <div style={{ marginBottom: 18 }}>
                  <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--ash)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.04em' }}>
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
                          border: 'none',
                          boxShadow: handoffTarget === key ? 'inset 0 0 0 1px var(--blue)' : 'inset 0 0 0 1px var(--stone)',
                          background: handoffTarget === key ? 'var(--blue)' : '#f6f4ef',
                          color: handoffTarget === key ? '#fff' : 'var(--text)',
                          cursor: 'pointer',
                          fontWeight: 500,
                          fontSize: '0.9rem',
                        }}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                <div style={{ background: 'var(--surface-soft)', boxShadow: 'inset 0 0 0 1px var(--stone)', borderRadius: 10, padding: '14px 16px', color: 'var(--muted)', fontSize: 15, lineHeight: 1.47, marginBottom: 22 }}>
                  We’ll give you a ready-to-use native session that already knows this session title and whether to send it to Claude or Codex.
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
                    {creatingSession ? 'Preparing session...' : 'Open Desktop App'}
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
        <div style={{ textAlign: 'center', padding: '60px 24px', color: 'var(--muted)' }}>
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
                background: 'var(--surface)',
                boxShadow: 'inset 0 0 0 1px var(--stone)',
                borderRadius: 10,
                cursor: 'pointer',
                transition: 'all 0.2s',
              }}
              onMouseEnter={(e) => {
                (e.currentTarget as HTMLElement).style.boxShadow = 'inset 0 0 0 1px rgba(0, 134, 252, 0.24)';
                (e.currentTarget as HTMLElement).style.transform = 'translateY(-2px)';
              }}
              onMouseLeave={(e) => {
                (e.currentTarget as HTMLElement).style.boxShadow = 'inset 0 0 0 1px var(--stone)';
                (e.currentTarget as HTMLElement).style.transform = 'none';
              }}
              onClick={() => router.push(`/sessions/${session.id}/summary`)}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: 8 }}>
                <h3 style={{ fontSize: '1rem', fontWeight: 600, flex: 1 }}>{session.title}</h3>
                <span className={`badge badge-${session.status}`}>{session.status}</span>
              </div>
              <p style={{ fontSize: 12, color: 'var(--muted)', marginBottom: 8 }}>
                {new Date(session.createdAt).toLocaleDateString()}
              </p>
              <div style={{ display: 'flex', gap: 8, fontSize: 12, color: 'var(--muted)' }}>
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
