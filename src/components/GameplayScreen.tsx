import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import {
  ChevronLeft,
  Heart,
  Lightbulb,
  Navigation2,
  PartyPopper,
  RotateCcw,
  Settings,
} from 'lucide-react';
import type { ArrowTile, GridPoint } from '../types/game';
import {
  BOARD_PAD,
  BOARD_VIEWBOX,
  cellCenter,
} from '../utils/arrowGeometry';
import {
  findEscapableArrow,
  generateLevel,
  traceArrowPath,
} from '../utils/puzzleGenerator';
import { feedback } from '../utils/soundAndHaptics';
import { AnimatedPathArrow } from './AnimatedPathArrow';
import { ConfettiBurst } from './ConfettiBurst';

interface GameplayScreenProps {
  level: number;
  hints: number;
  onBackHome: () => void;
  onOpenSettings: () => void;
  onConsumeHint: () => boolean;
  onLevelComplete: () => void;
}

const MAX_LIVES = 3;
const MIN_ZOOM_SCALE = 1;

/**
 * Clean minimalist light-mode Gameplay Screen UI:
 * - Dotted grid matrix inside a clean rounded white card with pinch-to-zoom & panning
 * - Bent, L-shaped, and meandering custom SVG path arrows flowing smoothly along their routing
 * - Full-distance collision slide + elastic rebound on blocked taps
 * - Confetti burst and celebratory board shake when all arrows are cleared
 */
