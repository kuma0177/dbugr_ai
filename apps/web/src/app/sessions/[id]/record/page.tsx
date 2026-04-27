'use client';

import { useState, useRef, useEffect } from 'react';
import { useParams, useRouter } from 'next/navigation';

interface Box {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  notes: Note[];
}

interface Note {
  id: string;
  type: 'voice' | 'text';
  content: string; // For text or transcribed voice
  duration?: number; // For voice (seconds)
  timestamp: number; // When note was added (ms since session start)
}

export default function RecordPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [sessionStartTime] = useState(Date.now());

  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const [boxes, setBoxes] = useState<Box[]>([]);
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawStart, setDrawStart] = useState<{ x: number; y: number } | null>(null);
  const [currentBox, setCurrentBox] = useState<Box | null>(null);
  const [selectedBoxId, setSelectedBoxId] = useState<string | null>(null);
  const [showNoteForm, setShowNoteForm] = useState(false);
  const [noteType, setNoteType] = useState<'voice' | 'text'>('text');
  const [noteText, setNoteText] = useState('');
  const [isRecordingVoice, setIsRecordingVoice] = useState(false);
  const [voiceTimer, setVoiceTimer] = useState(0);
  const voiceRecorderRef = useRef<MediaRecorder | null>(null);
  const voiceChunksRef = useRef<Blob[]>([]);

  // Start screen recording
  useEffect(() => {
    async function startRecording() {
      try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({
          video: { cursor: 'always' } as any,
          audio: false,
        });

        if (videoRef.current) {
          videoRef.current.srcObject = screenStream;
        }

        const mediaRecorder = new MediaRecorder(screenStream, {
          mimeType: 'video/webm;codecs=vp9,opus',
        });

        mediaRecorder.ondataavailable = (e) => {
          if (e.data.size > 0) {
            chunksRef.current.push(e.data);
          }
        };

        mediaRecorder.start();
        mediaRecorderRef.current = mediaRecorder;
        streamRef.current = screenStream;
      } catch (err) {
        console.error('[record] Error starting screen capture:', err);
        alert('Failed to start screen recording. Please try again.');
        window.close();
      }
    }

    startRecording();
  }, []);

  // Handle right-click to draw box
  const handleContextMenu = (e: React.MouseEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (!canvasRef.current) return;

    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    if (boxes.length >= 5) {
      alert('Maximum 5 boxes per session');
      return;
    }

    setDrawStart({ x, y });
    setIsDrawing(true);
  };

  const handleMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isDrawing || !drawStart || !canvasRef.current) return;

    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const newBox: Box = {
      id: `box_temp`,
      x: Math.min(drawStart.x, x),
      y: Math.min(drawStart.y, y),
      width: Math.abs(x - drawStart.x),
      height: Math.abs(y - drawStart.y),
      notes: [],
    };

    setCurrentBox(newBox);
  };

  const handleMouseUp = () => {
    if (isDrawing && currentBox && currentBox.width > 20 && currentBox.height > 20) {
      const newBox: Box = {
        id: `box_${Date.now()}`,
        x: currentBox.x,
        y: currentBox.y,
        width: currentBox.width,
        height: currentBox.height,
        notes: [],
      };

      setBoxes([...boxes, newBox]);
      setSelectedBoxId(newBox.id);
      setShowNoteForm(true);
    }

    setIsDrawing(false);
    setDrawStart(null);
    setCurrentBox(null);
  };

  // Voice note recording
  const startVoiceRecording = async () => {
    try {
      const audioStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
        video: false,
      });

      const voiceRecorder = new MediaRecorder(audioStream);
      voiceChunksRef.current = [];

      voiceRecorder.ondataavailable = (e) => {
        voiceChunksRef.current.push(e.data);
      };

      voiceRecorder.onstop = async () => {
        const blob = new Blob(voiceChunksRef.current, { type: 'audio/webm' });
        // For now, use blob size as placeholder for transcription
        const content = `[Voice note: ${voiceTimer}s]`;
        addNoteToBox('voice', content, voiceTimer);
        audioStream.getTracks().forEach((track) => track.stop());
      };

      voiceRecorder.start();
      voiceRecorderRef.current = voiceRecorder;
      setIsRecordingVoice(true);
      setVoiceTimer(0);

      // Timer
      const interval = setInterval(() => {
        setVoiceTimer((prev) => {
          if (prev >= 30) {
            voiceRecorder.stop();
            clearInterval(interval);
            return 30;
          }
          return prev + 1;
        });
      }, 1000);
    } catch (err) {
      console.error('[record] Voice recording error:', err);
      alert('Failed to start voice recording');
    }
  };

  const stopVoiceRecording = () => {
    if (voiceRecorderRef.current && isRecordingVoice) {
      voiceRecorderRef.current.stop();
      setIsRecordingVoice(false);
    }
  };

  const addNoteToBox = (type: 'voice' | 'text', content: string, duration?: number) => {
    if (!selectedBoxId) return;
    if (type === 'text' && content.length > 1000) {
      alert('Text note must be under 1000 characters');
      return;
    }

    const newNote: Note = {
      id: `note_${Date.now()}`,
      type,
      content,
      duration,
      timestamp: Date.now() - sessionStartTime,
    };

    setBoxes(
      boxes.map((box) =>
        box.id === selectedBoxId ? { ...box, notes: [...box.notes, newNote] } : box
      )
    );

    setShowNoteForm(false);
    setNoteText('');
    setNoteType('text');
  };

  const handleSubmitSession = async () => {
    if (boxes.length === 0) {
      alert('Please add at least one box with notes');
      return;
    }

    // Stop screen recording
    if (mediaRecorderRef.current) {
      mediaRecorderRef.current.stop();
    }

    // Store boxes in session storage
    sessionStorage.setItem(`session_${id}_boxes`, JSON.stringify(boxes));

    // Redirect to summary
    window.location.href = `/sessions/${id}/summary`;
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: '#000',
        display: 'flex',
        flexDirection: 'column',
      }}
      onContextMenu={handleContextMenu}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
    >
      {/* Video - Full Screen */}
      <video
        ref={videoRef}
        autoPlay
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          objectFit: 'cover',
        }}
      />

      {/* Canvas Overlay for Boxes */}
      <canvas
        ref={canvasRef}
        style={{
          position: 'absolute',
          inset: 0,
          width: '100%',
          height: '100%',
          cursor: 'crosshair',
        }}
        width={window.innerWidth}
        height={window.innerHeight}
      />

      {/* Draw boxes */}
      {boxes.map((box) => (
        <div
          key={box.id}
          style={{
            position: 'absolute',
            left: box.x,
            top: box.y,
            width: box.width,
            height: box.height,
            border: selectedBoxId === box.id ? '3px solid #ef4444' : '2px solid #ef4444',
            background: 'rgba(239, 68, 68, 0.1)',
            cursor: 'pointer',
            zIndex: 10,
          }}
          onClick={() => setSelectedBoxId(box.id)}
        >
          <div style={{ padding: 4, fontSize: '12px', color: '#fff', background: 'rgba(0,0,0,0.7)' }}>
            {box.notes.length} note{box.notes.length !== 1 ? 's' : ''}
          </div>
        </div>
      ))}

      {/* Current drawing box */}
      {currentBox && (
        <div
          style={{
            position: 'absolute',
            left: currentBox.x,
            top: currentBox.y,
            width: currentBox.width,
            height: currentBox.height,
            border: '2px dashed #fbbf24',
            background: 'rgba(251, 191, 36, 0.05)',
            pointerEvents: 'none',
            zIndex: 5,
          }}
        />
      )}

      {/* HUD - Box counter */}
      <div
        style={{
          position: 'fixed',
          top: 16,
          right: 16,
          background: 'rgba(0, 0, 0, 0.8)',
          color: '#fff',
          padding: '12px 16px',
          borderRadius: 8,
          fontSize: '14px',
          zIndex: 100,
        }}
      >
        Boxes: {boxes.length}/5
      </div>

      {/* HUD - Instructions */}
      <div
        style={{
          position: 'fixed',
          bottom: 16,
          left: 16,
          background: 'rgba(0, 0, 0, 0.8)',
          color: '#fff',
          padding: '12px 16px',
          borderRadius: 8,
          fontSize: '12px',
          zIndex: 100,
          maxWidth: 250,
        }}
      >
        <div style={{ marginBottom: 8, fontWeight: 600 }}>Recording...</div>
        <div>Right-click + drag to draw box</div>
        <div>Click box to add notes (text or voice)</div>
        <div style={{ marginTop: 8 }}>Max: 5 boxes, voice 30s, text 1000 chars</div>
      </div>

      {/* Note Form Modal */}
      {showNoteForm && selectedBoxId && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0, 0, 0, 0.7)',
            display: 'flex',
            alignItems: 'flex-end',
            zIndex: 1000,
          }}
          onClick={() => !isRecordingVoice && setShowNoteForm(false)}
        >
          <div
            style={{
              background: '#fff',
              width: '100%',
              maxWidth: 600,
              padding: 24,
              borderRadius: '12px 12px 0 0',
              boxShadow: '0 -4px 20px rgba(0,0,0,0.2)',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ marginBottom: 16 }}>Add Note to Box</h3>

            {/* Toggle voice/text */}
            <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
              <button
                className={`btn ${noteType === 'text' ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => setNoteType('text')}
                disabled={isRecordingVoice}
              >
                📝 Text
              </button>
              <button
                className={`btn ${noteType === 'voice' ? 'btn-primary' : 'btn-ghost'}`}
                onClick={() => setNoteType('voice')}
                disabled={isRecordingVoice}
              >
                🎤 Voice
              </button>
            </div>

            {noteType === 'text' ? (
              <>
                <textarea
                  className="textarea"
                  placeholder="Describe the issue... (max 1000 characters)"
                  value={noteText}
                  onChange={(e) => setNoteText(e.target.value.slice(0, 1000))}
                  style={{ width: '100%', height: 100, marginBottom: 8 }}
                />
                <div style={{ fontSize: '0.8rem', color: '#666', marginBottom: 16 }}>
                  {noteText.length}/1000
                </div>
              </>
            ) : (
              <div style={{ marginBottom: 16 }}>
                {isRecordingVoice ? (
                  <>
                    <div
                      style={{
                        padding: 16,
                        background: '#fef2f2',
                        borderRadius: 8,
                        textAlign: 'center',
                        marginBottom: 12,
                      }}
                    >
                      <div style={{ fontSize: '1.5rem', fontWeight: 700, color: '#dc2626' }}>
                        {voiceTimer}s / 30s
                      </div>
                    </div>
                    <button
                      className="btn btn-danger"
                      onClick={stopVoiceRecording}
                      style={{ width: '100%' }}
                    >
                      Stop Recording
                    </button>
                  </>
                ) : (
                  <button
                    className="btn btn-primary"
                    onClick={startVoiceRecording}
                    style={{ width: '100%' }}
                  >
                    🎤 Start Recording (max 30s)
                  </button>
                )}
              </div>
            )}

            {/* Actions */}
            <div style={{ display: 'flex', gap: 8 }}>
              <button
                className="btn btn-ghost"
                onClick={() => !isRecordingVoice && setShowNoteForm(false)}
                disabled={isRecordingVoice}
                style={{ flex: 1 }}
              >
                Cancel
              </button>
              <button
                className="btn btn-primary"
                onClick={() => addNoteToBox(noteType, noteText)}
                disabled={!noteText.trim() || isRecordingVoice}
                style={{ flex: 1 }}
              >
                Add Note
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Submit Button */}
      <div
        style={{
          position: 'fixed',
          bottom: 16,
          right: 16,
          zIndex: 100,
        }}
      >
        <button
          className="btn btn-primary"
          onClick={handleSubmitSession}
          style={{
            padding: '12px 24px',
            fontSize: '1rem',
            background: '#059669',
          }}
        >
          ✓ Submit Session
        </button>
      </div>
    </div>
  );
}
