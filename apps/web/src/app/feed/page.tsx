'use client';

import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import type { AIReviewSummary, FeedbackComment, FeedbackSession } from '@feedbackagent/shared';

type Scope = 'private' | 'organization' | 'public';

export default function FeedPage() {
  const [scope, setScope] = useState<Scope>('organization');
  const [sessions, setSessions] = useState<FeedbackSession[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [commentBody, setCommentBody] = useState('Make sure this follows the Dbugr design system before AI handoff.');
  const [status, setStatus] = useState('Loading Phase 2 feed...');
  const [summary, setSummary] = useState<AIReviewSummary | null>(null);

  const selected = useMemo(
    () => sessions.find((session) => session.id === selectedId) ?? sessions[0],
    [selectedId, sessions],
  );

  async function load(nextScope = scope) {
    setStatus(`Loading ${nextScope} feed...`);
    console.info('[phase2-web] feed.load.started', { scope: nextScope });
    try {
      const data = await api.phase2.feed(nextScope);
      setSessions(data.sessions);
      setSelectedId((current) => data.sessions.some((session) => session.id === current) ? current : data.sessions[0]?.id ?? '');
      setStatus(`${data.sessions.length} session(s) loaded for ${nextScope}.`);
      console.info('[phase2-web] feed.load.completed', {
        scope: nextScope,
        sessions: data.sessions.length,
      });
    } catch (error) {
      setStatus(`Feed failed: ${error instanceof Error ? error.message : String(error)}`);
      console.warn('[phase2-web] feed.load.failed', {
        scope: nextScope,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  useEffect(() => {
    void load(scope);
  }, [scope]);

  async function addContribution() {
    if (!selected) return;
    setStatus('Adding structured contribution...');
    console.info('[phase2-web] contribution.create.started', {
      sessionId: selected.id,
      scope,
    });
    try {
      await api.phase2.contribute(selected.id, {
        targetType: 'session',
        contributionType: 'suggested_edit',
        body: commentBody,
        visibility: selected.visibility === 'public' ? 'public' : 'org',
      });
      await load(scope);
      setStatus('Contribution added. It will not enter the AI payload until accepted.');
      console.info('[phase2-web] contribution.create.completed', { sessionId: selected.id });
    } catch (error) {
      setStatus(`Contribution failed: ${error instanceof Error ? error.message : String(error)}`);
      console.warn('[phase2-web] contribution.create.failed', {
        sessionId: selected.id,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async function curate(comment: FeedbackComment, decision: 'accepted' | 'rejected') {
    setStatus(`${decision === 'accepted' ? 'Accepting' : 'Rejecting'} contribution...`);
    console.info('[phase2-web] curation.submit.started', {
      contributionId: comment.id,
      decision,
    });
    try {
      await api.phase2.curate(comment.id, { decision });
      await load(scope);
      setStatus(`Contribution ${decision}.`);
      console.info('[phase2-web] curation.submit.completed', {
        contributionId: comment.id,
        decision,
      });
    } catch (error) {
      setStatus(`Curation failed: ${error instanceof Error ? error.message : String(error)}`);
      console.warn('[phase2-web] curation.submit.failed', {
        contributionId: comment.id,
        decision,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  async function preflight(providerTarget: 'claude' | 'codex' | 'cursor') {
    if (!selected) return;
    setStatus(`Generating ${providerTarget} preflight summary from accepted feedback...`);
    console.info('[phase2-web] preflight.started', {
      sessionId: selected.id,
      providerTarget,
    });
    try {
      const result = await api.phase2.preflight(selected.id, providerTarget);
      setSummary(result);
      setStatus('AI preflight summary ready for owner approval.');
      console.info('[phase2-web] preflight.completed', {
        sessionId: selected.id,
        providerTarget,
        promptChars: result.finalPromptDraft.length,
      });
    } catch (error) {
      setStatus(`Preflight failed: ${error instanceof Error ? error.message : String(error)}`);
      console.warn('[phase2-web] preflight.failed', {
        sessionId: selected.id,
        providerTarget,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 18 }}>
        <div>
          <div className="phase2-kicker">Social review hub</div>
          <h1 className="page-title" style={{ marginBottom: 4 }}>Team and public feedback feed</h1>
          <p className="phase2-muted">{status}</p>
        </div>
        <div className="row gap-8">
          {(['private', 'organization', 'public'] as Scope[]).map((item) => (
            <button key={item} className={`btn ${scope === item ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setScope(item)}>
              {item === 'organization' ? 'Internal review' : item[0].toUpperCase() + item.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <section className="feed-layout">
        <aside className="phase2-card">
          <div className="phase2-kicker">Sessions</div>
          <div className="stack gap-8 mt-16">
            {sessions.map((session) => (
              <button key={session.id} className="btn btn-ghost" style={{ justifyContent: 'flex-start' }} onClick={() => setSelectedId(session.id)}>
                {session.title}
              </button>
            ))}
            {sessions.length === 0 && <p className="phase2-muted">No sessions in this scope yet.</p>}
          </div>
        </aside>

        <main>
          {sessions.map((session) => (
            <article key={session.id} className="phase2-card feed-card">
              <div className="feed-thumb" />
              <div>
                <div className="row gap-8" style={{ justifyContent: 'space-between' }}>
                  <h2>{session.title}</h2>
                  <span className="visibility-pill">{session.visibility === 'org' ? 'Team' : session.visibility}</span>
                </div>
                <p className="phase2-muted">{session.about || 'No session note yet.'}</p>
                <div className="row gap-8 mt-16">
                  <span className="badge badge-ready">{session.comments?.length ?? 0} comments</span>
                  <span className="badge badge-routed">{session.reviewStatus ?? 'draft'}</span>
                </div>
              </div>
            </article>
          ))}
        </main>

        <aside className="phase2-card">
          <div className="phase2-kicker">Curation tray</div>
          {selected ? (
            <div className="stack gap-16 mt-16">
              <div>
                <h3>{selected.title}</h3>
                <p className="phase2-muted">Only accepted suggestions enter the AI preflight payload.</p>
              </div>
              <textarea className="textarea" value={commentBody} onChange={(event) => setCommentBody(event.target.value)} />
              <button className="btn btn-primary" onClick={addContribution}>Add suggestion</button>
              <div className="stack gap-8">
                {(selected.comments ?? []).map((comment) => (
                  <div key={comment.id} className="card">
                    <div className="phase2-kicker">{comment.contributionType ?? 'comment'} · {comment.author?.name ?? 'Teammate'}</div>
                    <p className="phase2-muted mt-8">{comment.body}</p>
                    <div className="row gap-8 mt-16">
                      <button className="btn btn-ghost" onClick={() => curate(comment, 'accepted')}>Accept</button>
                      <button className="btn btn-danger" onClick={() => curate(comment, 'rejected')}>Reject</button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="row gap-8">
                <button className="btn btn-primary" onClick={() => preflight('claude')}>Claude preflight</button>
                <button className="btn btn-ghost" onClick={() => preflight('codex')}>Codex</button>
              </div>
              {summary && (
                <pre className="pre card">{summary.finalPromptDraft}</pre>
              )}
            </div>
          ) : (
            <p className="phase2-muted mt-16">Choose a session to curate.</p>
          )}
        </aside>
      </section>
    </div>
  );
}