export function GameplayScreen({
  level,
  hints,
  onBackHome,
  onOpenSettings,
  onConsumeHint,
  onLevelComplete,
}: GameplayScreenProps) {
  const generated = useMemo(() => generateLevel(level), [level]);

  const [arrows, setArrows] = useState<ArrowTile[]>(generated.arrows);
  const [lives, setLives] = useState<number>(MAX_LIVES);
  const [hintTargetId, setHintTargetId] = useState<string | null>(null);
  const [impactFlash, setImpactFlash] = useState<{
    key: number;
    pt: GridPoint;
  } | null>(null);
  const [celebrating, setCelebrating] = useState<boolean>(false);
  const [confettiKey, setConfettiKey] = useState<number>(0);
  const [heartsShakeKey, setHeartsShakeKey] = useState<number>(0);
  const [statusModal, setStatusModal] = useState<'none' | 'cleared' | 'failed'>('none');

  const timersRef = useRef<number[]>([]);
  const livesRef = useRef<number>(MAX_LIVES);

  // Pinch-to-Zoom & Panning state (stored in refs for 60fps DOM transform updates)
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const zoomLayerRef = useRef<HTMLDivElement | null>(null);
  const transformRef = useRef<{ scale: number; tx: number; ty: number }>({
    scale: 1,
    tx: 0,
    ty: 0,
  });
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const gestureRef = useRef<{
    mode: 'none' | 'pan' | 'pinch';
    startDist: number;
    startScale: number;
    startTx: number;
    startTy: number;
    startMidX: number;
    startMidY: number;
    moved: boolean;
  }>({
    mode: 'none',
    startDist: 0,
    startScale: 1,
    startTx: 0,
    startTy: 0,
    startMidX: 0,
    startMidY: 0,
    moved: false,
  });
  const suppressTapUntilRef = useRef<number>(0);

  const maxZoomScale = useMemo(
    () => Math.min(3.6, Math.max(2.2, generated.gridSize * 0.42)),
    [generated.gridSize]
  );

  const clampTransform = useCallback(
    (scale: number, tx: number, ty: number) => {
      const el = viewportRef.current;
      const w = el?.clientWidth || 360;
      const h = el?.clientHeight || 360;
      const clampedScale = Math.min(maxZoomScale, Math.max(MIN_ZOOM_SCALE, scale));
      if (clampedScale <= MIN_ZOOM_SCALE) {
        return { scale: MIN_ZOOM_SCALE, tx: 0, ty: 0 };
      }
      const minTx = w * (1 - clampedScale);
      const minTy = h * (1 - clampedScale);
      return {
        scale: clampedScale,
        tx: Math.min(0, Math.max(minTx, tx)),
        ty: Math.min(0, Math.max(minTy, ty)),
      };
    },
    [maxZoomScale]
  );

  const applyZoomTransform = useCallback(
    (next: { scale: number; tx: number; ty: number }) => {
      transformRef.current = next;
      if (zoomLayerRef.current) {
        zoomLayerRef.current.style.transform = `translate3d(${next.tx.toFixed(
          2
        )}px, ${next.ty.toFixed(2)}px, 0) scale(${next.scale.toFixed(4)})`;
      }
    },
    []
  );

  const resetZoomTransform = useCallback(() => {
    pointersRef.current.clear();
    gestureRef.current.mode = 'none';
    gestureRef.current.moved = false;
    applyZoomTransform({ scale: 1, tx: 0, ty: 0 });
  }, [applyZoomTransform]);

  const scheduleTimeout = (fn: () => void, ms: number) => {
    const id = window.setTimeout(fn, ms);
    timersRef.current.push(id);
  };

  const clearScheduledTimeouts = () => {
    for (const id of timersRef.current) {
      window.clearTimeout(id);
    }
    timersRef.current = [];
  };

  useEffect(() => {
    clearScheduledTimeouts();
    setArrows(generated.arrows);
    setLives(MAX_LIVES);
    livesRef.current = MAX_LIVES;
    setHintTargetId(null);
    setImpactFlash(null);
    setCelebrating(false);
    setHeartsShakeKey(0);
    setStatusModal('none');
    resetZoomTransform();
    return clearScheduledTimeouts;
  }, [generated, resetZoomTransform]);

  // Native non-passive wheel zoom for desktop convenience (strictly capped to [1, maxZoomScale])
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;

    const handleWheel = (e: WheelEvent) => {
      if (statusModal !== 'none') return;
      e.preventDefault();
      const rect = el.getBoundingClientRect();
      const fx = e.clientX - rect.left;
      const fy = e.clientY - rect.top;
      const curr = transformRef.current;
      const factor = Math.exp(-e.deltaY * 0.0022);
      const nextScale = Math.min(
        maxZoomScale,
        Math.max(MIN_ZOOM_SCALE, curr.scale * factor)
      );
      const bx = (fx - curr.tx) / curr.scale;
      const by = (fy - curr.ty) / curr.scale;
      const rawTx = fx - bx * nextScale;
      const rawTy = fy - by * nextScale;
      applyZoomTransform(clampTransform(nextScale, rawTx, rawTy));
    };

    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [applyZoomTransform, clampTransform, maxZoomScale, statusModal]);

  const activeArrows = useMemo(
    () => arrows.filter((a) => a.state !== 'escaping'),
    [arrows]
  );

  const cellStep = (BOARD_VIEWBOX - BOARD_PAD * 2) / generated.gridSize;
  const strokeWidth = Math.min(5.6, Math.max(2.2, cellStep * 0.082));
  const arrowTipScale = Math.min(1.28, Math.max(0.68, cellStep / 48));
  const dotRadius = Math.min(2.6, Math.max(1.3, cellStep * 0.038));

  const handleRestartLevel = () => {
    feedback.playTap();
    clearScheduledTimeouts();
    setArrows(generated.arrows);
    setLives(MAX_LIVES);
    livesRef.current = MAX_LIVES;
    setHintTargetId(null);
    setImpactFlash(null);
    setCelebrating(false);
    setStatusModal('none');
    resetZoomTransform();
  };

  const handleEscapeComplete = useCallback(
    (id: string) => {
      setArrows((prev) => {
        const next = prev.filter((a) => a.id !== id);
        if (next.length === 0) {
          feedback.playLevelClear();
          setCelebrating(true);
          setConfettiKey((k) => k + 1);
          const modalTimer = window.setTimeout(() => {
            setStatusModal('cleared');
          }, 450);
          timersRef.current.push(modalTimer);
        }
        return next;
      });
    },
    []
  );

  const handleBlockedComplete = useCallback((id: string) => {
    setArrows((prev) =>
      prev.map((a) =>
        a.id === id
          ? {
              ...a,
              state: 'idle',
              isBlocked: true,
              bumpDistancePx: undefined,
              bumpDurationMs: undefined,
            }
          : a
      )
    );
    if (livesRef.current === 0) {
      setStatusModal('failed');
    }
  }, []);

  const handlePenaltyComplete = useCallback((id: string) => {
    setArrows((prev) =>
      prev.map((a) => (a.id === id ? { ...a, state: 'idle' } : a))
    );
    if (livesRef.current === 0) {
      setStatusModal('failed');
    }
  }, []);

  const handleTapArrow = (arrow: ArrowTile) => {
    if (statusModal !== 'none') return;
    if (arrow.state !== 'idle') return;
    if (performance.now() < suppressTapUntilRef.current) return;

    feedback.unlock();
    const { clear, blockerCell, freeCells } = traceArrowPath(
      arrows,
      arrow,
      generated.gridSize
    );

    if (clear) {
      // Scenario A: Path is clear -> arrow flows smoothly off the board edge
      feedback.playEscape();
      setHintTargetId((prev) => (prev === arrow.id ? null : prev));

      setArrows((prev) =>
        prev.map((a) => (a.id === arrow.id ? { ...a, state: 'escaping' } : a))
      );
      return;
    }

    // Scenario B: Blocked -> slide across open gap, hit blocker, and rebound elastically
    const isFirstPenalty = !arrow.isBlocked;
    const singleHeadOffset =
      arrow.cells.length === 1 ? Math.min(cellStep * 0.22, 14) : 0;
    const gapCenterDist = (freeCells + 1) * cellStep - singleHeadOffset;
    const tipContactBuffer = Math.max(10, strokeWidth * 2 + cellStep * 0.12);
    const bumpDistancePx = Math.max(12, gapCenterDist - tipContactBuffer);

    const hitDurationMs = 150 + freeCells * 60;
    const reboundDurationMs = 320 + freeCells * 50;
    const bumpDurationMs = hitDurationMs + reboundDurationMs;

    feedback.playTap();

    if (blockerCell) {
      scheduleTimeout(() => {
        feedback.playBlocked();
        if (isFirstPenalty) {
          setHeartsShakeKey((k) => k + 1);
        }
        setImpactFlash({ key: Date.now(), pt: blockerCell });
        scheduleTimeout(() => {
          setImpactFlash((curr) =>
            curr && curr.pt.r === blockerCell.r && curr.pt.c === blockerCell.c
              ? null
              : curr
          );
        }, 360);
      }, Math.round(bumpDurationMs * 0.34));
    } else {
      feedback.playBlocked();
      if (isFirstPenalty) {
        setHeartsShakeKey((k) => k + 1);
      }
    }

    // Deduct 1 heart ONLY on the first blocked tap of this arrow
    if (isFirstPenalty) {
      const nextLives = Math.max(0, livesRef.current - 1);
      livesRef.current = nextLives;
      setLives(nextLives);
    }

    setArrows((prev) =>
      prev.map((a) =>
        a.id === arrow.id
          ? {
              ...a,
              state: 'blocked',
              bumpDistancePx,
              bumpDurationMs,
            }
          : a
      )
    );
  };

  const handleBoardPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (statusModal !== 'none') return;
    const el = viewportRef.current;
    if (!el) return;

    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointersRef.current.size === 1) {
      const curr = transformRef.current;
      gestureRef.current = {
        mode: 'pan',
        startDist: 0,
        startScale: curr.scale,
        startTx: curr.tx,
        startTy: curr.ty,
        startMidX: e.clientX,
        startMidY: e.clientY,
        moved: false,
      };
    } else if (pointersRef.current.size >= 2) {
      const pts = Array.from(pointersRef.current.values());
      const rect = el.getBoundingClientRect();
      const mx = (pts[0].x + pts[1].x) * 0.5 - rect.left;
      const my = (pts[0].y + pts[1].y) * 0.5 - rect.top;
      const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      const curr = transformRef.current;

      gestureRef.current = {
        mode: 'pinch',
        startDist: Math.max(10, dist),
        startScale: curr.scale,
        startTx: curr.tx,
        startTy: curr.ty,
        startMidX: mx,
        startMidY: my,
        moved: true,
      };
      suppressTapUntilRef.current = performance.now() + 350;
    }
  };

  const handleBoardPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!pointersRef.current.has(e.pointerId)) return;
    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    const el = viewportRef.current;
    if (!el) return;
    const g = gestureRef.current;

    if (pointersRef.current.size >= 2 && g.mode === 'pinch') {
      const pts = Array.from(pointersRef.current.values());
      const rect = el.getBoundingClientRect();
      const mx = (pts[0].x + pts[1].x) * 0.5 - rect.left;
      const my = (pts[0].y + pts[1].y) * 0.5 - rect.top;
      const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);

      const nextScale = Math.min(
        maxZoomScale,
        Math.max(MIN_ZOOM_SCALE, g.startScale * (dist / g.startDist))
      );
      const bx = (g.startMidX - g.startTx) / g.startScale;
      const by = (g.startMidY - g.startTy) / g.startScale;
      const rawTx = mx - bx * nextScale;
      const rawTy = my - by * nextScale;

      applyZoomTransform(clampTransform(nextScale, rawTx, rawTy));
      suppressTapUntilRef.current = performance.now() + 350;
      return;
    }

    if (pointersRef.current.size === 1 && g.mode === 'pan') {
      const dx = e.clientX - g.startMidX;
      const dy = e.clientY - g.startMidY;

      if (!g.moved && Math.hypot(dx, dy) > 6) {
        g.moved = true;
      }

      if (g.moved && transformRef.current.scale > MIN_ZOOM_SCALE) {
        applyZoomTransform(
          clampTransform(g.startScale, g.startTx + dx, g.startTy + dy)
        );
        suppressTapUntilRef.current = performance.now() + 280;
      }
    }
  };

  const handleBoardPointerEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    pointersRef.current.delete(e.pointerId);

    if (pointersRef.current.size === 1) {
      const remaining = Array.from(pointersRef.current.values())[0];
      const curr = transformRef.current;
      gestureRef.current = {
        mode: 'pan',
        startDist: 0,
        startScale: curr.scale,
        startTx: curr.tx,
        startTy: curr.ty,
        startMidX: remaining.x,
        startMidY: remaining.y,
        moved: true,
      };
      suppressTapUntilRef.current = performance.now() + 280;
    } else if (pointersRef.current.size === 0) {
      gestureRef.current.mode = 'none';
    }
  };

  const handleUseHint = () => {
    if (statusModal !== 'none' || activeArrows.length === 0) return;
    if (hints <= 0) {
      feedback.playBlocked();
      return;
    }
    const candidate = findEscapableArrow(arrows, generated.gridSize);
    if (!candidate) return;
    if (onConsumeHint()) {
      feedback.playHint();
      setHintTargetId(candidate.id);
    }
  };

  const difficultyTone =
    generated.difficulty === 'Easy'
      ? 'bg-emerald-50 text-emerald-700'
      : generated.difficulty === 'Normal'
        ? 'bg-[#EAF0F8] text-slate-700'
        : generated.difficulty === 'Hard'
          ? 'bg-amber-50 text-amber-700'
          : 'bg-rose-50 text-rose-700';

  return (
    <div className="safe-top safe-bottom relative flex h-full w-full flex-col justify-between overflow-hidden bg-[#F5F8FC] px-4 py-3 text-slate-900">
      {/* Top Header Bar */}
      <header className="flex items-center justify-between">
        <button
          type="button"
          onClick={() => {
            feedback.playTap();
            onBackHome();
          }}
          aria-label="Back to home"
          className="flex h-11 w-11 items-center justify-center rounded-full text-[#2589FF] transition-transform hover:bg-blue-50 active:scale-90"
        >
          <ChevronLeft className="h-6 w-6 stroke-[2.5]" />
        </button>

        <h1 className="font-display text-base font-bold tracking-tight text-slate-900">
          Level {level}
        </h1>

        <button
          type="button"
          onClick={() => {
            feedback.playTap();
            onOpenSettings();
          }}
          aria-label="Open settings"
          className="flex h-11 w-11 items-center justify-center rounded-full text-[#2589FF] transition-transform hover:bg-blue-50 active:scale-90"
        >
          <Settings className="h-5 w-5 stroke-[2.2]" />
        </button>
      </header>

      {/* Sub-HUD / Status Bar */}
      <div className="mt-0.5 flex items-center justify-between px-1">
        {/* Left: Remaining arrows badge */}
        <div className="flex h-7 items-center gap-1.5 rounded-full bg-[#EAF0F8] px-3 text-slate-800">
          <Navigation2
            className="h-3 w-3 rotate-45 fill-slate-700 text-slate-700"
            aria-hidden="true"
          />
          <span className="font-mono-tabular text-xs font-bold">
            {activeArrows.length}
          </span>
        </div>

        {/* Center: 3 Hearts */}
        <motion.div
          key={heartsShakeKey}
          animate={heartsShakeKey > 0 ? { x: [0, -5, 5, -3, 3, 0] } : { x: 0 }}
          transition={{ duration: 0.28, ease: 'easeOut' }}
          className="flex items-center gap-1.5"
          aria-label={`${lives} of ${MAX_LIVES} lives remaining`}
        >
          {Array.from({ length: MAX_LIVES }).map((_, idx) => {
            const active = idx < lives;
            return (
              <Heart
                key={idx}
                className={`h-5 w-5 transition-all duration-200 ${
                  active
                    ? 'scale-100 fill-[#EF4444] text-[#EF4444]'
                    : 'scale-90 fill-slate-200 text-slate-300'
                }`}
                aria-hidden="true"
              />
            );
          })}
        </motion.div>

        {/* Right: Difficulty pill */}
        <div
          className={`flex h-7 items-center rounded-full px-3 text-xs font-semibold ${difficultyTone}`}
        >
          {generated.difficulty}
        </div>
      </div>

      {/* Central Minimalist Dotted-Matrix Board Card (Pinch-to-Zoom & Pan enabled) */}
      <div className="my-auto flex w-full items-center justify-center py-2">
        <motion.div
          ref={viewportRef}
          onPointerDown={handleBoardPointerDown}
          onPointerMove={handleBoardPointerMove}
          onPointerUp={handleBoardPointerEnd}
          onPointerCancel={handleBoardPointerEnd}
          animate={
            celebrating
              ? {
                  x: [0, -6, 6, -4, 4, -2, 0],
                  y: [0, -3, 2, -2, 1, 0],
                  scale: [1, 1.028, 1],
                }
              : { x: 0, y: 0, scale: 1 }
          }
          transition={{ duration: 0.42, ease: 'easeOut' }}
          className={`relative aspect-square w-full max-w-[368px] touch-none overflow-hidden rounded-3xl bg-white shadow-[0_14px_38px_-12px_rgba(15,23,42,0.09)] transition-shadow duration-300 select-none ${
            celebrating
              ? 'ring-2 ring-emerald-400/70 shadow-[0_18px_46px_-10px_rgba(16,185,129,0.28)]'
              : 'ring-1 ring-slate-200/70'
          }`}
        >
          <div
            ref={zoomLayerRef}
            className="h-full w-full"
            style={{ transformOrigin: '0 0', willChange: 'transform' }}
          >
            <svg
              viewBox={`0 0 ${BOARD_VIEWBOX} ${BOARD_VIEWBOX}`}
              className="h-full w-full touch-none select-none"
              role="img"
              aria-label={`Level ${level} Arrow Escape puzzle board`}
            >
              <defs>
                <filter id="hint-glow" x="-30%" y="-30%" width="160%" height="160%">
                  <feDropShadow
                    dx="0"
                    dy="0"
                    stdDeviation="3.5"
                    floodColor="#2589FF"
                    floodOpacity="0.6"
                  />
                </filter>
              </defs>

              {/* Subtle Dotted Grid Matrix */}
              {Array.from({ length: generated.gridSize * generated.gridSize }).map(
                (_, index) => {
                  const r = Math.floor(index / generated.gridSize);
                  const c = index % generated.gridSize;
                  const { x, y } = cellCenter({ r, c }, cellStep);
                  return (
                    <circle
                      key={`dot-${r}-${c}`}
                      cx={x}
                      cy={y}
                      r={dotRadius}
                      fill="#CBD5E1"
                    />
                  );
                }
              )}

              {/* Bent & Custom Path Arrows */}
              {arrows.map((arrow) => (
                <AnimatedPathArrow
                  key={arrow.id}
                  arrow={arrow}
                  cellStep={cellStep}
                  strokeWidth={strokeWidth}
                  arrowTipScale={arrowTipScale}
                  baseStrokeColor="#0F172A"
                  isHinted={arrow.id === hintTargetId}
                  onTap={handleTapArrow}
                  onEscapeComplete={handleEscapeComplete}
                  onBlockedComplete={handleBlockedComplete}
                  onPenaltyComplete={handlePenaltyComplete}
                />
              ))}

              {/* Collision ripple flash at obstructing cell on blocked tap */}
              {impactFlash && (() => {
                const center = cellCenter(impactFlash.pt, cellStep);
                return (
                  <motion.circle
                    key={impactFlash.key}
                    cx={center.x}
                    cy={center.y}
                    initial={{ r: 4, opacity: 0.85 }}
                    animate={{ r: Math.max(16, cellStep * 0.45), opacity: 0 }}
                    transition={{ duration: 0.34, ease: 'easeOut' }}
                    fill="none"
                    stroke="#EF4444"
                    strokeWidth={2.5}
                    className="pointer-events-none"
                  />
                );
              })()}
            </svg>
          </div>
        </motion.div>
      </div>

      {/* Celebratory 60fps Confetti Cannons */}
      <ConfettiBurst triggerKey={confettiKey} />

      {/* Bottom Floating Hint Control */}
      <footer className="flex items-center justify-center pb-2">
        <button
          type="button"
          onClick={handleUseHint}
          aria-label={`Use hint (${hints} remaining)`}
          className={`relative flex h-14 w-14 items-center justify-center rounded-full bg-white shadow-[0_8px_24px_-4px_rgba(37,137,255,0.22)] transition-transform active:scale-92 ${
            hintTargetId ? 'ring-2 ring-[#2589FF]' : 'ring-1 ring-slate-200/80'
          }`}
        >
          <Lightbulb
            className={`h-6 w-6 ${hints > 0 ? 'text-[#2589FF]' : 'text-slate-400'}`}
          />
          <span className="font-mono-tabular absolute -top-1 -right-0.5 flex h-5 min-w-[20px] items-center justify-center rounded-full bg-[#2589FF] px-1 text-[11px] font-bold text-white shadow-xs">
            {hints}
          </span>
        </button>
      </footer>

      {/* Level Complete Modal */}
      {statusModal === 'cleared' && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-slate-900/40 px-6 backdrop-blur-xs">
          <motion.div
            initial={{ scale: 0.92, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="w-full max-w-[320px] rounded-3xl border border-slate-200 bg-white p-6 text-center shadow-2xl"
          >
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-600">
              <PartyPopper className="h-6 w-6" />
            </div>
            <h2 className="font-display mt-3 text-2xl font-bold text-slate-900">
              Level {level} Cleared
            </h2>

            <div className="mt-5 flex flex-col gap-2.5">
              <button
                type="button"
                onClick={() => {
                  feedback.playTap();
                  onLevelComplete();
                }}
                className="flex h-12 w-full items-center justify-center rounded-2xl bg-[#2589FF] text-sm font-bold text-white shadow-md shadow-blue-500/25 transition-transform active:scale-95"
              >
                Next Level
              </button>
              <button
                type="button"
                onClick={() => {
                  onLevelComplete();
                  onBackHome();
                }}
                className="flex h-11 w-full items-center justify-center rounded-2xl border border-slate-200 bg-[#F5F8FC] text-xs font-semibold text-slate-700 transition-colors hover:bg-[#EAF0F8] active:scale-95"
              >
                Back to Home
              </button>
            </div>
          </motion.div>
        </div>
      )}

      {/* Out of Lives Modal */}
      {statusModal === 'failed' && (
        <div className="absolute inset-0 z-30 flex items-center justify-center bg-slate-900/40 px-6 backdrop-blur-xs">
          <motion.div
            initial={{ scale: 0.92, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="w-full max-w-[320px] rounded-3xl border border-slate-200 bg-white p-6 text-center shadow-2xl"
          >
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-rose-100 text-rose-600">
              <Heart className="h-6 w-6" />
            </div>
            <h2 className="font-display mt-3 text-2xl font-bold text-slate-900">
              Out of Lives
            </h2>
            <p className="mt-1 text-xs text-slate-500">
              Clear blocking arrows first before tapping inner paths.
            </p>

            <div className="mt-5 flex flex-col gap-2.5">
              <button
                type="button"
                onClick={handleRestartLevel}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#2589FF] text-sm font-bold text-white shadow-md shadow-blue-500/25 transition-transform active:scale-95"
              >
                <RotateCcw className="h-4 w-4" />
                <span>Retry Level {level}</span>
              </button>
              <button
                type="button"
                onClick={onBackHome}
                className="flex h-11 w-full items-center justify-center rounded-2xl border border-slate-200 text-xs font-semibold text-slate-600 transition-colors hover:bg-slate-50"
              >
                Back to Home
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
}
