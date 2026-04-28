'use client';

import { Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useSearchParams } from 'next/navigation';
import { api } from '@/lib/api';
import { buildOverlayBookmarklet, type OverlayTarget } from '@/lib/overlayBookmarklet';

function LaunchOverlayPageInner() {
  const { id } = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const [sessionTitle, setSessionTitle] = useState('Debug session');
  const [copied, setCopied] = useState(false);
  const [copiedLauncher, setCopiedLauncher] = useState(false);

  const targetUrl = searchParams.get('url') ?? '';
  const handoffTarget = (searchParams.get('target') === 'codex' ? 'codex' : 'claude') as OverlayTarget;
  const webOrigin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';

  useEffect(() => {
    async function loadSession() {
      try {
        const session = await api.sessions.get(id);
        setSessionTitle(session.title);
      } catch (error) {
        console.error('[launch] failed to load session', error);
      }
    }

    void loadSession();
  }, [id]);

  const bookmarkletHref = useMemo(
    () =>
      buildOverlayBookmarklet({
        webOrigin,
        sessionId: id,
        title: sessionTitle,
        target: handoffTarget,
      }),
    [handoffTarget, id, sessionTitle, webOrigin],
  );

  const targetLabel = handoffTarget === 'codex' ? 'Codex' : 'Claude';

  return (
    <main style={{ maxWidth: 960, margin: '0 auto', padding: '32px 24px 72px' }}>
      <Link href="/sessions" className="muted" style={{ fontSize: '0.875rem' }}>
        ← Back to Sessions
      </Link>

      <div style={{ marginTop: 18, marginBottom: 28 }}>
        <div style={{ fontSize: '0.82rem', fontWeight: 800, color: '#818cf8', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>
          Overlay Launch
        </div>
        <h1 style={{ margin: 0, fontSize: '2.5rem' }}>Annotate on the real page</h1>
        <p style={{ fontSize: '1rem', color: '#94a3b8', lineHeight: 1.7, maxWidth: 760, marginTop: 14 }}>
          This session is ready. If the FeedbackAgent extension is installed, opening the target page will auto-show annotation controls.
          If not, use the bookmarklet fallback below. Then add up to 5 boxes with typed or transcribed voice notes and submit straight to {targetLabel}.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1.15fr 0.85fr', gap: 20, alignItems: 'start' }}>
        <section
          style={{
            background: '#0f172a',
            border: '1px solid #1e293b',
            borderRadius: 20,
            padding: 24,
            boxShadow: '0 20px 60px rgba(2, 6, 23, 0.35)',
          }}
        >
          <div style={{ display: 'grid', gap: 18 }}>
            {[
              {
                step: '1',
                title: 'Open the page you want to debug',
                body: 'Use the button below to open the exact product page in a fresh tab. If the tab is already open, just switch to it.',
              },
              {
                step: '2',
                title: 'Controls appear automatically (extension mode)',
                body: 'With the extension installed, this tab is auto-matched and the overlay appears without clicking bookmarklets.',
              },
              {
                step: '3',
                title: 'Annotate, submit, and review updates',
                body: `Draw or snap boxes on the real page, attach your notes, then submit. You will land on the summary page and see the ${targetLabel} handoff status and next steps.`,
              },
            ].map((item) => (
              <div
                key={item.step}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '52px 1fr',
                  gap: 14,
                  padding: '16px 18px',
                  borderRadius: 16,
                  background: '#111c34',
                  border: '1px solid #22314e',
                }}
              >
                <div
                  style={{
                    width: 52,
                    height: 52,
                    borderRadius: 14,
                    background: '#312e81',
                    color: '#eef2ff',
                    display: 'grid',
                    placeItems: 'center',
                    fontWeight: 900,
                    fontSize: '1rem',
                  }}
                >
                  {item.step}
                </div>
                <div>
                  <div style={{ color: '#f8fafc', fontWeight: 800, fontSize: '1rem', marginBottom: 6 }}>{item.title}</div>
                  <div style={{ color: '#94a3b8', lineHeight: 1.65, fontSize: '0.92rem' }}>{item.body}</div>
                </div>
              </div>
            ))}
          </div>

          <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', marginTop: 22 }}>
            <button
              className="btn btn-primary"
              onClick={() => window.open(targetUrl, '_blank', 'noopener,noreferrer')}
              style={{ paddingInline: 20 }}
            >
              Open Target Page
            </button>
            <button
              className="btn btn-ghost"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(targetUrl);
                  setCopied(true);
                  window.setTimeout(() => setCopied(false), 1800);
                } catch (error) {
                  console.error('[launch] copy failed', error);
                }
              }}
            >
              {copied ? 'Copied URL' : 'Copy Target URL'}
            </button>
          </div>
        </section>

        <aside
          style={{
            background: '#f8fafc',
            border: '1px solid #dbe4f0',
            borderRadius: 20,
            padding: 24,
            color: '#0f172a',
          }}
        >
          <div style={{ fontSize: '0.78rem', fontWeight: 800, color: '#4f46e5', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 10 }}>
            Fallback Launcher (v2)
          </div>
          <div style={{ fontSize: '1.15rem', fontWeight: 800, marginBottom: 8 }}>FeedbackAgent Overlay</div>
          <p style={{ margin: 0, fontSize: '0.92rem', color: '#475569', lineHeight: 1.7 }}>
            Use this only if extension auto-mode is not installed. Copy the launcher URL, then create a bookmark manually and click it from the target page tab.
            It is already configured for this session and will send the finished report to {targetLabel}.
          </p>

          <button
            type="button"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(bookmarkletHref);
                setCopiedLauncher(true);
                window.setTimeout(() => setCopiedLauncher(false), 1800);
              } catch (error) {
                console.error('[launch] bookmarklet copy failed', error);
              }
            }}
            style={{
              marginTop: 18,
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              padding: '14px 18px',
              borderRadius: 14,
              background: copiedLauncher ? '#059669' : '#eef2ff',
              color: copiedLauncher ? '#f8fafc' : '#312e81',
              textDecoration: 'none',
              fontWeight: 800,
              fontSize: '0.95rem',
              border: '1.5px solid #818cf8',
              cursor: 'pointer',
              userSelect: 'none',
              width: '100%',
            }}
            title="Copy the bookmarklet URL to your clipboard"
          >
            {copiedLauncher ? '✓ Copied launcher URL' : '📋 Copy FeedbackAgent Overlay v2'}
          </button>

          <div style={{ marginTop: 10, fontSize: '0.8rem', color: '#64748b', lineHeight: 1.7 }}>
            1. Create a new bookmark named <code>⬡ FeedbackAgent Overlay</code>.
            <br />
            2. Paste the copied launcher URL into the bookmark's URL field.
            <br />
            3. If an older bookmark exists, delete it first so only the new launcher remains.
          </div>

          <div style={{ marginTop: 16, padding: '12px 14px', borderRadius: 12, background: '#eff6ff', border: '1px solid #bfdbfe', color: '#1e3a8a', fontSize: '0.82rem', lineHeight: 1.6 }}>
            Auto mode install (one-time): open <code>chrome://extensions</code> → Developer mode ON → Load unpacked →
            <code>/Users/kumar/debugr/apps/chrome-extension</code>.
          </div>

          <div style={{ marginTop: 18, padding: '14px 16px', borderRadius: 14, background: '#fff', border: '1px solid #dbe4f0' }}>
            <div style={{ fontSize: '0.78rem', fontWeight: 800, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
              This session
            </div>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>{sessionTitle}</div>
            <div style={{ color: '#475569', fontSize: '0.86rem', lineHeight: 1.6 }}>
              <div>Session ID: <code>{id}</code></div>
              <div>Target page: <code>{targetUrl}</code></div>
              <div>Submit destination: <strong>{targetLabel}</strong></div>
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}

export default function LaunchOverlayPage() {
  return (
    <Suspense fallback={<div style={{ padding: 32, color: '#94a3b8' }}>Loading…</div>}>
      <LaunchOverlayPageInner />
    </Suspense>
  );
}
