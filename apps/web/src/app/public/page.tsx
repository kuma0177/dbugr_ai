'use client';

import { useEffect, useMemo, useState } from 'react';
import { api, apiAssetUrl } from '@/lib/api';
import { displayOnboardingName, readOnboardingState } from '@/lib/onboarding';
import type { FeedbackFrame, FeedbackSession } from '@feedbackagent/shared';

function initials(value?: string | null) {
  const source = value?.trim() || 'Dbugr';
  return source
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join('');
}

function framePreviewUrl(frame?: FeedbackFrame | null, viewerEmail?: string) {
  if (!frame) return '';
  const params = new URLSearchParams();
  if (viewerEmail?.trim()) params.set('viewerEmail', viewerEmail.trim().toLowerCase());
  return apiAssetUrl(`/phase2/frames/${frame.id}/image${params.size ? `?${params.toString()}` : ''}`);
}

function updatedCopy(value?: string) {
  if (!value) return 'Just now';
  const delta = Date.now() - new Date(value).getTime();
  if (Number.isNaN(delta) || delta < 60_000) return 'Just now';
  if (delta < 3_600_000) return `${Math.max(1, Math.round(delta / 60_000))}m ago`;
  if (delta < 86_400_000) return `${Math.max(1, Math.round(delta / 3_600_000))}h ago`;
  return `${Math.max(1, Math.round(delta / 86_400_000))}d ago`;
}

