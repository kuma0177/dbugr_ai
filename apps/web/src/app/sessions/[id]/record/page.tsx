'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useParams, useSearchParams } from 'next/navigation';
import { buildOverlayBookmarklet } from '@/lib/overlayBookmarklet';

interface Note {
  id: string;
  type: 'voice' | 'text';
  content: string;
  duration?: number;
  timestamp: number;
}

interface Box {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  notes: Note[];
  screenshot?: string;
}

interface SnapRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

type HandoffTarget = 'claude' | 'codex';
type AnnotationMode = 'draw' | 'snap';

interface BrowserSpeechRecognitionResult {
  isFinal: boolean;
  0: { transcript: string };
}

interface BrowserSpeechRecognitionEvent {
  resultIndex: number;
  results: ArrayLike<BrowserSpeechRecognitionResult>;
}

interface BrowserSpeechRecognitionErrorEvent {
  error: string;
}

interface BrowserSpeechRecognition {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: BrowserSpeechRecognitionEvent) => void) | null;
  onerror: ((event: BrowserSpeechRecognitionErrorEvent) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
}

interface BrowserSpeechRecognitionConstructor {
  new (): BrowserSpeechRecognition;
}

const RECENT_URLS_KEY = 'feedbackagent_recent_urls';
const MAX_RECENT = 6;
const QUICK_URLS = ['http://localhost:3000', 'http://localhost:3001', 'http://localhost:5173', 'http://localhost:4200'];

function saveRecentUrl(url: string) {
  try {
    const existing: string[] = JSON.parse(localStorage.getItem(RECENT_URLS_KEY) || '[]');
    localStorage.setItem(
      RECENT_URLS_KEY,
      JSON.stringify([url, ...existing.filter((entry) => entry !== url)].slice(0, MAX_RECENT)),
    );
  } catch {}
}

function getRecentUrls(): string[] {
  try {
    return JSON.parse(localStorage.getItem(RECENT_URLS_KEY) || '[]');
  } catch {
    return [];
  }
}

function looksExternallyHosted(url: string) {
  try {
    const parsed = new URL(url);
    return !['localhost', '127.0.0.1'].includes(parsed.hostname);
  } catch {
    return false;
  }
}

async function captureBoxScreenshot(
  container: HTMLElement,
  box: { x: number; y: number; width: number; height: number },
): Promise<string | undefined> {
  try {
    const { default: html2canvas } = await import('html2canvas');
    const canvas = await html2canvas(container, {
      useCORS: true,
      allowTaint: true,
      logging: false,
      x: box.x,
      y: box.y,
      width: box.width,
      height: box.height,
      windowWidth: container.offsetWidth,
      windowHeight: container.offsetHeight,
    });
    return canvas.toDataURL('image/png');
  } catch {
    return undefined;
  }
}

