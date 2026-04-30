import Link from 'next/link';

function getSteps() {
  return [
  {
    n: '1',
    title: 'Launch Debugr',
    body: 'Debugr runs in the background and is ready when you need it.',
    panel: (
      <div style={mockBoard}>
        <div style={macBar}>
          <span style={dot('#ef4444')} />
          <span style={dot('#f59e0b')} />
          <span style={dot('#22c55e')} />
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10, color: '#334155', fontSize: 12 }}>
            <span style={pill}>dmg</span>
            <span>Tue 2:25 PM</span>
          </div>
        </div>
        <div style={launchCanvas}>
          <div style={menuCard}>
            <div style={menuItem(true)}>New Annotation <span style={shortcut}>⌥⌘A</span></div>
            <div style={menuItem()}>Sessions <span style={shortcut}>⌘J</span></div>
            <div style={menuItem()}>Settings <span style={chev}>›</span></div>
            <div style={menuItem()}>What&apos;s New</div>
            <div style={menuItem()}>Quit Debugr</div>
          </div>
          <div style={statusCard}>
            <div style={statusBadge}>dmg</div>
            <div style={{ fontSize: 15, fontWeight: 700, marginTop: 14 }}>Debugr is running</div>
            <div style={{ color: '#475569', marginTop: 6, fontSize: 12.5 }}>Press <strong>⌥⌘A</strong> to annotate</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 18, color: '#16a34a', fontSize: 12 }}>
              <span style={greenDot} /> Active
            </div>
          </div>
        </div>
      </div>
    ),
  },
  {
    n: '2',
    title: 'Trigger annotation with a shortcut',
    body: 'Press \u2318\u2325A from anywhere to start annotating your screen.',
    panel: (
      <div style={mockBoard}>
        <div style={githubHeader}>
          <span style={octo} />
          <span>acme / project</span>
        </div>
        <div style={githubTabs}>
          {['Code', 'Issues', 'Pull requests', 'Actions', 'Security', 'Insights'].map((item, idx) => (
            <span key={item} style={{ ...tabItem, ...(idx === 2 ? tabActive : {}) }}>{item}</span>
          ))}
        </div>
        <div style={repoTitle}>Onboarding flow</div>
        <div style={repoList}>
          <div style={repoRow}><span>README.md</span><span>Update onboarding docs</span><span>2h ago</span></div>
          <div style={repoRow}><span>src/</span><span>Fix analytics event</span><span>5h ago</span></div>
          <div style={repoRow}><span>package.json</span><span>Bump deps</span><span>yesterday</span></div>
        </div>
        <div style={shortcutChip}><span>⌥</span><span>⌘</span><span>A</span></div>
      </div>
    ),
  },
  {
    n: '3',
    title: 'Click to annotate',
    body: 'Click or drag to highlight anything. Add optional notes.',
    panel: (
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 260px', gap: 12, alignItems: 'stretch' }}>
        <div style={mockBoard}>
          <div style={githubHeader}>
            <span style={octo} />
            <span>acme / project</span>
          </div>
          <div style={githubTabs}>
            {['Code', 'Issues', 'Pull requests', 'Actions'].map((item, idx) => (
              <span key={item} style={{ ...tabItem, ...(idx === 2 ? tabActive : {}) }}>{item}</span>
            ))}
          </div>
          <div style={repoTitle}>Onboarding flow</div>
          <div style={selectionFrame}>
            <div style={selectionNote}>The onboarding flow is breaking for users who skip setup.</div>
            <div style={bubble}>1</div>
          </div>
          <div style={toolbar}>
            {['Select', 'Arrow', 'Text', 'Rectangle', 'Blur'].map((item, idx) => (
              <span key={item} style={{ ...toolbarItem, ...(idx === 2 ? toolbarActive : {}) }}>{item}</span>
            ))}
          </div>
        </div>
        <div style={annotationPanel}>
          <div style={panelTitle}>Annotation</div>
          <div style={noteCard}>The onboarding flow is breaking for users who skip setup.</div>
          <div style={metaRow}><span>120 / 250</span></div>
          <div style={panelSub}>Options</div>
          <div style={tagRow}>
            {['bug', 'onboarding'].map((tag) => <span key={tag} style={tagPill}>{tag}</span>)}
            <span style={tagPlus}>+</span>
          </div>
          <div style={panelSub}>Add to session</div>
          <div style={selectMock}>Onboarding flow bug <span>▾</span></div>
          <div style={primaryButton}>Save Annotation</div>
        </div>
      </div>
    ),
  },
  {
    n: '4',
    title: 'Annotations are saved to your session',
    body: 'Every annotation is captured with context and added to the current session.',
    panel: (
      <div style={sessionShell}>
        <div style={sessionSidebar}>
          <div style={{ color: '#64748b', fontSize: 12, fontWeight: 700, marginBottom: 10 }}>Sessions</div>
          <div style={sessionListItem(true)}>Onboarding flow bug</div>
          <div style={sessionListItem()}>API error on save</div>
          <div style={sessionListItem()}>Settings confusion</div>
          <div style={{ marginTop: 14, color: '#2563eb', fontSize: 12, fontWeight: 700 }}>View all sessions →</div>
        </div>
        <div style={sessionMain}>
          <div style={sessionHeader}>
            <div>
              <div style={{ fontSize: 17, fontWeight: 700 }}>Onboarding flow bug</div>
              <div style={{ color: '#64748b', fontSize: 12.5 }}>3 annotations · acme / project</div>
            </div>
            <div style={newCapture}>+ New Capture</div>
          </div>
          <div style={captureList}>
            {['The onboarding flow is breaking for users who skip setup.', 'Console shows undefined error in UserSettings.tsx', 'Confusing fallback state when no workspace exists'].map((txt, idx) => (
              <div key={txt} style={captureRow}>
                <div style={captureIndex}>{idx + 1}</div>
                <div style={captureThumb} />
                <div style={{ flex: 1 }}>
                  <div style={{ fontWeight: 600 }}>{txt}</div>
                  <div style={{ color: '#64748b', fontSize: 12 }}>Today, 2:{26 + idx} PM</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    ),
  },
  {
    n: '5',
    title: 'Submit to Claude or Codex',
    body: 'Send your session, context, and annotations for AI-powered feedback.',
    panel: (
      <div style={sharePanel}>
        <div style={shareHead}>Share feedback</div>
        <div style={sessionPreview}>
          <div style={previewThumb} />
          <div>
            <div style={{ fontWeight: 600 }}>Onboarding flow bug</div>
            <div style={{ color: '#64748b', fontSize: 12 }}>3 annotations · Today, 2:26 PM</div>
          </div>
        </div>
        <div style={{ color: '#64748b', fontSize: 12, fontWeight: 700, marginTop: 14, marginBottom: 10 }}>Send to</div>
        <div style={targetGrid}>
          <div style={targetCard}><span style={targetLogo('#f97316')}>✺</span><div><strong>Claude</strong><div>AI assistant</div></div></div>
          <div style={{ ...targetCard, borderColor: '#2563eb' }}><span style={targetLogo('#111827')}>⬡</span><div><strong>Codex</strong><div>Code agent</div></div></div>
        </div>
        <div style={{ color: '#64748b', fontSize: 12, fontWeight: 700, marginTop: 14, marginBottom: 10 }}>Include additional context</div>
        <div style={checkList}>
          <label><input type="checkbox" defaultChecked /> Console logs</label>
          <label><input type="checkbox" defaultChecked /> Network logs</label>
          <label><input type="checkbox" defaultChecked /> Environment info</label>
        </div>
        <div style={primaryButton}>Send to Codex</div>
      </div>
    ),
  },
  {
    n: '6',
    title: 'Get AI feedback and next steps',
    body: 'Receive analysis, suggestions, and actionable fixes.',
    panel: (
      <div style={feedbackShell}>
        <div style={feedbackTop}>
          <div>
            <div style={{ fontSize: 17, fontWeight: 700 }}>Onboarding flow bug</div>
            <div style={{ color: '#16a34a', fontSize: 12, fontWeight: 700, marginTop: 4 }}>✓ Responded</div>
          </div>
          <div style={newCapture}>+ New Capture</div>
        </div>
        <div style={conversationTabs}><span style={{ color: '#2563eb', borderBottom: '2px solid #2563eb', paddingBottom: 6 }}>Conversation</span><span>Details</span></div>
        <div style={chatBubbleStyle(true)}>You sent this session to Codex.</div>
        <div style={chatBubbleStyle(false)}>Thanks for the detailed report and screenshots. The issue is caused by skipped setup leaving user preferences undefined.</div>
        <div style={codePanel}>
          <div style={{ color: '#64748b', fontSize: 12, fontWeight: 700, marginBottom: 8 }}>Suggested fix</div>
          <pre style={{ margin: 0, fontSize: 12, lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{`const prefs = user.preferences.setup ?? {}
if (!prefs) return <SetupWizard />`}</pre>
        </div>
        <div style={replyBar}>Reply to Codex...</div>
      </div>
    ),
  },
  ];
}

export default function HomePage() {
  return (
    <main style={page}>
      <section style={hero}>
        <div style={eyebrow}>debugr.ai · macOS feedback capture</div>
        <h1 style={title}>Capture the moment, launch the bridge, and hand it to Claude or Codex.</h1>
        <p style={lede}>
          The flow below is the actual product path: Debugr sits in the background, the shortcut opens annotation, sessions save locally, and the bridge launcher now opens a real MCP server or background relay instead of a fake handshake.
        </p>
        <div style={ctaRow}>
          <Link href="/sessions" style={primaryCta}>Open Sessions</Link>
          <span style={secondaryCta}>Shortcut: ⌥⌘A</span>
        </div>
      </section>

      <section style={grid}>
        {getSteps().map((step) => (
          <article key={step.n} style={card}>
            <div style={stepHeader}>
              <span style={stepBadge}>{step.n}</span>
              <div>
                <h2 style={stepTitle}>{step.title}</h2>
                <p style={stepBody}>{step.body}</p>
              </div>
            </div>
            {step.panel}
          </article>
        ))}
      </section>

      <section style={footerGrid}>
        <div style={footerCard}>
          <div style={footerTitle}>Always one shortcut away</div>
          <p style={footerText}>Launch Debugr once, then use the global shortcut to start a session from anywhere.</p>
        </div>
        <div style={footerCard}>
          <div style={footerTitle}>Bridge options are real</div>
          <p style={footerText}>The MCP server opens in Terminal, and the background relay runs as an actual helper process.</p>
        </div>
        <div style={footerCard}>
          <div style={footerTitle}>Your data stays local</div>
          <p style={footerText}>Sessions save to the local API and can be reviewed in the dashboard at any time.</p>
        </div>
      </section>
    </main>
  );
}

const page = {
  minHeight: '100vh',
  background: 'linear-gradient(180deg, #ffffff 0%, #f7fafc 100%)',
  color: '#0f172a',
  padding: '24px 20px 40px',
};

const hero = {
  maxWidth: 1260,
  margin: '0 auto 28px',
};

const eyebrow = {
  fontSize: 12,
  fontWeight: 800,
  letterSpacing: '0.08em',
  textTransform: 'uppercase' as const,
  color: '#2563eb',
  marginBottom: 10,
};

const title = {
  fontSize: 'clamp(32px, 4vw, 52px)',
  lineHeight: 1.02,
  letterSpacing: 0,
  maxWidth: 920,
  margin: 0,
};

const lede = {
  maxWidth: 760,
  marginTop: 14,
  color: '#475569',
  fontSize: 16,
  lineHeight: 1.7,
};

const ctaRow = {
  display: 'flex',
  gap: 12,
  alignItems: 'center',
  marginTop: 20,
  flexWrap: 'wrap' as const,
};

const primaryCta = {
  padding: '12px 16px',
  borderRadius: 12,
  background: '#2563eb',
  color: '#fff',
  fontWeight: 700,
  textDecoration: 'none',
};

const secondaryCta = {
  padding: '12px 16px',
  borderRadius: 12,
  border: '1px solid #dbe4f0',
  background: '#fff',
  color: '#334155',
  fontWeight: 700,
};

const grid = {
  maxWidth: 1260,
  margin: '0 auto',
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
  gap: 18,
};

const card = {
  border: '1px solid #e2e8f0',
  borderRadius: 18,
  background: '#fff',
  padding: 16,
  boxShadow: '0 8px 30px rgba(15, 23, 42, 0.05)',
};

const stepHeader = {
  display: 'flex',
  gap: 12,
  alignItems: 'flex-start',
  marginBottom: 12,
};

const stepBadge = {
  width: 28,
  height: 28,
  borderRadius: 999,
  display: 'inline-grid',
  placeItems: 'center',
  background: '#2563eb',
  color: '#fff',
  fontWeight: 800,
  flex: '0 0 auto',
};

const stepTitle = { margin: 0, fontSize: 18, lineHeight: 1.1, letterSpacing: 0 };
const stepBody = { margin: '4px 0 0', color: '#475569', lineHeight: 1.55, fontSize: 13.5 };

const mockBoard = {
  position: 'relative' as const,
  border: '1px solid #dbe4f0',
  borderRadius: 12,
  background: 'linear-gradient(180deg, #fff 0%, #f8fbff 100%)',
  overflow: 'hidden',
  minHeight: 260,
};

const macBar = {
  display: 'flex',
  alignItems: 'center',
  gap: 6,
  padding: '8px 10px',
  borderBottom: '1px solid #e2e8f0',
  background: '#f8fafc',
};

const launchCanvas = {
  position: 'relative' as const,
  minHeight: 220,
  padding: 18,
  background: 'linear-gradient(135deg, #3b82f6 0%, #1e40af 100%)',
};

const menuCard = {
  position: 'absolute' as const,
  top: 12,
  left: 64,
  width: 172,
  borderRadius: 14,
  background: '#fff',
  boxShadow: '0 18px 40px rgba(15, 23, 42, 0.18)',
  padding: 8,
  fontSize: 13,
};

const statusCard = {
  position: 'absolute' as const,
  right: 16,
  bottom: 16,
  width: 132,
  borderRadius: 14,
  background: '#fff',
  boxShadow: '0 16px 40px rgba(15, 23, 42, 0.18)',
  padding: 16,
  textAlign: 'center' as const,
};

const statusBadge = {
  width: 46,
  height: 46,
  borderRadius: 12,
  margin: '0 auto',
  background: '#2563eb',
  color: '#fff',
  fontSize: 14,
  fontWeight: 800,
  display: 'grid',
  placeItems: 'center',
};

function menuItem(active = false) {
  return {
    display: 'flex',
    justifyContent: 'space-between',
    padding: '8px 10px',
    borderRadius: 10,
    background: active ? '#eff6ff' : 'transparent',
    fontWeight: active ? 600 : 500,
    color: '#0f172a',
  } as const;
}

const shortcut = {
  color: '#334155',
  fontSize: 12,
  letterSpacing: 0,
};

const chev = { color: '#94a3b8' };
const pill = {
  padding: '3px 8px',
  borderRadius: 999,
  background: '#2563eb',
  color: '#fff',
  fontSize: 11,
  fontWeight: 800,
};
const dot = (c: string) => ({ width: 10, height: 10, borderRadius: 999, background: c });
const greenDot = { width: 8, height: 8, borderRadius: 999, background: '#22c55e' };

const githubHeader = {
  display: 'flex',
  alignItems: 'center',
  gap: 8,
  padding: '10px 12px 0',
  fontSize: 13,
  color: '#334155',
};
const octo = { width: 14, height: 14, borderRadius: 999, background: '#111827' };
const githubTabs = {
  display: 'flex',
  gap: 12,
  padding: '10px 12px',
  borderBottom: '1px solid #e2e8f0',
  fontSize: 12,
  color: '#64748b',
  flexWrap: 'wrap' as const,
};
const tabItem = { paddingBottom: 8 };
const tabActive = { color: '#2563eb', borderBottom: '2px solid #2563eb' };
const repoTitle = { padding: '14px 12px 10px', fontSize: 18, fontWeight: 700 };
const repoList = {
  margin: '0 12px',
  border: '1px solid #e2e8f0',
  borderRadius: 10,
  overflow: 'hidden',
};
const repoRow = {
  display: 'grid',
  gridTemplateColumns: '120px 1fr 68px',
  gap: 8,
  padding: '10px 12px',
  background: '#fff',
  borderBottom: '1px solid #eef2f7',
  fontSize: 12,
};
const shortcutChip = {
  position: 'absolute' as const,
  right: 14,
  top: 16,
  display: 'flex',
  gap: 6,
  padding: '10px 14px',
  borderRadius: 12,
  background: '#111827',
  color: '#fff',
  boxShadow: '0 12px 30px rgba(15, 23, 42, 0.18)',
};

const selectionFrame = {
  position: 'absolute' as const,
  left: 86,
  right: 34,
  top: 92,
  height: 86,
  borderRadius: 12,
  border: '2px solid #2563eb',
};
const selectionNote = {
  position: 'absolute' as const,
  right: 42,
  top: -34,
  maxWidth: 220,
  padding: '12px 14px',
  borderRadius: 12,
  border: '1px solid #93c5fd',
  background: '#fff',
  boxShadow: '0 14px 30px rgba(59, 130, 246, 0.12)',
  fontSize: 12.5,
};
const bubble = {
  position: 'absolute' as const,
  right: -8,
  top: -12,
  width: 24,
  height: 24,
  borderRadius: 999,
  display: 'grid',
  placeItems: 'center',
  background: '#2563eb',
  color: '#fff',
  fontSize: 11,
  fontWeight: 800,
};
const toolbar = {
  position: 'absolute' as const,
  left: '50%',
  bottom: 16,
  transform: 'translateX(-50%)',
  display: 'flex',
  gap: 8,
  padding: 8,
  borderRadius: 16,
  background: '#111827',
  color: '#fff',
  boxShadow: '0 16px 34px rgba(15, 23, 42, 0.24)',
};
const toolbarItem = {
  padding: '9px 12px',
  borderRadius: 12,
  background: 'transparent',
  fontSize: 12,
};
const toolbarActive = { background: '#2563eb' };
const annotationPanel = {
  border: '1px solid #e2e8f0',
  borderRadius: 12,
  background: '#fff',
  padding: 14,
};
const panelTitle = { fontSize: 13, fontWeight: 700, marginBottom: 10 };
const noteCard = {
  minHeight: 92,
  border: '1px solid #dbe4f0',
  borderRadius: 10,
  background: '#f8fafc',
  padding: 12,
  lineHeight: 1.5,
  fontSize: 13,
};
const metaRow = { display: 'flex', justifyContent: 'flex-end', color: '#94a3b8', fontSize: 11, marginTop: 8 };
const panelSub = { marginTop: 14, marginBottom: 8, color: '#64748b', fontSize: 12, fontWeight: 700 };
const tagRow = { display: 'flex', gap: 8, flexWrap: 'wrap' as const, alignItems: 'center' };
const tagPill = {
  padding: '6px 10px',
  borderRadius: 999,
  background: '#eff6ff',
  color: '#1d4ed8',
  fontSize: 12,
  fontWeight: 700,
};
const tagPlus = {
  width: 28,
  height: 28,
  borderRadius: 999,
  display: 'grid',
  placeItems: 'center',
  background: '#f1f5f9',
  color: '#475569',
  fontWeight: 800,
};
const selectMock = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  padding: '10px 12px',
  borderRadius: 10,
  border: '1px solid #dbe4f0',
  background: '#fff',
  fontSize: 13,
};
const primaryButton = {
  marginTop: 14,
  padding: '12px 14px',
  borderRadius: 12,
  background: '#2563eb',
  color: '#fff',
  textAlign: 'center' as const,
  fontWeight: 700,
};

const sessionShell = {
  display: 'grid',
  gridTemplateColumns: '180px 1fr',
  gap: 12,
  minHeight: 260,
  borderRadius: 12,
  border: '1px solid #dbe4f0',
  overflow: 'hidden',
};
const sessionSidebar = {
  background: '#f8fafc',
  padding: 14,
  borderRight: '1px solid #e2e8f0',
};
const sessionListItem = (active = false) => ({
  padding: '9px 10px',
  borderRadius: 10,
  marginBottom: 6,
  background: active ? '#dbeafe' : '#fff',
  border: '1px solid #e2e8f0',
  fontSize: 12.5,
  fontWeight: active ? 700 : 600,
  color: '#0f172a',
});
const sessionMain = { padding: 14, background: '#fff' };
const sessionHeader = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: 12,
};
const newCapture = {
  padding: '8px 10px',
  borderRadius: 10,
  background: '#2563eb',
  color: '#fff',
  fontWeight: 700,
  fontSize: 12,
};
const captureList = { display: 'grid', gap: 10 };
const captureRow = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: 10,
  borderRadius: 12,
  border: '1px solid #e2e8f0',
  background: '#fff',
};
const captureIndex = {
  width: 22,
  height: 22,
  borderRadius: 999,
  display: 'grid',
  placeItems: 'center',
  background: '#2563eb',
  color: '#fff',
  fontSize: 12,
  fontWeight: 800,
};
const captureThumb = {
  width: 74,
  height: 48,
  borderRadius: 8,
  background: 'linear-gradient(135deg, #bfdbfe 0%, #e0f2fe 100%)',
  border: '1px solid #dbe4f0',
};

