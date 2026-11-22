import { type PointerEvent as ReactPointerEvent, useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { errorMessage } from '../api/client';
import { api } from '../api/endpoints';
import type { PresenceUser, Stroke, StrokeTool } from '../api/types';
import { useToast } from '../components/Toasts';
import { Modal, Spinner } from '../components/ui';
import { getHub, onHubReconnected } from '../realtime/hub';

/** Logical canvas size shared with the server (Stroke.CanvasWidth/Height). Every client scales it to fit. */
export const CANVAS = { width: 1600, height: 1000 };

const COLORS = ['#1f2937', '#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4', '#3b82f6', '#8b5cf6', '#ec4899'];
const SIZES = [2, 4, 8, 16];
const MAX_POINTS = 4900; // server allows 5000; longer lines are split into several strokes
const PROGRESS_EVERY_MS = 50;
const PREVIEW_TTL_MS = 5000;

type Tool = StrokeTool | 'Eraser';

interface LiveStroke {
  id: string;
  tool: StrokeTool;
  color: string;
  width: number;
  points: number[];
}
interface Preview extends LiveStroke {
  user: PresenceUser;
  updatedAt: number;
}

interface Props {
  boardId: string;
  canEdit: boolean;
  myUserId: string;
}

export function Whiteboard({ boardId, canEdit, myUserId }: Props) {
  const toast = useToast();
  const [strokes, setStrokes] = useState<Stroke[] | null>(null);
  const [tool, setTool] = useState<Tool>('Pen');
  const [color, setColor] = useState(COLORS[0]);
  const [size, setSize] = useState(SIZES[1]);
  const [confirmClear, setConfirmClear] = useState(false);
  const [layout, setLayout] = useState({ scale: 0, width: 0, height: 0 });

  const wrapRef = useRef<HTMLDivElement>(null);
  const baseRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);

  // Mutable drawing state lives in refs so pointer events don't re-render React on every move.
  const strokesRef = useRef<Stroke[]>([]);
  const current = useRef<(LiveStroke & { sent: number }) | null>(null);
  const erasing = useRef<Set<string> | null>(null);
  const pointer = useRef<{ x: number; y: number } | null>(null);
  const previews = useRef(new Map<string, Preview>());
  const myStrokes = useRef<string[]>([]); // for undo, newest last
  const overlayDirty = useRef(true);
  const scaleRef = useRef(1);

  useEffect(() => {
    strokesRef.current = strokes ?? [];
  }, [strokes]);

  const lineWidth = (t: StrokeTool) => (t === 'Highlighter' ? size * 4 : size);
  const eraserRadius = Math.max(8, size * 2);

  // ---- Loading and live updates ----

  const load = useCallback(async () => {
    try {
      setStrokes(await api.listStrokes(boardId));
    } catch (e) {
      toast(errorMessage(e), 'error');
      setStrokes((s) => s ?? []);
    }
  }, [boardId, toast]);

  useEffect(() => {
    void load();
    const hub = getHub();
    const mine = (id: string) => id === boardId;

    const onProgress = (
      id: string,
      strokeId: string,
      user: PresenceUser,
      t: StrokeTool,
      c: string,
      w: number,
      points: number[],
    ) => {
      if (!mine(id)) return;
      const preview = previews.current.get(strokeId) ?? { id: strokeId, user, tool: t, color: c, width: w, points: [], updatedAt: 0 };
      preview.points.push(...points);
      preview.updatedAt = Date.now();
      previews.current.set(strokeId, preview);
      overlayDirty.current = true;
    };
    const onAdded = (stroke: Stroke) => {
      if (!mine(stroke.boardId)) return;
      previews.current.delete(stroke.id);
      overlayDirty.current = true;
      setStrokes((s) => (s?.some((x) => x.id === stroke.id) ? s : [...(s ?? []), stroke]));
    };
    const onErased = (id: string, ids: string[]) => {
      if (!mine(id)) return;
      const gone = new Set(ids);
      setStrokes((s) => s?.filter((x) => !gone.has(x.id)) ?? null);
    };
    const onCleared = (id: string) => {
      if (!mine(id)) return;
      previews.current.clear();
      overlayDirty.current = true;
      setStrokes([]);
    };

    hub.on('StrokeProgress', onProgress);
    hub.on('StrokeAdded', onAdded);
    hub.on('StrokesErased', onErased);
    hub.on('DrawingCleared', onCleared);
    const offReconnect = onHubReconnected(() => void load());
    return () => {
      hub.off('StrokeProgress', onProgress);
      hub.off('StrokeAdded', onAdded);
      hub.off('StrokesErased', onErased);
      hub.off('DrawingCleared', onCleared);
      offReconnect();
    };
  }, [boardId, load]);

  // ---- Sizing: fit the logical canvas into the available space ----

  useLayoutEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const fit = () => {
      const scale = Math.max(0.1, Math.min(wrap.clientWidth / CANVAS.width, wrap.clientHeight / CANVAS.height));
      scaleRef.current = scale;
      setLayout({ scale, width: Math.floor(CANVAS.width * scale), height: Math.floor(CANVAS.height * scale) });
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(wrap);
    return () => observer.disconnect();
  }, []);

  const prepare = (canvas: HTMLCanvasElement | null) => {
    if (!canvas || !layout.scale) return null;
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(layout.width * dpr);
    const h = Math.round(layout.height * dpr);
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.setTransform(dpr * layout.scale, 0, 0, dpr * layout.scale, 0, 0);
    return ctx;
  };

  // Saved strokes: redrawn only when they change or the size changes.
  useEffect(() => {
    const ctx = prepare(baseRef.current);
    if (!ctx) return;
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, CANVAS.width, CANVAS.height);
    for (const s of strokes ?? []) drawStroke(ctx, s);
    overlayDirty.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [strokes, layout]);

  // In-progress strokes (mine and others'), drawn every animation frame when something changed.
  useEffect(() => {
    let frame = 0;
    const tick = () => {
      frame = requestAnimationFrame(tick);
      const now = Date.now();
      for (const [id, p] of previews.current) {
        if (now - p.updatedAt > PREVIEW_TTL_MS) {
          previews.current.delete(id); // the author's save failed or they disconnected
          overlayDirty.current = true;
        }
      }
      if (!overlayDirty.current) return;
      overlayDirty.current = false;
      const ctx = prepare(overlayRef.current);
      if (!ctx) return;
      const scale = scaleRef.current;
      for (const p of previews.current.values()) {
        drawStroke(ctx, p);
        drawNameTag(ctx, p, scale);
      }
      if (current.current) drawStroke(ctx, current.current);
      if (tool === 'Eraser' && pointer.current && canEdit) {
        ctx.beginPath();
        ctx.arc(pointer.current.x, pointer.current.y, eraserRadius, 0, Math.PI * 2);
        ctx.lineWidth = 1.5 / scale;
        ctx.strokeStyle = '#64748b';
        ctx.stroke();
      }
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [layout, tool, eraserRadius, canEdit]);

  // Stream the stroke being drawn to everyone else.
  useEffect(() => {
    const timer = setInterval(() => {
      const s = current.current;
      const hub = getHub();
      if (!s || s.points.length <= s.sent || hub.state !== 'Connected') return;
      const chunk = s.points.slice(s.sent, s.sent + 1000);
      s.sent += chunk.length;
      hub.send('DrawProgress', s.id, s.tool, s.color, s.width, chunk).catch(() => undefined);
    }, PROGRESS_EVERY_MS);
    return () => clearInterval(timer);
  }, []);

  // ---- Saving ----

  const commit = (s: LiveStroke) => {
    const optimistic: Stroke = { ...s, boardId, authorId: myUserId, createdAt: new Date().toISOString() };
    setStrokes((all) => [...(all ?? []), optimistic]);
    myStrokes.current.push(s.id);
    api
      .addStroke(boardId, { id: s.id, tool: s.tool, color: s.color, width: s.width, points: s.points })
      .then((saved) => setStrokes((all) => all?.map((x) => (x.id === saved.id ? saved : x)) ?? null))
      .catch((e) => {
        setStrokes((all) => all?.filter((x) => x.id !== s.id) ?? null);
        toast(`Couldn't save that line: ${errorMessage(e)}`, 'error');
      });
  };

  const erase = (ids: string[]) => {
    if (ids.length === 0) return;
    const gone = new Set(ids);
    setStrokes((all) => all?.filter((x) => !gone.has(x.id)) ?? null);
    for (let i = 0; i < ids.length; i += 500) {
      api.eraseStrokes(boardId, ids.slice(i, i + 500)).catch((e) => {
        toast(errorMessage(e), 'error');
        void load();
      });
    }
  };

  const undo = useCallback(() => {
    const existing = new Set(strokesRef.current.map((s) => s.id));
    while (myStrokes.current.length) {
      const id = myStrokes.current.pop()!;
      if (existing.has(id)) {
        erase([id]);
        return;
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!canEdit) return;
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.closest('input, textarea, [contenteditable]')) return;
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        undo();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [canEdit, undo]);

  // ---- Pointer input ----

  const toLogical = (e: { clientX: number; clientY: number }) => {
    const rect = overlayRef.current!.getBoundingClientRect();
    const scale = scaleRef.current;
    return {
      x: clamp((e.clientX - rect.left) / scale, 0, CANVAS.width),
      y: clamp((e.clientY - rect.top) / scale, 0, CANVAS.height),
    };
  };

  const eraseAt = (x: number, y: number) => {
    const hits = erasing.current;
    if (!hits) return;
    const found: string[] = [];
    for (const s of strokesRef.current) {
      if (!hits.has(s.id) && hitsStroke(s, x, y, eraserRadius)) {
        hits.add(s.id);
        found.push(s.id);
      }
    }
    if (found.length) {
      const gone = new Set(found);
      setStrokes((all) => all?.filter((x) => !gone.has(x.id)) ?? null);
    }
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!canEdit || e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    const { x, y } = toLogical(e);
    if (tool === 'Eraser') {
      erasing.current = new Set();
      eraseAt(x, y);
    } else {
      current.current = { id: crypto.randomUUID(), tool, color, width: lineWidth(tool), points: [x, y], sent: 0 };
    }
    overlayDirty.current = true;
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLCanvasElement>) => {
    const events = e.nativeEvent.getCoalescedEvents?.() ?? [e.nativeEvent];
    for (const ev of events.length ? events : [e.nativeEvent]) {
      const { x, y } = toLogical(ev);
      pointer.current = { x, y };
      const s = current.current;
      if (s) {
        const n = s.points.length;
        if (Math.hypot(x - s.points[n - 2], y - s.points[n - 1]) < 1) continue;
        s.points.push(x, y);
        if (s.points.length / 2 >= MAX_POINTS) {
          // Very long line: save this part and carry on seamlessly in a new stroke.
          commit(s);
          current.current = { ...s, id: crypto.randomUUID(), points: [x, y], sent: 0 };
        }
      } else if (erasing.current) {
        eraseAt(x, y);
      }
    }
    overlayDirty.current = true;
  };

  const onPointerUp = () => {
    const s = current.current;
    current.current = null;
    if (s) commit(s);
    if (erasing.current) {
      const ids = [...erasing.current];
      erasing.current = null;
      erase(ids);
    }
    overlayDirty.current = true;
  };

  const download = () => {
    const canvas = baseRef.current;
    if (!canvas) return;
    const link = document.createElement('a');
    link.download = 'whiteboard.png';
    link.href = canvas.toDataURL('image/png');
    link.click();
  };

  const clear = async () => {
    setConfirmClear(false);
    try {
      await api.clearDrawing(boardId);
      setStrokes([]);
      myStrokes.current = [];
    } catch (e) {
      toast(errorMessage(e), 'error');
    }
  };

  return (
    <div className="whiteboard">
      <div className="wb-toolbar" role="toolbar" aria-label="Drawing tools">
        {canEdit ? (
          <>
            <div className="wb-group" role="radiogroup" aria-label="Tool">
              <ToolButton label="Pen" active={tool === 'Pen'} onClick={() => setTool('Pen')} icon="✎" />
              <ToolButton label="Highlighter" active={tool === 'Highlighter'} onClick={() => setTool('Highlighter')} icon="▮" />
              <ToolButton label="Eraser" active={tool === 'Eraser'} onClick={() => setTool('Eraser')} icon="⌫" />
            </div>
            <div className="wb-group" role="radiogroup" aria-label="Color">
              {COLORS.map((c) => (
                <button
                  key={c}
                  role="radio"
                  aria-checked={color === c}
                  aria-label={`Color ${c}`}
                  className={`wb-swatch ${color === c ? 'active' : ''}`}
                  style={{ background: c }}
                  onClick={() => {
                    setColor(c);
                    if (tool === 'Eraser') setTool('Pen');
                  }}
                />
              ))}
            </div>
            <div className="wb-group" role="radiogroup" aria-label="Size">
              {SIZES.map((s) => (
                <button
                  key={s}
                  role="radio"
                  aria-checked={size === s}
                  aria-label={`Size ${s}`}
                  className={`wb-size ${size === s ? 'active' : ''}`}
                  onClick={() => setSize(s)}
                >
                  <span style={{ width: Math.min(18, s + 2), height: Math.min(18, s + 2) }} />
                </button>
              ))}
            </div>
            <div className="wb-group">
              <button className="button small" onClick={undo} title="Undo your last line (Ctrl/⌘+Z)">
                Undo
              </button>
              <button className="button small ghost" onClick={download}>
                Download
              </button>
              <button className="button small ghost danger-text" onClick={() => setConfirmClear(true)} disabled={!strokes?.length}>
                Clear
              </button>
            </div>
          </>
        ) : (
          <>
            <span className="muted small">View only. Editors can draw here.</span>
            <button className="button small ghost" onClick={download}>
              Download
            </button>
          </>
        )}
      </div>

      <div ref={wrapRef} className="wb-stage">
        {strokes === null ? (
          <Spinner label="Loading whiteboard" />
        ) : (
          <div className="wb-canvas" style={{ width: layout.width, height: layout.height }}>
            <canvas ref={baseRef} style={{ width: layout.width, height: layout.height }} aria-hidden="true" />
            <canvas
              ref={overlayRef}
              className={canEdit ? `wb-input tool-${tool.toLowerCase()}` : 'wb-input'}
              style={{ width: layout.width, height: layout.height }}
              role="img"
              aria-label={`Whiteboard with ${strokes.length} ${strokes.length === 1 ? 'line' : 'lines'}`}
              onPointerDown={onPointerDown}
              onPointerMove={onPointerMove}
              onPointerUp={onPointerUp}
              onPointerCancel={onPointerUp}
              onPointerLeave={() => {
                pointer.current = null;
                overlayDirty.current = true;
              }}
            />
          </div>
        )}
      </div>

      {confirmClear && (
        <Modal title="Clear the whiteboard?" onClose={() => setConfirmClear(false)}>
          <p>This removes every line for everyone on this board. It can't be undone.</p>
          <div className="row end">
            <button className="button ghost" onClick={() => setConfirmClear(false)}>
              Cancel
            </button>
            <button className="button danger" onClick={() => void clear()}>
              Clear whiteboard
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}

function ToolButton({ label, icon, active, onClick }: { label: string; icon: string; active: boolean; onClick(): void }) {
  return (
    <button role="radio" aria-checked={active} className={`wb-tool ${active ? 'active' : ''}`} onClick={onClick} title={label}>
      <span aria-hidden="true">{icon}</span>
      <span className="wb-tool-label">{label}</span>
    </button>
  );
}

// ---- Rendering helpers ----

function drawStroke(ctx: CanvasRenderingContext2D, s: { tool: StrokeTool; color: string; width: number; points: number[] }) {
  const p = s.points;
  if (p.length < 2) return;
  ctx.save();
  if (s.tool === 'Highlighter') {
    ctx.globalAlpha = 0.35;
    ctx.globalCompositeOperation = 'multiply';
  }
  ctx.strokeStyle = s.color;
  ctx.fillStyle = s.color;
  ctx.lineWidth = s.width;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  if (p.length === 2) {
    ctx.arc(p[0], p[1], s.width / 2, 0, Math.PI * 2);
    ctx.fill();
  } else {
    // Smooth the line by curving through the midpoints between samples.
    ctx.moveTo(p[0], p[1]);
    for (let i = 2; i < p.length - 2; i += 2) {
      ctx.quadraticCurveTo(p[i], p[i + 1], (p[i] + p[i + 2]) / 2, (p[i + 1] + p[i + 3]) / 2);
    }
    ctx.lineTo(p[p.length - 2], p[p.length - 1]);
    ctx.stroke();
  }
  ctx.restore();
}

function drawNameTag(ctx: CanvasRenderingContext2D, p: Preview, scale: number) {
  const n = p.points.length;
  if (n < 2) return;
  const x = p.points[n - 2] + 8 / scale;
  const y = p.points[n - 1] - 8 / scale;
  const font = 12 / scale;
  ctx.save();
  ctx.font = `600 ${font}px system-ui, sans-serif`;
  const w = ctx.measureText(p.user.displayName).width + 10 / scale;
  const h = font + 6 / scale;
  ctx.fillStyle = p.color === '#ffffff' ? '#1f2937' : p.color;
  ctx.beginPath();
  ctx.roundRect(x, y - h, w, h, 4 / scale);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.fillText(p.user.displayName, x + 5 / scale, y - 4 / scale);
  ctx.restore();
}

const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v));

const bounds = new WeakMap<Stroke, [number, number, number, number]>();

function boundsOf(s: Stroke) {
  let b = bounds.get(s);
  if (!b) {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (let i = 0; i < s.points.length; i += 2) {
      minX = Math.min(minX, s.points[i]);
      maxX = Math.max(maxX, s.points[i]);
      minY = Math.min(minY, s.points[i + 1]);
      maxY = Math.max(maxY, s.points[i + 1]);
    }
    b = [minX, minY, maxX, maxY];
    bounds.set(s, b);
  }
  return b;
}

/** True if a circle at (x, y) touches the stroke. */
function hitsStroke(s: Stroke, x: number, y: number, radius: number) {
  const reach = radius + s.width / 2;
  const [minX, minY, maxX, maxY] = boundsOf(s);
  if (x < minX - reach || x > maxX + reach || y < minY - reach || y > maxY + reach) return false;
  const p = s.points;
  if (p.length === 2) return Math.hypot(x - p[0], y - p[1]) <= reach;
  for (let i = 0; i < p.length - 2; i += 2) {
    if (distanceToSegment(x, y, p[i], p[i + 1], p[i + 2], p[i + 3]) <= reach) return true;
  }
  return false;
}

function distanceToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const len = dx * dx + dy * dy;
  const t = len === 0 ? 0 : clamp(((px - ax) * dx + (py - ay) * dy) / len, 0, 1);
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}
