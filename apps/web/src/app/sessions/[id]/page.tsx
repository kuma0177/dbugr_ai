'use client';

import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { api } from '@/lib/api';
import type { FeedbackSession } from '@feedbackagent/shared';
import { TranscriptTab } from '@/components/session/TranscriptTab';
import { FramesTab } from '@/components/session/FramesTab';
import { CommentsTab } from '@/components/session/CommentsTab';
import { TaskPanel } from '@/components/session/TaskPanel';

type Tab = 'transcript' | 'frames' | 'comments';

export default function SessionDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [session, setSession] = useState<FeedbackSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<Tab>('transcript');

  async function load() {
    try {
      const data = await api.sessions.get(id);
      setSession(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, [id]);

  if (loading) return <p className="muted">Loading…</p>;
  if (!session) return <p className="muted">Session not found.</p>;

  return (
    <>
      <div className="row gap-12" style={{ marginBottom: 8 }}>
        <a href="/" className="muted" style={{ fontSize: '0.875rem' }}>← Inbox</a>
      </div>

      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 24, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontSize: '1.25rem', fontWeight: 700 }}>{session.title}</h1>
          <div className="row gap-8 mt-8">
            <span className={`badge badge-${session.status}`}>{session.status}</span>
            <span className="muted">{new Date(session.createdAt).toLocaleString()}</span>
          </div>
        </div>
      </div>

      {session.aiSummary && (
        <div className="card mt-8" style={{ marginBottom: 24 }}>
          <div className="muted" style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
            AI Summary
          </div>
          <p style={{ lineHeight: 1.7 }}>{session.aiSummary}</p>
        </div>
      )}

      <div className="detail-grid">
        <div>
          <div className="tabs">
            {(['transcript', 'frames', 'comments'] as Tab[]).map((t) => (
              <button key={t} className={`tab ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
                {t.charAt(0).toUpperCase() + t.slice(1)}
                {t === 'comments' && session.comments?.length ? ` (${session.comments.length})` : ''}
              </button>
            ))}
          </div>

          {tab === 'transcript' && <TranscriptTab transcript={session.transcript} />}
          {tab === 'frames' && <FramesTab frames={session.frames ?? []} />}
          {tab === 'comments' && (
            <CommentsTab sessionId={session.id} comments={session.comments ?? []} onUpdate={load} />
          )}
        </div>

        <div>
          <TaskPanel session={session} onUpdate={load} />
        </div>
      </div>
    </>
  );
}
