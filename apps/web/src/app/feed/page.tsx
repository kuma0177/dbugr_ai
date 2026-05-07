'use client';

import { useEffect, useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { displayOnboardingName, readOnboardingState } from '@/lib/onboarding';
import type { AIReviewSummary, FeedbackComment, FeedbackSession, Submission } from '@feedbackagent/shared';

type Scope = 'private' | 'organization' | 'public';
type ProviderTarget = 'claude' | 'codex' | 'cursor';

const scopeLabels: Record<Scope, string> = {
  private: 'Private feed',
  organization: 'Team feed',
  public: 'Public feed',
};

const providerLabels: Record<ProviderTarget, string> = {
  claude: 'Claude CLI',
  codex: 'Codex CLI',
  cursor: 'Cursor',
};

function acceptedComments(session?: FeedbackSession) {
  return (session?.comments ?? []).filter((comment) =>
    comment.curationDecisions?.some((decision) => decision.includedInPayload),
  );
}

function commentDecision(comment: FeedbackComment) {
  const latest = comment.curationDecisions?.[comment.curationDecisions.length - 1];
  return latest?.decision ?? 'needs_review';
}

function sessionImage(session?: FeedbackSession) {
  return session?.frames?.find((frame) => frame.imageUrl)?.imageUrl ?? '';
}

function updatedCopy(value?: string) {
  if (!value) return 'Just now';
  const delta = Date.now() - new Date(value).getTime();
  if (Number.isNaN(delta) || delta < 60_000) return 'Just now';
  if (delta < 3_600_000) return `${Math.max(1, Math.round(delta / 60_000))}m ago`;
  if (delta < 86_400_000) return `${Math.max(1, Math.round(delta / 3_600_000))}h ago`;
  return `${Math.max(1, Math.round(delta / 86_400_000))}d ago`;
}

export default function FeedPage() {
  const [scope, setScope] = useState<Scope>('organization');
  const [sessions, setSessions] = useState<FeedbackSession[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [commentBody, setCommentBody] = useState('I think this should be accepted before the final AI handoff.');
  const [status, setStatus] = useState('Loading review workspace...');
  const [summary, setSummary] = useState<AIReviewSummary | null>(null);
  const [providerTarget, setProviderTarget] = useState<ProviderTarget>('claude');
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [working, setWorking] = useState('');
  const [isOnboarded, setIsOnboarded] = useState(false);
  const [workspaceName, setWorkspaceName] = useState('Dbugr workspace');
  const [signedInAs, setSignedInAs] = useState('');

  const selected = useMemo(
    () => sessions.find((session) => session.id === selectedId) ?? sessions[0],
    [selectedId, sessions],
  );
  const accepted = useMemo(() => acceptedComments(selected), [selected]);
  const selectedImage = sessionImage(selected);

  async function load(nextScope = scope) {
    setWorking('Loading workspace');
    setStatus(`Loading ${scopeLabels[nextScope].toLowerCase()} sessions...`);
    console.info('[phase2-web] review_feed.load.started', { scope: nextScope });
    try {
      const data = await api.phase2.feed(nextScope);
      setSessions(data.sessions);
      setSelectedId((current) => data.sessions.some((session) => session.id === current) ? current : data.sessions[0]?.id ?? '');
      setStatus(data.sessions.length
        ? `${data.sessions.length} session(s) ready in ${scopeLabels[nextScope].toLowerCase()}.`
        : `No sessions are in ${scopeLabels[nextScope].toLowerCase()} yet.`);
      console.info('[phase2-web] review_feed.load.completed', {
        scope: nextScope,
        sessions: data.sessions.length,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`Feed failed: ${message}`);
      console.warn('[phase2-web] review_feed.load.failed', { scope: nextScope, message });
    } finally {
      setWorking('');
    }
  }

  useEffect(() => {
    const syncWorkspaceIdentity = () => {
      const next = readOnboardingState();
      setWorkspaceName(next?.organizationName || 'Dbugr workspace');
      setSignedInAs(displayOnboardingName(next) || next?.userEmail || '');
      return next;
    };
    const onboarding = syncWorkspaceIdentity();
    setIsOnboarded(Boolean(onboarding));
    if (!onboarding) {
      setStatus('Create a workspace before opening team or public review.');
      console.info('[phase2-web] review_feed.blocked_missing_onboarding');
      window.addEventListener('dbugr-auth-changed', syncWorkspaceIdentity);
      return () => window.removeEventListener('dbugr-auth-changed', syncWorkspaceIdentity);
    }
    void load(scope);
    window.addEventListener('dbugr-auth-changed', syncWorkspaceIdentity);
    return () => window.removeEventListener('dbugr-auth-changed', syncWorkspaceIdentity);
  }, [scope]);

  async function addContribution() {
    if (!selected || !commentBody.trim()) return;
    setWorking('Posting note');
    setStatus('Adding your note to the review thread...');
    console.info('[phase2-web] review_feed.contribution.started', { sessionId: selected.id, scope });
    try {
      await api.phase2.contribute(selected.id, {
        targetType: 'session',
        contributionType: 'suggested_edit',
        body: commentBody.trim(),
        visibility: selected.visibility === 'public' ? 'public' : selected.visibility === 'private' ? 'private' : 'org',
      });
      setCommentBody('');
      await load(scope);
      setStatus('Note added. It will be emailed in the next digest batch if it needs team attention.');
      console.info('[phase2-web] review_feed.contribution.completed', { sessionId: selected.id });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`Contribution failed: ${message}`);
      console.warn('[phase2-web] review_feed.contribution.failed', { sessionId: selected.id, message });
    } finally {
      setWorking('');
    }
  }

  async function curate(comment: FeedbackComment, decision: 'accepted' | 'rejected' | 'duplicate' | 'needs_clarification') {
    setWorking('Saving decision');
    setStatus(`Marking feedback as ${decision.replace('_', ' ')}...`);
    console.info('[phase2-web] review_feed.curation.started', { contributionId: comment.id, decision });
    try {
      await api.phase2.curate(comment.id, { decision });
      await load(scope);
      setStatus(decision === 'accepted'
        ? 'Accepted. This feedback is now eligible for the AI-ready prompt.'
        : `Marked as ${decision.replace('_', ' ')}.`);
      console.info('[phase2-web] review_feed.curation.completed', { contributionId: comment.id, decision });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`Curation failed: ${message}`);
      console.warn('[phase2-web] review_feed.curation.failed', { contributionId: comment.id, decision, message });
    } finally {
      setWorking('');
    }
  }

  async function preflight(target: ProviderTarget) {
    if (!selected) return;
    setWorking('Generating AI preview');
    setProviderTarget(target);
    setStatus(`Generating a clean ${providerLabels[target]} prompt from accepted feedback...`);
    console.info('[phase2-web] review_feed.preflight.started', {
      sessionId: selected.id,
      providerTarget: target,
      acceptedCount: accepted.length,
    });
    try {
      const result = await api.phase2.preflight(selected.id, target);
      setSummary(result);
      setStatus('AI prompt preview is ready. Review it before freezing the submission.');
      console.info('[phase2-web] review_feed.preflight.completed', {
        sessionId: selected.id,
        providerTarget: target,
        promptChars: result.finalPromptDraft.length,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`Preflight failed: ${message}`);
      console.warn('[phase2-web] review_feed.preflight.failed', { sessionId: selected.id, providerTarget: target, message });
    } finally {
      setWorking('');
    }
  }

  async function changeVisibility(visibility: 'private' | 'org' | 'public') {
    if (!selected) return;
    const submissionFlow = visibility === 'public' ? 'public_feed' : visibility === 'org' ? 'internal_review' : 'direct';
    setWorking('Updating route');
    setStatus(visibility === 'public'
      ? 'Publishing to the public feed with redaction confirmation...'
      : `Moving session to ${visibility === 'org' ? 'team review' : 'private/direct'}...`);
    console.info('[phase2-web] review_feed.visibility.started', { sessionId: selected.id, visibility, submissionFlow });
    try {
      await api.phase2.visibility(selected.id, {
        visibility,
        submissionFlow,
        redactionConfirmed: visibility === 'public',
      });
      await load(visibility === 'org' ? 'organization' : visibility);
      setScope(visibility === 'org' ? 'organization' : visibility);
      setStatus(visibility === 'public'
        ? 'Public feed route is ready. Review redaction before final AI handoff.'
        : `Session route updated to ${visibility === 'org' ? 'team review' : 'direct/private'}.`);
      console.info('[phase2-web] review_feed.visibility.completed', { sessionId: selected.id, visibility });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`Visibility update failed: ${message}`);
      console.warn('[phase2-web] review_feed.visibility.failed', { sessionId: selected.id, visibility, message });
    } finally {
      setWorking('');
    }
  }

  async function submitToAI() {
    if (!selected) return;
    setWorking('Freezing prompt');
    setStatus(`Freezing prompt snapshot for ${providerLabels[providerTarget]}...`);
    console.info('[phase2-web] review_feed.submission.started', {
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
      setStatus(`Submission snapshot created for ${providerLabels[providerTarget]}. The Mac app can hand it to the local CLI.`);
      console.info('[phase2-web] review_feed.submission.completed', {
        sessionId: selected.id,
        submissionId: result.id,
        providerTarget,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`Submission failed: ${message}`);
      console.warn('[phase2-web] review_feed.submission.failed', { sessionId: selected.id, providerTarget, message });
    } finally {
      setWorking('');
    }
  }

  if (!isOnboarded) {
    return (
      <section className="phase2-hero">
        <div className="phase2-card">
          <div className="phase2-kicker">Account required</div>
          <h1 className="phase2-title">Create your workspace before review.</h1>
          <p className="phase2-lede">
            Direct local desktop handoff can stay account-free, but team review, public feed,
            comments, curation, and AI preflight need a web identity, organization, and role.
          </p>
          <a className="btn btn-primary mt-24" href="/onboarding">Start onboarding</a>
        </div>
      </section>
    );
  }

  return (
    <section className="review-shell">
      <aside className="review-sidebar" aria-label="Review navigation">
        <div className="review-profile">
          <div className="review-avatar">D</div>
          <div>
            <strong>Dbugr.ai</strong>
            <span>Review mode</span>
          </div>
        </div>
        <div className="review-workspace-card" aria-label="Current workspace">
          <span>Workspace</span>
          <strong>{workspaceName}</strong>
          {signedInAs ? <small>Signed in as {signedInAs}</small> : null}
        </div>
        <nav className="review-nav">
          <a className="active" href="/feed">Notes Feed</a>
          <div className="review-nav-subtabs" role="tablist" aria-label="Notes feed scope">
            {(['private', 'organization', 'public'] as Scope[]).map((item) => (
              <button
                key={item}
                className={scope === item ? 'active' : ''}
                onClick={() => setScope(item)}
                role="tab"
                aria-selected={scope === item}
                type="button"
              >
                {scopeLabels[item]}
              </button>
            ))}
          </div>
          <a href="/sessions">Sessions</a>
          <a href="/admin">Admin</a>
          <a href="/onboarding">Mac Link</a>
        </nav>
        <a className="review-new" href="/onboarding">New Annotation</a>
      </aside>

      <main className="review-main">
        <header className="review-topbar">
          <label className="review-search">
            <span>Search</span>
            <input placeholder="Search annotations, notes, or sessions..." />
          </label>
          <div className="review-top-actions">
            <button className="btn btn-ghost">Settings</button>
            <button className="btn btn-primary" onClick={() => selected && preflight(providerTarget)}>
              Export prompt
            </button>
          </div>
        </header>

        <div className="review-hero">
          <div>
            <div className="phase2-kicker">Notes Feed</div>
            <h1>Review visual feedback before AI sees it.</h1>
            <p>{status}</p>
            {working ? <span className="review-working">⌛ {working}...</span> : null}
          </div>
        </div>

        <section className="review-grid">
          <div className="review-session-list">
            {sessions.map((session) => {
              const isSelected = selected?.id === session.id;
              const acceptedCount = acceptedComments(session).length;
              const image = sessionImage(session);
              return (
                <button
                  key={session.id}
                  className={`review-session-card ${isSelected ? 'active' : ''}`}
                  onClick={() => {
                    setSelectedId(session.id);
                    setSummary(null);
                    setSubmission(null);
                    console.info('[phase2-web] review_feed.session_selected', { sessionId: session.id });
                  }}
                >
                  <div className="review-session-thumb">
                    {image ? <img src={image} alt={`${session.title} screenshot preview`} /> : <span>▣</span>}
                  </div>
                  <div className="review-session-body">
                    <div className="review-session-title">
                      <h2>{session.title}</h2>
                      <span>{session.visibility === 'org' ? 'Team' : session.visibility}</span>
                    </div>
                    <p>{session.about || session.aiSummary || 'No session note yet. Add context before handoff.'}</p>
                    <div className="review-card-meta">
                      <span>💬 {session.comments?.length ?? 0} notes</span>
                      <span>✅ {acceptedCount} accepted</span>
                      <span>Updated {updatedCopy(session.updatedAt)}</span>
                    </div>
                  </div>
                </button>
              );
            })}
            {sessions.length === 0 ? (
              <div className="review-empty">
                <strong>No sessions here yet.</strong>
                <p>Choose Team or Public in the Mac app submission flow, and Dbugr will sync the session into this feed.</p>
              </div>
            ) : null}
          </div>

          <aside className="review-detail-panel">
            {selected ? (
              <>
                <div className="review-detail-header">
                  <div>
                    <div className="phase2-kicker">Selected session</div>
                    <h2>{selected.title}</h2>
                  </div>
                  <span className="review-pill">{selected.reviewStatus?.replaceAll('_', ' ') ?? 'draft'}</span>
                </div>

                <div className="review-route-card">
                  <div className="phase2-kicker">Where should this go?</div>
                  <div className="review-route-buttons">
                    <button onClick={() => changeVisibility('private')} className={selected.visibility === 'private' ? 'active' : ''}>
                      Direct
                    </button>
                    <button onClick={() => changeVisibility('org')} className={selected.visibility === 'org' ? 'active' : ''}>
                      Team
                    </button>
                    <button onClick={() => changeVisibility('public')} className={selected.visibility === 'public' ? 'active' : ''}>
                      Public
                    </button>
                  </div>
                  <p>
                    Direct stays private for local CLI handoff. Team opens internal review.
                    Public asks the builder community after redaction approval.
                  </p>
                </div>

                <div className="review-preview-frame">
                  {selectedImage ? (
                    <img src={selectedImage} alt={`${selected.title} annotated screenshot`} />
                  ) : (
                    <div className="review-preview-empty">
                      <span>📸</span>
                      <strong>Screenshot preview will appear here</strong>
                      <p>Native Mac captures sync frames into this review board.</p>
                    </div>
                  )}
                </div>

                <div className="review-comment-box">
                  <div className="phase2-kicker">Add team note</div>
                  <textarea value={commentBody} onChange={(event) => setCommentBody(event.target.value)} />
                  <button className="btn btn-primary" onClick={addContribution}>Post note</button>
                </div>

                <div className="review-comment-list">
                  {(selected.comments ?? []).map((comment) => {
                    const decision = commentDecision(comment);
                    return (
                      <article key={comment.id} className="review-comment">
                        <div className="review-comment-head">
                          <strong>{comment.author?.name ?? 'Teammate'}</strong>
                          <span className={`review-decision decision-${decision}`}>{decision.replace('_', ' ')}</span>
                        </div>
                        <p>{comment.body}</p>
                        <div className="review-comment-actions">
                          <button onClick={() => curate(comment, 'accepted')}>Accept</button>
                          <button onClick={() => curate(comment, 'rejected')}>Decline</button>
                          <button onClick={() => curate(comment, 'duplicate')}>Duplicate</button>
                        </div>
                      </article>
                    );
                  })}
                  {(selected.comments ?? []).length === 0 ? (
                    <p className="phase2-muted">No comments yet. Add the first review note.</p>
                  ) : null}
                </div>

                <div className="review-synthesis">
                  <div>
                    <div className="phase2-kicker">Accepted notes</div>
                    <h3>{accepted.length} item(s) ready for synthesis</h3>
                  </div>
                  <div className="review-provider-row">
                    {(['claude', 'codex', 'cursor'] as const).map((provider) => (
                      <button
                        key={provider}
                        className={providerTarget === provider ? 'active' : ''}
                        onClick={() => setProviderTarget(provider)}
                      >
                        {providerLabels[provider]}
                      </button>
                    ))}
                  </div>
                  <button className="btn btn-primary" onClick={() => preflight(providerTarget)}>
                    Generate AI-ready prompt
                  </button>
                  {summary ? (
                    <>
                      <pre>{summary.finalPromptDraft}</pre>
                      <button className="btn btn-primary" onClick={submitToAI}>
                        Freeze and send snapshot
                      </button>
                    </>
                  ) : (
                    <p>Accept the best notes, then generate a clean implementation prompt for Claude, Codex, or Cursor.</p>
                  )}
                  {submission ? (
                    <p className="review-success">Snapshot created for {providerLabels[submission.providerTarget]}.</p>
                  ) : null}
                </div>
              </>
            ) : (
              <div className="review-empty">
                <strong>Choose a session.</strong>
                <p>The curation panel will show screenshots, comments, accepted notes, and AI handoff controls.</p>
              </div>
            )}
          </aside>
        </section>
      </main>
    </section>
  );
}
