import Link from 'next/link';

export default function HomePage() {
  return (
    <main style={{ maxWidth: 1200, margin: '0 auto', padding: '60px 24px', textAlign: 'center' }}>
      <h1 style={{ fontSize: '2.5rem', marginBottom: 16 }}>debugr.ai</h1>
      <p style={{ fontSize: '1.1rem', color: '#666', marginBottom: 32 }}>
        Open the Mac app, capture the right screen, confirm the linked repo context, and get feedback back from Claude or Codex
      </p>

      <div style={{ display: 'flex', gap: 16, justifyContent: 'center', flexWrap: 'wrap', marginBottom: 48 }}>
        <Link href="/sessions" className="btn btn-primary" style={{ padding: '12px 32px', fontSize: '1rem' }}>
          → Go to Sessions
        </Link>
      </div>

      <div style={{ background: '#f0f9ff', padding: 32, borderRadius: 8, maxWidth: 600, margin: '0 auto' }}>
        <h2 style={{ marginBottom: 16, fontSize: '1.2rem' }}>How It Works</h2>
        <ol style={{ textAlign: 'left', lineHeight: 2, color: '#555' }}>
          <li><strong>Open the DMG App:</strong> Start Debugr directly on macOS</li>
          <li><strong>Point It at the Work:</strong> Open a browser page or capture another app or experience on screen</li>
          <li><strong>Freeze the Screenshot:</strong> Confirm the exact view in the macOS picker and take the capture</li>
          <li><strong>Confirm Context:</strong> Verify the screenshot belongs to your Claude or Codex work and linked GitHub repo</li>
          <li><strong>Submit and Review:</strong> Send to Claude or Codex and read the immediate feedback response</li>
        </ol>
      </div>
    </main>
  );
}
