'use client';

import { useState } from 'react';
import type { FeedbackSession, ImprovementTask, IntegrationTarget } from '@feedbackagent/shared';
import { api } from '@/lib/api';

interface Props {
  session: FeedbackSession;
  onUpdate: () => void;
}

export function TaskPanel({ session, onUpdate }: Props) {
  const [showForm, setShowForm] = useState(false);
  const [target, setTarget] = useState<IntegrationTarget>('github');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [loading, setLoading] = useState(false);

  const tasks = session.tasks ?? [];

  let parsedBrief: { title?: string; description?: string } | null = null;
  try {
    if (session.aiTaskBrief) parsedBrief = JSON.parse(session.aiTaskBrief);
  } catch {}

  async function createTask(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    try {
      await api.tasks.create(session.id, { target, title, description });
      setShowForm(false);
      setTitle('');
      setDescription('');
      onUpdate();
    } finally {
      setLoading(false);
    }
  }

  async function approve(taskId: string) {
    await api.tasks.approve(taskId);
    onUpdate();
  }

  async function send(taskId: string) {
    await api.tasks.send(taskId);
    onUpdate();
  }

  async function sendToClaude() {
    setLoading(true);
    try {
      // Send feedback to Claude Code via API
      // This will be handled by the API calling MCP push_feedback_to_claude
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/feedback-sessions/${session.id}/send-to-claude`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target: 'claude' }),
      });
      if (res.ok) {
        alert('✓ Feedback pushed to Claude Code.\n\nYour Claude Code instance can now access the full context and generate code changes.');
        onUpdate();
      } else {
        alert('Error sending feedback to Claude Code');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="stack gap-16">
      {/* V2: Send to Claude Code */}
      {session.status === 'ready' && (
        <div className="card" style={{ background: 'linear-gradient(135deg, #667eea 0%, #764ba2 100%)', color: 'white', padding: 16, borderRadius: 8 }}>
          <div style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8, opacity: 0.9 }}>
            Experimental Handoff
          </div>
          <p style={{ marginBottom: 12, fontSize: '0.9rem', lineHeight: 1.6 }}>
            Send this prepared feedback package to Claude Code. Today this is a handoff step, not a fully automatic
            fix pipeline.
          </p>
          <button
            className="btn"
            style={{
              background: 'white',
              color: '#667eea',
              fontWeight: 600,
              padding: '8px 16px',
              fontSize: '0.85rem',
              cursor: 'pointer',
              border: 'none',
              borderRadius: 4,
            }}
            onClick={sendToClaude}
            disabled={loading}
          >
            {loading ? '⏳ Sending...' : '→ Send to Claude Code'}
          </button>
        </div>
      )}

      {parsedBrief && (
        <div className="card">
          <div className="muted" style={{ fontSize: '0.75rem', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
            AI Task Brief
          </div>
          <div className="bold" style={{ marginBottom: 6 }}>{parsedBrief.title}</div>
          <p style={{ fontSize: '0.875rem', lineHeight: 1.6, color: 'var(--muted)' }}>{parsedBrief.description}</p>
        </div>
      )}

      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 16 }}>
          <span className="bold">Improvement Tasks</span>
          <button className="btn btn-primary" style={{ padding: '4px 12px', fontSize: '0.8rem' }} onClick={() => setShowForm((v) => !v)}>
            {showForm ? 'Cancel' : '+ New Task'}
          </button>
        </div>

        {showForm && (
          <form onSubmit={createTask} className="stack gap-12" style={{ marginBottom: 16, padding: 12, background: 'var(--bg)', borderRadius: 6 }}>
            <div className="stack gap-4">
              <label className="muted">Target</label>
              <select className="select" style={{ width: '100%' }} value={target} onChange={(e) => setTarget(e.target.value as IntegrationTarget)}>
                {(['github', 'jira', 'figma', 'claude', 'codex', 'chatgpt', 'gemini'] as IntegrationTarget[]).map((t) => (
                  <option key={t} value={t}>{t}</option>
                ))}
              </select>
            </div>
            <div className="stack gap-4">
              <label className="muted">Title</label>
              <input className="input" value={title} onChange={(e) => setTitle(e.target.value)}
                placeholder={parsedBrief?.title ?? 'Task title'} required />
            </div>
            <div className="stack gap-4">
              <label className="muted">Description</label>
              <textarea className="textarea" value={description} onChange={(e) => setDescription(e.target.value)}
                placeholder={parsedBrief?.description ?? 'Describe what needs to be done'} required />
            </div>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? 'Creating…' : 'Create Task'}
            </button>
          </form>
        )}

        {tasks.length === 0 && !showForm && (
          <p className="muted" style={{ fontSize: '0.875rem' }}>No tasks yet.</p>
        )}

        <div className="stack gap-12">
          {tasks.map((task) => (
            <TaskCard key={task.id} task={task} onApprove={approve} onSend={send} />
          ))}
        </div>
      </div>
    </div>
  );
}

function TaskCard({
  task,
  onApprove,
  onSend,
}: {
  task: ImprovementTask;
  onApprove: (id: string) => void;
  onSend: (id: string) => void;
}) {
  return (
    <div className="task-card">
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 6 }}>
        <span className="bold" style={{ fontSize: '0.9rem' }}>{task.title}</span>
        <span className={`badge badge-${task.status}`}>{task.status}</span>
      </div>
      <p className="muted" style={{ fontSize: '0.8rem', marginBottom: 10 }}>{task.description}</p>
      <div className="row gap-8" style={{ flexWrap: 'wrap' }}>
        <span className="muted" style={{ fontSize: '0.8rem' }}>→ {task.target}</span>
        {task.status === 'draft' && (
          <button className="btn btn-ghost" style={{ padding: '3px 10px', fontSize: '0.8rem' }} onClick={() => onApprove(task.id)}>
            Approve
          </button>
        )}
        {task.status === 'approved' && (
          <button className="btn btn-primary" style={{ padding: '3px 10px', fontSize: '0.8rem' }} onClick={() => onSend(task.id)}>
            Send to {task.target}
          </button>
        )}
        {task.externalUrl && (
          <a href={task.externalUrl} target="_blank" rel="noreferrer" className="muted" style={{ fontSize: '0.8rem' }}>
            View external ↗
          </a>
        )}
      </div>
    </div>
  );
}
