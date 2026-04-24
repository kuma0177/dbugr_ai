'use client';

import { useState } from 'react';
import { api } from '@/lib/api';

const DEMO_PROJECT_ID = 'proj_demo';

interface Props {
  onClose: () => void;
  onCreated: () => void;
}

export function NewSessionModal({ onClose, onCreated }: Props) {
  const [title, setTitle] = useState('');
  const [visibility, setVisibility] = useState<'private' | 'public' | 'org'>('private');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const session = await api.sessions.create(DEMO_PROJECT_ID, { title, visibility });
      // Auto-finalize with mock data to trigger worker
      await api.sessions.finalize(session.id, { durationMs: 30000 });
      onCreated();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create session');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 200,
    }}>
      <div className="card" style={{ width: 480, maxWidth: '90vw' }}>
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 20 }}>
          <span className="bold">New Feedback Session</span>
          <button className="btn btn-ghost" style={{ padding: '4px 10px' }} onClick={onClose}>✕</button>
        </div>
        <form onSubmit={handleSubmit} className="stack gap-16">
          <div className="stack gap-8">
            <label className="muted">Title</label>
            <input
              className="input"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Checkout CTA not working on mobile"
              required
            />
          </div>
          <div className="stack gap-8">
            <label className="muted">Visibility</label>
            <select className="select" value={visibility} onChange={(e) => setVisibility(e.target.value as typeof visibility)}>
              <option value="private">Private</option>
              <option value="org">Org</option>
              <option value="public">Public</option>
            </select>
          </div>
          {error && <p style={{ color: 'var(--red)', fontSize: '0.875rem' }}>{error}</p>}
          <div className="row gap-8" style={{ justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={loading || !title}>
              {loading ? 'Creating…' : 'Create & Process'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
