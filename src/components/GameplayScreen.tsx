import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { motion } from 'motion/react';
import {
  ChevronLeft,
  Heart,
  Lightbulb,
  Minimize2,
  Navigation2,
  PartyPopper,
  RotateCcw,
  Settings,
} from 'lucide-react';
import type { ArrowTile, GridPoint } from '../types/game';
import {
  BOARD_PAD,
  BOARD_VIEWBOX,
  buildGridDotsPath,
  cellCenter,
} from '../utils/arrowGeometry';
import {
  buildOccupancyGrid,
  findEscapableArrow,
  generateLevel,
  traceArrowPathFast,
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
 * Full-bleed crisp SVG viewBox-camera Gameplay Screen (Web & Capacitor):
 * - Direct SVG viewBox camera zoom & pan (re-tessellated at native DPI with zero bitmap blur)
 * - Edge-to-edge open canvas playfield behind floating bottom Hint & 1.0x Reset controls
 * - Full-distance collision slide + elastic rebound on blocked taps
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
  const [isZoomed, setIsZoomed] = useState<boolean>(false);

  const timersRef = useRef<number[]>([]);
  const livesRef = useRef<number>(MAX_LIVES);
  const statusModalRef = useRef(statusModal);
  statusModalRef.current = statusModal;
  const occGridRef = useRef<Uint8Array>(new Uint8Array(0));
  const escapingIdsRef = useRef<Set<string>>(new Set());

  // Direct SVG viewBox camera refs (zero CSS bitmap scaling)
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const layoutRef = useRef<{
    w: number;
    h: number;
    usableH: number;
    baseScale: number;
    baseOx: number;
    baseOy: number;
  }>({
    w: 360,
    h: 520,
    usableH: 430,
    baseScale: 0.9,
    baseOx: 18,
    baseOy: 18,
  });
  const cameraRef = useRef<{ zoom: number; tx: number; ty: number }>({
    zoom: 1,
    tx: 18,
    ty: 18,
  });
  const camAnimRafRef = useRef<number>(0);
  const pointersRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const gestureRef = useRef<{
    mode: 'none' | 'pan' | 'pinch';
    startDist: number;
    startZoom: number;
    startTx: number;
    startTy: number;
    startMidX: number;
    startMidY: number;
    startFocusBx: number;
    startFocusBy: number;
    moved: boolean;
  }>({
    mode: 'none',
    startDist: 0,
    startZoom: 1,
    startTx: 0,
    startTy: 0,
    startMidX: 0,
    startMidY: 0,
    startFocusBx: BOARD_VIEWBOX * 0.5,
    startFocusBy: BOARD_VIEWBOX * 0.5,
    moved: false,
  });
  const suppressTapUntilRef = useRef<number>(0);

  const maxZoomScale = useMemo(
    () => Math.min(8.0, Math.max(2.6, generated.gridSize * 0.25)),
    [generated.gridSize]
  );

  const clampCamera = useCallback(
    (nextZoom: number, nextTx: number, nextTy: number) => {
      const { w, h, usableH, baseScale, baseOx, baseOy } = layoutRef.current;
      const z = Math.min(maxZoomScale, Math.max(MIN_ZOOM_SCALE, nextZoom));
      if (z <= 1.0005) {
        return { zoom: 1, tx: baseOx, ty: baseOy };
      }
      const t = Math.min(1, (z - 1) / 0.25);
      const scaledBoard = BOARD_VIEWBOX * baseScale * z;
      const freeMinTx = Math.min(baseOx, w * 0.36 - scaledBoard);
      const freeMaxTx = Math.max(baseOx, w * 0.64);
      const freeMinTy = Math.min(baseOy, usableH * 0.36 - scaledBoard);
      const freeMaxTy = Math.max(baseOy, h * 0.66);

      const minTx = baseOx + (freeMinTx - baseOx) * t;
      const maxTx = baseOx + (freeMaxTx - baseOx) * t;
      const minTy = baseOy + (freeMinTy - baseOy) * t;
      const maxTy = baseOy + (freeMaxTy - baseOy) * t;

      return {
        zoom: z,
        tx: Math.max(minTx, Math.min(maxTx, nextTx)),
        ty: Math.max(minTy, Math.min(maxTy, nextTy)),
      };
    },
    [maxZoomScale]
  );

  const applyCameraViewBox = useCallback(
    (next: { zoom: number; tx: number; ty: number }) => {
      cameraRef.current = next;
      const { w, h, baseScale } = layoutRef.current;
      const totalScale = Math.max(0.001, baseScale * next.zoom);
      const vbX = -next.tx / totalScale;
      const vbY = -next.ty / totalScale;
      const vbW = w / totalScale;
      const vbH = h / totalScale;
      if (svgRef.current) {
        svgRef.current.setAttribute(
          'viewBox',
          `${vbX.toFixed(3)} ${vbY.toFixed(3)} ${vbW.toFixed(3)} ${vbH.toFixed(3)}`
        );
      }
      const zoomedNow = next.zoom > 1.08;
      setIsZoomed((prev) => (prev === zoomedNow ? prev : zoomedNow));
    },
    []
  );

  const animateCameraTo = useCallback(
    (target: { zoom: number; tx: number; ty: number }, durationMs = 220) => {
      cancelAnimationFrame(camAnimRafRef.current);
      const start = { ...cameraRef.current };
      const t0 = performance.now();
      const tick = (now: number) => {
        const raw = Math.min(1, (now - t0) / durationMs);
        const eased = 1 - Math.pow(1 - raw, 3);
        applyCameraViewBox({
          zoom: start.zoom + (target.zoom - start.zoom) * eased,
          tx: start.tx + (target.tx - start.tx) * eased,
          ty: start.ty + (target.ty - start.ty) * eased,
        });
        if (raw < 1) {
          camAnimRafRef.current = requestAnimationFrame(tick);
        }
      };
      camAnimRafRef.current = requestAnimationFrame(tick);
    },
    [applyCameraViewBox]
  );

  const resetZoomTransform = useCallback(
    (animated = false) => {
      cancelAnimationFrame(camAnimRafRef.current);
      pointersRef.current.clear();
      gestureRef.current.mode = 'none';
      gestureRef.current.moved = false;
      const { baseOx, baseOy } = layoutRef.current;
      if (animated) {
        animateCameraTo({ zoom: 1, tx: baseOx, ty: baseOy }, 220);
      } else {
        applyCameraViewBox({ zoom: 1, tx: baseOx, ty: baseOy });
      }
    },
    [animateCameraTo, applyCameraViewBox]
  );

  // Sync playfield layout dimensions cleanly on mount & resize
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;

    const updateLayout = () => {
      const w = el.clientWidth;
      const h = el.clientHeight;
      if (w <= 0 || h <= 0) return;
      const usableH = Math.max(180, h - 84);
      const fit = Math.max(180, Math.min(w - 20, usableH - 12));
      const nextBaseScale = fit / BOARD_VIEWBOX;
      const nextOx = (w - fit) * 0.5;
      const nextOy = Math.max(8, (usableH - fit) * 0.5);

      const prevOx = layoutRef.current.baseOx;
      const prevOy = layoutRef.current.baseOy;
      layoutRef.current = {
        w,
        h,
        usableH,
        baseScale: nextBaseScale,
        baseOx: nextOx,
        baseOy: nextOy,
      };

      const curr = cameraRef.current;
      if (curr.zoom <= 1.005) {
        applyCameraViewBox({ zoom: 1, tx: nextOx, ty: nextOy });
      } else {
        applyCameraViewBox({
          zoom: curr.zoom,
          tx: curr.tx + (nextOx - prevOx),
          ty: curr.ty + (nextOy - prevOy),
        });
      }
    };

    updateLayout();
    const ro = new ResizeObserver(updateLayout);
    ro.observe(el);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(camAnimRafRef.current);
    };
  }, [applyCameraViewBox]);

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
    occGridRef.current = buildOccupancyGrid(generated.arrows, generated.gridSize);
    escapingIdsRef.current.clear();
    setArrows(generated.arrows);
    setLives(MAX_LIVES);
    livesRef.current = MAX_LIVES;
    setHintTargetId(null);
    setImpactFlash(null);
    setCelebrating(false);
    setHeartsShakeKey(0);
    setStatusModal('none');
    resetZoomTransform(false);
    return clearScheduledTimeouts;
  }, [generated, resetZoomTransform]);

  // Native non-passive wheel zoom for desktop convenience (crisp SVG viewBox update)
  useEffect(() => {
    const el = viewportRef.current;
    if (!el) return;

    const handleWheel = (e: WheelEvent) => {
      if (statusModal !== 'none') return;
      e.preventDefault();
      cancelAnimationFrame(camAnimRafRef.current);
      const rect = el.getBoundingClientRect();
      const fx = e.clientX - rect.left;
      const fy = e.clientY - rect.top;
      const curr = cameraRef.current;
      const { baseScale } = layoutRef.current;
      const curTotalS = baseScale * curr.zoom;
      const bx = (fx - curr.tx) / curTotalS;
      const by = (fy - curr.ty) / curTotalS;

      const factor = Math.exp(-e.deltaY * 0.0022);
      const nextZoom = Math.min(
        maxZoomScale,
        Math.max(MIN_ZOOM_SCALE, curr.zoom * factor)
      );
      const nextTotalS = baseScale * nextZoom;
      const rawTx = fx - bx * nextTotalS;
      const rawTy = fy - by * nextTotalS;
      applyCameraViewBox(clampCamera(nextZoom, rawTx, rawTy));
    };

    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, [applyCameraViewBox, clampCamera, maxZoomScale, statusModal]);

  const activeArrows = useMemo(
    () => arrows.filter((a) => a.state !== 'escaping'),
    [arrows]
  );

  const cellStep = (BOARD_VIEWBOX - BOARD_PAD * 2) / generated.gridSize;
  const strokeWidth = Math.min(5.0, Math.max(1.25, cellStep * 0.145));
  const arrowTipScale = Math.min(1.22, Math.max(0.28, cellStep / 33));
  const dotRadius = Math.min(2.3, Math.max(0.65, cellStep * 0.052));

  const dotsPathD = useMemo(
    () => buildGridDotsPath(generated.gridSize, cellStep),
    [generated.gridSize, cellStep]
  );

  const handleRestartLevel = () => {
    feedback.playTap();
    clearScheduledTimeouts();
    occGridRef.current = buildOccupancyGrid(generated.arrows, generated.gridSize);
    escapingIdsRef.current.clear();
    setArrows(generated.arrows);
    setLives(MAX_LIVES);
    livesRef.current = MAX_LIVES;
    setHintTargetId(null);
    setImpactFlash(null);
    setCelebrating(false);
    setStatusModal('none');
    resetZoomTransform(false);
  };

  const handleEscapeComplete = useCallback(
    (id: string) => {
      escapingIdsRef.current.delete(id);
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

  const handleTapArrow = useCallback((arrow: ArrowTile) => {
    if (statusModalRef.current !== 'none') return;
    if (arrow.state !== 'idle') return;
    if (escapingIdsRef.current.has(arrow.id)) return;
    if (performance.now() < suppressTapUntilRef.current) return;

    feedback.unlock();
    const gridSize = generated.gridSize;
    const { clear, blockerCell, freeCells } = traceArrowPathFast(
      occGridRef.current,
      arrow,
      gridSize
    );

    if (clear) {
      escapingIdsRef.current.add(arrow.id);
      const occ = occGridRef.current;
      for (let i = 0; i < arrow.cells.length; i++) {
        const pt = arrow.cells[i];
        occ[pt.r * gridSize + pt.c] = 0;
      }

      feedback.playEscape();
      setHintTargetId((prev) => (prev === arrow.id ? null : prev));

      setArrows((prev) =>
        prev.map((a) => (a.id === arrow.id ? { ...a, state: 'escaping' } : a))
      );
      return;
    }

    const isFirstPenalty = !arrow.isBlocked;
    const singleHeadOffset =
      arrow.cells.length === 1 ? Math.min(cellStep * 0.22, 14) : 0;
    const gapCenterDist = (freeCells + 1) * cellStep - singleHeadOffset;
    const tipContactBuffer = Math.max(cellStep * 0.34, strokeWidth * 1.8);
    const bumpDistancePx = Math.max(cellStep * 0.28, gapCenterDist - tipContactBuffer);

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
  }, [cellStep, generated.gridSize, strokeWidth]);

  const handleBoardPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (statusModal !== 'none') return;
    const el = viewportRef.current;
    if (!el) return;
    cancelAnimationFrame(camAnimRafRef.current);

    pointersRef.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointersRef.current.size === 1) {
      const curr = cameraRef.current;
      gestureRef.current = {
        mode: 'pan',
        startDist: 0,
        startZoom: curr.zoom,
        startTx: curr.tx,
        startTy: curr.ty,
        startMidX: e.clientX,
        startMidY: e.clientY,
        startFocusBx: BOARD_VIEWBOX * 0.5,
        startFocusBy: BOARD_VIEWBOX * 0.5,
        moved: false,
      };
    } else if (pointersRef.current.size >= 2) {
      const pts = Array.from(pointersRef.current.values());
      const rect = el.getBoundingClientRect();
      const mx = (pts[0].x + pts[1].x) * 0.5 - rect.left;
      const my = (pts[0].y + pts[1].y) * 0.5 - rect.top;
      const dist = Math.hypot(pts[1].x - pts[0].x, pts[1].y - pts[0].y);
      const curr = cameraRef.current;
      const totalS = layoutRef.current.baseScale * curr.zoom;

      gestureRef.current = {
        mode: 'pinch',
        startDist: Math.max(10, dist),
        startZoom: curr.zoom,
        startTx: curr.tx,
        startTy: curr.ty,
        startMidX: mx,
        startMidY: my,
        startFocusBx: (mx - curr.tx) / totalS,
        startFocusBy: (my - curr.ty) / totalS,
        moved: true,
      };
      suppressTapUntilRef.current = performance.now() + 120;
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

      const nextZoom = Math.min(
        maxZoomScale,
        Math.max(MIN_ZOOM_SCALE, g.startZoom * (dist / g.startDist))
      );
      const nextTotalS = layoutRef.current.baseScale * nextZoom;
      const rawTx = mx - g.startFocusBx * nextTotalS;
      const rawTy = my - g.startFocusBy * nextTotalS;

      applyCameraViewBox(clampCamera(nextZoom, rawTx, rawTy));
      suppressTapUntilRef.current = performance.now() + 120;
      return;
    }

    if (pointersRef.current.size === 1 && g.mode === 'pan') {
      const dx = e.clientX - g.startMidX;
      const dy = e.clientY - g.startMidY;

      if (!g.moved && Math.hypot(dx, dy) > 8) {
        g.moved = true;
      }

      if (g.moved && cameraRef.current.zoom > MIN_ZOOM_SCALE) {
        applyCameraViewBox(
          clampCamera(g.startZoom, g.startTx + dx, g.startTy + dy)
        );
        suppressTapUntilRef.current = performance.now() + 70;
      }
    }
  };

  const handleBoardPointerEnd = (e: React.PointerEvent<HTMLDivElement>) => {
    pointersRef.current.delete(e.pointerId);

    if (pointersRef.current.size === 1) {
      const remaining = Array.from(pointersRef.current.values())[0];
      const curr = cameraRef.current;
      gestureRef.current = {
        mode: 'pan',
        startDist: 0,
        startZoom: curr.zoom,
        startTx: curr.tx,
        startTy: curr.ty,
        startMidX: remaining.x,
        startMidY: remaining.y,
        startFocusBx: BOARD_VIEWBOX * 0.5,
        startFocusBy: BOARD_VIEWBOX * 0.5,
        moved: true,
      };
      suppressTapUntilRef.current = performance.now() + 70;
    } else if (pointersRef.current.size === 0) {
      gestureRef.current.mode = 'none';
      if (cameraRef.current.zoom < 1.05 && cameraRef.current.zoom > 1) {
        const { baseOx, baseOy } = layoutRef.current;
        animateCameraTo({ zoom: 1, tx: baseOx, ty: baseOy }, 150);
      }
    }
  };

  const handleUseHint = () => {
    if (statusModal !== 'none' || activeArrows.length === 0) return;
    if (hints <= 0) {
      feedback.playBlocked();
      return;
    }
    const candidate = findEscapableArrow(
      arrows,
      generated.gridSize,
      occGridRef.current
    );
    if (!candidate) return;
    if (onConsumeHint()) {
      feedback.playHint();
      setHintTargetId(candidate.id);

      const curr = cameraRef.current;
      if (curr.zoom > 1.15) {
        const headCenter = cellCenter(
          candidate.cells[candidate.cells.length - 1],
          cellStep
        );
        const { w, usableH, baseScale } = layoutRef.current;
        const totalS = baseScale * curr.zoom;
        const sx = curr.tx + headCenter.x * totalS;
        const sy = curr.ty + headCenter.y * totalS;
        if (sx < 44 || sx > w - 44 || sy < 44 || sy > usableH - 44) {
          const clamped = clampCamera(
            curr.zoom,
            w * 0.5 - headCenter.x * totalS,
            usableH * 0.5 - headCenter.y * totalS
          );
          animateCameraTo(clamped, 280);
        }
      }
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
    <div className="safe-top relative flex h-full w-full flex-col overflow-hidden bg-[#F5F8FC] text-slate-900">
      {/* Compact Top HUD Strip */}
      <div className="z-10 border-b border-slate-200/80 bg-[#F5F8FC] px-4 pt-1.5 pb-2.5">
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

        <div className="mt-0.5 flex items-center justify-between px-1">
          <div className="flex h-7 items-center gap-1.5 rounded-full bg-[#EAF0F8] px-3 text-slate-800">
            <Navigation2
              className="h-3 w-3 rotate-45 fill-slate-700 text-slate-700"
              aria-hidden="true"
            />
            <span className="font-mono-tabular text-xs font-bold">
              {activeArrows.length}
            </span>
          </div>

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

          <div
            className={`flex h-7 items-center rounded-full px-3 text-xs font-semibold ${difficultyTone}`}
          >
            {generated.difficulty}
          </div>
        </div>
      </div>

      {/* Full-Bleed Edge-to-Edge Vector Playfield (Direct SVG viewBox camera zoom) */}
      <motion.div
        ref={viewportRef}
        onPointerDown={handleBoardPointerDown}
        onPointerMove={handleBoardPointerMove}
        onPointerUp={handleBoardPointerEnd}
        onPointerCancel={handleBoardPointerEnd}
        animate={
          celebrating
            ? { x: [0, -6, 6, -4, 4, -2, 0] }
            : { x: 0 }
        }
        transition={{ duration: 0.42, ease: 'easeOut' }}
        className={`relative flex-1 w-full touch-none overflow-hidden transition-colors duration-300 select-none ${
          celebrating ? 'bg-[#F6FEF9]' : 'bg-white'
        }`}
      >
        <svg
          ref={svgRef}
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

          {/* Subtle Dotted Grid Matrix (1 SVG path) */}
          <path
            d={dotsPathD}
            fill="none"
            stroke="#CBD5E1"
            strokeWidth={dotRadius * 2}
            strokeLinecap="round"
          />

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

        {/* Floating Bottom Controls over Open Canvas */}
        <div className="safe-bottom pointer-events-none absolute right-4 bottom-4 left-4 flex items-center justify-between">
          <div className="flex flex-1 justify-start">
            {isZoomed && (
              <button
                type="button"
                onClick={() => {
                  feedback.playTap();
                  resetZoomTransform(true);
                }}
                aria-label="Reset zoom to fit board"
                className="pointer-events-auto flex h-10 items-center gap-1.5 rounded-full border border-slate-200/90 bg-white/95 px-3.5 text-[13px] font-bold text-slate-800 shadow-md backdrop-blur-xs transition-transform active:scale-95"
              >
                <Minimize2 className="h-3.5 w-3.5 text-[#2589FF]" />
                <span className="font-mono-tabular">1.0×</span>
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={handleUseHint}
            aria-label={`Use hint (${hints} remaining)`}
            className={`pointer-events-auto relative flex h-14 w-14 items-center justify-center rounded-full bg-white shadow-[0_8px_24px_-4px_rgba(37,137,255,0.22)] transition-transform active:scale-92 ${
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

          <div className="flex-1" />
        </div>
      </motion.div>

      {/* Celebratory 60fps Confetti Cannons */}
      <ConfettiBurst triggerKey={confettiKey} />

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
