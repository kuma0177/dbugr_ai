import type { FeedbackSession } from '@feedbackagent/shared';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://127.0.0.1:3001';

async function getSession(id: string): Promise<FeedbackSession | null> {
  try {
    const res = await fetch(`${API}/api/feedback-sessions/${id}`, {
      next: { revalidate: 60 },
    });
    if (!res.ok) return null;
    const json = (await res.json()) as { data: FeedbackSession };
    return json.data;
  } catch {
    return null;
  }
}

export default async function PublicSessionPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const session = await getSession(id);

  if (!session) {
    return (
      <main style={{ maxWidth: 720, margin: '80px auto', padding: '0 24px', fontFamily: 'sans-serif' }}>
        <h1 style={{ fontSize: '1.5rem' }}>Session not found</h1>
        <p style={{ color: '#888' }}>This feedback session does not exist or is not public.</p>
      </main>
    );
  }

  if (session.visibility === 'private') {
    return (
      <main style={{ maxWidth: 720, margin: '80px auto', padding: '0 24px', fontFamily: 'sans-serif' }}>
        <h1 style={{ fontSize: '1.5rem' }}>Private session</h1>
        <p style={{ color: '#888' }}>This feedback session is private and cannot be viewed publicly.</p>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 720, margin: '48px auto', padding: '0 24px', fontFamily: 'sans-serif' }}>
      {/* Header */}
      <div style={{ marginBottom: 32 }}>
        <div style={{ fontSize: '0.75rem', color: '#888', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
          debugr.ai · Public Report
        </div>
        <h1 style={{ fontSize: '1.75rem', fontWeight: 700, marginBottom: 8 }}>{session.title}</h1>
        <div style={{ display: 'flex', gap: 12, color: '#888', fontSize: '0.875rem' }}>
          <span>Status: {session.status}</span>
          <span>·</span>
          <span>{new Date(session.createdAt).toLocaleDateString()}</span>
        </div>
      </div>

      {/* AI Summary */}
      {session.aiSummary && (
        <section style={{ background: '#f9f9f9', border: '1px solid #e5e5e5', borderRadius: 8, padding: '20px 24px', marginBottom: 28 }}>
          <div style={{ fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.1em', color: '#888', marginBottom: 10 }}>
            AI Summary
          </div>
          <p style={{ lineHeight: 1.7, margin: 0 }}>{session.aiSummary}</p>
        </section>
      )}

      {/* Transcript */}
      {session.transcript && (
        <section style={{ marginBottom: 28 }}>
          <h2 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: 12 }}>Transcript</h2>
          <pre style={{
            background: '#f4f4f4',
            border: '1px solid #e5e5e5',
            borderRadius: 6,
            padding: '16px 20px',
            fontSize: '0.85rem',
            lineHeight: 1.7,
            whiteSpace: 'pre-wrap',
            overflowWrap: 'break-word',
          }}>
            {session.transcript}
          </pre>
        </section>
      )}

      {/* Frames */}
      {session.frames && session.frames.length > 0 && (
        <section style={{ marginBottom: 28 }}>
          <h2 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: 12 }}>
            Frames ({session.frames.length})
          </h2>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 12 }}>
            {session.frames.map((frame) => (
              <div key={frame.id} style={{ border: '1px solid #e5e5e5', borderRadius: 6, padding: 12, fontSize: '0.8rem' }}>
                <div style={{ color: '#888', marginBottom: 4 }}>
                  t={Math.floor(frame.timestampMs / 1000)}s
                </div>
                {frame.description && <div>{frame.description}</div>}
                <div style={{ color: '#aaa', marginTop: 4 }}>
                  cursor ({frame.cursorX}, {frame.cursorY})
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Comments */}
      {session.comments && session.comments.filter((c) => c.visibility !== 'private').length > 0 && (
        <section style={{ marginBottom: 28 }}>
          <h2 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: 12 }}>
            Comments ({session.comments.filter((c) => c.visibility !== 'private').length})
          </h2>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {session.comments
              .filter((c) => c.visibility !== 'private')
              .map((comment) => (
                <div key={comment.id} style={{ border: '1px solid #e5e5e5', borderRadius: 6, padding: '12px 16px' }}>
                  <div style={{ display: 'flex', gap: 8, marginBottom: 6, fontSize: '0.8rem', color: '#888' }}>
                    <span style={{ fontWeight: 600, color: '#333' }}>{comment.author?.name ?? 'Anonymous'}</span>
                    <span>{new Date(comment.createdAt).toLocaleString()}</span>
                    <span style={{ marginLeft: 'auto' }}>▲ {comment.votesCount}</span>
                  </div>
                  <p style={{ margin: 0, lineHeight: 1.6 }}>{comment.body}</p>
                </div>
              ))}
          </div>
        </section>
      )}

      <footer style={{ borderTop: '1px solid #e5e5e5', paddingTop: 20, color: '#aaa', fontSize: '0.75rem' }}>
        Powered by debugr.ai
      </footer>
    </main>
  );
}
