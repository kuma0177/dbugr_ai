'use client';

import { useEffect, useState, useRef } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { api } from '@/lib/api';
import type { FeedbackSession } from '@feedbackagent/shared';

interface Annotation {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  description: string;
  timestamp: number;
  color: string;
}

interface DrawingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

export default function AnnotatePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [session, setSession] = useState<FeedbackSession | null>(null);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const [annotations, setAnnotations] = useState<Annotation[]>([]);
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawingBox, setDrawingBox] = useState<DrawingBox | null>(null);
  const [startPos, setStartPos] = useState<{ x: number; y: number } | null>(null);
  const [selectedColor, setSelectedColor] = useState('#ef4444');
  const [annotationText, setAnnotationText] = useState('');
  const [selectedAnnotationId, setSelectedAnnotationId] = useState<string | null>(null);

  async function loadSession() {
    try {
      const data = await api.sessions.get(id);
      setSession(data);
    } catch (e) {
      console.error('[annotate] Error loading session:', e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadSession();
  }, [id]);

  // Redraw canvas when annotations change
  useEffect(() => {
    redrawCanvas();
  }, [annotations, drawingBox, selectedColor]);

  // Handle canvas drawing
  const handleCanvasMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    setStartPos({ x, y });
    setIsDrawing(true);
  };

  const handleCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!isDrawing || !startPos || !canvasRef.current) return;
    const rect = canvasRef.current.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;
    setDrawingBox({
      x: Math.min(startPos.x, x),
      y: Math.min(startPos.y, y),
      width: Math.abs(x - startPos.x),
      height: Math.abs(y - startPos.y),
    });
    redrawCanvas();
  };

  const handleCanvasMouseUp = () => {
    setIsDrawing(false);
  };

  const redrawCanvas = () => {
    if (!canvasRef.current || !videoRef.current) return;
    const ctx = canvasRef.current.getContext('2d');
    if (!ctx) return;

    // Draw current video frame
    try {
      ctx.drawImage(videoRef.current, 0, 0, canvasRef.current.width, canvasRef.current.height);
    } catch (e) {
      // Video not ready yet
      ctx.fillStyle = '#222';
      ctx.fillRect(0, 0, canvasRef.current.width, canvasRef.current.height);
      ctx.fillStyle = '#888';
      ctx.font = '16px Arial';
      ctx.textAlign = 'center';
      ctx.fillText('Video loading...', canvasRef.current.width / 2, canvasRef.current.height / 2);
    }

    // Redraw all annotations
    annotations.forEach((ann) => {
      ctx.strokeStyle = ann.color;
      ctx.lineWidth = 2;
      ctx.strokeRect(ann.x, ann.y, ann.width, ann.height);

      // Draw label background
      ctx.fillStyle = ann.color;
      ctx.globalAlpha = 0.8;
      ctx.fillRect(ann.x + 4, ann.y - 20, ann.description.substring(0, 20).length * 7, 16);
      ctx.globalAlpha = 1;

      // Draw label text
      ctx.fillStyle = '#fff';
      ctx.font = '12px monospace';
      ctx.fillText(ann.description.substring(0, 20), ann.x + 6, ann.y - 6);
    });

    // Draw current drawing box
    if (drawingBox) {
      ctx.strokeStyle = selectedColor;
      ctx.lineWidth = 2;
      ctx.setLineDash([5, 5]);
      ctx.strokeRect(drawingBox.x, drawingBox.y, drawingBox.width, drawingBox.height);
      ctx.setLineDash([]);
    }
  };

  const handleAddAnnotation = () => {
    if (!drawingBox || !annotationText.trim()) {
      alert('Please draw a box and enter a description');
      return;
    }

    const newAnnotation: Annotation = {
      id: `ann_${Date.now()}`,
      x: drawingBox.x,
      y: drawingBox.y,
      width: drawingBox.width,
      height: drawingBox.height,
      description: annotationText,
      timestamp: currentTime,
      color: selectedColor,
    };

    setAnnotations([...annotations, newAnnotation]);
    setDrawingBox(null);
    setAnnotationText('');
    setSelectedColor('#ef4444');
    redrawCanvas();
  };

  const handleDeleteAnnotation = (annId: string) => {
    setAnnotations(annotations.filter((a) => a.id !== annId));
    setSelectedAnnotationId(null);
    redrawCanvas();
  };

  const handleEditAnnotation = (ann: Annotation) => {
    setSelectedAnnotationId(ann.id);
    setAnnotationText(ann.description);
    setSelectedColor(ann.color);
    setDrawingBox({
      x: ann.x,
      y: ann.y,
      width: ann.width,
      height: ann.height,
    });
  };

  const handleUpdateAnnotation = () => {
    if (!selectedAnnotationId || !drawingBox || !annotationText.trim()) {
      alert('Please complete the annotation');
      return;
    }

    setAnnotations(
      annotations.map((a) =>
        a.id === selectedAnnotationId
          ? {
              ...a,
              x: drawingBox.x,
              y: drawingBox.y,
              width: drawingBox.width,
              height: drawingBox.height,
              description: annotationText,
              color: selectedColor,
            }
          : a
      )
    );
    setSelectedAnnotationId(null);
    setDrawingBox(null);
    setAnnotationText('');
    setSelectedColor('#ef4444');
    redrawCanvas();
  };

  const handleFinalize = async () => {
    if (!session) return;
    setSubmitting(true);
    try {
      // Prepare cursor events from annotations
      const cursorEvents = annotations.map((ann) => ({
        timestampMs: ann.timestamp * 1000,
        x: ann.x + ann.width / 2,
        y: ann.y + ann.height / 2,
        type: 'click' as const,
      }));

      // Call finalize endpoint
      const res = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/feedback-sessions/${id}/finalize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          durationMs: Math.round(duration * 1000),
          cursorEvents,
        }),
      });

      if (!res.ok) {
        throw new Error('Failed to finalize session');
      }

      // Store annotations in localStorage temporarily
      sessionStorage.setItem(`annotations_${id}`, JSON.stringify(annotations));

      // Redirect to task panel
      alert('✓ Feedback finalized! Moving to task panel.');
      router.push(`/sessions/${id}`);
    } catch (err) {
      console.error('[annotate] Finalize error:', err);
      alert('Failed to finalize session. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) return <p className="muted">Loading…</p>;
  if (!session) return <p className="muted">Session not found.</p>;

  return (
    <main style={{ maxWidth: 1400, margin: '0 auto', padding: '24px' }}>
      <div className="row gap-12" style={{ marginBottom: 8 }}>
        <a href={`/sessions/${id}`} className="muted" style={{ fontSize: '0.875rem' }}>
          ← Back to Session
        </a>
      </div>

      <h1 style={{ marginBottom: 24 }}>Annotate Feedback</h1>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 24 }}>
        {/* Canvas Area */}
        <div>
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', marginBottom: 8, fontWeight: 600 }}>
              Drawing Canvas
            </label>
            <div
              style={{
                background: '#1a1a1a',
                borderRadius: 8,
                overflow: 'hidden',
                aspectRatio: '16 / 9',
                position: 'relative',
                marginBottom: 8,
              }}
            >
              <canvas
                ref={canvasRef}
                width={1280}
                height={720}
                style={{
                  width: '100%',
                  height: '100%',
                  cursor: isDrawing ? 'crosshair' : 'default',
                  display: 'block',
                }}
                onMouseDown={handleCanvasMouseDown}
                onMouseMove={handleCanvasMouseMove}
                onMouseUp={handleCanvasMouseUp}
                onMouseLeave={handleCanvasMouseUp}
              />
            </div>
            <p className="muted" style={{ fontSize: '0.8rem' }}>
              Click and drag to draw a box. Describe what you're marking.
            </p>
          </div>

          {/* Timeline Controls */}
          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', marginBottom: 8, fontWeight: 600 }}>
              Timeline ({(currentTime).toFixed(1)}s / {(duration).toFixed(1)}s)
            </label>
            <input
              type="range"
              min="0"
              max={duration || 0}
              step="0.1"
              value={currentTime}
              onChange={(e) => {
                const time = parseFloat(e.target.value);
                setCurrentTime(time);
                if (videoRef.current) {
                  videoRef.current.currentTime = time;
                  // Force canvas redraw
                  setTimeout(() => redrawCanvas(), 50);
                }
              }}
              style={{ width: '100%' }}
            />
            <div className="row gap-8" style={{ marginTop: 8 }}>
              <button
                className="btn btn-ghost"
                onClick={() => {
                  if (videoRef.current) {
                    if (videoRef.current.paused) {
                      videoRef.current.play();
                    } else {
                      videoRef.current.pause();
                    }
                  }
                }}
              >
                {videoRef.current?.paused ? '▶ Play' : '⏸ Pause'}
              </button>
              <button
                className="btn btn-ghost"
                onClick={() => {
                  if (videoRef.current) videoRef.current.currentTime -= 5;
                }}
              >
                ⏪ -5s
              </button>
              <button
                className="btn btn-ghost"
                onClick={() => {
                  if (videoRef.current) videoRef.current.currentTime += 5;
                }}
              >
                ⏩ +5s
              </button>
            </div>
          </div>

          {/* Hidden Video Element */}
          <video
            ref={videoRef}
            src={session.videoUrl}
            style={{ display: 'none' }}
            onTimeUpdate={() => {
              if (videoRef.current) {
                setCurrentTime(videoRef.current.currentTime);
                redrawCanvas();
              }
            }}
            onLoadedMetadata={() => videoRef.current && setDuration(videoRef.current.duration)}
            onPlay={() => {
              // Video is playing, canvas updates via onTimeUpdate
            }}
          />
        </div>

        {/* Sidebar */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Drawing Controls */}
          <div className="card">
            <div style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', marginBottom: 8 }}>
              Drawing Tools
            </div>
            <div className="stack gap-8">
              <div>
                <label style={{ fontSize: '0.8rem', marginBottom: 4, display: 'block' }}>Color</label>
                <div className="row gap-4" style={{ flexWrap: 'wrap' }}>
                  {['#ef4444', '#f97316', '#eab308', '#22c55e', '#3b82f6', '#8b5cf6', '#ec4899'].map((c) => (
                    <button
                      key={c}
                      onClick={() => setSelectedColor(c)}
                      style={{
                        width: 28,
                        height: 28,
                        background: c,
                        border: selectedColor === c ? '2px solid white' : '2px solid var(--border)',
                        borderRadius: 4,
                        cursor: 'pointer',
                      }}
                    />
                  ))}
                </div>
              </div>

              <div>
                <label style={{ fontSize: '0.8rem', marginBottom: 4, display: 'block' }}>Description</label>
                <textarea
                  className="textarea"
                  value={annotationText}
                  onChange={(e) => setAnnotationText(e.target.value)}
                  placeholder="What issue is this pointing to?"
                  style={{ width: '100%', height: 60 }}
                />
              </div>

              {selectedAnnotationId ? (
                <div className="row gap-4">
                  <button className="btn btn-primary" onClick={handleUpdateAnnotation} style={{ flex: 1 }}>
                    Update
                  </button>
                  <button
                    className="btn btn-ghost"
                    onClick={() => {
                      setSelectedAnnotationId(null);
                      setDrawingBox(null);
                      setAnnotationText('');
                      redrawCanvas();
                    }}
                    style={{ flex: 1 }}
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  className="btn btn-primary"
                  onClick={handleAddAnnotation}
                  style={{ width: '100%' }}
                  disabled={!drawingBox || !annotationText.trim()}
                >
                  + Add Annotation
                </button>
              )}
            </div>
          </div>

          {/* Annotations List */}
          <div className="card">
            <div style={{ fontSize: '0.75rem', fontWeight: 700, textTransform: 'uppercase', marginBottom: 8 }}>
              Annotations ({annotations.length})
            </div>
            <div className="stack gap-8" style={{ maxHeight: 400, overflowY: 'auto' }}>
              {annotations.length === 0 ? (
                <p className="muted" style={{ fontSize: '0.8rem' }}>
                  No annotations yet.
                </p>
              ) : (
                annotations.map((ann) => (
                  <div
                    key={ann.id}
                    style={{
                      padding: 8,
                      background: 'var(--bg)',
                      borderLeft: `3px solid ${ann.color}`,
                      borderRadius: 4,
                      cursor: 'pointer',
                    }}
                    onClick={() => handleEditAnnotation(ann)}
                  >
                    <div style={{ fontSize: '0.75rem', color: 'var(--muted)', marginBottom: 4 }}>
                      {(ann.timestamp).toFixed(1)}s
                    </div>
                    <div style={{ fontSize: '0.8rem', fontWeight: 500, marginBottom: 4 }}>
                      {ann.description}
                    </div>
                    <button
                      className="btn btn-ghost"
                      style={{ fontSize: '0.75rem', padding: '2px 6px' }}
                      onClick={(e) => {
                        e.stopPropagation();
                        handleDeleteAnnotation(ann.id);
                      }}
                    >
                      Delete
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>

          {/* Actions */}
          <button
            className="btn btn-primary"
            onClick={handleFinalize}
            disabled={submitting || annotations.length === 0}
            style={{ width: '100%', padding: '12px 24px' }}
          >
            {submitting ? '⏳ Finalizing…' : '✓ Finalize & Continue'}
          </button>
        </div>
      </div>
    </main>
  );
}
