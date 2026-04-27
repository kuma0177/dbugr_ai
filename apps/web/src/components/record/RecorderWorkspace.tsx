'use client';

import { useEffect, useRef, useState } from 'react';

type RecorderState = 'idle' | 'selecting' | 'recording' | 'paused' | 'stopped';
const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

export interface Annotation {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  description: string;
  timestamp: number;
  color: string;
  voiceNoteDataUrl?: string;
  voiceNoteDurationSec?: number;
  screenshotDataUrl?: string;
}

interface DrawingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface StoredAnnotation extends Annotation {
  canvasWidth: number;
  canvasHeight: number;
}

interface ControllerDraft {
  id: string;
  description?: string;
  voiceNoteDataUrl?: string;
  voiceNoteDurationSec?: number;
  createdAt: string;
}

interface LiveSessionSnapshot {
  id: string;
  title: string;
  status: RecorderState;
  timestampSec: number;
  annotations: Annotation[];
  pendingDraft: ControllerDraft | null;
  updatedAt: string;
  createdAt: string;
}

interface Props {
  mode?: 'launcher' | 'tab-a' | 'companion';
  sessionId?: string;
}

export function RecorderWorkspace({ mode = 'launcher', sessionId }: Props) {
  const isTabA = mode === 'tab-a';
  const isLauncher = mode === 'launcher';
  const [state, setState] = useState<RecorderState>('idle');
  const [duration, setDuration] = useState(0);
  const [title, setTitle] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadProgress] = useState(0);

  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawingBox, setDrawingBox] = useState<DrawingBox | null>(null);
  const [startPos, setStartPos] = useState<{ x: number; y: number } | null>(null);
  const [selectedColor, setSelectedColor] = useState('#ef4444');
  const [annotationText, setAnnotationText] = useState('');
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);
  const [draftVoiceNoteDataUrl, setDraftVoiceNoteDataUrl] = useState<string | undefined>();
  const [draftVoiceNoteDurationSec, setDraftVoiceNoteDurationSec] = useState<number | undefined>();
  const [isRecordingVoiceNote, setIsRecordingVoiceNote] = useState(false);
  const [voiceNoteSeconds, setVoiceNoteSeconds] = useState(0);
  const [liveSession, setLiveSession] = useState<LiveSessionSnapshot | null>(null);
  const [copyStatus, setCopyStatus] = useState('');
  const [lastAppliedDraftId, setLastAppliedDraftId] = useState<string | null>(null);

  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const voiceNoteRecorderRef = useRef<MediaRecorder | null>(null);
  const voiceNoteStreamRef = useRef<MediaStream | null>(null);
  const voiceNoteChunksRef = useRef<Blob[]>([]);
  const voiceNoteTimerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    syncOverlayCanvasSize();

    const handleResize = () => {
      syncOverlayCanvasSize();
      redrawOverlay();
    };

    window.addEventListener('resize', handleResize);
    return () => {
      window.removeEventListener('resize', handleResize);
      if (timerRef.current) clearInterval(timerRef.current);
      if (voiceNoteTimerRef.current) clearInterval(voiceNoteTimerRef.current);
      stopVoiceNoteStream();
    };
  }, []);

  useEffect(() => {
    if (!isTabA || !sessionId) return;

    const loadDebugSession = async () => {
      try {
        const res = await fetch(`${API_BASE}/live-sessions/${sessionId}`);
        if (!res.ok) return;
        const json = (await res.json()) as { data: LiveSessionSnapshot };
        setLiveSession(json.data);
        setTitle(json.data.title);
      } catch (error) {
        console.error('[recorder] load debug session error:', error);
      }
    };

    void loadDebugSession();
  }, [isTabA, sessionId]);

  useEffect(() => {
    redrawOverlay();
  }, [annotations, drawingBox, selectedColor]);

  useEffect(() => {
    if (!liveSession?.id) return;

    const heartbeat = async () => {
      try {
        await fetch(`${API_BASE}/live-sessions/${liveSession.id}/heartbeat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            title: title.trim() || liveSession.title,
            status: state,
            timestampSec: duration,
          }),
        });
      } catch (error) {
        console.error('[recorder] heartbeat error:', error);
      }
    };

    heartbeat();
    const interval = setInterval(heartbeat, 1000);
    return () => clearInterval(interval);
  }, [liveSession?.id, title, state, duration]);

  useEffect(() => {
    if (!liveSession?.id) return;

    const syncAnnotations = async () => {
      try {
        await fetch(`${API_BASE}/live-sessions/${liveSession.id}/annotations`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ annotations }),
        });
      } catch (error) {
        console.error('[recorder] annotation sync error:', error);
      }
    };

    syncAnnotations();
  }, [liveSession?.id, annotations]);

  useEffect(() => {
    if (!liveSession?.id) return;

    const pollSession = async () => {
      try {
        const res = await fetch(`${API_BASE}/live-sessions/${liveSession.id}`);
        if (!res.ok) return;
        const json = (await res.json()) as { data: LiveSessionSnapshot };
        setLiveSession(json.data);

        const pendingDraft = json.data.pendingDraft;
        if (pendingDraft && pendingDraft.id !== lastAppliedDraftId) {
          setAnnotationText(pendingDraft.description ?? '');
          setDraftVoiceNoteDataUrl(pendingDraft.voiceNoteDataUrl);
          setDraftVoiceNoteDurationSec(pendingDraft.voiceNoteDurationSec);
          setLastAppliedDraftId(pendingDraft.id);
        }
      } catch (error) {
        console.error('[recorder] poll error:', error);
      }
    };

    pollSession();
    const interval = setInterval(pollSession, 1000);
    return () => clearInterval(interval);
  }, [liveSession?.id, lastAppliedDraftId]);

  function syncOverlayCanvasSize() {
    const video = videoRef.current;
    const canvas = overlayCanvasRef.current;
    if (!video || !canvas) return;

    const rect = video.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    canvas.width = rect.width;
    canvas.height = rect.height;
  }

  function redrawOverlay() {
    const canvas = overlayCanvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);

    annotations.forEach((ann) => {
      ctx.strokeStyle = ann.color;
      ctx.lineWidth = 2;
      ctx.strokeRect(ann.x, ann.y, ann.width, ann.height);

      const label = `${ann.timestamp.toFixed(1)}s  ${ann.description}`;
      ctx.font = '12px monospace';
      const textWidth = Math.min(ctx.measureText(label).width + 12, canvas.width - ann.x - 4);
      const labelY = ann.y > 24 ? ann.y - 20 : ann.y + ann.height + 6;

      ctx.fillStyle = ann.color;
      ctx.globalAlpha = 0.9;
      ctx.fillRect(ann.x + 2, labelY, textWidth, 16);
      ctx.globalAlpha = 1;

      ctx.fillStyle = '#fff';
      ctx.fillText(label.slice(0, 36), ann.x + 8, labelY + 12);
    });

    if (drawingBox) {
      ctx.strokeStyle = selectedColor;
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 4]);
      ctx.strokeRect(drawingBox.x, drawingBox.y, drawingBox.width, drawingBox.height);
      ctx.setLineDash([]);
    }
  }

  async function startRecording() {
    try {
      if (!title.trim()) {
        alert('Please enter a title first.');
        return;
      }

      const ensuredSession = liveSession ?? (await createLiveSession());
      if (!ensuredSession) return;

      setState('selecting');
      setAnnotations([]);
      setDrawingBox(null);
      setSelectedAnnotationId(null);
      setAnnotationText('');
      setDraftVoiceNoteDataUrl(undefined);
      setDraftVoiceNoteDurationSec(undefined);
      chunksRef.current = [];

      const screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: { cursor: 'always' } as MediaTrackConstraints,
        audio: false,
      });

      const audioStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
        video: false,
      });

      const combinedStream = new MediaStream();
      screenStream.getVideoTracks().forEach((track) => combinedStream.addTrack(track));
      audioStream.getAudioTracks().forEach((track) => combinedStream.addTrack(track));

      if (videoRef.current) {
        videoRef.current.srcObject = screenStream;
        videoRef.current.onloadedmetadata = () => {
          syncOverlayCanvasSize();
          redrawOverlay();
        };
      }

      const mediaRecorder = new MediaRecorder(combinedStream, {
        mimeType: 'video/webm;codecs=vp9,opus',
      });

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) chunksRef.current.push(event.data);
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'video/webm' });
        handleRecordingComplete(blob);
      };

      mediaRecorderRef.current = mediaRecorder;
      streamRef.current = combinedStream;

      setDuration(0);
      timerRef.current = setInterval(() => {
        setDuration((value) => value + 1);
      }, 1000);

      mediaRecorder.start();
      setState('recording');
    } catch (err) {
      console.error('[recorder] Error:', err);
      alert('Failed to access screen or microphone. Make sure you granted permissions.');
      setState('idle');
    }
  }

  function pauseRecording() {
    if (!mediaRecorderRef.current) return;
    mediaRecorderRef.current.pause();
    setState('paused');
    if (timerRef.current) clearInterval(timerRef.current);
  }

  function resumeRecording() {
    if (!mediaRecorderRef.current) return;
    mediaRecorderRef.current.resume();
    setState('recording');
    timerRef.current = setInterval(() => {
      setDuration((value) => value + 1);
    }, 1000);
  }

  function stopRecording() {
    if (mediaRecorderRef.current && (state === 'recording' || state === 'paused')) {
      if (state === 'paused') mediaRecorderRef.current.resume();
      mediaRecorderRef.current.stop();
      setState('stopped');
      if (timerRef.current) clearInterval(timerRef.current);

      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
    }
  }

  function handleOverlayMouseDown(event: React.MouseEvent<HTMLCanvasElement>) {
    if (state !== 'recording' && state !== 'paused') return;
    if (isTabA && event.button !== 2) return;
    const canvas = overlayCanvasRef.current;
    if (!canvas) return;

    if (isTabA) event.preventDefault();

    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    setStartPos({ x, y });
    setDrawingBox({ x, y, width: 0, height: 0 });
    setIsDrawing(true);
  }

  function handleOverlayMouseMove(event: React.MouseEvent<HTMLCanvasElement>) {
    if (!isDrawing || !startPos || !overlayCanvasRef.current) return;

    const rect = overlayCanvasRef.current.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;

    setDrawingBox({
      x: Math.min(startPos.x, x),
      y: Math.min(startPos.y, y),
      width: Math.abs(x - startPos.x),
      height: Math.abs(y - startPos.y),
    });
  }

  function handleOverlayMouseUp() {
    setIsDrawing(false);
  }

  function handleOverlayContextMenu(event: React.MouseEvent<HTMLCanvasElement>) {
    if (!isTabA) return;
    event.preventDefault();
  }

  function captureCurrentFrame(): string | undefined {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight) return undefined;

    const canvas = document.createElement('canvas');
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) return undefined;

    ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png');
  }

  async function blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onloadend = () => {
        if (typeof reader.result === 'string') resolve(reader.result);
        else reject(new Error('Could not convert voice note'));
      };
      reader.onerror = () => reject(reader.error ?? new Error('Could not convert voice note'));
      reader.readAsDataURL(blob);
    });
  }

  function stopVoiceNoteStream() {
    if (voiceNoteStreamRef.current) {
      voiceNoteStreamRef.current.getTracks().forEach((track) => track.stop());
      voiceNoteStreamRef.current = null;
    }
  }

  async function startVoiceNoteRecording() {
    try {
      setVoiceNoteSeconds(0);
      voiceNoteChunksRef.current = [];

      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
      const recorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });

      voiceNoteStreamRef.current = stream;
      voiceNoteRecorderRef.current = recorder;

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) voiceNoteChunksRef.current.push(event.data);
      };

      recorder.onstop = async () => {
        try {
          const blob = new Blob(voiceNoteChunksRef.current, { type: 'audio/webm' });
          const dataUrl = await blobToDataUrl(blob);
          setDraftVoiceNoteDataUrl(dataUrl);
          setDraftVoiceNoteDurationSec(voiceNoteSeconds || 30);
        } catch (error) {
          console.error('[recorder] Voice note conversion error:', error);
        } finally {
          setIsRecordingVoiceNote(false);
          if (voiceNoteTimerRef.current) clearInterval(voiceNoteTimerRef.current);
          stopVoiceNoteStream();
        }
      };

      recorder.start();
      setIsRecordingVoiceNote(true);

      voiceNoteTimerRef.current = setInterval(() => {
        setVoiceNoteSeconds((current) => {
          if (current >= 29) {
            recorder.stop();
            return 30;
          }
          return current + 1;
        });
      }, 1000);
    } catch (error) {
      console.error('[recorder] Voice note error:', error);
      alert('Could not start the box voice note. Check microphone permissions and try again.');
    }
  }

  function stopVoiceNoteRecording() {
    if (voiceNoteRecorderRef.current && isRecordingVoiceNote) {
      voiceNoteRecorderRef.current.stop();
    }
  }

  function resetDraftComposer() {
    setSelectedAnnotationId(null);
    setDrawingBox(null);
    setAnnotationText('');
    setSelectedColor('#ef4444');
    setDraftVoiceNoteDataUrl(undefined);
    setDraftVoiceNoteDurationSec(undefined);
  }

  async function clearPendingDraft() {
    if (!liveSession?.id) return;

    try {
      await fetch(`${API_BASE}/live-sessions/${liveSession.id}/drafts/current`, {
        method: 'DELETE',
      });
      setLiveSession((current) => (current ? { ...current, pendingDraft: null } : current));
    } catch (error) {
      console.error('[recorder] clear draft error:', error);
    }
  }

  function handleAddAnnotation() {
    if (!drawingBox) {
      alert('Draw a box first.');
      return;
    }
    if (!annotationText.trim() && !draftVoiceNoteDataUrl) {
      alert('Add typed notes or a voice note before saving.');
      return;
    }
    if (annotations.length >= 5) {
      alert('A session can include up to 5 boxes.');
      return;
    }

    const nextAnnotation: Annotation = {
      id: `ann_${Date.now()}`,
      x: drawingBox.x,
      y: drawingBox.y,
      width: drawingBox.width,
      height: drawingBox.height,
      description: annotationText.trim(),
      timestamp: duration,
      color: selectedColor,
      voiceNoteDataUrl: draftVoiceNoteDataUrl,
      voiceNoteDurationSec: draftVoiceNoteDurationSec,
      screenshotDataUrl: captureCurrentFrame(),
    };

    setAnnotations((current) => [...current, nextAnnotation]);
    resetDraftComposer();
    void clearPendingDraft();
  }

  function handleEditAnnotation(annotation: Annotation) {
    setSelectedAnnotationId(annotation.id);
    setAnnotationText(annotation.description);
    setSelectedColor(annotation.color);
    setDrawingBox({
      x: annotation.x,
      y: annotation.y,
      width: annotation.width,
      height: annotation.height,
    });
    setDraftVoiceNoteDataUrl(annotation.voiceNoteDataUrl);
    setDraftVoiceNoteDurationSec(annotation.voiceNoteDurationSec);
  }

  function handleUpdateAnnotation() {
    if (!selectedAnnotationId || !drawingBox) {
      alert('Finish the box placement before updating.');
      return;
    }
    if (!annotationText.trim() && !draftVoiceNoteDataUrl) {
      alert('Add typed notes or a voice note before updating.');
      return;
    }

    setAnnotations((current) =>
      current.map((annotation) =>
        annotation.id === selectedAnnotationId
          ? {
              ...annotation,
              x: drawingBox.x,
              y: drawingBox.y,
              width: drawingBox.width,
              height: drawingBox.height,
              description: annotationText.trim(),
              color: selectedColor,
              voiceNoteDataUrl: draftVoiceNoteDataUrl,
              voiceNoteDurationSec: draftVoiceNoteDurationSec,
              screenshotDataUrl: captureCurrentFrame() ?? annotation.screenshotDataUrl,
            }
          : annotation
      )
    );

    resetDraftComposer();
    void clearPendingDraft();
  }

  function handleDeleteAnnotation(annotationId: string) {
    setAnnotations((current) => current.filter((annotation) => annotation.id !== annotationId));
    if (selectedAnnotationId === annotationId) resetDraftComposer();
  }

  async function handleRecordingComplete(blob: Blob) {
    if (!title.trim()) {
      alert('Please enter a feedback title');
      return;
    }

    setUploading(true);

    try {
      const formData = new FormData();
      formData.append('video', blob, `feedback-${Date.now()}.webm`);
      formData.append('title', title);
      formData.append('durationMs', String(duration * 1000));

      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/feedback-sessions/upload`, {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) throw new Error('Upload failed');

      const data = (await res.json()) as { data: { id: string } };
      const sessionId = data.data.id;
      const canvas = overlayCanvasRef.current;

      const storedAnnotations: StoredAnnotation[] = annotations.map((annotation) => ({
        ...annotation,
        canvasWidth: canvas?.width || 1,
        canvasHeight: canvas?.height || 1,
      }));

      sessionStorage.setItem(`annotations_${sessionId}`, JSON.stringify(storedAnnotations));
      window.location.href = `/sessions/${sessionId}/annotate`;
    } catch (err) {
      console.error('[recorder] Upload error:', err);
      alert('Failed to upload recording. Please try again.');
      setState('stopped');
      setUploading(false);
    }
  }

  const minutes = Math.floor(duration / 60);
  const seconds = duration % 60;
  const timeDisplay = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  const canStartRecording = title.trim().length > 0;
  const isActive = state === 'recording' || state === 'paused';
  const helperUrl =
    liveSession && typeof window !== 'undefined'
      ? `${window.location.origin}/control/${liveSession.id}`
      : '';
  const tabAUrl =
    liveSession && typeof window !== 'undefined' ? `${window.location.origin}/record/tab-a/${liveSession.id}` : '';

  async function createLiveSession() {
    try {
      const res = await fetch(`${API_BASE}/live-sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: title.trim() || 'Untitled live session' }),
      });
      if (!res.ok) throw new Error('Failed to create live session');
      const json = (await res.json()) as { data: LiveSessionSnapshot };
      setLiveSession(json.data);
      return json.data;
    } catch (error) {
      console.error('[recorder] create live session error:', error);
      alert('Could not create the helper link. Make sure the API server is running.');
      return null;
    }
  }

  async function handleCreateControllerSession() {
    if (!title.trim()) {
      alert('Please enter a title first.');
      return;
    }
    await createLiveSession();
  }

  async function copyControllerUrl() {
    if (!helperUrl) return;
    try {
      await navigator.clipboard.writeText(helperUrl);
      setCopyStatus('Copied controller link');
      setTimeout(() => setCopyStatus(''), 1500);
    } catch (error) {
      console.error('[recorder] copy controller link error:', error);
      setCopyStatus('Copy failed');
      setTimeout(() => setCopyStatus(''), 1500);
    }
  }

  if (isLauncher) {
    return (
      <main style={{ maxWidth: 980, margin: '0 auto', padding: '24px' }}>
        <h1 style={{ marginBottom: 24 }}>Record Feedback</h1>

        <div className="card" style={{ padding: 20, marginBottom: 16 }}>
          <div style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', marginBottom: 10 }}>
            Step 1 · Title first
          </div>
          <label style={{ display: 'block', marginBottom: 8, fontSize: '0.875rem', fontWeight: 600 }}>
            Feedback Title
          </label>
          <input
            className="input"
            type="text"
            placeholder='e.g., "Bug: checkout broken"'
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            style={{ width: '100%' }}
          />
          <p style={{ marginTop: 8, fontSize: '0.8rem', color: '#888', lineHeight: 1.5, marginBottom: 0 }}>
            Give the feedback a short name before you open the recording tab.
          </p>
        </div>

        <div className="card" style={{ padding: 20, marginBottom: 16 }}>
          <div style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', marginBottom: 10 }}>
            Step 2 · Create a debug session
          </div>
          <p style={{ margin: '0 0 12px 0', lineHeight: 1.6 }}>
            This sets up the session that Tab A will record into. The notes are made on the product itself, not in
            this launcher tab.
          </p>
          {!liveSession ? (
            <button className="btn btn-primary" onClick={handleCreateControllerSession} disabled={!title.trim()}>
              Create Debug Session
            </button>
          ) : (
            <div className="stack gap-8">
              <div style={{ fontSize: '0.85rem' }}>
                Session code: <strong>{liveSession.id}</strong>
              </div>
              <div className="row gap-8" style={{ flexWrap: 'wrap' }}>
                <button
                  className="btn btn-primary"
                  onClick={() => {
                    const url = `${window.location.origin}/record/tab-a/${liveSession.id}`;
                    window.open(url, '_blank', 'noopener,noreferrer');
                  }}
                >
                  Open Tab A
                </button>
                <button
                  className="btn btn-ghost"
                  onClick={async () => {
                    if (!tabAUrl) return;
                    try {
                      await navigator.clipboard.writeText(tabAUrl);
                      setCopyStatus('Copied Tab A link');
                      setTimeout(() => setCopyStatus(''), 1500);
                    } catch (error) {
                      console.error('[recorder] copy tab-a link error:', error);
                      setCopyStatus('Copy failed');
                      setTimeout(() => setCopyStatus(''), 1500);
                    }
                  }}
                >
                  Copy Tab A Link
                </button>
                {copyStatus && <span style={{ fontSize: '0.8rem', color: '#93c5fd' }}>{copyStatus}</span>}
              </div>
            </div>
          )}
        </div>

        <div
          style={{
            padding: 16,
            background: '#111827',
            color: '#e5e7eb',
            borderRadius: 8,
            border: '1px solid #374151',
          }}
        >
          <div style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', marginBottom: 8 }}>
            Step 3 · Open Tab A
          </div>
          <div style={{ display: 'grid', gap: 10, lineHeight: 1.6 }}>
            <div>Tab A is the browser tab that gets screen-recorded.</div>
            <div>Right-click and drag to draw a rectangle around the part of the product you want to mark.</div>
            <div>You can save up to 5 boxes in one session, each with text up to 1000 characters or a voice note up to 30 seconds.</div>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main style={{ maxWidth: 1280, margin: '0 auto', padding: '24px' }}>
      <h1 style={{ marginBottom: 24 }}>
        {mode === 'companion' ? 'Recorder Companion' : 'Record Feedback'}
      </h1>

      <div style={{ display: 'grid', gap: 16, marginBottom: 16 }}>
        <div className="card" style={{ padding: 20 }}>
          <div style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', marginBottom: 10 }}>
            Step 1 · Title first
          </div>
          <label style={{ display: 'block', marginBottom: 8, fontSize: '0.875rem', fontWeight: 600 }}>
            Feedback Title
          </label>
          <input
            className="input"
            type="text"
            placeholder="e.g., Checkout button broken on mobile"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            style={{ width: '100%' }}
          />
          <p style={{ marginTop: 8, fontSize: '0.8rem', color: '#888', lineHeight: 1.5, marginBottom: 0 }}>
            Enter the feedback before you start. This title stays editable throughout the flow.
          </p>
        </div>

        <div
          style={{
            padding: 16,
            background: '#111827',
            color: '#e5e7eb',
            borderRadius: 8,
            border: '1px solid #374151',
          }}
        >
          <div style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', marginBottom: 8 }}>
            Step 2 · Helper Link
          </div>
          <p style={{ margin: '0 0 10px 0', lineHeight: 1.6 }}>
            Optional link for another browser or phone. Use it if someone else is helping write notes while you
            record.
          </p>
          {!liveSession ? (
            <button className="btn btn-primary" onClick={handleCreateControllerSession}>
              Create Helper Link
            </button>
          ) : (
            <div className="stack gap-8">
              <div style={{ fontSize: '0.85rem' }}>
                Link code: <strong>{liveSession.id}</strong>
              </div>
              <input className="input" readOnly value={helperUrl} />
              <div className="row gap-8" style={{ flexWrap: 'wrap' }}>
                <button className="btn btn-primary" onClick={copyControllerUrl}>
                  Copy Helper Link
                </button>
                <a className="btn btn-ghost" href={helperUrl} target="_blank" rel="noreferrer">
                  Open Helper Link
                </a>
                {copyStatus && <span style={{ fontSize: '0.8rem', color: '#93c5fd' }}>{copyStatus}</span>}
              </div>
            </div>
          )}
        </div>
      </div>

      <div
        style={{
          marginBottom: 16,
          padding: '12px 16px',
          background: '#111827',
          color: '#e5e7eb',
          borderRadius: 8,
          border: '1px solid #374151',
          fontSize: '0.9rem',
          lineHeight: 1.6,
        }}
      >
        <strong>Step 3 · Start recording.</strong> Then use the overview surface below to draw rectangles around the
        parts you want to focus on, and add up to 1000 characters of text or a 30-second voice note to each box.
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) 360px', gap: 24 }}>
        <div>
          <div
            style={{
              marginBottom: 12,
              padding: '0 4px',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 12,
            }}
          >
            <div>
              <div style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', marginBottom: 4 }}>
                Overview
              </div>
              <div style={{ fontSize: '0.9rem', color: '#9ca3af', lineHeight: 1.5 }}>
                Draw rectangles around areas of focus directly on the live recording surface.
              </div>
            </div>
            <div
              style={{
                fontSize: '0.75rem',
                color: '#cbd5e1',
                border: '1px solid #334155',
                borderRadius: 999,
                padding: '6px 10px',
                whiteSpace: 'nowrap',
              }}
            >
              Step 4 · Select focus areas
            </div>
          </div>

          <div
            style={{
              background: '#000',
              borderRadius: 8,
              overflow: 'hidden',
              aspectRatio: '16 / 9',
              marginBottom: 16,
              position: 'relative',
              border: '1px solid #243244',
            }}
          >
            {state !== 'idle' && state !== 'selecting' ? (
              <>
                <video
                  ref={videoRef}
                  autoPlay
                  muted
                  playsInline
                  style={{ width: '100%', height: '100%', objectFit: 'contain', display: 'block' }}
                />
                <canvas
                  ref={overlayCanvasRef}
                  style={{
                    position: 'absolute',
                    inset: 0,
                    width: '100%',
                    height: '100%',
                    cursor: isActive ? 'crosshair' : 'default',
                  }}
                  onMouseDown={handleOverlayMouseDown}
                  onMouseMove={handleOverlayMouseMove}
                  onMouseUp={handleOverlayMouseUp}
                  onMouseLeave={handleOverlayMouseUp}
                  onContextMenu={handleOverlayContextMenu}
                />
                {isActive && (
                  <div
                    style={{
                      position: 'absolute',
                      top: 12,
                      left: 12,
                      display: 'flex',
                      gap: 8,
                      flexWrap: 'wrap',
                      maxWidth: 'calc(100% - 24px)',
                    }}
                  >
                    <div
                      style={{
                        background: 'rgba(0, 0, 0, 0.72)',
                        color: '#fff',
                        border: '1px solid rgba(255,255,255,0.18)',
                        borderRadius: 999,
                        padding: '8px 12px',
                        fontSize: '0.8rem',
                        fontWeight: 700,
                      }}
                    >
                      {state === 'recording' ? 'REC + MIC ON' : 'PAUSED'}
                    </div>
                    <div
                      style={{
                        background: 'rgba(0, 0, 0, 0.72)',
                        color: '#e5e7eb',
                        border: '1px solid rgba(255,255,255,0.18)',
                        borderRadius: 999,
                        padding: '8px 12px',
                        fontSize: '0.8rem',
                      }}
                    >
                      Right-click and drag to mark a focus area, then save the note from the panel
                    </div>
                  </div>
                )}
              </>
            ) : (
              <div
                style={{
                  width: '100%',
                  height: '100%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  color: '#888',
                  fontSize: '0.9rem',
                  textAlign: 'center',
                  padding: '0 24px',
                }}
              >
                {state === 'selecting'
                  ? 'Requesting screen + microphone access...'
                  : canStartRecording
                    ? 'This overview is your drawing surface. Start recording, then draw rectangles on the screen and save notes from the panel'
                    : 'Enter a title to unlock recording'}
              </div>
            )}
          </div>

          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            {state === 'idle' && (
              <button
                className="btn btn-primary"
                onClick={startRecording}
                disabled={!canStartRecording}
                style={{ flex: 1, padding: '12px 24px' }}
              >
                🔴 Start Recording
              </button>
            )}
            {isActive && (
              <>
                {state === 'recording' ? (
                  <button className="btn btn-ghost" onClick={pauseRecording} style={{ flex: 1 }}>
                    ⏸ Pause
                  </button>
                ) : (
                  <button className="btn btn-ghost" onClick={resumeRecording} style={{ flex: 1 }}>
                    ▶ Resume
                  </button>
                )}
                <button
                  className="btn btn-danger"
                  onClick={stopRecording}
                  style={{ flex: 1, background: '#dc2626' }}
                >
                  ⏹ Stop
                </button>
              </>
            )}
          </div>

          {isActive && (
            <div
              style={{
                marginBottom: 16,
                padding: 12,
                border: '1px solid #374151',
                borderRadius: 8,
                background: '#111827',
                color: '#e5e7eb',
                fontSize: '0.85rem',
                lineHeight: 1.5,
              }}
            >
              The video itself is the annotation surface. Drag to mark the UI, then add either text or a 30-second
              voice note in the right panel and save it to the current timestamp.
            </div>
          )}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {state !== 'idle' && (
            <div className="card">
              <div style={{ fontSize: '0.75rem', color: '#666', marginBottom: 4 }}>Duration</div>
              <div style={{ fontSize: '1.875rem', fontWeight: 700, fontFamily: 'monospace' }}>
                {timeDisplay}
              </div>
            </div>
          )}

          {state !== 'idle' && (
            <div className="card">
              <div style={{ fontSize: '0.75rem', color: '#666', marginBottom: 4 }}>Status</div>
              <div style={{ fontSize: '0.9rem', fontWeight: 600 }}>
                {state === 'selecting' && '⏳ Requesting access...'}
                {state === 'recording' && '🔴 Recording screen + microphone with live markup enabled'}
                {state === 'paused' && '⏸ Paused'}
                {state === 'stopped' && '✓ Stopped'}
              </div>
              <div style={{ fontSize: '0.8rem', color: '#888', marginTop: 8, lineHeight: 1.5 }}>
                Voice notes are optional. If you prefer text, each box note supports up to 1000 characters.
              </div>
              {liveSession?.pendingDraft && (
                <div style={{ fontSize: '0.8rem', color: '#93c5fd', marginTop: 8, lineHeight: 1.5 }}>
                  A helper note draft is ready. Draw a box on the recorder preview and save it from the composer.
                </div>
              )}
            </div>
          )}

          <div className="card">
            <div style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', marginBottom: 8 }}>
              Step 6 · Box Note Composer
            </div>
            <div className="stack gap-8">
              <div>
                <label style={{ fontSize: '0.8rem', marginBottom: 4, display: 'block' }}>Color</label>
                <div className="row gap-4" style={{ flexWrap: 'wrap' }}>
                  {['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899'].map((color) => (
                    <button
                      key={color}
                      onClick={() => setSelectedColor(color)}
                      style={{
                        width: 28,
                        height: 28,
                        background: color,
                        border: selectedColor === color ? '2px solid white' : '2px solid var(--border)',
                        borderRadius: 4,
                        cursor: 'pointer',
                      }}
                    />
                  ))}
                </div>
              </div>

              <div>
                <label style={{ fontSize: '0.8rem', marginBottom: 4, display: 'block' }}>
                  Free-form note
                </label>
                <textarea
                  className="textarea"
                  value={annotationText}
                  onChange={(event) => setAnnotationText(event.target.value.slice(0, 1000))}
                  placeholder="Describe what is wrong in this boxed area"
                  maxLength={1000}
                  style={{ width: '100%', height: 96 }}
                />
                <div style={{ marginTop: 6, fontSize: '0.75rem', color: '#888', textAlign: 'right' }}>
                  {annotationText.length}/1000
                </div>
              </div>

              <div>
                <label style={{ fontSize: '0.8rem', marginBottom: 6, display: 'block' }}>
                  Optional voice note
                </label>
                <div className="row gap-8" style={{ flexWrap: 'wrap' }}>
                  {!isRecordingVoiceNote ? (
                    <button className="btn btn-ghost" onClick={startVoiceNoteRecording}>
                      🎙 Record Voice Note
                    </button>
                  ) : (
                    <button className="btn btn-danger" onClick={stopVoiceNoteRecording}>
                      ⏹ Stop Voice Note ({voiceNoteSeconds}s / 30s)
                    </button>
                  )}
                  {draftVoiceNoteDataUrl && (
                    <button
                      className="btn btn-ghost"
                      onClick={() => {
                        setDraftVoiceNoteDataUrl(undefined);
                        setDraftVoiceNoteDurationSec(undefined);
                      }}
                    >
                      Remove Voice Note
                    </button>
                  )}
                </div>
                {draftVoiceNoteDataUrl && (
                  <div style={{ marginTop: 10 }}>
                    <audio controls src={draftVoiceNoteDataUrl} style={{ width: '100%' }} />
                    <div style={{ fontSize: '0.75rem', color: '#888', marginTop: 4 }}>
                      Voice note length: {draftVoiceNoteDurationSec ?? 0}s
                    </div>
                  </div>
                )}
              </div>

              <div style={{ fontSize: '0.78rem', color: '#888', lineHeight: 1.5 }}>
                Draw a box on the preview first. Save either a text note, a voice note, or both. Each saved note is
                attached to the current recording timestamp and box coordinates.
              </div>
              {liveSession?.pendingDraft && (
                <div
                  style={{
                    padding: 10,
                    background: '#0f172a',
                    border: '1px solid #1e3a8a',
                    borderRadius: 8,
                    color: '#dbeafe',
                    fontSize: '0.82rem',
                    lineHeight: 1.5,
                  }}
                >
                  Controller draft loaded into this composer. Place the box on the preview, then save the box note.
                </div>
              )}

              {selectedAnnotationId ? (
                <div className="row gap-8">
                  <button className="btn btn-primary" onClick={handleUpdateAnnotation} style={{ flex: 1 }}>
                    Update Box Note
                  </button>
                  <button className="btn btn-ghost" onClick={resetDraftComposer} style={{ flex: 1 }}>
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  className="btn btn-primary"
                  onClick={handleAddAnnotation}
                  disabled={!drawingBox || (!annotationText.trim() && !draftVoiceNoteDataUrl) || annotations.length >= 5}
                  style={{ width: '100%' }}
                >
                  + Save Box Note {annotations.length >= 5 ? '(5/5 reached)' : `(${annotations.length}/5)`}
                </button>
              )}
            </div>
          </div>

          <div
            style={{
              padding: 16,
              background: '#0b1220',
              color: '#e5e7eb',
              borderRadius: 8,
              border: '1px solid #22304a',
            }}
          >
            <div style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', marginBottom: 8 }}>
              Step 7 · Helper Notes
            </div>
            <p style={{ margin: 0, lineHeight: 1.6, fontSize: '0.9rem' }}>
              If a helper link is open, drafts will land here. Draw the box on the overview surface, then save the
              synced note to the same timestamp.
            </p>
          </div>

          <div className="card">
            <div style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', marginBottom: 8 }}>
              Saved Box Notes ({annotations.length})
            </div>
            <div className="stack gap-8" style={{ maxHeight: 320, overflowY: 'auto' }}>
              {annotations.length === 0 ? (
                <p className="muted" style={{ fontSize: '0.8rem' }}>
                  No box notes yet. Start recording, draw a box, and save either text or a short voice note.
                </p>
              ) : (
                annotations.map((annotation) => (
                  <div
                    key={annotation.id}
                    style={{
                      padding: 10,
                      background: 'var(--bg)',
                      borderLeft: `3px solid ${annotation.color}`,
                      borderRadius: 4,
                      cursor: 'pointer',
                    }}
                    onClick={() => handleEditAnnotation(annotation)}
                  >
                    {annotation.screenshotDataUrl && (
                      <img
                        src={annotation.screenshotDataUrl}
                        alt="Box note screenshot"
                        style={{
                          width: '100%',
                          maxHeight: 120,
                          objectFit: 'cover',
                          borderRadius: 6,
                          marginBottom: 8,
                          border: '1px solid #374151',
                        }}
                      />
                    )}
                    <div style={{ fontSize: '0.75rem', color: 'var(--muted)', marginBottom: 4 }}>
                      {annotation.timestamp.toFixed(1)}s
                      {' · '}
                      x:{Math.round(annotation.x)}, y:{Math.round(annotation.y)}
                    </div>
                    {annotation.description ? (
                      <div style={{ fontSize: '0.82rem', fontWeight: 500, marginBottom: 6 }}>
                        {annotation.description}
                      </div>
                    ) : (
                      <div style={{ fontSize: '0.8rem', color: '#888', marginBottom: 6 }}>
                        Voice-note only box
                      </div>
                    )}
                    {annotation.voiceNoteDataUrl && (
                      <audio
                        controls
                        src={annotation.voiceNoteDataUrl}
                        style={{ width: '100%', marginBottom: 6 }}
                        onClick={(event) => event.stopPropagation()}
                      />
                    )}
                    <button
                      className="btn btn-ghost"
                      style={{ fontSize: '0.75rem', padding: '2px 6px' }}
                      onClick={(event) => {
                        event.stopPropagation();
                        handleDeleteAnnotation(annotation.id);
                      }}
                    >
                      Delete
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

          {state === 'stopped' && (
            <button
              className="btn btn-primary"
              onClick={() => handleRecordingComplete(new Blob(chunksRef.current))}
              disabled={uploading || !title.trim()}
              style={{ width: '100%', padding: '12px 24px' }}
            >
              {uploading ? `⏳ Uploading (${uploadProgress}%)` : '📤 Finish Recording & Continue'}
            </button>
          )}
        </div>
      </div>
    </main>
  );
}
