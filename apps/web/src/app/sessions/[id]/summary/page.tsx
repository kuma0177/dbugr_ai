'use client';

import { useState, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import type { FeedbackSession } from '@feedbackagent/shared';

interface Box {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  notes: Note[];
}

interface Note {
  id: string;
  type: 'voice' | 'text';
  content: string;
  duration?: number;
  timestamp: number;
}

export default function SummaryPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [session, setSession] = useState<FeedbackSession | null>(null);
  const [boxes, setBoxes] = useState<Box[]>([]);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    async function load() {
      try {
        // Load session
        const sessionData = await api.sessions.get(id);
        setSession(sessionData);

        // Load boxes from session storage
        const storedBoxes = sessionStorage.getItem(`session_${id}_boxes`);
        if (storedBoxes) {
          setBoxes(JSON.parse(storedBoxes));
        }
      } catch (e) {
        console.error('[summary] Error:', e);
      } finally {
        setLoading(false);
      }
    }

    load();
  }, [id]);

  const handleSendToClaude = async () => {
    if (!session) return;
    setSending(true);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/feedback-sessions/${id}/send-to-claude`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: 'claude' }),
      });

      if (!res.ok) throw new Error('Failed to send');

      alert('✓ Sent to Claude Code!\n\nYour Claude Code instance can now access this session and generate fixes.');
      router.push('/sessions');
    } catch (err) {
      console.error('[summary] Send error:', err);
      alert('Failed to send to Claude Code');
    } finally {
      setSending(false);
    }
  };

  const handleSendToCodex = async () => {
    if (!session) return;
    setSending(true);
    try {
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/feedback-sessions/${id}/send-to-claude`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: 'codex' }),
      });

      if (!res.ok) throw new Error('Failed to send');

      alert('✓ Sent to Codex!\n\nCodex will process this session and generate code changes.');
      router.push('/sessions');
    } catch (err) {
      console.error('[summary] Send error:', err);
      alert('Failed to send to Codex');
    } finally {
      setSending(false);
    }
  };

  if (loading) return <p className="muted">Loading summary…</p>;
  if (!session) return <p className="muted">Session not found.</p>;

  return (
    <main style={{ maxWidth: 1200, margin: '0 auto', padding: '24px' }}>
      <div style={{ marginBottom: 32 }}>
        <a href="/sessions" className="muted" style={{ fontSize: '0.875rem' }}>
          ← Back to Sessions
        </a>
        <h1 style={{ marginBottom: 8, marginTop: 8 }}>{session.title}</h1>
        <div className="row gap-8">
          <span className={`badge badge-${session.status}`}>{session.status}</span>
          <span className="muted">{boxes.length} box(es)</span>
          <span className="muted">{new Date(session.createdAt).toLocaleString()}</span>
        </div>
      </div>

      {boxes.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 24px', color: '#999' }}>
          <p>No notes recorded in this session yet.</p>
          <button className="btn btn-primary" onClick={() => router.push('/sessions')}>
            Back to Sessions
          </button>
        </div>
      ) : (
        <>
          {/* Boxes Grid */}
          <div style={{ marginBottom: 40 }}>
            <h2 style={{ marginBottom: 16 }}>Debug Notes ({boxes.length})</h2>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))',
                gap: 16,
              }}
            >
              {boxes.map((box) => (
                <div
                  key={box.id}
                  style={{
                    border: '1px solid #e5e7eb',
                    borderRadius: 8,
                    padding: 16,
                    background: '#f9fafb',
                  }}
                >
                  <div style={{ marginBottom: 12 }}>
                    <div style={{ fontSize: '0.75rem', color: '#666', marginBottom: 4, fontWeight: 700 }}>
                      COORDINATES
                    </div>
                    <div style={{ fontSize: '0.9rem', fontFamily: 'monospace', color: '#444' }}>
                      x: {Math.round(box.x)}, y: {Math.round(box.y)}
                      <br />
                      w: {Math.round(box.width)}, h: {Math.round(box.height)}
                    </div>
                  </div>

                  <div style={{ borderTop: '1px solid #e5e7eb', paddingTop: 12 }}>
                    <div style={{ fontSize: '0.75rem', color: '#666', marginBottom: 8, fontWeight: 700 }}>
                      NOTES ({box.notes.length})
                    </div>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                      {box.notes.map((note) => (
                        <div
                          key={note.id}
                          style={{
                            background: '#fff',
                            padding: 8,
                            borderRadius: 4,
                            border: '1px solid #e5e7eb',
                          }}
                        >
                          <div style={{ fontSize: '0.75rem', color: '#999', marginBottom: 4 }}>
                            {note.type === 'voice' ? '🎤 Voice' : '📝 Text'}
                            {note.duration ? ` • ${note.duration}s` : ''}
                          </div>
                          <div style={{ fontSize: '0.85rem', lineHeight: 1.4, color: '#333' }}>
                            {note.content}
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Actions */}
          <div style={{ padding: 24, background: '#f0f9ff', borderRadius: 8, marginBottom: 24 }}>
            <h3 style={{ marginBottom: 16 }}>Send to AI for Code Generation</h3>
            <p style={{ color: '#555', marginBottom: 16, fontSize: '0.9rem' }}>
              Your debug session is ready. Choose which AI to send it to for automatic code generation and fixes.
            </p>
            <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
              <button
                className="btn"
                onClick={handleSendToClaude}
                disabled={sending}
                style={{
                  background: '#667eea',
                  color: 'white',
                  padding: '12px 24px',
                  border: 'none',
                  borderRadius: 4,
                  cursor: 'pointer',
                  fontWeight: 500,
                }}
              >
                {sending ? '⏳ Sending...' : '→ Send to Claude'}
              </button>
              <button
                className="btn"
                onClick={handleSendToCodex}
                disabled={sending}
                style={{
                  background: '#8b5cf6',
                  color: 'white',
                  padding: '12px 24px',
                  border: 'none',
                  borderRadius: 4,
                  cursor: 'pointer',
                  fontWeight: 500,
                }}
              >
                {sending ? '⏳ Sending...' : '→ Send to Codex'}
              </button>
              <button
                className="btn btn-ghost"
                onClick={() => router.push('/sessions')}
                disabled={sending}
                style={{ padding: '12px 24px' }}
              >
                ← Back to Sessions
              </button>
            </div>
          </div>
        </>
      )}
    </main>
  );
}
