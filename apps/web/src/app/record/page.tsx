'use client';

import { useState, useRef, useEffect } from 'react';
import { api } from '@/lib/api';

type RecorderState = 'idle' | 'selecting' | 'recording' | 'paused' | 'stopped';

export default function RecorderPage() {
  const [state, setState] = useState<RecorderState>('idle');
  const [duration, setDuration] = useState(0);
  const [title, setTitle] = useState('');
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<NodeJS.Timeout | null>(null);
  const screenshotCountRef = useRef(0);

  // ─────────────────────────────────────────────────────────────────────────
  // Screen Capture Setup
  // ─────────────────────────────────────────────────────────────────────────

  async function startRecording() {
    try {
      setState('selecting');

      // Get screen and audio
      const screenStream = await navigator.mediaDevices.getDisplayMedia({
        video: { cursor: 'always' } as any,
        audio: false,
      });

      const audioStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
        video: false,
      });

      // Combine streams
      const context = new AudioContext();
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d')!;

      // Get video track settings
      const videoTrack = screenStream.getVideoTracks()[0];
      const videoSettings = videoTrack.getSettings();
      canvas.width = videoSettings.width || 1920;
      canvas.height = videoSettings.height || 1080;

      // Create combined stream
      const combinedStream = new MediaStream();
      screenStream.getVideoTracks().forEach((track) => combinedStream.addTrack(track));
      audioStream.getAudioTracks().forEach((track) => combinedStream.addTrack(track));

      // Setup video preview
      if (videoRef.current) {
        videoRef.current.srcObject = screenStream;
      }

      // Setup recorder
      const mediaRecorder = new MediaRecorder(combinedStream, {
        mimeType: 'video/webm;codecs=vp9,opus',
      });

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) {
          chunksRef.current.push(e.data);
        }
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'video/webm' });
        handleRecordingComplete(blob);
      };

      mediaRecorderRef.current = mediaRecorder;
      streamRef.current = combinedStream;

      // Start timer
      setDuration(0);
      timerRef.current = setInterval(() => {
        setDuration((d) => d + 1);
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
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.pause();
      setState('paused');
      if (timerRef.current) clearInterval(timerRef.current);
    }
  }

  function resumeRecording() {
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.resume();
      setState('recording');
      timerRef.current = setInterval(() => {
        setDuration((d) => d + 1);
      }, 1000);
    }
  }

  function stopRecording() {
    if (mediaRecorderRef.current && state === 'recording') {
      mediaRecorderRef.current.stop();
      setState('stopped');
      if (timerRef.current) clearInterval(timerRef.current);

      // Stop all tracks
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
    } else if (state === 'paused') {
      mediaRecorderRef.current?.resume();
      mediaRecorderRef.current?.stop();
      setState('stopped');
      if (timerRef.current) clearInterval(timerRef.current);

      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Screenshot Capture
  // ─────────────────────────────────────────────────────────────────────────

  function captureScreenshot() {
    if (!videoRef.current) return;

    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Get video dimensions
    const rect = videoRef.current.getBoundingClientRect();
    canvas.width = videoRef.current.videoWidth;
    canvas.height = videoRef.current.videoHeight;

    // Draw current frame
    ctx.drawImage(videoRef.current, 0, 0);

    // Download screenshot
    canvas.toBlob((blob) => {
      if (!blob) return;
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `screenshot-${Date.now()}.png`;
      a.click();
      URL.revokeObjectURL(url);
    });

    screenshotCountRef.current++;
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Upload Handler
  // ─────────────────────────────────────────────────────────────────────────

  async function handleRecordingComplete(blob: Blob) {
    if (!title.trim()) {
      alert('Please enter a feedback title');
      return;
    }

    setUploading(true);
    setUploadProgress(0);

    try {
      // Create FormData with video + metadata
      const formData = new FormData();
      formData.append('video', blob, `feedback-${Date.now()}.webm`);
      formData.append('title', title);
      formData.append('durationMs', String(duration * 1000));
      formData.append('screenshotCount', String(screenshotCountRef.current));

      // Upload
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/feedback-sessions/upload`, {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        throw new Error('Upload failed');
      }

      const data = (await res.json()) as { data: { id: string } };
      const sessionId = data.data.id;

      // Redirect to annotation page
      window.location.href = `/sessions/${sessionId}/annotate`;
    } catch (err) {
      console.error('[recorder] Upload error:', err);
      alert('Failed to upload recording. Please try again.');
      setState('stopped');
      setUploading(false);
    }
  }

  // ─────────────────────────────────────────────────────────────────────────
  // Formatting
  // ─────────────────────────────────────────────────────────────────────────

  const minutes = Math.floor(duration / 60);
  const seconds = duration % 60;
  const timeDisplay = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;

  return (
    <main style={{ maxWidth: 1200, margin: '0 auto', padding: '24px' }}>
      <h1 style={{ marginBottom: 24 }}>Record Feedback</h1>

      <div style={{ display: 'grid', gridTemplateColumns: '2fr 1fr', gap: 24 }}>
        {/* Video Preview */}
        <div>
          <div
            style={{
              background: '#000',
              borderRadius: 8,
              overflow: 'hidden',
              aspectRatio: '16 / 9',
              marginBottom: 16,
            }}
          >
            {state !== 'idle' && state !== 'selecting' ? (
              <video
                ref={videoRef}
                autoPlay
                style={{ width: '100%', height: '100%', objectFit: 'contain' }}
              />
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
                }}
              >
                {state === 'selecting' ? 'Requesting screen access...' : 'No preview yet'}
              </div>
            )}
          </div>

          {/* Controls */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
            {state === 'idle' && (
              <button
                className="btn btn-primary"
                onClick={startRecording}
                style={{ flex: 1, padding: '12px 24px' }}
              >
                🔴 Start Recording
              </button>
            )}
            {(state === 'recording' || state === 'paused') && (
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

          {/* Screenshot Button */}
          {(state === 'recording' || state === 'paused') && (
            <button
              className="btn btn-ghost"
              onClick={captureScreenshot}
              style={{ width: '100%', marginBottom: 16 }}
            >
              📸 Take Screenshot (for annotation)
            </button>
          )}
        </div>

        {/* Sidebar */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Title Input */}
          <div>
            <label style={{ display: 'block', marginBottom: 8, fontSize: '0.875rem', fontWeight: 600 }}>
              Feedback Title
            </label>
            <input
              className="input"
              type="text"
              placeholder="e.g., Checkout button broken on mobile"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              disabled={state !== 'idle' && state !== 'stopped'}
              style={{ width: '100%' }}
            />
          </div>

          {/* Duration */}
          {state !== 'idle' && (
            <div style={{ background: '#f3f4f6', padding: 16, borderRadius: 8 }}>
              <div style={{ fontSize: '0.75rem', color: '#666', marginBottom: 4 }}>Duration</div>
              <div style={{ fontSize: '1.875rem', fontWeight: 700, fontFamily: 'monospace' }}>
                {timeDisplay}
              </div>
            </div>
          )}

          {/* Status */}
          {state !== 'idle' && (
            <div style={{ background: '#f3f4f6', padding: 16, borderRadius: 8 }}>
              <div style={{ fontSize: '0.75rem', color: '#666', marginBottom: 4 }}>Status</div>
              <div style={{ fontSize: '0.9rem', fontWeight: 600 }}>
                {state === 'selecting' && '⏳ Requesting access...'}
                {state === 'recording' && '🔴 Recording'}
                {state === 'paused' && '⏸ Paused'}
                {state === 'stopped' && '✓ Stopped'}
              </div>
              {state === 'stopped' && (
                <div style={{ fontSize: '0.8rem', color: '#888', marginTop: 8 }}>
                  Screenshots: {screenshotCountRef.current}
                </div>
              )}
            </div>
          )}

          {/* Upload Button */}
          {state === 'stopped' && (
            <button
              className="btn btn-primary"
              onClick={() => handleRecordingComplete(new Blob(chunksRef.current))}
              disabled={uploading || !title.trim()}
              style={{ width: '100%', padding: '12px 24px' }}
            >
              {uploading ? `⏳ Uploading (${uploadProgress}%)` : '📤 Upload & Annotate'}
            </button>
          )}
        </div>
      </div>

      {/* Hidden Canvas for Screenshots */}
      <canvas ref={canvasRef} style={{ display: 'none' }} />

      {/* Help Text */}
      <div style={{ marginTop: 40, padding: 24, background: '#f0f9ff', borderRadius: 8 }}>
        <h3 style={{ marginBottom: 12 }}>How to Use</h3>
        <ol style={{ lineHeight: 1.8, color: '#555' }}>
          <li><strong>Title:</strong> Enter what feedback you're giving (e.g., "Bug: checkout broken")</li>
          <li><strong>Record:</strong> Click "Start Recording" and select your screen</li>
          <li><strong>Talk:</strong> Narrate your feedback while showing the issue</li>
          <li><strong>Screenshot:</strong> Click "Take Screenshot" to capture key moments</li>
          <li><strong>Stop:</strong> Click "Stop" when done, then upload</li>
          <li><strong>Annotate:</strong> Draw boxes around UI elements and add detailed notes</li>
          <li><strong>Send to Claude:</strong> Claude Code will read your annotated feedback and generate fixes</li>
        </ol>
      </div>
    </main>
  );
}
