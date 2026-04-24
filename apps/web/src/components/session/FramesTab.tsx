'use client';

import type { FeedbackFrame } from '@feedbackagent/shared';

interface Props {
  frames: FeedbackFrame[];
}

export function FramesTab({ frames }: Props) {
  if (!frames.length) {
    return <p className="muted">No frames extracted yet.</p>;
  }
  return (
    <div>
      <div className="frames-timeline">
        {frames.map((f) => (
          <div key={f.id} className="frame-thumb">
            <div style={{
              width: '100%', aspectRatio: '16/9', background: 'var(--border)',
              borderRadius: 4, marginBottom: 6, display: 'flex', alignItems: 'center',
              justifyContent: 'center', fontSize: '1.5rem',
            }}>
              🖼
            </div>
            <div>{(f.timestampMs / 1000).toFixed(1)}s</div>
            {f.description && <div style={{ marginTop: 2, color: 'var(--muted)' }}>{f.description}</div>}
            <div style={{ marginTop: 2 }}>
              cursor: ({Math.round(f.cursorX)}, {Math.round(f.cursorY)})
            </div>
            {f.clickType && <div style={{ color: 'var(--yellow)', marginTop: 2 }}>{f.clickType}</div>}
          </div>
        ))}
      </div>
      <p className="muted mt-8" style={{ fontSize: '0.8rem' }}>
        {/* TODO: render actual frame images from storage */}
        Frame images shown as placeholders — replace with real extracted frames.
      </p>
    </div>
  );
}
