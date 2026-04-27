'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import type { FeedbackSession } from '@feedbackagent/shared';

export default function SessionsPage() {
  const router = useRouter();
  const [sessions, setSessions] = useState<FeedbackSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [title, setTitle] = useState('');
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
  }, []);

  const handleCreateSession = async () => {
    if (!title.trim()) {
      alert('Please enter a title');
      return;
    }

    setCreatingSession(true);
    try {
      // Create session via API
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/projects/proj_demo/feedback-sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: title.trim(),
          visibility: 'private',
        }),
      });

      if (!res.ok) throw new Error('Failed to create session');
      const { data } = (await res.json()) as { data: { id: string } };

      // Close modal
      setShowCreateModal(false);
      setTitle('');

      // Open recording in new tab
      window.open(`/sessions/${data.id}/record`, '_blank');

      // Reload sessions list
      loadSessions();
    } catch (err) {
      console.error('[sessions] Create error:', err);
      alert('Failed to create session');
    } finally {
      setCreatingSession(false);
    }
  };

  return (
    <main style={{ maxWidth: 1200, margin: '0 auto', padding: '24px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 32 }}>
        <h1>Debug Sessions</h1>
        <button
          className="btn btn-primary"
          onClick={() => setShowCreateModal(true)}
          style={{ padding: '12px 24px' }}
        >
          + Create Session
        </button>
      </div>

      {/* Create Session Modal */}
      {showCreateModal && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            zIndex: 1000,
          }}
          onClick={() => !creatingSession && setShowCreateModal(false)}
        >
          <div
            style={{
              background: 'white',
              padding: '32px',
              borderRadius: '8px',
              minWidth: '400px',
              boxShadow: '0 10px 40px rgba(0,0,0,0.2)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 style={{ marginBottom: 16 }}>New Debug Session</h2>
            <p style={{ color: '#666', marginBottom: 16, fontSize: '0.9rem' }}>
              Enter a title for your debug session. You'll record issues and add notes in Tab A.
            </p>
            <input
              type="text"
              className="input"
              placeholder="e.g., Checkout flow broken on mobile"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onKeyPress={(e) => e.key === 'Enter' && handleCreateSession()}
              style={{ width: '100%', marginBottom: 16 }}
              autoFocus
              disabled={creatingSession}
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                className="btn btn-ghost"
                onClick={() => setShowCreateModal(false)}
                disabled={creatingSession}
                style={{ flex: 1 }}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={handleCreateSession}
                disabled={creatingSession || !title.trim()}
                style={{ flex: 1 }}
              >
                {creatingSession ? '⏳ Creating...' : '→ Start Recording'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Sessions List */}
      {loading ? (
        <p className="muted">Loading sessions…</p>
      ) : sessions.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 24px', color: '#999' }}>
          <p style={{ fontSize: '1.1rem', marginBottom: 16 }}>No debug sessions yet.</p>
          <button className="btn btn-primary" onClick={() => setShowCreateModal(true)}>
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
