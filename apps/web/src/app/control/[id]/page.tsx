'use client';

import { useEffect, useRef, useState } from 'react';
import { useParams } from 'next/navigation';

type LiveAnnotation = {
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
};

type LiveSession = {
  id: string;
  title: string;
  status: 'idle' | 'selecting' | 'recording' | 'paused' | 'stopped';
  timestampSec: number;
  annotations: LiveAnnotation[];
  pendingDraft: {
    id: string;
    description?: string;
    voiceNoteDataUrl?: string;
    voiceNoteDurationSec?: number;
    createdAt: string;
  } | null;
  updatedAt: string;
  createdAt: string;
};

const API_BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001/api';

export default function ControllerPage() {
  const { id } = useParams<{ id: string }>();
  const [session, setSession] = useState<LiveSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [description, setDescription] = useState('');
  const [sending, setSending] = useState(false);
  const [voiceNoteDataUrl, setVoiceNoteDataUrl] = useState<string | undefined>();
  const [voiceNoteDurationSec, setVoiceNoteDurationSec] = useState<number | undefined>();
  const [isRecordingVoiceNote, setIsRecordingVoiceNote] = useState(false);
  const [voiceNoteSeconds, setVoiceNoteSeconds] = useState(0);

  const voiceNoteRecorderRef = useRef<MediaRecorder | null>(null);
  const voiceNoteStreamRef = useRef<MediaStream | null>(null);
  const voiceNoteChunksRef = useRef<Blob[]>([]);
  const voiceNoteTimerRef = useRef<NodeJS.Timeout | null>(null);

  async function loadSession() {
    try {
      const res = await fetch(`${API_BASE}/live-sessions/${id}`);
      if (!res.ok) throw new Error('Failed to load session');
      const json = (await res.json()) as { data: LiveSession };
      setSession(json.data);
    } catch (error) {
      console.error('[controller] load error:', error);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadSession();
    const interval = setInterval(loadSession, 1000);
    return () => {
      clearInterval(interval);
      if (voiceNoteTimerRef.current) clearInterval(voiceNoteTimerRef.current);
      if (voiceNoteStreamRef.current) {
        voiceNoteStreamRef.current.getTracks().forEach((track) => track.stop());
      }
    };
  }, [id]);

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
          setVoiceNoteDataUrl(dataUrl);
          setVoiceNoteDurationSec(voiceNoteSeconds || 30);
        } catch (error) {
          console.error('[controller] voice note error:', error);
        } finally {
          setIsRecordingVoiceNote(false);
          if (voiceNoteTimerRef.current) clearInterval(voiceNoteTimerRef.current);
          if (voiceNoteStreamRef.current) {
            voiceNoteStreamRef.current.getTracks().forEach((track) => track.stop());
            voiceNoteStreamRef.current = null;
          }
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
      console.error('[controller] voice note permission error:', error);
      alert('Could not start the controller voice note. Check microphone permissions and try again.');
    }
  }

  function stopVoiceNoteRecording() {
    if (voiceNoteRecorderRef.current && isRecordingVoiceNote) {
      voiceNoteRecorderRef.current.stop();
    }
  }

  async function sendDraft() {
    if (!description.trim() && !voiceNoteDataUrl) {
      alert('Add text or a voice note before sending.');
      return;
    }

    setSending(true);
    try {
      const res = await fetch(`${API_BASE}/live-sessions/${id}/drafts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: `draft_${Date.now()}`,
          description: description.trim(),
          voiceNoteDataUrl,
          voiceNoteDurationSec,
          createdAt: new Date().toISOString(),
        }),
      });

      if (!res.ok) throw new Error('Failed to send draft');

      setDescription('');
      setVoiceNoteDataUrl(undefined);
      setVoiceNoteDurationSec(undefined);
      await loadSession();
    } catch (error) {
      console.error('[controller] send error:', error);
      alert('Could not send the note to the recorder.');
    } finally {
      setSending(false);
    }
  }

  if (loading) return <p className="muted">Loading controller…</p>;
  if (!session) return <p className="muted">Session not found.</p>;

  return (
    <main style={{ maxWidth: 720, margin: '0 auto', padding: '24px' }}>
      <h1 style={{ marginBottom: 12 }}>Controller</h1>
      <p className="muted" style={{ marginBottom: 24 }}>
        Use this from desktop or mobile to prepare notes while the recorder view handles box placement and overlay.
      </p>

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', marginBottom: 8 }}>
          Live Session
        </div>
        <div className="bold" style={{ marginBottom: 6 }}>{session.title}</div>
        <div className="muted" style={{ lineHeight: 1.6 }}>
          Status: {session.status}
          <br />
          Recorder time: {session.timestampSec.toFixed(1)}s
          <br />
          Saved box notes: {session.annotations.length}
        </div>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', marginBottom: 8 }}>
          Note Draft
        </div>
        <textarea
          className="textarea"
          value={description}
          onChange={(event) => setDescription(event.target.value.slice(0, 1000))}
          placeholder="Add free-form text up to 1000 characters"
          maxLength={1000}
          style={{ width: '100%', minHeight: 120 }}
        />
        <div style={{ marginTop: 6, fontSize: '0.75rem', color: '#888', textAlign: 'right' }}>
          {description.length}/1000
        </div>

        <div style={{ marginTop: 16 }}>
          <div style={{ fontSize: '0.8rem', marginBottom: 6 }}>Optional voice note</div>
          {!isRecordingVoiceNote ? (
            <button className="btn btn-ghost" onClick={startVoiceNoteRecording}>
              🎙 Record Voice Note
            </button>
          ) : (
            <button className="btn btn-danger" onClick={stopVoiceNoteRecording}>
              ⏹ Stop Voice Note ({voiceNoteSeconds}s / 30s)
            </button>
          )}
          {voiceNoteDataUrl && (
            <div style={{ marginTop: 12 }}>
              <audio controls src={voiceNoteDataUrl} style={{ width: '100%' }} />
              <div style={{ fontSize: '0.75rem', color: '#888', marginTop: 4 }}>
                Voice note length: {voiceNoteDurationSec ?? 0}s
              </div>
            </div>
          )}
        </div>

        <button
          className="btn btn-primary"
          onClick={sendDraft}
          disabled={sending || (!description.trim() && !voiceNoteDataUrl)}
          style={{ width: '100%', marginTop: 16 }}
        >
          {sending ? 'Sending…' : 'Send Note To Recorder'}
        </button>
      </div>

      <div className="card" style={{ marginBottom: 16 }}>
        <div style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', marginBottom: 8 }}>
          Recorder Handoff State
        </div>
        {session.pendingDraft ? (
          <div style={{ lineHeight: 1.6 }}>
            <div className="bold" style={{ marginBottom: 4 }}>Pending box note ready</div>
            <div className="muted">
              The recorder view should now draw a box and save this note at the current timestamp.
            </div>
          </div>
        ) : (
          <p className="muted">No pending note draft right now.</p>
        )}
      </div>

      <div className="card">
        <div style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', marginBottom: 8 }}>
          Saved Box Notes
        </div>
        <div className="stack gap-8">
          {session.annotations.length === 0 ? (
            <p className="muted">No saved box notes yet.</p>
          ) : (
            session.annotations.map((annotation) => (
              <div key={annotation.id} style={{ padding: 10, background: 'var(--bg)', borderRadius: 6 }}>
                <div style={{ fontSize: '0.75rem', color: 'var(--muted)', marginBottom: 4 }}>
                  {annotation.timestamp.toFixed(1)}s
                </div>
                {annotation.description ? (
                  <div style={{ marginBottom: 6 }}>{annotation.description}</div>
                ) : (
                  <div style={{ marginBottom: 6, color: '#888' }}>Voice-note only box</div>
                )}
                {annotation.voiceNoteDataUrl && (
                  <audio controls src={annotation.voiceNoteDataUrl} style={{ width: '100%' }} />
                )}
              </div>
            ))
          )}
        </div>
      </div>
    </main>
  );
}