function RecordPageInner() {
  const { id } = useParams<{ id: string }>();
  const searchParams = useSearchParams();
  const sessionStartTime = useRef(Date.now());
  const overlayRef = useRef<HTMLDivElement>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const speechRecRef = useRef<BrowserSpeechRecognition | null>(null);
  const voiceIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [mode, setMode] = useState<AnnotationMode>('snap');
  const [handoffTarget, setHandoffTarget] = useState<HandoffTarget>('claude');
  const [loadedUrl, setLoadedUrl] = useState('');
  const [urlInput, setUrlInput] = useState('');
  const [recentUrls, setRecentUrls] = useState<string[]>([]);
  const [showUrlEditor, setShowUrlEditor] = useState(false);
  const [showRecentUrls, setShowRecentUrls] = useState(false);
  const [iframeLikelyBlocked, setIframeLikelyBlocked] = useState(false);

  const [boxes, setBoxes] = useState<Box[]>([]);
  const [selectedBoxId, setSelectedBoxId] = useState<string | null>(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null);
  const [currentBox, setCurrentBox] = useState<SnapRect | null>(null);
  const [snapPreview, setSnapPreview] = useState<SnapRect | null>(null);

  const [noteType, setNoteType] = useState<'text' | 'voice'>('text');
  const [noteText, setNoteText] = useState('');
  const [voiceTranscript, setVoiceTranscript] = useState('');
  const [voiceTimer, setVoiceTimer] = useState(0);
  const [isRecordingVoice, setIsRecordingVoice] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [fetchedTitle, setFetchedTitle] = useState('');

  useEffect(() => {
    setRecentUrls(getRecentUrls());
    const initialUrl = searchParams?.get('url') ?? '';
    if (initialUrl) {
      setLoadedUrl(initialUrl);
      setUrlInput(initialUrl);
      saveRecentUrl(initialUrl);
    }
    const targetParam = searchParams?.get('target');
    if (targetParam === 'codex') setHandoffTarget('codex');

    // Fetch session title for the bookmarklet label
    const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';
    fetch(`${API}/feedback-sessions/${id}`)
      .then(r => r.json())
      .then(j => { if (j.data?.title) setFetchedTitle(j.data.title); })
      .catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    return () => {
      if (voiceIntervalRef.current) clearInterval(voiceIntervalRef.current);
      speechRecRef.current?.stop();
    };
  }, []);

  useEffect(() => {
    if (!loadedUrl) {
      setIframeLikelyBlocked(false);
      return;
    }

    setIframeLikelyBlocked(false);

    if (!looksExternallyHosted(loadedUrl)) return;

    const timeout = window.setTimeout(() => {
      setIframeLikelyBlocked(true);
    }, 2500);

    return () => window.clearTimeout(timeout);
  }, [loadedUrl]);

  const selectedBox = boxes.find((box) => box.id === selectedBoxId) ?? null;

  // Session-specific bookmarklet — pre-configured so clicking it on any page
  // activates the overlay for this exact session without a prompt.
  const bookmarkletHref = useMemo(() => {
    const webOrigin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';
    return buildOverlayBookmarklet({ webOrigin, sessionId: id, title: fetchedTitle, target: handoffTarget });
  }, [id, fetchedTitle, handoffTarget]);

  const handleLoad = () => {
    let nextUrl = urlInput.trim();
    if (!nextUrl) return;
    if (!nextUrl.startsWith('http://') && !nextUrl.startsWith('https://')) {
      nextUrl = nextUrl.startsWith('localhost') || nextUrl.startsWith('127.0.0.1') ? `http://${nextUrl}` : `https://${nextUrl}`;
    }
    setLoadedUrl(nextUrl);
    setUrlInput(nextUrl);
    setShowUrlEditor(false);
    setShowRecentUrls(false);
    setIframeLikelyBlocked(false);
    saveRecentUrl(nextUrl);
    setRecentUrls(getRecentUrls());
  };

  const getSnapTarget = useCallback((clientX: number, clientY: number): SnapRect | null => {
    const overlay = overlayRef.current;
    if (!overlay) return null;
    const overlayRect = overlay.getBoundingClientRect();

    overlay.style.pointerEvents = 'none';
    const element = document.elementFromPoint(clientX, clientY);
    overlay.style.pointerEvents = '';

    if (!element) return null;

    if (element.tagName === 'IFRAME') {
      const iframe = element as HTMLIFrameElement;
      try {
        const iframeRect = iframe.getBoundingClientRect();
        const innerElement = iframe.contentDocument?.elementFromPoint(clientX - iframeRect.left, clientY - iframeRect.top);
        if (innerElement && innerElement.tagName !== 'HTML' && innerElement.tagName !== 'BODY') {
          const rect = innerElement.getBoundingClientRect();
          if (rect.width > 10 && rect.height > 10) {
            return {
              x: rect.left - overlayRect.left,
              y: rect.top - overlayRect.top,
              width: rect.width,
              height: rect.height,
            };
          }
        }
      } catch {}

      return {
        x: clientX - overlayRect.left - 140,
        y: clientY - overlayRect.top - 60,
        width: 280,
        height: 120,
      };
    }

    if (element === overlay || element === document.body || element === document.documentElement) {
      return {
        x: clientX - overlayRect.left - 140,
        y: clientY - overlayRect.top - 60,
        width: 280,
        height: 120,
      };
    }

    const rect = element.getBoundingClientRect();
    if (rect.width < 4 || rect.height < 4) return null;

    return {
      x: rect.left - overlayRect.left,
      y: rect.top - overlayRect.top,
      width: rect.width,
      height: rect.height,
    };
  }, []);

  const finalizeBox = useCallback(async (rect: SnapRect) => {
    if (rect.width < 10 || rect.height < 10) return;
    const newBox: Box = {
      id: `box_${Date.now()}`,
      ...rect,
      notes: [],
    };

    if (previewRef.current) {
      const screenshot = await captureBoxScreenshot(previewRef.current, rect);
      if (screenshot) newBox.screenshot = screenshot;
    }

    setBoxes((prev) => [...prev, newBox]);
    setSelectedBoxId(newBox.id);
    setNoteType('text');
    setNoteText('');
    setVoiceTranscript('');
  }, []);

  const handleMouseDown = (event: React.MouseEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;

    if (mode === 'snap' && snapPreview) {
      if (boxes.length >= 5) {
        alert('Maximum 5 boxes per session');
        return;
      }
      void finalizeBox(snapPreview);
      setSnapPreview(null);
      return;
    }

    if (mode === 'draw') {
      if (boxes.length >= 5) {
        alert('Maximum 5 boxes per session');
        return;
      }
      const rect = overlayRef.current?.getBoundingClientRect();
      if (!rect) return;
      setDrawStart({ x: event.clientX - rect.left, y: event.clientY - rect.top });
      setIsDrawing(true);
    }
  };

  const handleMouseMove = (event: React.MouseEvent<HTMLDivElement>) => {
    if (isDrawing && drawStart) {
      const rect = overlayRef.current?.getBoundingClientRect();
      if (!rect) return;
      const x = event.clientX - rect.left;
      const y = event.clientY - rect.top;
      setCurrentBox({
        x: Math.min(drawStart.x, x),
        y: Math.min(drawStart.y, y),
        width: Math.abs(x - drawStart.x),
        height: Math.abs(y - drawStart.y),
      });
      return;
    }

    if (mode === 'snap') {
      setSnapPreview(getSnapTarget(event.clientX, event.clientY));
    }
  };

  const handleMouseUp = () => {
    if (!isDrawing) return;
    if (currentBox && currentBox.width > 20 && currentBox.height > 20) {
      void finalizeBox(currentBox);
    }
    setIsDrawing(false);
    setDrawStart(null);
    setCurrentBox(null);
  };

  const startVoice = () => {
    const SpeechRecognitionCtor = (
      window as typeof window & {
        SpeechRecognition?: BrowserSpeechRecognitionConstructor;
        webkitSpeechRecognition?: BrowserSpeechRecognitionConstructor;
      }
    ).SpeechRecognition ?? (
      window as typeof window & { webkitSpeechRecognition?: BrowserSpeechRecognitionConstructor }
    ).webkitSpeechRecognition;

    if (!SpeechRecognitionCtor) {
      alert('Speech recognition is not supported in this browser. Use Chrome or Edge, or type your note instead.');
      return;
    }

    const recognizer = new SpeechRecognitionCtor();
    recognizer.continuous = true;
    recognizer.interimResults = true;
    recognizer.lang = 'en-US';

    let finalText = '';

    recognizer.onresult = (event: BrowserSpeechRecognitionEvent) => {
      let interimText = '';
      for (let index = event.resultIndex; index < event.results.length; index++) {
        const transcript = event.results[index][0].transcript;
        if (event.results[index].isFinal) finalText += `${transcript} `;
        else interimText = transcript;
      }
      setVoiceTranscript((finalText + interimText).trim());
    };

    recognizer.onerror = (event: BrowserSpeechRecognitionErrorEvent) => {
      if (event.error !== 'aborted') console.warn('[voice]', event.error);
    };

    recognizer.onend = () => {
      setIsRecordingVoice(false);
      if (voiceIntervalRef.current) clearInterval(voiceIntervalRef.current);
      setVoiceTranscript(finalText.trim());
    };

    speechRecRef.current = recognizer;
    recognizer.start();
    setVoiceTranscript('');
    setVoiceTimer(0);
    setIsRecordingVoice(true);

    let elapsed = 0;
    voiceIntervalRef.current = setInterval(() => {
      elapsed += 1;
      setVoiceTimer(elapsed);
      if (elapsed >= 30) {
        speechRecRef.current?.stop();
      }
    }, 1000);
  };

  const stopVoice = () => {
    speechRecRef.current?.stop();
    setIsRecordingVoice(false);
    if (voiceIntervalRef.current) clearInterval(voiceIntervalRef.current);
  };

  const addNote = (type: 'voice' | 'text', content: string) => {
    if (!selectedBoxId) return;
    const trimmedContent = content.trim();
    if (!trimmedContent) return;
    if (type === 'text' && trimmedContent.length > 1000) {
      alert('Text notes must be 1000 characters or less');
      return;
    }

    const note: Note = {
      id: `note_${Date.now()}`,
      type,
      content: trimmedContent,
      duration: type === 'voice' ? voiceTimer : undefined,
      timestamp: Date.now() - sessionStartTime.current,
    };

    setBoxes((prev) =>
      prev.map((box) => (box.id === selectedBoxId ? { ...box, notes: [...box.notes, note] } : box)),
    );
    setNoteText('');
    setVoiceTranscript('');
    setVoiceTimer(0);
    setNoteType('text');
  };

  const handleSubmit = async () => {
    if (boxes.length === 0) {
      alert('Add at least one annotation box first');
      return;
    }

    setSubmitting(true);
    sessionStorage.setItem(`session_${id}_boxes`, JSON.stringify(boxes));
    sessionStorage.setItem(
      `session_${id}_meta`,
      JSON.stringify({
        loadedUrl,
        viewportWidth: previewRef.current?.offsetWidth ?? 1280,
        viewportHeight: previewRef.current?.offsetHeight ?? 800,
      }),
    );
    window.location.href = `/sessions/${id}/summary?target=${handoffTarget}&autoSend=1`;
  };

  const cursorStyle = mode === 'snap' ? 'pointer' : isDrawing ? 'crosshair' : 'crosshair';

  return (
    <div style={{ height: '100vh', display: 'flex', flexDirection: 'column', background: '#0b0f19', color: '#e5e7eb', overflow: 'hidden', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '10px 16px', background: '#1f2937', borderBottom: '1px solid #334155', flexShrink: 0 }}>
        <div style={{ display: 'flex', background: '#0f172a', borderRadius: 12, padding: 4, gap: 4, border: '1px solid #334155' }}>
          {([
            { key: 'draw', label: '✏️ Draw' },
            { key: 'snap', label: '🔎 Snap' },
          ] as const).map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={() => {
                setMode(option.key);
                setSnapPreview(null);
              }}
              style={{
                padding: '9px 16px',
                borderRadius: 10,
                border: 'none',
                cursor: 'pointer',
                fontSize: 13,
                fontWeight: 700,
                background: mode === option.key ? '#6366f1' : 'transparent',
                color: mode === option.key ? '#fff' : '#94a3b8',
              }}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div style={{ flex: 1, minWidth: 0 }}>
          {!showUrlEditor ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              {loadedUrl ? (
                <>
                  <span style={{ fontSize: 11, color: '#22c55e', fontWeight: 800 }}>● Loaded:</span>
                  <span style={{ fontSize: 12, color: '#cbd5e1', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{loadedUrl}</span>
                  <button
                    type="button"
                    onClick={() => {
                      setShowUrlEditor(true);
                      setUrlInput(loadedUrl);
                    }}
                    style={{ padding: '5px 10px', background: '#334155', color: '#cbd5e1', border: 'none', borderRadius: 8, cursor: 'pointer', fontSize: 12 }}
                  >
                    Change
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowUrlEditor(true)}
                  style={{ padding: '8px 12px', background: 'transparent', color: '#94a3b8', border: '1px dashed #475569', borderRadius: 10, cursor: 'pointer', fontSize: 12 }}
                >
                  Load the page you want to annotate
                </button>
              )}
            </div>
          ) : (
            <div style={{ position: 'relative' }}>
              <div style={{ display: 'flex', borderRadius: 10, overflow: 'hidden', border: '1px solid #6366f1' }}>
                <input
                  autoFocus
                  value={urlInput}
                  onChange={(event) => setUrlInput(event.target.value)}
                  onFocus={() => setShowRecentUrls(true)}
                  onBlur={() => setTimeout(() => setShowRecentUrls(false), 150)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') handleLoad();
                    if (event.key === 'Escape') setShowUrlEditor(false);
                  }}
                  placeholder="http://localhost:3000"
                  style={{ flex: 1, padding: '9px 12px', background: '#0f172a', color: '#f8fafc', fontSize: 13, border: 'none', outline: 'none' }}
                />
                <button type="button" onClick={handleLoad} style={{ padding: '9px 16px', background: '#6366f1', color: '#fff', border: 'none', cursor: 'pointer', fontSize: 13, fontWeight: 700 }}>
                  Load
                </button>
                <button type="button" onClick={() => setShowUrlEditor(false)} style={{ padding: '9px 11px', background: '#334155', color: '#cbd5e1', border: 'none', cursor: 'pointer', fontSize: 14 }}>
                  ✕
                </button>
              </div>
              {showRecentUrls && (
                <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, background: '#111827', border: '1px solid #334155', borderRadius: '0 0 12px 12px', zIndex: 10, marginTop: 2 }}>
                  {[...recentUrls, ...QUICK_URLS.filter((url) => !recentUrls.includes(url))].slice(0, 6).map((url) => (
                    <button
                      key={url}
                      type="button"
                      onMouseDown={() => {
                        setUrlInput(url);
                        setLoadedUrl(url);
                        setShowUrlEditor(false);
                        setIframeLikelyBlocked(false);
                        saveRecentUrl(url);
                        setRecentUrls(getRecentUrls());
                      }}
                      style={{ display: 'block', width: '100%', padding: '8px 12px', background: 'transparent', border: 'none', color: '#cbd5e1', fontSize: 13, textAlign: 'left', cursor: 'pointer' }}
                    >
                      {url}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, color: '#94a3b8', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.08em' }}>Send to</span>
          <div style={{ display: 'flex', background: '#0f172a', borderRadius: 999, padding: 3, border: '1px solid #334155' }}>
            {(['claude', 'codex'] as HandoffTarget[]).map((target) => (
              <button
                key={target}
                type="button"
                onClick={() => setHandoffTarget(target)}
                style={{
                  padding: '7px 14px',
                  borderRadius: 999,
                  border: 'none',
                  background: handoffTarget === target ? '#6366f1' : 'transparent',
                  color: handoffTarget === target ? '#fff' : '#94a3b8',
                  cursor: 'pointer',
                  fontSize: 13,
                  fontWeight: 700,
                }}
              >
                {target === 'claude' ? 'Claude' : 'Codex'}
              </button>
            ))}
          </div>
        </div>

        <div style={{ padding: '8px 14px', background: '#0f172a', borderRadius: 999, border: `1px solid ${boxes.length === 5 ? '#ef4444' : '#334155'}`, color: boxes.length === 5 ? '#fca5a5' : '#cbd5e1', fontSize: 13, fontWeight: 700 }}>
          {boxes.length}/5 boxes
        </div>

        <button
          type="button"
          onClick={handleSubmit}
          disabled={boxes.length === 0 || submitting}
          style={{
            padding: '11px 20px',
            borderRadius: 12,
            border: 'none',
            background: boxes.length === 0 ? '#334155' : '#059669',
            color: '#fff',
            cursor: boxes.length === 0 ? 'not-allowed' : 'pointer',
            fontWeight: 800,
            fontSize: 14,
          }}
        >
          {submitting ? 'Saving and sending...' : `Submit to ${handoffTarget === 'claude' ? 'Claude' : 'Codex'}`}
        </button>
      </div>

      <div style={{ flex: 1, display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 380px', minHeight: 0 }}>
        <div style={{ minWidth: 0, minHeight: 0, padding: 18 }}>
          <div
            ref={previewRef}
            style={{
              height: '100%',
              position: 'relative',
              overflow: 'hidden',
              borderRadius: 18,
              border: '1px solid #334155',
              background: loadedUrl ? '#ffffff' : '#162033',
              boxShadow: '0 24px 64px rgba(2, 6, 23, 0.35)',
            }}
          >
            {!loadedUrl && (
              <div style={{ position: 'absolute', inset: 0, backgroundImage: 'radial-gradient(circle, #334155 1px, transparent 1px)', backgroundSize: '24px 24px' }} />
            )}

            {loadedUrl && (
              <iframe
                ref={iframeRef}
                key={loadedUrl}
                src={loadedUrl}
                style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 'none' }}
                sandbox="allow-same-origin allow-scripts allow-forms allow-popups"
                title="Page being annotated"
                onLoad={() => {
                  if (!looksExternallyHosted(loadedUrl)) {
                    setIframeLikelyBlocked(false);
                  }
                }}
              />
            )}

            {iframeLikelyBlocked && (
              <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', background: 'rgba(15,23,42,0.92)', zIndex: 5 }}>
                <div style={{ width: 'min(560px, calc(100% - 40px))', background: '#fff', color: '#0f172a', borderRadius: 20, boxShadow: '0 30px 80px rgba(0,0,0,0.45)', padding: '28px 30px' }}>
                  <div style={{ fontSize: '0.75rem', fontWeight: 800, color: '#dc2626', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 8 }}>
                    This site blocks embedding
                  </div>
                  <div style={{ fontSize: '1.15rem', fontWeight: 800, marginBottom: 10 }}>
                    {loadedUrl} can't be previewed here
                  </div>
                  <div style={{ fontSize: '0.9rem', color: '#475569', lineHeight: 1.65, marginBottom: 22 }}>
                    Many sites send <code style={{ background: '#f1f5f9', padding: '1px 5px', borderRadius: 4 }}>X-Frame-Options</code> headers that block in-app iframes. Use the 2-step workaround below — it only takes seconds.
                  </div>

                  <div style={{ display: 'grid', gap: 14 }}>
                    {/* Step 1 */}
                    <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', padding: '14px 16px', borderRadius: 12, background: '#f8fafc', border: '1px solid #e2e8f0' }}>
                      <div style={{ width: 32, height: 32, borderRadius: 8, background: '#312e81', color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 14, flexShrink: 0 }}>1</div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 700, marginBottom: 6 }}>Drag this to your bookmarks bar</div>
                        <a
                          href={bookmarkletHref}
                          onClick={e => e.preventDefault()}
                          draggable
                          style={{
                            display: 'inline-flex', alignItems: 'center', gap: 6,
                            padding: '9px 16px', borderRadius: 9,
                            background: '#eef2ff', color: '#312e81',
                            fontWeight: 800, fontSize: 13, textDecoration: 'none',
                            border: '1.5px dashed #818cf8', cursor: 'grab', userSelect: 'none',
                          }}
                          title="Drag to bookmarks bar"
                        >
                          ⬡ FeedbackAgent — {fetchedTitle || id.slice(0, 8)}
                        </a>
                        <div style={{ fontSize: 11, color: '#94a3b8', marginTop: 5 }}>Already in your bar? Skip this step.</div>
                      </div>
                    </div>

                    {/* Step 2 */}
                    <div style={{ display: 'flex', gap: 14, alignItems: 'flex-start', padding: '14px 16px', borderRadius: 12, background: '#f8fafc', border: '1px solid #e2e8f0' }}>
                      <div style={{ width: 32, height: 32, borderRadius: 8, background: '#312e81', color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 800, fontSize: 14, flexShrink: 0 }}>2</div>
                      <div style={{ flex: 1 }}>
                        <div style={{ fontWeight: 700, marginBottom: 8 }}>Open the page and click the bookmarklet</div>
                        <button
                          onClick={() => window.open(loadedUrl, '_blank', 'noopener,noreferrer')}
                          style={{ padding: '9px 18px', borderRadius: 9, background: '#0f172a', color: '#f8fafc', border: 'none', cursor: 'pointer', fontWeight: 700, fontSize: 13 }}
                        >
                          Open {loadedUrl} ↗
                        </button>
                        <div style={{ fontSize: 12, color: '#64748b', marginTop: 6, lineHeight: 1.5 }}>
                          Once the page loads, click <strong>⬡ FeedbackAgent</strong> in your bookmarks bar. The overlay will appear on that real page — already linked to this session.
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              </div>
            )}

            <div
              ref={overlayRef}
              style={{ position: 'absolute', inset: 0, zIndex: 10, cursor: cursorStyle }}
              onMouseDown={handleMouseDown}
              onMouseMove={handleMouseMove}
              onMouseUp={handleMouseUp}
              onMouseLeave={() => mode === 'snap' && setSnapPreview(null)}
              onContextMenu={(event) => event.preventDefault()}
            >
              {mode === 'snap' && snapPreview && (
                <div
                  style={{
                    position: 'absolute',
                    left: snapPreview.x,
                    top: snapPreview.y,
                    width: snapPreview.width,
                    height: snapPreview.height,
                    border: '2px solid #60a5fa',
                    background: 'rgba(96, 165, 250, 0.12)',
                    pointerEvents: 'none',
                    boxSizing: 'border-box',
                    transition: 'left 0.04s, top 0.04s, width 0.04s, height 0.04s',
                  }}
                >
                  <div style={{ position: 'absolute', top: -24, left: -2, background: '#2563eb', color: '#fff', fontSize: 11, fontWeight: 800, padding: '3px 8px', borderRadius: '6px 6px 0 0', whiteSpace: 'nowrap' }}>
                    click to annotate
                  </div>
                </div>
              )}

              {boxes.map((box, index) => (
                <div
                  key={box.id}
                  onMouseDown={(event) => event.stopPropagation()}
                  onClick={() => setSelectedBoxId(box.id)}
                  style={{
                    position: 'absolute',
                    left: box.x,
                    top: box.y,
                    width: box.width,
                    height: box.height,
                    border: `2px solid ${selectedBoxId === box.id ? '#ef4444' : '#f87171'}`,
                    background: selectedBoxId === box.id ? 'rgba(239, 68, 68, 0.18)' : 'rgba(248, 113, 113, 0.12)',
                    cursor: 'pointer',
                    boxSizing: 'border-box',
                  }}
                >
                  <div style={{ position: 'absolute', top: -24, left: -2, background: '#ef4444', color: '#fff', fontSize: 11, fontWeight: 800, padding: '3px 8px', borderRadius: '6px 6px 0 0', whiteSpace: 'nowrap' }}>
                    #{index + 1} {box.notes.length === 0 ? '· click to add note' : `· ${box.notes.length} note${box.notes.length > 1 ? 's' : ''}`}
                  </div>
                </div>
              ))}

              {currentBox && (
                <div
                  style={{
                    position: 'absolute',
                    left: currentBox.x,
                    top: currentBox.y,
                    width: currentBox.width,
                    height: currentBox.height,
                    border: '2px dashed #fbbf24',
                    background: 'rgba(251, 191, 36, 0.08)',
                    pointerEvents: 'none',
                  }}
                />
              )}

              {!loadedUrl && (
                <div style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center', pointerEvents: 'none' }}>
                  <div style={{ background: 'rgba(15, 23, 42, 0.95)', border: '1px solid #334155', borderRadius: 16, padding: '20px 22px', maxWidth: 360, boxShadow: '0 18px 40px rgba(2, 6, 23, 0.45)' }}>
                    <div style={{ fontSize: '0.78rem', fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#93c5fd', marginBottom: 8 }}>
                      Page-first annotation
                    </div>
                    <div style={{ fontSize: '1rem', fontWeight: 700, marginBottom: 8 }}>
                      Load the page you want to review
                    </div>
                    <div style={{ fontSize: '0.86rem', color: '#94a3b8', lineHeight: 1.6 }}>
                      This view is designed to keep the product visible while you highlight elements and write notes in the right-side panel.
                    </div>
                  </div>
                </div>
              )}

              {loadedUrl && boxes.length === 0 && !snapPreview && !isDrawing && (
                <div style={{ position: 'absolute', top: 16, left: 16, background: 'rgba(15, 23, 42, 0.92)', borderRadius: 12, border: '1px solid #334155', padding: '12px 14px', maxWidth: 320, pointerEvents: 'none' }}>
                  <div style={{ fontSize: '0.76rem', fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#93c5fd', marginBottom: 6 }}>
                    {mode === 'snap' ? 'Snap Mode' : 'Draw Mode'}
                  </div>
                  <div style={{ fontSize: '0.88rem', color: '#e5e7eb', lineHeight: 1.5 }}>
                    {mode === 'snap'
                      ? 'Move over the page to highlight an element, then click to annotate it.'
                      : 'Drag directly on the page to draw a custom annotation region.'}
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <aside style={{ borderLeft: '1px solid #1f2937', background: '#0f172a', padding: 18, overflowY: 'auto' }}>
          <div style={{ display: 'grid', gap: 14 }}>
            <div style={{ borderRadius: 16, border: '1px solid #1f2937', background: '#111827', padding: 16 }}>
              <div style={{ fontSize: '0.78rem', fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#93c5fd', marginBottom: 6 }}>
                Right Panel
              </div>
              <div style={{ fontSize: '1.05rem', fontWeight: 700, color: '#f8fafc', marginBottom: 8 }}>
                {selectedBox ? `Box #${boxes.findIndex((box) => box.id === selectedBox.id) + 1}` : 'Choose something to annotate'}
              </div>
              <div style={{ fontSize: '0.86rem', color: '#94a3b8', lineHeight: 1.6 }}>
                This panel is where your notes live. The page stays visible on the left so the experience feels closer to the Codex review flow you showed.
              </div>
            </div>

            {selectedBox?.screenshot && (
              <div style={{ borderRadius: 16, overflow: 'hidden', border: '1px solid #1f2937', background: '#111827' }}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={selectedBox.screenshot} alt="Selected annotation" style={{ width: '100%', display: 'block', maxHeight: 180, objectFit: 'cover', objectPosition: 'top' }} />
              </div>
            )}

            <div style={{ borderRadius: 16, border: '1px solid #1f2937', background: '#111827', padding: 16 }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
                <div>
                  <div style={{ fontSize: '0.76rem', color: '#60a5fa', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                    Note Composer
                  </div>
                  <div style={{ fontSize: '0.9rem', color: '#e5e7eb', marginTop: 4 }}>
                    {selectedBox ? 'Add context for the highlighted area' : 'Select a box to start'}
                  </div>
                </div>
                {selectedBox && (
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedBoxId(null);
                      setNoteText('');
                      setVoiceTranscript('');
                      setNoteType('text');
                    }}
                    style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: 12 }}
                  >
                    Clear
                  </button>
                )}
              </div>

              {selectedBox ? (
                <>
                  <div style={{ marginBottom: 14, fontSize: 12, color: '#94a3b8', fontFamily: 'monospace' }}>
                    {Math.round(selectedBox.x)},{Math.round(selectedBox.y)} · {Math.round(selectedBox.width)}x{Math.round(selectedBox.height)}
                  </div>

                  {selectedBox.notes.length > 0 && (
                    <div style={{ marginBottom: 16, padding: '10px 12px', background: '#0b1220', borderRadius: 10, border: '1px solid #1e293b' }}>
                      <div style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', marginBottom: 8 }}>EXISTING NOTES</div>
                      {selectedBox.notes.map((note) => (
                        <div key={note.id} style={{ fontSize: 12, color: '#cbd5e1', marginBottom: 6, display: 'flex', gap: 6 }}>
                          <span>{note.type === 'voice' ? '🎤' : '📝'}</span>
                          <span>{note.content}</span>
                        </div>
                      ))}
                    </div>
                  )}

                  <div style={{ display: 'flex', background: '#0b1220', borderRadius: 10, padding: 3, marginBottom: 16, border: '1px solid #1f2937' }}>
                    {(['text', 'voice'] as const).map((type) => (
                      <button
                        key={type}
                        type="button"
                        disabled={isRecordingVoice}
                        onClick={() => setNoteType(type)}
                        style={{
                          flex: 1,
                          padding: '8px',
                          borderRadius: 8,
                          border: 'none',
                          cursor: isRecordingVoice ? 'not-allowed' : 'pointer',
                          fontWeight: 700,
                          fontSize: 13,
                          background: noteType === type ? '#2563eb' : 'transparent',
                          color: noteType === type ? '#fff' : '#94a3b8',
                        }}
                      >
                        {type === 'text' ? 'Text note' : 'Voice note'}
                      </button>
                    ))}
                  </div>

                  {noteType === 'text' ? (
                    <>
                      <textarea
                        placeholder="Describe what needs attention in this area..."
                        value={noteText}
                        onChange={(event) => setNoteText(event.target.value.slice(0, 1000))}
                        style={{ width: '100%', height: 130, padding: 12, borderRadius: 10, border: '1px solid #334155', resize: 'none', fontSize: 14, boxSizing: 'border-box', outline: 'none', lineHeight: 1.5, background: '#0b1220', color: '#f8fafc' }}
                      />
                      <div style={{ fontSize: 11, color: '#64748b', textAlign: 'right', marginTop: 6 }}>{noteText.length}/1000</div>
                    </>
                  ) : (
                    <div>
                      {isRecordingVoice ? (
                        <div style={{ background: '#3f0d12', borderRadius: 10, padding: 16, border: '1px solid #7f1d1d' }}>
                          <div style={{ minHeight: 60, marginBottom: 12, padding: '10px 12px', background: '#fff', borderRadius: 8, border: '1px solid #fca5a5', fontSize: 14, color: '#111', lineHeight: 1.5 }}>
                            {voiceTranscript || <span style={{ color: '#9ca3af', fontStyle: 'italic' }}>Listening... speak now</span>}
                          </div>
                          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
                            <div style={{ fontSize: 13, color: '#fecaca', fontWeight: 700 }}>Recording {voiceTimer}s / 30s</div>
                            <button type="button" onClick={stopVoice} style={{ padding: '7px 16px', background: '#dc2626', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer', fontWeight: 700, fontSize: 13 }}>
                              Stop
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button type="button" onClick={startVoice} style={{ width: '100%', padding: '14px', background: '#4f46e5', color: '#fff', border: 'none', borderRadius: 10, cursor: 'pointer', fontSize: 14, fontWeight: 700 }}>
                          Start Voice Note
                        </button>
                      )}
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: 10, marginTop: 16 }}>
                    <button
                      type="button"
                      onClick={() => {
                        setNoteText('');
                        setVoiceTranscript('');
                        setNoteType('text');
                      }}
                      disabled={isRecordingVoice}
                      style={{ flex: 1, padding: '11px', borderRadius: 10, border: '1px solid #334155', background: '#111827', cursor: isRecordingVoice ? 'not-allowed' : 'pointer', color: '#cbd5e1', fontWeight: 700 }}
                    >
                      Reset
                    </button>
                    <button
                      type="button"
                      onClick={() => addNote(noteType, noteType === 'voice' ? voiceTranscript : noteText)}
                      disabled={noteType === 'text' ? !noteText.trim() : (isRecordingVoice || !voiceTranscript.trim())}
                      style={{
                        flex: 2,
                        padding: '11px',
                        borderRadius: 10,
                        border: 'none',
                        background: (noteType === 'text' ? !noteText.trim() : (isRecordingVoice || !voiceTranscript.trim())) ? '#334155' : '#22c55e',
                        color: '#fff',
                        cursor: (noteType === 'text' ? !noteText.trim() : (isRecordingVoice || !voiceTranscript.trim())) ? 'not-allowed' : 'pointer',
                        fontWeight: 800,
                        fontSize: 14,
                      }}
                    >
                      {noteType === 'voice' && voiceTranscript ? 'Save Transcript' : 'Add Note'}
                    </button>
                  </div>
                </>
              ) : (
                <div style={{ borderRadius: 12, border: '1px dashed #334155', padding: 18, color: '#94a3b8', fontSize: '0.9rem', lineHeight: 1.6 }}>
                  Start by hovering an element and clicking to snap it, or switch to Draw to mark a custom area.
                </div>
              )}
            </div>

            <div style={{ borderRadius: 16, border: '1px solid #1f2937', background: '#111827', padding: 16 }}>
              <div style={{ fontSize: '0.76rem', color: '#60a5fa', fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 10 }}>
                Captured Areas
              </div>
              <div style={{ display: 'grid', gap: 10 }}>
                {boxes.length === 0 ? (
                  <div style={{ color: '#6b7280', fontSize: '0.88rem' }}>No highlights yet.</div>
                ) : (
                  boxes.map((box, index) => (
                    <button
                      key={box.id}
                      type="button"
                      onClick={() => setSelectedBoxId(box.id)}
                      style={{
                        textAlign: 'left',
                        padding: 12,
                        borderRadius: 12,
                        border: selectedBoxId === box.id ? '1px solid #60a5fa' : '1px solid #1f2937',
                        background: selectedBoxId === box.id ? '#0b1220' : '#111827',
                        color: '#e5e7eb',
                        cursor: 'pointer',
                      }}
                    >
                      <div style={{ fontSize: '0.88rem', fontWeight: 700, marginBottom: 6 }}>Box #{index + 1}</div>
                      <div style={{ fontSize: 12, color: '#94a3b8', fontFamily: 'monospace', marginBottom: 6 }}>
                        {Math.round(box.x)},{Math.round(box.y)} · {Math.round(box.width)}x{Math.round(box.height)}
                      </div>
                      <div style={{ fontSize: '0.82rem', color: '#cbd5e1' }}>
                        {box.notes.length === 0 ? 'No notes yet' : `${box.notes.length} note${box.notes.length > 1 ? 's' : ''} attached`}
                      </div>
                    </button>
                  ))
                )}
              </div>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

export default function RecordPage() {
  return (
    <Suspense
      fallback={
        <div style={{ height: '100vh', background: '#0b0f19', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8' }}>
          Loading...
        </div>
      }
    >
      <RecordPageInner />
    </Suspense>
  );
}