const sharePanel = {
  border: '1px solid #dbe4f0',
  borderRadius: 12,
  background: '#fff',
  padding: 14,
};
const shareHead = { fontSize: 15, fontWeight: 700, marginBottom: 12 };
const sessionPreview = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: 12,
  borderRadius: 12,
  border: '1px solid #e2e8f0',
  background: '#f8fafc',
};
const previewThumb = {
  width: 72,
  height: 42,
  borderRadius: 8,
  background: 'linear-gradient(135deg, #e0e7ff 0%, #f8fafc 100%)',
  border: '1px solid #dbe4f0',
};
const targetGrid = { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 };
const targetCard = {
  display: 'flex',
  alignItems: 'center',
  gap: 10,
  padding: 12,
  borderRadius: 12,
  border: '1px solid #dbe4f0',
  background: '#fff',
  minHeight: 72,
};
const targetLogo = (bg: string) => ({
  width: 36,
  height: 36,
  borderRadius: 12,
  display: 'grid',
  placeItems: 'center',
  background: bg,
  color: '#fff',
  fontWeight: 800,
});
const checkList = {
  display: 'grid',
  gap: 8,
  color: '#334155',
  fontSize: 13,
};

const feedbackShell = {
  border: '1px solid #dbe4f0',
  borderRadius: 12,
  background: '#fff',
  padding: 14,
};
const feedbackTop = {
  display: 'flex',
  justifyContent: 'space-between',
  alignItems: 'center',
  marginBottom: 12,
};
const conversationTabs = {
  display: 'flex',
  gap: 14,
  color: '#64748b',
  fontSize: 12.5,
  marginBottom: 12,
};
function chatBubbleStyle(isUser: boolean) {
  return {
    padding: '12px 14px',
    borderRadius: 12,
    marginBottom: 10,
    background: isUser ? '#eff6ff' : '#f8fafc',
    border: '1px solid #dbe4f0',
    color: '#0f172a',
    fontSize: 13,
    lineHeight: 1.6,
  } as const;
}
const codePanel = {
  border: '1px solid #dbe4f0',
  borderRadius: 12,
  background: '#f8fafc',
  padding: 12,
  marginBottom: 10,
};
const replyBar = {
  padding: '11px 12px',
  borderRadius: 999,
  border: '1px solid #dbe4f0',
  background: '#fff',
  color: '#94a3b8',
  fontSize: 13,
};

const footerGrid = {
  maxWidth: 1260,
  margin: '18px auto 0',
  display: 'grid',
  gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))',
  gap: 16,
};
const footerCard = {
  padding: 18,
  borderRadius: 16,
  border: '1px solid #e2e8f0',
  background: '#fff',
};
const footerTitle = { fontWeight: 800, marginBottom: 8 };
const footerText = { color: '#475569', fontSize: 13, lineHeight: 1.7, margin: 0 };
