import Link from 'next/link';

export default function HomePage() {
  return (
    <main style={{ maxWidth: 1200, margin: '0 auto', padding: '60px 24px', textAlign: 'center' }}>
      <h1 style={{ fontSize: '2.5rem', marginBottom: 16 }}>🐛 FeedbackAgent</h1>
      <p style={{ fontSize: '1.1rem', color: '#666', marginBottom: 32 }}>
        Record screen issues with annotated notes and send to Claude Code for automatic fixes
      </p>

      <div style={{ display: 'flex', gap: 16, justifyContent: 'center', flexWrap: 'wrap', marginBottom: 48 }}>
        <Link href="/sessions" className="btn btn-primary" style={{ padding: '12px 32px', fontSize: '1rem' }}>
          → Go to Sessions
        </Link>
      </div>

      <div style={{ background: '#f0f9ff', padding: 32, borderRadius: 8, maxWidth: 600, margin: '0 auto' }}>
        <h2 style={{ marginBottom: 16, fontSize: '1.2rem' }}>How It Works</h2>
        <ol style={{ textAlign: 'left', lineHeight: 2, color: '#555' }}>
          <li><strong>Create Session:</strong> Give your debug report a title</li>
          <li><strong>Record Screen:</strong> Full-screen recording opens in new tab (Tab A)</li>
          <li><strong>Annotate Issues:</strong> Right-click to draw boxes, add text or voice notes (max 5)</li>
          <li><strong>Review Notes:</strong> Summary page shows coordinates and all annotations</li>
          <li><strong>Send to Claude:</strong> Claude Code generates code fixes automatically</li>
        </ol>
      </div>
    </main>
  );
}
