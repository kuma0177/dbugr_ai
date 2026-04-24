'use client';

import { useState } from 'react';
import type { FeedbackComment } from '@feedbackagent/shared';
import { api } from '@/lib/api';

interface Props {
  sessionId: string;
  comments: FeedbackComment[];
  onUpdate: () => void;
}

export function CommentsTab({ sessionId, comments, onUpdate }: Props) {
  const [body, setBody] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setSubmitting(true);
    try {
      await api.comments.create(sessionId, { body });
      setBody('');
      onUpdate();
    } finally {
      setSubmitting(false);
    }
  }

  async function vote(commentId: string, value: 1 | -1) {
    await api.comments.vote(commentId, value);
    onUpdate();
  }

  return (
    <div>
      <div>
        {comments.length === 0 && <p className="muted">No comments yet. Be the first!</p>}
        {comments.map((c) => (
          <CommentRow key={c.id} comment={c} onVote={vote} />
        ))}
      </div>

      <form onSubmit={submit} className="stack gap-8" style={{ marginTop: 20 }}>
        <textarea
          className="textarea"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder="Add a comment…"
        />
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
          <button type="submit" className="btn btn-primary" disabled={submitting || !body.trim()}>
            {submitting ? 'Posting…' : 'Post Comment'}
          </button>
        </div>
      </form>
    </div>
  );
}

function CommentRow({
  comment,
  onVote,
}: {
  comment: FeedbackComment;
  onVote: (id: string, v: 1 | -1) => void;
}) {
  return (
    <div className="comment">
      <div className="row gap-8">
        <span className="bold" style={{ fontSize: '0.875rem' }}>
          {comment.author?.name ?? 'Unknown'}
        </span>
        <span className="muted">{new Date(comment.createdAt).toLocaleString()}</span>
      </div>
      <p className="comment-body">{comment.body}</p>
      <div className="row gap-8 mt-8">
        <button className="btn btn-ghost" style={{ padding: '2px 10px', fontSize: '0.8rem' }} onClick={() => onVote(comment.id, 1)}>
          ▲ {comment.votesCount}
        </button>
        <button className="btn btn-ghost" style={{ padding: '2px 10px', fontSize: '0.8rem' }} onClick={() => onVote(comment.id, -1)}>
          ▼
        </button>
      </div>
      {comment.replies?.map((r) => (
        <div key={r.id} className="comment-reply">
          <CommentRow comment={r} onVote={onVote} />
        </div>
      ))}
    </div>
  );
}
