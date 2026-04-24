'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { FeedbackSession } from '@feedbackagent/shared';
import { NewSessionModal } from '@/components/NewSessionModal';

export default function InboxPage() {
  const [sessions, setSessions] = useState<FeedbackSession[]>([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);

  async function load() {
    try {
      const data = await api.sessions.list();
      setSessions(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  return (
    <>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 24 }}>
        <h1 className="page-title" style={{ margin: 0 }}>Feedback Inbox</h1>
        <button className="btn btn-primary" onClick={() => setShowModal(true)}>
          + New Session
        </button>
      </div>

      {loading && <p className="muted">Loading…</p>}

      {!loading && sessions.length === 0 && (
        <div className="card" style={{ textAlign: 'center', padding: 48 }}>
          <p className="muted">No feedback sessions yet.</p>
          <button className="btn btn-primary" style={{ marginTop: 16 }} onClick={() => setShowModal(true)}>
            Create your first session
          </button>
        </div>
      )}

      <div className="session-list">
        {sessions.map((s) => (
          <a key={s.id} href={`/sessions/${s.id}`} style={{ textDecoration: 'none', color: 'inherit' }}>
            <div className="session-row">
              <div>
                <div className="bold">{s.title}</div>
                <div className="muted" style={{ marginTop: 4 }}>
                  {new Date(s.createdAt).toLocaleDateString()} · {s.projectId}
                </div>
              </div>
              <span className={`badge badge-${s.status}`}>{s.status}</span>
            </div>
          </a>
        ))}
      </div>

      {showModal && (
        <NewSessionModal
          onClose={() => setShowModal(false)}
          onCreated={() => { setShowModal(false); load(); }}
        />
      )}
    </>
  );
}