export default function PublicFeedPage() {
  const [sessions, setSessions] = useState<FeedbackSession[]>([]);
  const [selectedId, setSelectedId] = useState('');
  const [viewerName, setViewerName] = useState('');
  const [viewerEmail, setViewerEmail] = useState('');
  const [status, setStatus] = useState('Loading public feedback...');
  const [working, setWorking] = useState('');
  const [commentDrafts, setCommentDrafts] = useState<Record<string, string>>({});

  const selected = useMemo(
    () => sessions.find((session) => session.id === selectedId) ?? sessions[0] ?? null,
    [selectedId, sessions],
  );
  const shareUrl = typeof window === 'undefined' || !selected ? '' : `${window.location.origin}/public?sessionId=${selected.id}`;

  function syncViewer() {
    const state = readOnboardingState();
    setViewerEmail(state?.userEmail ?? '');
    setViewerName(displayOnboardingName(state) || state?.userEmail || '');
    return state;
  }

  async function load(preferredSessionId = selectedId) {
    setWorking('Loading public feed');
    try {
      const data = await api.phase2.publicFeed();
      setSessions(data.sessions);
      setSelectedId((current) => {
        if (preferredSessionId && data.sessions.some((session) => session.id === preferredSessionId)) return preferredSessionId;
        if (current && data.sessions.some((session) => session.id === current)) return current;
        return data.sessions[0]?.id ?? '';
      });
      setStatus(data.sessions.length
        ? `${data.sessions.length} public session${data.sessions.length === 1 ? '' : 's'} open for community review.`
        : 'No public sessions have been published yet.');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`Public feed failed: ${message}`);
    } finally {
      setWorking('');
    }
  }

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const requested = params.get('sessionId') ?? '';
    syncViewer();
    void load(requested);
    window.addEventListener('storage', syncViewer);
    window.addEventListener('dbugr-auth-changed', syncViewer);
    return () => {
      window.removeEventListener('storage', syncViewer);
      window.removeEventListener('dbugr-auth-changed', syncViewer);
    };
  }, []);

  async function addPublicComment(session: FeedbackSession) {
    const body = commentDrafts[session.id]?.trim();
    if (!body) return;
    if (!viewerEmail) {
      setStatus('Sign in or sign up before adding a public comment.');
      return;
    }

    setWorking('Posting public comment');
    try {
      await api.phase2.contribute(session.id, {
        targetType: 'session',
        contributionType: 'suggested_edit',
        body,
        visibility: 'public',
      });
      setCommentDrafts((current) => ({ ...current, [session.id]: '' }));
      await load(session.id);
      setStatus('Your public comment was posted. You can edit it by posting again.');
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus(`Comment failed: ${message}`);
    } finally {
      setWorking('');
    }
  }

  return (
    <section className="review-shell public-feed-shell">
      <aside className="review-sidebar" aria-label="Public review navigation">
        <div className="review-profile">
          <div className="review-avatar">D</div>
          <div>
            <strong>Dbugr.ai</strong>
            <span>Public feed</span>
          </div>
        </div>
        <div className="review-workspace-card">
          <span>Community</span>
          <strong>Public review</strong>
          <small>{viewerName ? `Signed in as ${viewerName}` : 'Read without an account. Sign in to comment.'}</small>
        </div>
        <nav className="review-nav">
          <a className="active" href="/public">Public discovery</a>
          <a href="/feed?scope=public">Creator review feed</a>
          <a href="/onboarding?flow=sign-in">Sign in</a>
          <a href="/onboarding?flow=sign-up">Sign up</a>
        </nav>
      </aside>

      <main className="review-main">
        <div className="review-hero">
          <div>
            <div className="phase2-kicker">Public Feed</div>
            <h1>Discover visual feedback before it becomes AI work.</h1>
            <p>{status}</p>
            {working ? <span className="review-working">{working}...</span> : null}
          </div>
        </div>

        <section className="review-feed-stack public-feed-stack">
          {sessions.map((session) => {
            const isSelected = selected?.id === session.id;
            const frames = session.frames?.length ? session.frames : [];
            const primaryFrame = frames.find((frame) => frame.imageUrl) ?? frames[0];
            const image = framePreviewUrl(primaryFrame, viewerEmail);
            const draft = commentDrafts[session.id] ?? '';
            const visibleComments = session.comments ?? [];
            return (
              <article key={session.id} className={`review-post ${isSelected ? 'expanded' : 'collapsed'}`}>
                <header className="review-post-header">
                  <div className="review-comment-avatar" aria-hidden="true">{initials(session.creator?.name)}</div>
                  <div className="review-post-heading">
                    <div className="review-post-author">
                      <strong>{session.creator?.name ?? 'Dbugr creator'}</strong>
                      <span>{updatedCopy(session.updatedAt)} · Public</span>
                    </div>
                    <h2>{session.title}</h2>
                    <p>{session.about || session.aiSummary || 'Community feedback is open for this session.'}</p>
                  </div>
                  <div className="review-post-controls">
                    <span className="review-pill">{session.reviewStatus?.replaceAll('_', ' ') ?? 'collecting feedback'}</span>
                    <button className="review-collapse-toggle" type="button" onClick={() => setSelectedId(isSelected ? '' : session.id)}>
                      {isSelected ? 'Collapse' : 'Open'}
                    </button>
                  </div>
                </header>

                {image ? (
                  <div className="review-frame-strip">
                    <figure className="review-frame-card">
                      <div className="review-frame-media">
                        <img src={image} alt={`${session.title} public capture`} />
                      </div>
                      <figcaption>
                        <strong>Capture 1</strong>
                        <span>{primaryFrame?.description || session.about || 'Public capture context'}</span>
                      </figcaption>
                    </figure>
                  </div>
                ) : null}

                <div className="review-card-meta">
                  <div>
                    <span>{visibleComments.length} comments</span>
                    <span>{frames.length} captures</span>
                  </div>
                  {isSelected && shareUrl ? <a className="review-collapse-toggle" href={shareUrl}>Public URL</a> : null}
                </div>

                {isSelected ? (
                  <div className="review-post-expanded">
                    <div className="review-comment-list">
                      {visibleComments.map((comment) => (
                        <article key={comment.id} className="review-comment">
                          <div className="review-comment-avatar" aria-hidden="true">{initials(comment.author?.name)}</div>
                          <div className="review-comment-head">
                            <div>
                              <strong>{comment.author?.name ?? 'Community member'}</strong>
                              <span>{updatedCopy(comment.createdAt)} · public note</span>
                            </div>
                          </div>
                          <p>{comment.body}</p>
                        </article>
                      ))}
                    </div>

                    <div className="review-comment-box">
                      <div className="phase2-kicker">Add public note</div>
                      {viewerEmail ? (
                        <>
                          <textarea
                            value={draft}
                            onChange={(event) => setCommentDrafts((current) => ({ ...current, [session.id]: event.target.value }))}
                            placeholder="Share what you noticed. Posting again edits your note for this session."
                          />
                          <button className="btn btn-primary" onClick={() => addPublicComment(session)}>Post public comment</button>
                        </>
                      ) : (
                        <div className="review-empty">
                          <h3>Sign in to engage</h3>
                          <p>Anyone can discover public feedback. To add a comment, sign in or create a Dbugr account first.</p>
                          <div className="review-top-actions">
                            <a className="btn btn-primary" href="/onboarding?flow=sign-in">Sign in</a>
                            <a className="review-collapse-toggle" href="/onboarding?flow=sign-up">Sign up</a>
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                ) : null}
              </article>
            );
          })}
        </section>
      </main>
    </section>
  );
}
