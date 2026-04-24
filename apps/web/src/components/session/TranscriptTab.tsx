'use client';

interface Props {
  transcript?: string | null;
}

export function TranscriptTab({ transcript }: Props) {
  if (!transcript) {
    return <p className="muted">No transcript yet. Processing may still be running.</p>;
  }
  return (
    <div className="card">
      <pre className="pre">{transcript}</pre>
    </div>
  );
}
