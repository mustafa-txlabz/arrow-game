import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Dimensions,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  Canvas,
  Circle,
  Group,
  Path,
  Skia,
  type SkPath,
  type SkPathBuilder,
} from '@shopify/react-native-skia';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Reanimated, {
  Easing,
  runOnJS,
  useAnimatedReaction,
  useAnimatedStyle,
  useDerivedValue,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import {
  SafeAreaView,
  useSafeAreaInsets,
} from 'react-native-safe-area-context';
import {
  ChevronLeft,
  Heart,
  Lightbulb,
  Minimize2,
  Navigation2,
  PartyPopper,
  RotateCcw,
  Settings,
} from 'lucide-react-native';
import type { ArrowTile, GridPoint } from '../types/game';
import {
  BOARD_PAD,
  BOARD_VIEWBOX,
  type ArrowPolylineGeometry,
  buildArrowGeometry,
  cellCenter,
} from '../utils/arrowGeometry';
import {
  buildOccupancyGrid,
  findEscapableArrow,
  generateLevel,
  traceArrowPathFast,
} from '../utils/puzzleGenerator';
import { feedback } from '../utils/soundAndHaptics';
import { ActiveArrowRunner } from './AnimatedPathArrow';
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
const BLOCKED_RED = '#EF4444';
const ACTIVE_BLUE = '#2589FF';

function appendStemToBuilder(
  builder: SkPathBuilder,
  geom: ArrowPolylineGeometry
): void {
  const { restPtsX, restPtsY } = geom;
  if (restPtsX.length === 0) return;
  builder.moveTo(restPtsX[0], restPtsY[0]);
  for (let i = 1; i < restPtsX.length; i++) {
    builder.lineTo(restPtsX[i], restPtsY[i]);
  }
}

function appendHeadToBuilder(
  builder: SkPathBuilder,
  geom: ArrowPolylineGeometry,
  tipScale: number
): void {
  const { x: hx, y: hy, angle } = geom.restHead;
  const rad = (angle * Math.PI) / 180;
  const cos = Math.cos(rad) * tipScale;
  const sin = Math.sin(rad) * tipScale;
  builder.moveTo(hx + 6 * cos, hy + 6 * sin);
  builder.lineTo(hx - 5.5 * cos + 5.8 * sin, hy - 5.5 * sin - 5.8 * cos);
  builder.lineTo(hx - 3.5 * cos, hy - 3.5 * sin);
  builder.lineTo(hx - 5.5 * cos - 5.8 * sin, hy - 5.5 * sin + 5.8 * cos);
  builder.close();
}

function buildBatchPaths(
  arrows: ArrowTile[],
  geomById: Map<string, ArrowPolylineGeometry>,
  hintTargetId: string | null,
  arrowTipScale: number
): {
  remainingCount: number;
  haloPath: SkPath | null;
  blackStemPath: SkPath | null;
  blackHeadPath: SkPath | null;
  redStemPath: SkPath | null;
  redHeadPath: SkPath | null;
  hintStemPath: SkPath | null;
  hintHeadPath: SkPath | null;
  animatingArrows: ArrowTile[];
} {
  const haloB = Skia.PathBuilder.Make();
  const blackStemB = Skia.PathBuilder.Make();
  const blackHeadB = Skia.PathBuilder.Make();
  const redStemB = Skia.PathBuilder.Make();
  const redHeadB = Skia.PathBuilder.Make();
  const hintStemB = Skia.PathBuilder.Make();
  const hintHeadB = Skia.PathBuilder.Make();

  let hasHalo = false;
  let hasBlack = false;
  let hasRed = false;
  let hasHint = false;
  const active: ArrowTile[] = [];
  let remaining = 0;

  for (let i = 0; i < arrows.length; i++) {
    const a = arrows[i];
    if (a.state !== 'escaping') {
      remaining += 1;
    }
    if (a.state !== 'idle') {
      active.push(a);
      continue;
    }
    const geom = geomById.get(a.id);
    if (!geom) continue;
    hasHalo = true;
    appendStemToBuilder(haloB, geom);

    if (a.id === hintTargetId) {
      hasHint = true;
      appendStemToBuilder(hintStemB, geom);
      appendHeadToBuilder(hintHeadB, geom, arrowTipScale);
    } else if (a.isBlocked) {
      hasRed = true;
      appendStemToBuilder(redStemB, geom);
      appendHeadToBuilder(redHeadB, geom, arrowTipScale);
    } else {
      hasBlack = true;
      appendStemToBuilder(blackStemB, geom);
      appendHeadToBuilder(blackHeadB, geom, arrowTipScale);
    }
  }

  return {
    remainingCount: remaining,
    haloPath: hasHalo ? haloB.detach() : null,
    blackStemPath: hasBlack ? blackStemB.detach() : null,
    blackHeadPath: hasBlack ? blackHeadB.detach() : null,
    redStemPath: hasRed ? redStemB.detach() : null,
    redHeadPath: hasRed ? redHeadB.detach() : null,
    hintStemPath: hasHint ? hintStemB.detach() : null,
    hintHeadPath: hasHint ? hintHeadB.detach() : null,
    animatingArrows: active,
  };
}

/**
 * Full-bleed GPU-accelerated Skia Gameplay Screen for Arrow Escape:
 * - True vector GPU rendering via @shopify/react-native-skia: zero bitmap scaling,
 *   zero pixel blur or jagged edges even at 7x+ zoom.
 * - Edge-to-edge open canvas playfield with focal-anchored pinch-to-zoom & smooth panning.
 * - O(1) Int32Array grid-cell hit-testing directly inside RNGH Tap gesture.
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
  const insets = useSafeAreaInsets();

  const [arrows, setArrows] = useState<ArrowTile[]>(generated.arrows);
  const [lives, setLives] = useState<number>(MAX_LIVES);
  const [hintTargetId, setHintTargetId] = useState<string | null>(null);
  const [impactFlash, setImpactFlash] = useState<{
    key: number;
    pt: GridPoint;
  } | null>(null);
  const [celebrating, setCelebrating] = useState<boolean>(false);
  const [confettiKey, setConfettiKey] = useState<number>(0);
  const [statusModal, setStatusModal] = useState<'none' | 'cleared' | 'failed'>('none');
  const [isZoomed, setIsZoomed] = useState<boolean>(false);

  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  const livesRef = useRef<number>(MAX_LIVES);
  const statusModalRef = useRef(statusModal);
  statusModalRef.current = statusModal;

  const occGridRef = useRef<Uint8Array>(new Uint8Array(0));
  const cellOwnerRef = useRef<Int32Array>(new Int32Array(0));
  const arrowsByIdRef = useRef<Map<string, ArrowTile>>(new Map());
  const escapingIdsRef = useRef<Set<string>>(new Set());
  const suppressTapUntilRef = useRef<number>(0);

  const heartsShakeX = useSharedValue(0);
  const boardShakeX = useSharedValue(0);

  // Full-bleed playfield camera shared values (GPU-driven at 120fps)
  const initialWin = Dimensions.get('window');
  const initialFit = Math.max(240, Math.min(initialWin.width - 24, initialWin.height * 0.62));
  const viewportW = useSharedValue(initialWin.width);
  const viewportH = useSharedValue(Math.max(320, initialWin.height - 140));
  const usableHVal = useSharedValue(Math.max(240, initialWin.height - 230));
  const baseScale = useSharedValue(initialFit / BOARD_VIEWBOX);
  const baseOx = useSharedValue((initialWin.width - initialFit) * 0.5);
  const baseOy = useSharedValue(16);

  const zoom = useSharedValue(1);
  const tx = useSharedValue((initialWin.width - initialFit) * 0.5);
  const ty = useSharedValue(16);
  const savedZoom = useSharedValue(1);
  const savedTx = useSharedValue(0);
  const savedTy = useSharedValue(0);
  const pinchFocusBx = useSharedValue(BOARD_VIEWBOX * 0.5);
  const pinchFocusBy = useSharedValue(BOARD_VIEWBOX * 0.5);
  const pinchMoved = useSharedValue(false);
  const panMoved = useSharedValue(false);

  const cellStep = (BOARD_VIEWBOX - BOARD_PAD * 2) / generated.gridSize;
  const strokeWidth = Math.min(5.0, Math.max(1.25, cellStep * 0.145));
  const arrowTipScale = Math.min(1.22, Math.max(0.28, cellStep / 33));
  const dotRadius = Math.min(2.3, Math.max(0.65, cellStep * 0.052));
  const haloWidth = strokeWidth + Math.min(4.0, strokeWidth * 0.95);
  const headStrokeWidth = Math.max(0.45, 1.2 * arrowTipScale);

  // Precompute all level geometry, 1-draw-call Skia grid dots SkPath, and initial cell ownership
  const levelData = useMemo(() => {
    const gridSize = generated.gridSize;
    const dotsBuilder = Skia.PathBuilder.Make();
    for (let r = 0; r < gridSize; r++) {
      const y = BOARD_PAD + r * cellStep + cellStep * 0.5;
      for (let c = 0; c < gridSize; c++) {
        const x = BOARD_PAD + c * cellStep + cellStep * 0.5;
        dotsBuilder.addCircle(x, y, dotRadius);
      }
    }
    const dotsPath = dotsBuilder.detach();

    const geomById = new Map<string, ArrowPolylineGeometry>();
    const initialCellOwner = new Int32Array(gridSize * gridSize).fill(-1);

    for (let i = 0; i < generated.arrows.length; i++) {
      const a = generated.arrows[i];
      geomById.set(a.id, buildArrowGeometry(a.cells, a.dir, cellStep, arrowTipScale));
      for (let j = 0; j < a.cells.length; j++) {
        const pt = a.cells[j];
        initialCellOwner[pt.r * gridSize + pt.c] = i;
      }
    }

    return { dotsPath, geomById, initialCellOwner };
  }, [generated, cellStep, arrowTipScale, dotRadius]);

  const arrowsById = useMemo(() => {
    const map = new Map<string, ArrowTile>();
    for (let i = 0; i < arrows.length; i++) {
      map.set(arrows[i].id, arrows[i]);
    }
    return map;
  }, [arrows]);
  arrowsByIdRef.current = arrowsById;

  const maxZoomScale = useMemo(
    () => Math.min(8.0, Math.max(2.6, generated.gridSize * 0.25)),
    [generated.gridSize]
  );

  const resetZoomTransform = useCallback(
    (animated = false) => {
      if (animated) {
        const ease = { duration: 220, easing: Easing.out(Easing.cubic) };
        zoom.value = withTiming(1, ease);
        tx.value = withTiming(baseOx.value, ease);
        ty.value = withTiming(baseOy.value, ease);
      } else {
        zoom.value = 1;
        tx.value = baseOx.value;
        ty.value = baseOy.value;
      }
      savedZoom.value = 1;
      savedTx.value = baseOx.value;
      savedTy.value = baseOy.value;
    },
    [baseOx, baseOy, savedTx, savedTy, savedZoom, tx, ty, zoom]
  );

  const scheduleTimeout = (fn: () => void, ms: number) => {
    const id = setTimeout(fn, ms);
    timersRef.current.push(id);
  };

  const clearScheduledTimeouts = () => {
    for (const id of timersRef.current) {
      clearTimeout(id);
    }
    timersRef.current = [];
  };

  useEffect(() => {
    clearScheduledTimeouts();
    occGridRef.current = buildOccupancyGrid(generated.arrows, generated.gridSize);
    cellOwnerRef.current = new Int32Array(levelData.initialCellOwner);
    escapingIdsRef.current.clear();
    setArrows(generated.arrows);
    setLives(MAX_LIVES);
    livesRef.current = MAX_LIVES;
    setHintTargetId(null);
    setImpactFlash(null);
    setCelebrating(false);
    setStatusModal('none');
    resetZoomTransform(false);
    feedback.unlock();
    return clearScheduledTimeouts;
  }, [generated, levelData.initialCellOwner, resetZoomTransform]);

  useAnimatedReaction(
    () => zoom.value > 1.08,
    (curr, prev) => {
      if (curr !== prev) {
        runOnJS(setIsZoomed)(curr);
      }
    }
  );

  const handlePlayfieldLayout = useCallback(
    (w: number, h: number) => {
      if (w <= 0 || h <= 0) return;
      const bottomReserve = Math.max(84, insets.bottom + 76);
      const uH = Math.max(180, h - bottomReserve);
      const fit = Math.max(180, Math.min(w - 20, uH - 12));
      const nextBaseScale = fit / BOARD_VIEWBOX;
      const nextOx = (w - fit) * 0.5;
      const nextOy = Math.max(8, (uH - fit) * 0.5);

      const prevOx = baseOx.value;
      const prevOy = baseOy.value;
      viewportW.value = w;
      viewportH.value = h;
      usableHVal.value = uH;
      baseScale.value = nextBaseScale;
      baseOx.value = nextOx;
      baseOy.value = nextOy;

      if (zoom.value <= 1.005) {
        tx.value = nextOx;
        ty.value = nextOy;
      } else {
        tx.value += nextOx - prevOx;
        ty.value += nextOy - prevOy;
      }
    },
    [baseOx, baseOy, baseScale, insets.bottom, tx, ty, usableHVal, viewportH, viewportW, zoom]
  );

  const triggerHeartsShake = useCallback(() => {
    heartsShakeX.value = 0;
    heartsShakeX.value = withSequence(
      withTiming(-5, { duration: 48 }),
      withTiming(5, { duration: 48 }),
      withTiming(-3, { duration: 48 }),
      withTiming(3, { duration: 48 }),
      withTiming(0, { duration: 48 })
    );
  }, [heartsShakeX]);

  const triggerBoardCelebrateShake = useCallback(() => {
    boardShakeX.value = 0;
    boardShakeX.value = withSequence(
      withTiming(-6, { duration: 55 }),
      withTiming(6, { duration: 55 }),
      withTiming(-4, { duration: 55 }),
      withTiming(4, { duration: 55 }),
      withTiming(0, { duration: 55 })
    );
  }, [boardShakeX]);

  const markPinchEnd = useCallback(() => {
    suppressTapUntilRef.current = Date.now() + 90;
  }, []);

  const markPanEnd = useCallback(() => {
    suppressTapUntilRef.current = Date.now() + 45;
  }, []);

  const handleRestartLevel = () => {
    feedback.playTap();
    clearScheduledTimeouts();
    occGridRef.current = buildOccupancyGrid(generated.arrows, generated.gridSize);
    cellOwnerRef.current = new Int32Array(levelData.initialCellOwner);
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
          triggerBoardCelebrateShake();
          setConfettiKey((k) => k + 1);
          const modalTimer = setTimeout(() => {
            setStatusModal('cleared');
          }, 420);
          timersRef.current.push(modalTimer);
        }
        return next;
      });
    },
    [triggerBoardCelebrateShake]
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

  const handleTapArrow = useCallback(
    (arrow: ArrowTile) => {
      if (statusModalRef.current !== 'none') return;
      if (arrow.state !== 'idle') return;
      if (escapingIdsRef.current.has(arrow.id)) return;

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
        const owners = cellOwnerRef.current;
        for (let i = 0; i < arrow.cells.length; i++) {
          const pt = arrow.cells[i];
          const flatIdx = pt.r * gridSize + pt.c;
          occ[flatIdx] = 0;
          owners[flatIdx] = -1;
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

      const hitDurationMs = 70 + freeCells * 16;
      const reboundDurationMs = 130 + freeCells * 20;
      const bumpDurationMs = hitDurationMs + reboundDurationMs;

      feedback.playTap();

      if (blockerCell) {
        scheduleTimeout(() => {
          feedback.playBlocked();
          if (isFirstPenalty) {
            triggerHeartsShake();
          }
          setImpactFlash({ key: Date.now(), pt: blockerCell });
          scheduleTimeout(() => {
            setImpactFlash((curr) =>
              curr && curr.pt.r === blockerCell.r && curr.pt.c === blockerCell.c
                ? null
                : curr
            );
          }, 300);
        }, Math.round(bumpDurationMs * 0.34));
      } else {
        feedback.playBlocked();
        if (isFirstPenalty) {
          triggerHeartsShake();
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
    },
    [cellStep, generated.gridSize, strokeWidth, triggerHeartsShake]
  );

  // O(1) Grid-cell tap resolver mapped directly from screen pixel -> board coordinates
  const handleBoardTap = useCallback(
    (
      screenX: number,
      screenY: number,
      curZoom: number,
      curTx: number,
      curTy: number,
      curBaseScale: number
    ) => {
      if (statusModalRef.current !== 'none') return;
      if (Date.now() < suppressTapUntilRef.current) return;
      const totalScale = curBaseScale * curZoom;
      if (totalScale <= 0) return;

      const vx = (screenX - curTx) / totalScale;
      const vy = (screenY - curTy) / totalScale;

      const gridSize = generated.gridSize;
      const fc = (vx - BOARD_PAD) / cellStep;
      const fr = (vy - BOARD_PAD) / cellStep;
      const r0 = Math.floor(fr);
      const c0 = Math.floor(fc);

      const owners = cellOwnerRef.current;
      const baseArrows = generated.arrows;
      const liveMap = arrowsByIdRef.current;

      if (r0 >= 0 && r0 < gridSize && c0 >= 0 && c0 < gridSize) {
        const ownerIdx = owners[r0 * gridSize + c0];
        if (ownerIdx >= 0) {
          const live = liveMap.get(baseArrows[ownerIdx].id);
          if (live && live.state === 'idle') {
            handleTapArrow(live);
            return;
          }
        }
      }

      let bestArrow: ArrowTile | null = null;
      let bestDistSq = 0.68 * 0.68;
      const rMin = Math.max(0, r0 - 1);
      const rMax = Math.min(gridSize - 1, r0 + 1);
      const cMin = Math.max(0, c0 - 1);
      const cMax = Math.min(gridSize - 1, c0 + 1);

      for (let rr = rMin; rr <= rMax; rr++) {
        const dy = fr - (rr + 0.5);
        for (let cc = cMin; cc <= cMax; cc++) {
          const ownerIdx = owners[rr * gridSize + cc];
          if (ownerIdx < 0) continue;
          const dx = fc - (cc + 0.5);
          const dSq = dx * dx + dy * dy;
          if (dSq < bestDistSq) {
            const live = liveMap.get(baseArrows[ownerIdx].id);
            if (live && live.state === 'idle') {
              bestDistSq = dSq;
              bestArrow = live;
            }
          }
        }
      }

      if (bestArrow) {
        handleTapArrow(bestArrow);
      }
    },
    [cellStep, generated.arrows, generated.gridSize, handleTapArrow]
  );

  const clampCameraWorklet = useCallback(
    (nextZoom: number, nextTx: number, nextTy: number) => {
      'worklet';
      const w = viewportW.value;
      const h = viewportH.value;
      const uH = usableHVal.value;
      const ox = baseOx.value;
      const oy = baseOy.value;
      const bScale = baseScale.value;

      const z = Math.min(maxZoomScale, Math.max(MIN_ZOOM_SCALE, nextZoom));
      if (z <= 1.0005) {
        return { z: 1, x: ox, y: oy };
      }

      const t = Math.min(1, (z - 1) / 0.25);
      const scaledBoard = BOARD_VIEWBOX * bScale * z;
      const freeMinTx = Math.min(ox, w * 0.36 - scaledBoard);
      const freeMaxTx = Math.max(ox, w * 0.64);
      const freeMinTy = Math.min(oy, uH * 0.36 - scaledBoard);
      const freeMaxTy = Math.max(oy, h * 0.66);

      const minTx = ox + (freeMinTx - ox) * t;
      const maxTx = ox + (freeMaxTx - ox) * t;
      const minTy = oy + (freeMinTy - oy) * t;
      const maxTy = oy + (freeMaxTy - oy) * t;

      return {
        z,
        x: Math.max(minTx, Math.min(maxTx, nextTx)),
        y: Math.max(minTy, Math.min(maxTy, nextTy)),
      };
    },
    [baseOx, baseOy, baseScale, maxZoomScale, usableHVal, viewportH, viewportW]
  );

  const pinchGesture = useMemo(
    () =>
      Gesture.Pinch()
        .onStart((e) => {
          'worklet';
          pinchMoved.value = false;
          savedZoom.value = zoom.value;
          savedTx.value = tx.value;
          savedTy.value = ty.value;
          const totalS = baseScale.value * zoom.value;
          pinchFocusBx.value = (e.focalX - tx.value) / totalS;
          pinchFocusBy.value = (e.focalY - ty.value) / totalS;
        })
        .onUpdate((e) => {
          'worklet';
          if (e.numberOfPointers >= 2 || Math.abs(e.scale - 1) > 0.02) {
            pinchMoved.value = true;
          }
          const rawZoom = savedZoom.value * e.scale;
          const clampedZoom = Math.min(
            maxZoomScale,
            Math.max(MIN_ZOOM_SCALE, rawZoom)
          );
          const nextTotalS = baseScale.value * clampedZoom;
          const rawTx = e.focalX - pinchFocusBx.value * nextTotalS;
          const rawTy = e.focalY - pinchFocusBy.value * nextTotalS;
          const c = clampCameraWorklet(clampedZoom, rawTx, rawTy);
          zoom.value = c.z;
          tx.value = c.x;
          ty.value = c.y;
        })
        .onEnd(() => {
          'worklet';
          if (pinchMoved.value) {
            runOnJS(markPinchEnd)();
          }
          if (zoom.value < 1.05) {
            const ease = { duration: 150, easing: Easing.out(Easing.cubic) };
            zoom.value = withTiming(1, ease);
            tx.value = withTiming(baseOx.value, ease);
            ty.value = withTiming(baseOy.value, ease);
          }
        }),
    [
      baseOx,
      baseOy,
      baseScale,
      clampCameraWorklet,
      markPinchEnd,
      maxZoomScale,
      pinchFocusBx,
      pinchFocusBy,
      pinchMoved,
      savedTx,
      savedTy,
      savedZoom,
      tx,
      ty,
      zoom,
    ]
  );

  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .minDistance(12)
        .maxPointers(1)
        .onStart(() => {
          'worklet';
          panMoved.value = false;
          savedTx.value = tx.value;
          savedTy.value = ty.value;
        })
        .onUpdate((e) => {
          'worklet';
          if (zoom.value <= 1.001) return;
          if (Math.abs(e.translationX) > 6 || Math.abs(e.translationY) > 6) {
            panMoved.value = true;
          }
          const c = clampCameraWorklet(
            zoom.value,
            savedTx.value + e.translationX,
            savedTy.value + e.translationY
          );
          tx.value = c.x;
          ty.value = c.y;
        })
        .onEnd(() => {
          'worklet';
          if (panMoved.value && zoom.value > 1.001) {
            runOnJS(markPanEnd)();
          }
        }),
    [clampCameraWorklet, markPanEnd, panMoved, savedTx, savedTy, tx, ty, zoom]
  );

  const tapGesture = useMemo(
    () =>
      Gesture.Tap()
        .maxDuration(280)
        .maxDistance(13)
        .onEnd((e, success) => {
          'worklet';
          if (!success) return;
          runOnJS(handleBoardTap)(
            e.x,
            e.y,
            zoom.value,
            tx.value,
            ty.value,
            baseScale.value
          );
        }),
    [baseScale, handleBoardTap, tx, ty, zoom]
  );

  const composedGesture = useMemo(
    () => Gesture.Simultaneous(pinchGesture, panGesture, tapGesture),
    [pinchGesture, panGesture, tapGesture]
  );

  const cameraTransform = useDerivedValue(() => {
    'worklet';
    return [
      { translateX: tx.value + boardShakeX.value },
      { translateY: ty.value },
      { scale: baseScale.value * zoom.value },
    ];
  });

  const heartsAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: heartsShakeX.value }],
  }));

  // Batch ALL static idle arrows into Skia GPU SkPath layers + separate out only moving runners
  const {
    remainingCount,
    haloPath,
    blackStemPath,
    blackHeadPath,
    redStemPath,
    redHeadPath,
    hintStemPath,
    hintHeadPath,
    animatingArrows,
  } = useMemo(
    () => buildBatchPaths(arrows, levelData.geomById, hintTargetId, arrowTipScale),
    [arrows, levelData.geomById, hintTargetId, arrowTipScale]
  );

  const handleUseHint = () => {
    if (statusModal !== 'none' || remainingCount === 0) return;
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

      // If zoomed in and hinted arrow is outside visible area, smoothly glide camera to reveal it
      if (zoom.value > 1.15) {
        const geom = levelData.geomById.get(candidate.id);
        if (geom) {
          const totalS = baseScale.value * zoom.value;
          const sx = tx.value + geom.restHead.x * totalS;
          const sy = ty.value + geom.restHead.y * totalS;
          const w = viewportW.value;
          const uH = usableHVal.value;
          if (sx < 44 || sx > w - 44 || sy < 44 || sy > uH - 44) {
            const targetTx = w * 0.5 - geom.restHead.x * totalS;
            const targetTy = uH * 0.5 - geom.restHead.y * totalS;
            const c = clampCameraWorklet(zoom.value, targetTx, targetTy);
            const ease = { duration: 280, easing: Easing.out(Easing.cubic) };
            tx.value = withTiming(c.x, ease);
            ty.value = withTiming(c.y, ease);
          }
        }
      }
    }
  };

  const difficultyBg =
    generated.difficulty === 'Easy'
      ? '#ECFDF5'
      : generated.difficulty === 'Normal'
        ? '#EAF0F8'
        : generated.difficulty === 'Hard'
          ? '#FFFBEB'
          : '#FFF1F2';

  const difficultyText =
    generated.difficulty === 'Easy'
      ? '#047857'
      : generated.difficulty === 'Normal'
        ? '#334155'
        : generated.difficulty === 'Hard'
          ? '#B45309'
          : '#BE123C';

  const impactCenter = impactFlash
    ? cellCenter(impactFlash.pt, cellStep)
    : null;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Compact Top HUD Strip */}
      <View style={styles.hudChrome}>
        <View style={styles.header}>
          <TouchableOpacity
            activeOpacity={0.8}
            onPress={() => {
              feedback.playTap();
              onBackHome();
            }}
            accessibilityLabel="Back to home"
            style={styles.headerIconBtn}
          >
            <ChevronLeft size={24} color="#2589FF" strokeWidth={2.5} />
          </TouchableOpacity>

          <Text style={styles.levelTitle}>Level {level}</Text>

          <TouchableOpacity
            activeOpacity={0.8}
            onPress={() => {
              feedback.playTap();
              onOpenSettings();
            }}
            accessibilityLabel="Open settings"
            style={styles.headerIconBtn}
          >
            <Settings size={20} color="#2589FF" strokeWidth={2.2} />
          </TouchableOpacity>
        </View>

        <View style={styles.subHud}>
          <View style={styles.remainingPill}>
            <View style={styles.navIconRotated}>
              <Navigation2 size={12} color="#334155" fill="#334155" />
            </View>
            <Text style={styles.remainingText}>{remainingCount}</Text>
          </View>

          <Reanimated.View style={[styles.heartsRow, heartsAnimatedStyle]}>
            {Array.from({ length: MAX_LIVES }).map((_, idx) => {
              const active = idx < lives;
              return (
                <Heart
                  key={idx}
                  size={20}
                  color={active ? '#EF4444' : '#CBD5E1'}
                  fill={active ? '#EF4444' : '#E2E8F0'}
                  style={!active && styles.lostHeart}
                />
              );
            })}
          </Reanimated.View>

          <View style={[styles.difficultyPill, { backgroundColor: difficultyBg }]}>
            <Text style={[styles.difficultyLabel, { color: difficultyText }]}>
              {generated.difficulty}
            </Text>
          </View>
        </View>
      </View>

      {/* Full-Bleed Edge-to-Edge Vector Skia Playfield */}
      <View
        style={[
          styles.playfieldWrap,
          celebrating && styles.playfieldCelebrating,
        ]}
        onLayout={(e) => {
          handlePlayfieldLayout(
            e.nativeEvent.layout.width,
            e.nativeEvent.layout.height
          );
        }}
      >
        <GestureDetector gesture={composedGesture}>
          <View collapsable={false} style={styles.canvasContainer}>
            <Canvas style={styles.skiaCanvas}>
              <Group transform={cameraTransform}>
                {/* 1-draw-call GPU Vector Dotted Grid Matrix */}
                <Path
                  path={levelData.dotsPath}
                  style="fill"
                  color="#CBD5E1"
                />

                {/* Optional Hint Glow Aura */}
                {hintStemPath && (
                  <Path
                    path={hintStemPath}
                    style="stroke"
                    color="rgba(37, 137, 255, 0.25)"
                    strokeWidth={strokeWidth + 8}
                    strokeCap="round"
                    strokeJoin="round"
                  />
                )}

                {/* Batched White Halo Backing for All Resting Arrows */}
                {haloPath && (
                  <Path
                    path={haloPath}
                    style="stroke"
                    color="#FFFFFF"
                    opacity={0.9}
                    strokeWidth={haloWidth}
                    strokeCap="round"
                    strokeJoin="round"
                  />
                )}

                {/* Batched Normal Resting Arrows (Stems + Heads) */}
                {blackStemPath && (
                  <Path
                    path={blackStemPath}
                    style="stroke"
                    color="#0F172A"
                    strokeWidth={strokeWidth}
                    strokeCap="round"
                    strokeJoin="round"
                  />
                )}
                {blackHeadPath && (
                  <>
                    <Path path={blackHeadPath} style="fill" color="#0F172A" />
                    <Path
                      path={blackHeadPath}
                      style="stroke"
                      color="#0F172A"
                      strokeWidth={headStrokeWidth}
                      strokeJoin="round"
                    />
                  </>
                )}

                {/* Batched Permanently-Blocked Red Resting Arrows (Stems + Heads) */}
                {redStemPath && (
                  <Path
                    path={redStemPath}
                    style="stroke"
                    color={BLOCKED_RED}
                    strokeWidth={strokeWidth}
                    strokeCap="round"
                    strokeJoin="round"
                  />
                )}
                {redHeadPath && (
                  <>
                    <Path path={redHeadPath} style="fill" color={BLOCKED_RED} />
                    <Path
                      path={redHeadPath}
                      style="stroke"
                      color={BLOCKED_RED}
                      strokeWidth={headStrokeWidth}
                      strokeJoin="round"
                    />
                  </>
                )}

                {/* Hinted Resting Arrow Highlight (Stem + Head) */}
                {hintStemPath && (
                  <Path
                    path={hintStemPath}
                    style="stroke"
                    color={ACTIVE_BLUE}
                    strokeWidth={strokeWidth}
                    strokeCap="round"
                    strokeJoin="round"
                  />
                )}
                {hintHeadPath && (
                  <>
                    <Path path={hintHeadPath} style="fill" color={ACTIVE_BLUE} />
                    <Path
                      path={hintHeadPath}
                      style="stroke"
                      color={ACTIVE_BLUE}
                      strokeWidth={headStrokeWidth}
                      strokeJoin="round"
                    />
                  </>
                )}

                {/* Active UI-thread Skia Runners (mounted ONLY while moving) */}
                {animatingArrows.map((arrow) => {
                  const geom = levelData.geomById.get(arrow.id);
                  if (!geom || arrow.state === 'idle') return null;
                  const restColor = arrow.isBlocked
                    ? BLOCKED_RED
                    : arrow.id === hintTargetId
                      ? ACTIVE_BLUE
                      : '#0F172A';
                  return (
                    <ActiveArrowRunner
                      key={arrow.id}
                      id={arrow.id}
                      mode={arrow.state}
                      isBlocked={Boolean(arrow.isBlocked)}
                      restColor={restColor}
                      strokeWidth={strokeWidth}
                      arrowTipScale={arrowTipScale}
                      cellStep={cellStep}
                      bumpDistancePx={arrow.bumpDistancePx}
                      bumpDurationMs={arrow.bumpDurationMs}
                      geom={geom}
                      showHintHalo={
                        arrow.id === hintTargetId ||
                        (arrow.state === 'escaping' && !arrow.isBlocked)
                      }
                      onEscapeComplete={handleEscapeComplete}
                      onBlockedComplete={handleBlockedComplete}
                      onPenaltyComplete={handlePenaltyComplete}
                    />
                  );
                })}

                {/* Collision ripple highlight at obstructing cell */}
                {impactCenter && (
                  <Group>
                    <Circle
                      cx={impactCenter.x}
                      cy={impactCenter.y}
                      r={Math.max(12, cellStep * 0.38)}
                      color="rgba(239, 68, 68, 0.14)"
                      style="fill"
                    />
                    <Circle
                      cx={impactCenter.x}
                      cy={impactCenter.y}
                      r={Math.max(12, cellStep * 0.38)}
                      color="#EF4444"
                      style="stroke"
                      strokeWidth={2.5}
                    />
                  </Group>
                )}
              </Group>
            </Canvas>
          </View>
        </GestureDetector>

        {/* Floating Bottom Controls over Open Canvas */}
        <View
          pointerEvents="box-none"
          style={[
            styles.floatingFooter,
            { paddingBottom: Math.max(16, insets.bottom + 12) },
          ]}
        >
          <View style={styles.footerSlotLeft}>
            {isZoomed && (
              <TouchableOpacity
                activeOpacity={0.85}
                onPress={() => {
                  feedback.playTap();
                  resetZoomTransform(true);
                }}
                accessibilityLabel="Reset zoom to fit board"
                style={styles.resetZoomPill}
              >
                <Minimize2 size={15} color="#2589FF" strokeWidth={2.3} />
                <Text style={styles.resetZoomText}>1.0×</Text>
              </TouchableOpacity>
            )}
          </View>

          <TouchableOpacity
            activeOpacity={0.88}
            onPress={handleUseHint}
            accessibilityLabel={`Use hint (${hints} remaining)`}
            style={[
              styles.hintFab,
              hintTargetId ? styles.hintFabActive : styles.hintFabDefault,
            ]}
          >
            <Lightbulb size={24} color={hints > 0 ? '#2589FF' : '#94A3B8'} />
            <View style={styles.hintBadge}>
              <Text style={styles.hintBadgeText}>{hints}</Text>
            </View>
          </TouchableOpacity>

          <View style={styles.footerSlotRight} />
        </View>
      </View>

      {/* Celebratory Confetti Overlay */}
      <ConfettiBurst triggerKey={confettiKey} />

      {/* Level Complete Modal */}
      <Modal
        visible={statusModal === 'cleared'}
        transparent
        animationType="fade"
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={[styles.statusBadge, styles.statusSuccessBg]}>
              <PartyPopper size={24} color="#059669" />
            </View>
            <Text style={styles.modalTitle}>Level {level} Cleared</Text>

            <View style={styles.modalActions}>
              <TouchableOpacity
                activeOpacity={0.9}
                onPress={() => {
                  feedback.playTap();
                  onLevelComplete();
                }}
                style={styles.primaryModalBtn}
              >
                <Text style={styles.primaryModalBtnText}>Next Level</Text>
              </TouchableOpacity>
              <TouchableOpacity
                activeOpacity={0.85}
                onPress={() => {
                  onLevelComplete();
                  onBackHome();
                }}
                style={styles.secondaryModalBtn}
              >
                <Text style={styles.secondaryModalBtnText}>Back to Home</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>

      {/* Out of Lives Modal */}
      <Modal
        visible={statusModal === 'failed'}
        transparent
        animationType="fade"
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <View style={[styles.statusBadge, styles.statusFailBg]}>
              <Heart size={24} color="#E11D48" />
            </View>
            <Text style={styles.modalTitle}>Out of Lives</Text>
            <Text style={styles.modalSubtitle}>
              Clear blocking arrows first before tapping inner paths.
            </Text>

            <View style={styles.modalActions}>
              <TouchableOpacity
                activeOpacity={0.9}
                onPress={handleRestartLevel}
                style={styles.primaryModalBtn}
              >
                <RotateCcw size={16} color="#FFFFFF" />
                <Text style={styles.primaryModalBtnText}>
                  Retry Level {level}
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                activeOpacity={0.85}
                onPress={onBackHome}
                style={styles.secondaryModalBtn}
              >
                <Text style={styles.secondaryModalBtnText}>Back to Home</Text>
              </TouchableOpacity>
            </View>
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F8FC',
  },
  hudChrome: {
    backgroundColor: '#F5F8FC',
    paddingHorizontal: 16,
    paddingTop: 6,
    paddingBottom: 10,
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(226, 232, 240, 0.85)',
    zIndex: 10,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerIconBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
  },
  levelTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#0F172A',
    letterSpacing: -0.3,
  },
  subHud: {
    marginTop: 2,
    paddingHorizontal: 4,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  remainingPill: {
    height: 28,
    borderRadius: 999,
    backgroundColor: '#EAF0F8',
    paddingHorizontal: 12,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  navIconRotated: {
    transform: [{ rotate: '45deg' }],
  },
  remainingText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#1E293B',
    fontVariant: ['tabular-nums'],
  },
  heartsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  lostHeart: {
    transform: [{ scale: 0.9 }],
  },
  difficultyPill: {
    height: 28,
    borderRadius: 999,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
  },
  difficultyLabel: {
    fontSize: 12,
    fontWeight: '600',
  },
  playfieldWrap: {
    flex: 1,
    width: '100%',
    backgroundColor: '#FFFFFF',
    overflow: 'hidden',
  },
  playfieldCelebrating: {
    backgroundColor: '#F6FEF9',
  },
  canvasContainer: {
    flex: 1,
    width: '100%',
    height: '100%',
  },
  skiaCanvas: {
    flex: 1,
    width: '100%',
    height: '100%',
  },
  floatingFooter: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  footerSlotLeft: {
    flex: 1,
    alignItems: 'flex-start',
  },
  footerSlotRight: {
    flex: 1,
  },
  resetZoomPill: {
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    paddingHorizontal: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderWidth: 1,
    borderColor: 'rgba(203, 213, 225, 0.9)',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.1,
    shadowRadius: 12,
    elevation: 4,
  },
  resetZoomText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#1E293B',
    fontVariant: ['tabular-nums'],
  },
  hintFab: {
    position: 'relative',
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#2589FF',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.22,
    shadowRadius: 16,
    elevation: 5,
  },
  hintFabDefault: {
    borderWidth: 1,
    borderColor: 'rgba(226, 232, 240, 0.9)',
  },
  hintFabActive: {
    borderWidth: 2,
    borderColor: '#2589FF',
  },
  hintBadge: {
    position: 'absolute',
    top: -4,
    right: -2,
    minWidth: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: '#2589FF',
    paddingHorizontal: 5,
    alignItems: 'center',
    justifyContent: 'center',
  },
  hintBadgeText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#FFFFFF',
    fontVariant: ['tabular-nums'],
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.42)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  modalCard: {
    width: '100%',
    maxWidth: 320,
    borderRadius: 24,
    backgroundColor: '#FFFFFF',
    padding: 24,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.2,
    shadowRadius: 28,
    elevation: 10,
  },
  statusBadge: {
    width: 48,
    height: 48,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  statusSuccessBg: {
    backgroundColor: '#D1FAE5',
  },
  statusFailBg: {
    backgroundColor: '#FFE4E6',
  },
  modalTitle: {
    marginTop: 12,
    fontSize: 22,
    fontWeight: '700',
    color: '#0F172A',
    textAlign: 'center',
  },
  modalSubtitle: {
    marginTop: 4,
    fontSize: 12,
    color: '#64748B',
    textAlign: 'center',
  },
  modalActions: {
    marginTop: 20,
    width: '100%',
    gap: 10,
  },
  primaryModalBtn: {
    height: 48,
    width: '100%',
    borderRadius: 16,
    backgroundColor: '#2589FF',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    shadowColor: '#2589FF',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.25,
    shadowRadius: 14,
    elevation: 4,
  },
  primaryModalBtnText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  secondaryModalBtn: {
    height: 44,
    width: '100%',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    backgroundColor: '#F5F8FC',
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryModalBtnText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#334155',
  },
});
