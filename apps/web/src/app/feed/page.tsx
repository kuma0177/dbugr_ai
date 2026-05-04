'use client';

import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { readOnboardingState } from '@/lib/onboarding';
import type { AIReviewSummary, FeedbackComment, FeedbackSession, Submission } from '@feedbackagent/shared';

type Scope = 'private' | 'organization' | 'public';

export default function FeedPage() {
  const [scope, setScope] = useState<Scope>('organization');
  const [sessions, setSessions] = useState<FeedbackSession[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [commentBody, setCommentBody] = useState('Make sure this follows the Dbugr design system before AI handoff.');
  const [status, setStatus] = useState('Loading Phase 2 feed...');
  const [summary, setSummary] = useState<AIReviewSummary | null>(null);
  const [providerTarget, setProviderTarget] = useState<'claude' | 'codex' | 'cursor'>('claude');
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [working, setWorking] = useState('');
  const [isOnboarded, setIsOnboarded] = useState(false);

  const selected = useMemo(
    () => sessions.find((session) => session.id === selectedId) ?? sessions[0],
    [selectedId, sessions],
  );

  async function load(nextScope = scope) {
    setWorking('Loading feed');
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
    setWorking('');
  }

  useEffect(() => {
    const onboarding = readOnboardingState();
    setIsOnboarded(Boolean(onboarding));
    if (!onboarding) {
      setStatus('Create a web account and organization before opening team/public review.');
      console.info('[phase2-web] feed.blocked_missing_onboarding');
      return;
    }
    void load(scope);
  }, [scope]);

  if (!isOnboarded) {
    return (
      <section className="phase2-hero">
        <div className="phase2-card">
          <div className="phase2-kicker">Account required</div>
          <h1 className="phase2-title">Create your workspace before review.</h1>
          <p className="phase2-lede">
            Direct local desktop handoff can stay account-free, but team review, public feed,
            comments, curation, and AI preflight require a web identity, organization, and role.
          </p>
          <a className="btn btn-primary mt-24" href="/onboarding">Start onboarding</a>
        </div>
        <div className="phase2-card">
          <div className="phase2-kicker">What onboarding creates</div>
          <div className="stack gap-16 mt-16">
            <p className="phase2-muted">Google-backed user identity.</p>
            <p className="phase2-muted">Organization owner role and optional team.</p>
            <p className="phase2-muted">Invites for teammates and a Mac app link code.</p>
          </div>
        </div>
      </section>
    );
  }

  async function addContribution() {
    if (!selected) return;
    setWorking('Adding suggestion');
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
    setWorking('');
  }

  async function curate(comment: FeedbackComment, decision: 'accepted' | 'rejected' | 'duplicate' | 'needs_clarification') {
    setWorking('Saving curation');
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
    setWorking('');
  }

  async function preflight(providerTarget: 'claude' | 'codex' | 'cursor') {
    if (!selected) return;
    setWorking('Generating preflight');
    setProviderTarget(providerTarget);
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
    setWorking('');
  }

  async function changeVisibility(visibility: 'private' | 'org' | 'public') {
    if (!selected) return;
    const submissionFlow = visibility === 'public' ? 'public_feed' : visibility === 'org' ? 'internal_review' : 'direct';
    setWorking('Updating visibility');
    setStatus(visibility === 'public' ? 'Publishing with redaction confirmation...' : `Moving session to ${visibility} scope...`);
    console.info('[phase2-web] visibility.started', { sessionId: selected.id, visibility, submissionFlow });
    try {
      await api.phase2.visibility(selected.id, {
        visibility,
        submissionFlow,
        redactionConfirmed: visibility === 'public',
      });
      await load(scope);
      setStatus(visibility === 'public'
        ? 'Public feed publish recorded with redaction confirmation.'
        : `Session moved to ${visibility === 'org' ? 'internal review' : 'private'}.`);
      console.info('[phase2-web] visibility.completed', { sessionId: selected.id, visibility });
    } catch (error) {
      setStatus(`Visibility update failed: ${error instanceof Error ? error.message : String(error)}`);
      console.warn('[phase2-web] visibility.failed', {
        sessionId: selected.id,
        visibility,
        message: error instanceof Error ? error.message : String(error),
      });
    }
    setWorking('');
  }

  async function submitToAI() {
    if (!selected) return;
    setWorking('Freezing submission');
    setStatus(`Freezing prompt snapshot for ${providerTarget}...`);
    console.info('[phase2-web] submission.started', {
      sessionId: selected.id,
      providerTarget,
      summaryId: summary?.id,
    });
    try {
      const result = await api.phase2.submit(selected.id, {
        providerTarget,
        aiReviewSummaryId: summary?.id,
        finalPrompt: summary?.editedPrompt ?? summary?.finalPromptDraft,
        credentialScope: 'personal',
      });
      setSubmission(result);
      await load(scope);
      setStatus(`Submission snapshot created for ${providerTarget}. Desktop can hand this to the local CLI.`);
      console.info('[phase2-web] submission.completed', {
        sessionId: selected.id,
        submissionId: result.id,
        providerTarget,
      });
    } catch (error) {
      setStatus(`Submission failed: ${error instanceof Error ? error.message : String(error)}`);
      console.warn('[phase2-web] submission.failed', {
        sessionId: selected.id,
        providerTarget,
        message: error instanceof Error ? error.message : String(error),
      });
    }
    setWorking('');
  }

  return (
    <div>
      <div className="row" style={{ justifyContent: 'space-between', marginBottom: 18 }}>
        <div>
          <div className="phase2-kicker">Social review hub</div>
          <h1 className="page-title" style={{ marginBottom: 4 }}>Team and public feedback feed</h1>
          <p className="phase2-muted">{status}</p>
          {working ? <p className="phase2-muted mt-8">⌛ {working}...</p> : null}
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
              <button key={session.id} className="session-select" onClick={() => setSelectedId(session.id)} aria-pressed={selected?.id === session.id}>
                <strong>{session.title}</strong>
                <span>{session.visibility === 'org' ? 'Internal review' : session.visibility} · {session.comments?.length ?? 0} comments</span>
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
                  <span className="badge badge-approved">
                    {(session.comments ?? []).filter((comment) => comment.curationDecisions?.some((decision) => decision.includedInPayload)).length} accepted
                  </span>
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
              <div className="card stack gap-8">
                <div className="phase2-kicker">Submission flow</div>
                <button className="btn btn-ghost" onClick={() => changeVisibility('private')}>Direct / private</button>
                <button className="btn btn-ghost" onClick={() => changeVisibility('org')}>Internal review</button>
                <button className="btn btn-primary" onClick={() => changeVisibility('public')}>Publish public feed</button>
                <p className="phase2-muted">Public publish sends an explicit redaction confirmation to the API audit log.</p>
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
                      <button className="btn btn-ghost" onClick={() => curate(comment, 'duplicate')}>Duplicate</button>
                      <button className="btn btn-ghost" onClick={() => curate(comment, 'needs_clarification')}>Clarify</button>
                    </div>
                  </div>
                ))}
              </div>
              <div className="phase2-card" style={{ background: 'var(--surface-soft)' }}>
                <div className="phase2-kicker">AI destination</div>
                <div className="provider-stack mt-16">
                  {(['claude', 'codex', 'cursor'] as const).map((provider) => (
                    <button
                      key={provider}
                      className={`provider-row ${providerTarget === provider ? 'active' : ''}`}
                      onClick={() => setProviderTarget(provider)}
                      aria-pressed={providerTarget === provider}
                    >
                      <span className="radio-dot" />
                      <strong>{provider === 'claude' ? 'Claude CLI' : provider === 'codex' ? 'Codex CLI' : 'Cursor'}</strong>
                      <span>Local handoff</span>
                    </button>
                  ))}
                </div>
              </div>
              <div className="row gap-8">
                <button className="btn btn-primary" onClick={() => preflight(providerTarget)}>Generate preflight</button>
                <button className="btn btn-ghost" disabled={!summary} onClick={submitToAI}>Freeze submission</button>
              </div>
              {summary && (
                <pre className="pre card">{summary.finalPromptDraft}</pre>
              )}
              {submission && (
                <div className="card">
                  <div className="phase2-kicker">Submission snapshot</div>
                  <p className="phase2-muted mt-8">Created for {submission.providerTarget}. Prompt chars: {submission.finalPrompt.length}.</p>
                </div>
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
