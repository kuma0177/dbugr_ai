'use client';

import { useEffect, useMemo, useState } from 'react';
import { api, apiAssetUrl } from '@/lib/api';
import { displayOnboardingName, readOnboardingState } from '@/lib/onboarding';
import type { AIReviewSummary, FeedbackComment, FeedbackFrame, FeedbackSession, Submission } from '@feedbackagent/shared';

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

function visibilityLabel(visibility: FeedbackSession['visibility']) {
  if (visibility === 'org') return 'Visibility: Team';
  if (visibility === 'public') return 'Visibility: Public';
  return 'Visibility: Private';
}

function acceptedComments(session?: FeedbackSession) {
  return (session?.comments ?? []).filter((comment) =>
    comment.curationDecisions?.some((decision) => decision.includedInPayload),
  );
}

function commentDecision(comment: FeedbackComment) {
  const latest = comment.curationDecisions?.[comment.curationDecisions.length - 1];
  return latest?.decision ?? 'needs_review';
}

function decisionLabel(comment: FeedbackComment) {
  return commentDecision(comment).replace('_', ' ');
}

function initials(value?: string | null) {
  const source = value?.trim() || 'Teammate';
  return source
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

function sessionFrame(session?: FeedbackSession) {
  return session?.frames?.find((frame) => frame.imageUrl) ?? session?.frames?.[0] ?? null;
}

function framePreviewUrl(frame?: FeedbackFrame | null) {
  return frame ? apiAssetUrl(`/phase2/frames/${frame.id}/image`) : '';
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
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});
  const [status, setStatus] = useState('Loading review workspace...');
  const [summary, setSummary] = useState<AIReviewSummary | null>(null);
  const [providerTarget, setProviderTarget] = useState<ProviderTarget>('claude');
  const [submission, setSubmission] = useState<Submission | null>(null);
  const [working, setWorking] = useState('');
  const [isOnboarded, setIsOnboarded] = useState(false);
  const [workspaceName, setWorkspaceName] = useState('Dbugr workspace');
  const [signedInAs, setSignedInAs] = useState('');

  const selected = useMemo(
    () => sessions.find((session) => session.id === selectedId),
    [selectedId, sessions],
  );

  async function load(nextScope = scope) {
    setWorking('Loading workspace');
    setStatus(`Loading ${scopeLabels[nextScope].toLowerCase()} sessions...`);
    console.info('[phase2-web] review_feed.load.started', { scope: nextScope });
    try {
      const data = await api.phase2.feed(nextScope);
      setSessions(data.sessions);
      setSelectedId((current) => data.sessions.some((session) => session.id === current) ? current : '');
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

  async function addContribution(session: FeedbackSession) {
    const body = commentDrafts[session.id]?.trim();
    if (!body) return;
    setSelectedId(session.id);
    setWorking('Posting note');
    setStatus('Adding your note to the review thread...');
    console.info('[phase2-web] review_feed.contribution.started', { sessionId: session.id, scope });
    try {
      await api.phase2.contribute(session.id, {
        targetType: 'session',
        contributionType: 'suggested_edit',
        body,
        visibility: session.visibility === 'public' ? 'public' : session.visibility === 'private' ? 'private' : 'org',
      });
      setCommentDrafts((current) => ({ ...current, [session.id]: '' }));
      await load(scope);
      setStatus('Note added. It will be emailed in the next digest batch if it needs team attention.');
      console.info('[phase2-web] review_feed.contribution.completed', { sessionId: session.id });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`Contribution failed: ${message}`);
      console.warn('[phase2-web] review_feed.contribution.failed', { sessionId: session.id, message });
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

  async function preflight(target: ProviderTarget, session = selected) {
    if (!session) return;
    setSelectedId(session.id);
    const acceptedForSession = acceptedComments(session);
    setWorking('Generating AI preview');
    setProviderTarget(target);
    setStatus(`Generating a clean ${providerLabels[target]} prompt from accepted feedback...`);
    console.info('[phase2-web] review_feed.preflight.started', {
      sessionId: session.id,
      providerTarget: target,
      acceptedCount: acceptedForSession.length,
    });
    try {
      const result = await api.phase2.preflight(session.id, target);
      setSummary(result);
      setStatus('AI prompt preview is ready. Review it before freezing the submission.');
      console.info('[phase2-web] review_feed.preflight.completed', {
        sessionId: session.id,
        providerTarget: target,
        promptChars: result.finalPromptDraft.length,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`Preflight failed: ${message}`);
      console.warn('[phase2-web] review_feed.preflight.failed', { sessionId: session.id, providerTarget: target, message });
    } finally {
      setWorking('');
    }
  }

  async function changeVisibility(session: FeedbackSession, visibility: 'private' | 'org' | 'public') {
    setSelectedId(session.id);
    const submissionFlow = visibility === 'public' ? 'public_feed' : visibility === 'org' ? 'internal_review' : 'direct';
    setWorking('Updating route');
    setStatus(visibility === 'public'
      ? 'Publishing to the public feed with redaction confirmation...'
      : `Moving session to ${visibility === 'org' ? 'team review' : 'private/direct'}...`);
    console.info('[phase2-web] review_feed.visibility.started', { sessionId: session.id, visibility, submissionFlow });
    try {
      await api.phase2.visibility(session.id, {
        visibility,
        submissionFlow,
        redactionConfirmed: visibility === 'public',
      });
      await load(visibility === 'org' ? 'organization' : visibility);
      setScope(visibility === 'org' ? 'organization' : visibility);
      setStatus(visibility === 'public'
        ? 'Public feed route is ready. Review redaction before final AI handoff.'
        : `Session route updated to ${visibility === 'org' ? 'team review' : 'direct/private'}.`);
      console.info('[phase2-web] review_feed.visibility.completed', { sessionId: session.id, visibility });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`Visibility update failed: ${message}`);
      console.warn('[phase2-web] review_feed.visibility.failed', { sessionId: session.id, visibility, message });
    } finally {
      setWorking('');
    }
  }

  async function submitToAI(session = selected) {
    if (!session) return;
    setSelectedId(session.id);
    setWorking('Freezing prompt');
    setStatus(`Freezing prompt snapshot for ${providerLabels[providerTarget]}...`);
    console.info('[phase2-web] review_feed.submission.started', {
      sessionId: session.id,
      providerTarget,
      summaryId: summary?.id,
    });
    try {
      const result = await api.phase2.submit(session.id, {
        providerTarget,
        aiReviewSummaryId: summary?.id,
        finalPrompt: summary?.editedPrompt ?? summary?.finalPromptDraft,
        credentialScope: 'personal',
      });
      setSubmission(result);
      await load(scope);
      setStatus(`Submission snapshot created for ${providerLabels[providerTarget]}. The Mac app can hand it to the local CLI.`);
      console.info('[phase2-web] review_feed.submission.completed', {
        sessionId: session.id,
        submissionId: result.id,
        providerTarget,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`Submission failed: ${message}`);
      console.warn('[phase2-web] review_feed.submission.failed', { sessionId: session.id, providerTarget, message });
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
        </header>

        <div className="review-hero">
          <div>
            <div className="phase2-kicker">Notes Feed</div>
            <h1>Review visual feedback before AI sees it.</h1>
            <p>{status}</p>
            {working ? <span className="review-working">⌛ {working}...</span> : null}
          </div>
        </div>

        <section className="review-feed-stack">
          {sessions.map((session) => {
            const isSelected = selected?.id === session.id;
            const acceptedForSession = acceptedComments(session);
            const sessionSummary = isSelected ? summary : null;
            const sessionSubmission = isSelected ? submission : null;
            const draft = commentDrafts[session.id] ?? '';
            const frames = session.frames?.length ? session.frames : [];
            return (
              <article key={session.id} className={`review-post ${isSelected ? 'expanded' : 'collapsed'}`}>
                <header className="review-post-header">
                  <div className="review-comment-avatar" aria-hidden="true">{initials(signedInAs || 'Dbugr')}</div>
                  <div className="review-post-heading">
                    <div className="review-post-author">
                      <strong>{signedInAs || 'Dbugr.ai'}</strong>
                      <span>{updatedCopy(session.updatedAt)} · {visibilityLabel(session.visibility)}</span>
                    </div>
                    <h2>{session.title}</h2>
                    <p>{session.about || session.aiSummary || 'No session note yet. Add context before handoff.'}</p>
                  </div>
                  <div className="review-post-controls">
                    <span className="review-pill">{session.reviewStatus?.replaceAll('_', ' ') ?? 'draft'}</span>
                    <button
                      type="button"
                      className="review-collapse-toggle"
                      aria-expanded={isSelected}
                      onClick={() => {
                        setSelectedId(isSelected ? '' : session.id);
                        setSummary(null);
                        setSubmission(null);
                      }}
                    >
                      {isSelected ? 'Collapse' : 'Expand'}
                    </button>
                  </div>
                </header>

                <div className="review-card-meta">
                  <div>
                    <span>{session.comments?.length ?? 0} comments</span>
                    <span>{acceptedForSession.length} accepted</span>
                    <span>{frames.length} captures</span>
                  </div>
                  <button
                    type="button"
                    className="review-collapse-toggle"
                    aria-expanded={isSelected}
                    onClick={() => {
                      setSelectedId(isSelected ? '' : session.id);
                      setSummary(null);
                      setSubmission(null);
                    }}
                  >
                    {isSelected ? 'Collapse comments' : 'Expand comments'}
                  </button>
                </div>

                {isSelected ? (
                  <div className="review-post-expanded">
                    <div className="review-route-card">
                      <div className="phase2-kicker">Session visibility</div>
                      <div className="review-route-buttons">
                        <button onClick={() => changeVisibility(session, 'private')} className={session.visibility === 'private' ? 'active' : ''}>
                          Direct
                        </button>
                        <button onClick={() => changeVisibility(session, 'org')} className={session.visibility === 'org' ? 'active' : ''}>
                          Team
                        </button>
                        <button onClick={() => changeVisibility(session, 'public')} className={session.visibility === 'public' ? 'active' : ''}>
                          Public
                        </button>
                      </div>
                      <p>Comments inherit this session setting.</p>
                    </div>

                    <div className="review-frame-strip" aria-label={`${session.title} captures`}>
                      {frames.length ? frames.map((frame, index) => {
                        const image = framePreviewUrl(frame);
                        return (
                          <figure key={frame.id} className="review-frame-card">
                            <div className="review-frame-media">
                              <img src={image} alt={`${session.title} capture ${index + 1}`} />
                            </div>
                            <figcaption>
                              <strong>Capture {index + 1}</strong>
                              <span>{frame.description || session.about || 'Primary note will appear here.'}</span>
                            </figcaption>
                          </figure>
                        );
                      }) : (
                        <figure className="review-frame-card">
                          <div className="review-frame-media review-preview-empty">
                            <strong>Screenshot preview will appear here</strong>
                            <p>Native Mac captures sync frames into this review board.</p>
                          </div>
                          <figcaption>
                            <strong>Capture pending</strong>
                            <span>{session.about || 'Add the first annotation from the Mac app.'}</span>
                          </figcaption>
                        </figure>
                      )}
                    </div>

                    <div className="review-comment-list">
                      {(session.comments ?? []).map((comment) => {
                        const author = comment.author?.name ?? 'Teammate';
                        return (
                          <article key={comment.id} className="review-comment">
                            <div className="review-comment-avatar" aria-hidden="true">{initials(author)}</div>
                            <div className="review-comment-head">
                              <div>
                                <strong>{author}</strong>
                                <span>{updatedCopy(comment.createdAt)} · {decisionLabel(comment)}</span>
                              </div>
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
                    </div>

                    <div className="review-comment-box">
                      <div className="phase2-kicker">Add review note</div>
                      <textarea
                        value={draft}
                        onChange={(event) => setCommentDrafts((current) => ({ ...current, [session.id]: event.target.value }))}
                        placeholder="Write a comment for this session..."
                      />
                      <button className="btn btn-primary" onClick={() => addContribution(session)}>Post comment</button>
                    </div>

                    <div className="review-synthesis">
                      <div>
                        <div className="phase2-kicker">Accepted notes</div>
                        <h3>{acceptedForSession.length} item(s) ready for synthesis</h3>
                      </div>
                      <div className="review-provider-row">
                        {(['claude', 'codex', 'cursor'] as const).map((provider) => (
                          <button
                            key={provider}
                            className={providerTarget === provider && isSelected ? 'active' : ''}
                            onClick={() => {
                              setSelectedId(session.id);
                              setProviderTarget(provider);
                            }}
                          >
                            {providerLabels[provider]}
                          </button>
                        ))}
                      </div>
                      <button className="btn btn-primary" onClick={() => preflight(providerTarget, session)}>
                        Generate AI-ready prompt
                      </button>
                      {sessionSummary ? (
                        <>
                          <pre>{sessionSummary.finalPromptDraft}</pre>
                          <button className="btn btn-primary" onClick={() => submitToAI(session)}>
                            Freeze and send snapshot
                          </button>
                        </>
                      ) : (
                        <p>Accept the best notes, then generate a clean implementation prompt for Claude, Codex, or Cursor.</p>
                      )}
                      {sessionSubmission ? (
                        <p className="review-success">Snapshot created for {providerLabels[sessionSubmission.providerTarget]}.</p>
                      ) : null}
                    </div>
                  </div>
                ) : null}
              </article>
            );
          })}
          {sessions.length === 0 ? (
            <div className="review-empty">
              <strong>No sessions here yet.</strong>
              <p>Choose Team or Public in the Mac app submission flow, and Dbugr will sync the session into this feed.</p>
            </div>
          ) : null}
        </section>
      </main>
    </section>
  );
}
