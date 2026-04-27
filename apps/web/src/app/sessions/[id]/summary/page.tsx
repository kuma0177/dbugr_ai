'use client';

import { Suspense, useState, useEffect } from 'react';
import { useParams, useRouter, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import type { FeedbackSession } from '@feedbackagent/shared';

interface Note {
  id: string;
  type: 'voice' | 'text';
  content: string;
  duration?: number;
  timestamp: number;
}

interface Box {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  notes: Note[];
  screenshot?: string;
}

interface SessionMeta {
  loadedUrl?: string;
  viewportWidth?: number;
  viewportHeight?: number;
}

const AI_TARGETS = [
  {
    key: 'claude',
    label: 'Send to Claude Code',
    color: '#6366f1',
    hoverColor: '#4f46e5',
    icon: '⚡',
    what: 'Opens a task in your local Claude Code instance',
    how: [
      'Your annotation boxes, coordinates, and notes are packaged into a structured prompt',
      'Claude Code reads the session via the MCP server running on port 3002',
      'It analyses each annotated area and generates targeted code fixes',
      'Changes appear as a diff in your editor — you review and accept',
    ],
  },
  {
    key: 'codex',
    label: 'Send to Codex',
    color: '#8b5cf6',
    hoverColor: '#7c3aed',
    icon: '🤖',
    what: 'Sends the session to OpenAI Codex for code generation',
    how: [
      'Annotation context is formatted as a Codex task brief',
      'Codex generates code changes based on your notes and coordinates',
      'A pull request is opened in your connected repository',
      'You review the PR and merge when satisfied',
    ],
  },
];

function SummaryPageInner() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [session, setSession] = useState<FeedbackSession | null>(null);
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [meta, setMeta] = useState<SessionMeta>({});
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [expandedTarget, setExpandedTarget] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const [autoSendStarted, setAutoSendStarted] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        const sessionData = await api.sessions.get(id);
        setSession(sessionData);

        // 1. Try sessionStorage first (iframe/record-tab flow)
        const storedBoxes = sessionStorage.getItem(`session_${id}_boxes`);
        const storedMeta  = sessionStorage.getItem(`session_${id}_meta`);

        if (storedBoxes) {
          setBoxes(JSON.parse(storedBoxes));
          if (storedMeta) setMeta(JSON.parse(storedMeta));
        } else if (sessionData.userIntent) {
          // 2. Fall back to userIntent saved by the bookmarklet
          try {
            const parsed = JSON.parse(sessionData.userIntent);
            if (parsed.boxes) setBoxes(parsed.boxes);
            setMeta({
              loadedUrl: parsed.pageUrl,
              viewportWidth: parsed.viewportWidth,
              viewportHeight: parsed.viewportHeight,
            });
          } catch { /* malformed JSON, ignore */ }
        }
      } catch (e) {
        console.error('[summary] Error:', e);
      } finally {
        setLoading(false);
      }
    }
    load();
  }, [id]);

  const [sentData, setSentData] = useState<{ taskId: string; feedbackId: string; message: string } | null>(null);

  const handleSend = async (target: 'claude' | 'codex') => {
    if (!session) return;
    setSending(true);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/feedback-sessions/${id}/send-to-claude`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error ?? 'Failed to send');
      setSentData({ taskId: json.data.task_id, feedbackId: json.data.feedback_id, message: json.data.message });
      setSent(target);
    } catch (err) {
      console.error('[summary] Send error:', err);
      alert(`Failed to send: ${err instanceof Error ? err.message : String(err)}\n\nCheck the API server is running.`);
    } finally {
      setSending(false);
    }
  };

  useEffect(() => {
    const requestedTarget = searchParams.get('target');
    const autoSend = searchParams.get('autoSend') === '1';
    if (!autoSend || autoSendStarted || !session) return;
    if (requestedTarget !== 'claude' && requestedTarget !== 'codex') return;

    setAutoSendStarted(true);
    handleSend(requestedTarget);
  }, [autoSendStarted, searchParams, session]);

  if (loading) return <p className="muted" style={{ padding: 32 }}>Loading summary…</p>;
  if (!session) return <p className="muted" style={{ padding: 32 }}>Session not found.</p>;

  // ── Success state ─────────────────────────────────────────────────────────
  if (sent) {
    const target = AI_TARGETS.find(t => t.key === sent)!;
    return (
      <main style={{ maxWidth: 640, margin: '80px auto', padding: '0 24px', textAlign: 'center' }}>
        <div style={{ fontSize: '3rem', marginBottom: 16 }}>✅</div>
        <h1 style={{ marginBottom: 8 }}>Session sent to {target.label.replace('Send to ', '')}!</h1>
        <p style={{ color: '#666', marginBottom: 32, lineHeight: 1.7 }}>
          {target.what}. {target.how[0].toLowerCase()}.
        </p>
        {sentData && (
          <div style={{ textAlign: 'left', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 14, padding: '18px 20px', marginBottom: 28 }}>
            <div style={{ fontSize: '0.78rem', fontWeight: 800, color: '#6366f1', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 10 }}>
              Next steps
            </div>
            <div style={{ color: '#334155', fontSize: '0.92rem', lineHeight: 1.7 }}>
              <div>Task created: <strong>{sentData.taskId}</strong></div>
              <div>Feedback session: <strong>{sentData.feedbackId}</strong></div>
              <div>{sentData.message}</div>
            </div>
          </div>
        )}
        <div style={{ display: 'flex', gap: 12, justifyContent: 'center' }}>
          <button className="btn btn-primary" onClick={() => router.push('/sessions')}>← Back to Sessions</button>
        </div>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 1100, margin: '0 auto', padding: '24px' }}>

      {/* Header */}
      <div style={{ marginBottom: 32 }}>
        <a href="/sessions" className="muted" style={{ fontSize: '0.875rem' }}>← Back to Sessions</a>
        <h1 style={{ marginBottom: 8, marginTop: 8 }}>{session.title}</h1>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <span className={`badge badge-${session.status}`}>{session.status}</span>
          <span className="muted">{boxes.length} annotation{boxes.length !== 1 ? 's' : ''}</span>
          {meta.loadedUrl && <span className="muted" style={{ fontSize: '0.8rem' }}>on <code style={{ background: '#f1f5f9', padding: '1px 6px', borderRadius: 4 }}>{meta.loadedUrl}</code></span>}
          <span className="muted">{new Date(session.createdAt).toLocaleString()}</span>
        </div>
      </div>

      {boxes.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 24px', color: '#999' }}>
          <p>No annotations recorded in this session yet.</p>
          <button className="btn btn-primary" onClick={() => router.push('/sessions')}>Back to Sessions</button>
        </div>
      ) : (
        <>
          {/* Annotation cards */}
          <h2 style={{ marginBottom: 16 }}>Annotations ({boxes.length})</h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 16, marginBottom: 40 }}>
            {boxes.map((box, i) => (
              <div key={box.id} style={{ border: '1px solid #e5e7eb', borderRadius: 10, overflow: 'hidden', background: '#fff', boxShadow: '0 1px 4px rgba(0,0,0,0.06)' }}>

                {/* Screenshot or placeholder */}
                {box.screenshot ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={box.screenshot} alt={`Annotation #${i + 1}`}
                    style={{ width: '100%', height: 160, objectFit: 'cover', objectPosition: 'top', display: 'block', borderBottom: '1px solid #f1f5f9' }} />
                ) : meta.loadedUrl ? (
                  /* Live mini-preview: scaled iframe with box overlay */
                  <div style={{ position: 'relative', height: 160, overflow: 'hidden', background: '#f8fafc', borderBottom: '1px solid #f1f5f9' }}>
                    <iframe
                      src={meta.loadedUrl}
                      style={{
                        position: 'absolute',
                        width: `${meta.viewportWidth ?? 1280}px`,
                        height: `${meta.viewportHeight ?? 800}px`,
                        border: 'none',
                        pointerEvents: 'none',
                        transformOrigin: 'top left',
                        transform: `scale(${300 / (meta.viewportWidth ?? 1280)})`,
                      }}
                      sandbox="allow-same-origin allow-scripts"
                      title={`Preview of annotation #${i + 1}`}
                    />
                    {/* Box highlight scaled to preview */}
                    <div style={{
                      position: 'absolute',
                      left: `${(box.x / (meta.viewportWidth ?? 1280)) * 300}px`,
                      top: `${(box.y / (meta.viewportHeight ?? 800)) * 160}px`,
                      width: `${(box.width / (meta.viewportWidth ?? 1280)) * 300}px`,
                      height: `${(box.height / (meta.viewportHeight ?? 800)) * 160}px`,
                      border: '2px solid #ef4444',
                      background: 'rgba(239,68,68,0.2)',
                      pointerEvents: 'none',
                    }} />
                  </div>
                ) : (
                  /* Dot-grid placeholder with box visualisation */
                  <div style={{
                    height: 160, position: 'relative', overflow: 'hidden',
                    background: '#0f172a',
                    backgroundImage: 'radial-gradient(circle, #334155 1px, transparent 1px)',
                    backgroundSize: '20px 20px',
                    borderBottom: '1px solid #1e293b',
                  }}>
                    <div style={{
                      position: 'absolute',
                      left: `${Math.min(box.x / (meta.viewportWidth ?? 1280) * 300, 240)}px`,
                      top: `${Math.min(box.y / (meta.viewportHeight ?? 800) * 160, 120)}px`,
                      width: `${Math.min(box.width / (meta.viewportWidth ?? 1280) * 300, 80)}px`,
                      height: `${Math.min(box.height / (meta.viewportHeight ?? 800) * 160, 60)}px`,
                      border: '2px solid #6366f1',
                      background: 'rgba(99,102,241,0.15)',
                    }} />
                  </div>
                )}

                {/* Card body */}
                <div style={{ padding: '12px 14px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                    <div style={{ fontWeight: 700, fontSize: '0.9rem', color: '#111' }}>Annotation #{i + 1}</div>
                    <div style={{ fontSize: '0.75rem', color: '#9ca3af', fontFamily: 'monospace' }}>
                      {Math.round(box.x)},{Math.round(box.y)} · {Math.round(box.width)}×{Math.round(box.height)}
                    </div>
                  </div>

                  {box.notes.length === 0 ? (
                    <p style={{ fontSize: '0.8rem', color: '#ccc', fontStyle: 'italic' }}>No notes added</p>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                      {box.notes.map(note => (
                        <div key={note.id} style={{ fontSize: '0.85rem', color: '#374151', background: '#f9fafb', borderRadius: 6, padding: '8px 10px', border: '1px solid #f1f5f9' }}>
                          <span style={{ marginRight: 6 }}>{note.type === 'voice' ? '🎤' : '📝'}</span>
                          {note.content}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* ── Send to AI ─────────────────────────────────────────────────── */}
          <div style={{ border: '1px solid #e5e7eb', borderRadius: 12, overflow: 'hidden', marginBottom: 24 }}>
            <div style={{ padding: '20px 24px', background: '#f8fafc', borderBottom: '1px solid #e5e7eb' }}>
              <h2 style={{ margin: 0, fontSize: '1.1rem' }}>Send to AI for code fixes</h2>
              <p style={{ margin: '6px 0 0', color: '#6b7280', fontSize: '0.875rem' }}>
                Your {boxes.length} annotation{boxes.length > 1 ? 's' : ''} and notes will be packaged into a structured prompt.
                The AI reads the coordinates, screenshots, and your descriptions to generate targeted code changes.
              </p>
            </div>

            <div style={{ padding: 24, display: 'flex', flexDirection: 'column', gap: 12 }}>
              {AI_TARGETS.map(target => (
                <div key={target.key} style={{ border: '1px solid #e5e7eb', borderRadius: 10, overflow: 'hidden' }}>

                  {/* Target row */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 16px' }}>
                    <span style={{ fontSize: '1.4rem' }}>{target.icon}</span>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontWeight: 700, fontSize: '0.95rem', color: '#111' }}>{target.label}</div>
                      <div style={{ fontSize: '0.8rem', color: '#6b7280', marginTop: 2 }}>{target.what}</div>
                    </div>
                    {/* "What happens?" toggle */}
                    <button
                      onClick={() => setExpandedTarget(expandedTarget === target.key ? null : target.key)}
                      style={{ padding: '4px 10px', background: 'none', border: '1px solid #e5e7eb', borderRadius: 6, cursor: 'pointer', fontSize: 12, color: '#6b7280', whiteSpace: 'nowrap' }}
                    >
                      {expandedTarget === target.key ? '▲ Hide' : '▼ What happens?'}
                    </button>
                    <button
                      onClick={() => handleSend(target.key as 'claude' | 'codex')}
                      disabled={sending}
                      style={{
                        padding: '9px 20px', borderRadius: 8, border: 'none', cursor: sending ? 'not-allowed' : 'pointer',
                        background: sending ? '#e5e7eb' : target.color,
                        color: sending ? '#9ca3af' : '#fff',
                        fontWeight: 700, fontSize: 13, whiteSpace: 'nowrap', flexShrink: 0,
                      }}
                    >
                      {sending ? '⏳ Sending…' : `→ ${target.label.replace('Send to ', 'Send to ')}`}
                    </button>
                  </div>

                  {/* Expanded "what happens" panel */}
                  {expandedTarget === target.key && (
                    <div style={{ background: '#f8fafc', borderTop: '1px solid #e5e7eb', padding: '14px 16px' }}>
                      <div style={{ fontSize: '0.8rem', fontWeight: 700, color: '#6b7280', marginBottom: 10, letterSpacing: 0.5 }}>WHAT HAPPENS STEP BY STEP</div>
                      <ol style={{ margin: 0, padding: '0 0 0 18px', display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {target.how.map((step, i) => (
                          <li key={i} style={{ fontSize: '0.85rem', color: '#374151', lineHeight: 1.5 }}>{step}</li>
                        ))}
                      </ol>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>

          <button className="btn btn-ghost" onClick={() => router.push('/sessions')} style={{ padding: '10px 20px' }}>
            ← Back to Sessions
          </button>
        </>
      )}
    </main>
  );
}

export default function SummaryPage() {
  return (
    <Suspense fallback={<p className="muted" style={{ padding: 32 }}>Loading summary…</p>}>
      <SummaryPageInner />
    </Suspense>
  );
}
