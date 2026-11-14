import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Dimensions,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Reanimated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withTiming,
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle, Path } from 'react-native-svg';
import {
  ChevronLeft,
  Heart,
  Lightbulb,
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

/**
 * Ultra-fast minimalist light-mode Gameplay Screen for Arrow Escape (React Native):
 * - Compound SVG path batching: all grid dots + all static idle/blocked arrows render in ~4-7 native SVG Paths total.
 * - O(1) grid-cell hit-testing inside RNGH Tap gesture (zero per-arrow SVG hitTest overhead).
 * - UI-thread Reanimated worklets for pinch/pan, arrow escape/rebound, and HUD/board shakes.
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
  const [statusModal, setStatusModal] = useState<'none' | 'cleared' | 'failed'>('none');

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

  const defaultBoardPx = Math.min(Dimensions.get('window').width - 32, 368);
  const boardSize = useSharedValue(defaultBoardPx);
  const scale = useSharedValue(1);
  const tx = useSharedValue(0);
  const ty = useSharedValue(0);
  const savedScale = useSharedValue(1);
  const savedTx = useSharedValue(0);
  const savedTy = useSharedValue(0);
  const pinchStartFx = useSharedValue(0);
  const pinchStartFy = useSharedValue(0);
  const pinchMoved = useSharedValue(false);
  const panMoved = useSharedValue(false);

  const cellStep = (BOARD_VIEWBOX - BOARD_PAD * 2) / generated.gridSize;
  const strokeWidth = Math.min(5.0, Math.max(1.25, cellStep * 0.145));
  const arrowTipScale = Math.min(1.22, Math.max(0.28, cellStep / 33));
  const dotRadius = Math.min(2.3, Math.max(0.65, cellStep * 0.052));
  const haloWidth = strokeWidth + Math.min(4.0, strokeWidth * 0.95);
  const headStrokeWidth = Math.max(0.45, 1.2 * arrowTipScale);

  // Precompute all level geometry, compound grid dots path, and initial cell ownership once per level
  const levelData = useMemo(() => {
    const gridSize = generated.gridSize;
    const dotsPathD = buildGridDotsPath(gridSize, cellStep);
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

    return { dotsPathD, geomById, initialCellOwner };
  }, [generated, cellStep, arrowTipScale]);

  // Keep an O(1) lookup map synced to current React state
  const arrowsById = useMemo(() => {
    const map = new Map<string, ArrowTile>();
    for (let i = 0; i < arrows.length; i++) {
      map.set(arrows[i].id, arrows[i]);
    }
    return map;
  }, [arrows]);
  arrowsByIdRef.current = arrowsById;

  const maxZoomScale = useMemo(
    () => Math.min(7.2, Math.max(2.4, generated.gridSize * 0.23)),
    [generated.gridSize]
  );

  const resetZoomTransform = useCallback(() => {
    scale.value = 1;
    tx.value = 0;
    ty.value = 0;
    savedScale.value = 1;
    savedTx.value = 0;
    savedTy.value = 0;
  }, [scale, tx, ty, savedScale, savedTx, savedTy]);

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
    resetZoomTransform();
    feedback.unlock();
    return clearScheduledTimeouts;
  }, [generated, levelData.initialCellOwner, resetZoomTransform]);

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
    resetZoomTransform();
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
        // Release occupancy & cell ownership synchronously so rapid multi-taps on inner arrows never drop
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

      // Blocked: slide across open gap, hit blocker, turn permanently red, and rebound elastically
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

  // O(1) Grid-cell tap resolver running straight from RNGH Tap coordinates
  const handleBoardTap = useCallback(
    (
      screenX: number,
      screenY: number,
      curScale: number,
      curTx: number,
      curTy: number,
      curBoardSize: number
    ) => {
      if (statusModalRef.current !== 'none') return;
      if (Date.now() < suppressTapUntilRef.current) return;
      if (curBoardSize <= 0) return;

      const half = curBoardSize * 0.5;
      const safeScale = curScale > 0 ? curScale : 1;
      const baseX = half + (screenX - half - curTx) / safeScale;
      const baseY = half + (screenY - half - curTy) / safeScale;

      const vx = (baseX / curBoardSize) * BOARD_VIEWBOX;
      const vy = (baseY / curBoardSize) * BOARD_VIEWBOX;

      const gridSize = generated.gridSize;
      const fc = (vx - BOARD_PAD) / cellStep;
      const fr = (vy - BOARD_PAD) / cellStep;
      const r0 = Math.floor(fr);
      const c0 = Math.floor(fc);

      const owners = cellOwnerRef.current;
      const baseArrows = generated.arrows;
      const liveMap = arrowsByIdRef.current;

      // Fast path: direct cell hit
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

      // Nearest occupied cell fallback within ~0.68 cell radius for edge/corner finger taps
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

  const pinchGesture = useMemo(
    () =>
      Gesture.Pinch()
        .onStart((e) => {
          pinchMoved.value = false;
          savedScale.value = scale.value;
          savedTx.value = tx.value;
          savedTy.value = ty.value;
          pinchStartFx.value = e.focalX - boardSize.value * 0.5;
          pinchStartFy.value = e.focalY - boardSize.value * 0.5;
        })
        .onUpdate((e) => {
          if (e.numberOfPointers >= 2 || Math.abs(e.scale - 1) > 0.025) {
            pinchMoved.value = true;
          }
          const nextScale = Math.min(
            maxZoomScale,
            Math.max(MIN_ZOOM_SCALE, savedScale.value * e.scale)
          );
          if (nextScale <= MIN_ZOOM_SCALE) {
            scale.value = MIN_ZOOM_SCALE;
            tx.value = 0;
            ty.value = 0;
            return;
          }
          const fx = e.focalX - boardSize.value * 0.5;
          const fy = e.focalY - boardSize.value * 0.5;
          const bx = (pinchStartFx.value - savedTx.value) / savedScale.value;
          const by = (pinchStartFy.value - savedTy.value) / savedScale.value;
          const maxOffset = boardSize.value * (nextScale - 1) * 0.5;
          scale.value = nextScale;
          tx.value = Math.max(-maxOffset, Math.min(maxOffset, fx - bx * nextScale));
          ty.value = Math.max(-maxOffset, Math.min(maxOffset, fy - by * nextScale));
        })
        .onEnd(() => {
          if (pinchMoved.value) {
            runOnJS(markPinchEnd)();
          }
        }),
    [
      boardSize,
      markPinchEnd,
      maxZoomScale,
      pinchMoved,
      pinchStartFx,
      pinchStartFy,
      savedScale,
      savedTx,
      savedTy,
      scale,
      tx,
      ty,
    ]
  );

  const panGesture = useMemo(
    () =>
      Gesture.Pan()
        .minDistance(14)
        .maxPointers(1)
        .onStart(() => {
          panMoved.value = false;
          savedTx.value = tx.value;
          savedTy.value = ty.value;
        })
        .onUpdate((e) => {
          if (scale.value <= MIN_ZOOM_SCALE) return;
          if (Math.abs(e.translationX) > 6 || Math.abs(e.translationY) > 6) {
            panMoved.value = true;
          }
          const maxOffset = boardSize.value * (scale.value - 1) * 0.5;
          tx.value = Math.max(-maxOffset, Math.min(maxOffset, savedTx.value + e.translationX));
          ty.value = Math.max(-maxOffset, Math.min(maxOffset, savedTy.value + e.translationY));
        })
        .onEnd(() => {
          if (panMoved.value && scale.value > MIN_ZOOM_SCALE) {
            runOnJS(markPanEnd)();
          }
        }),
    [boardSize, markPanEnd, panMoved, savedTx, savedTy, scale, tx, ty]
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
            scale.value,
            tx.value,
            ty.value,
            boardSize.value
          );
        }),
    [boardSize, handleBoardTap, scale, tx, ty]
  );

  const composedGesture = useMemo(
    () => Gesture.Simultaneous(pinchGesture, panGesture, tapGesture),
    [pinchGesture, panGesture, tapGesture]
  );

  const zoomAnimatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: tx.value },
      { translateY: ty.value },
      { scale: scale.value },
    ],
  }));

  const heartsAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: heartsShakeX.value }],
  }));

  const boardAnimatedStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: boardShakeX.value }],
  }));

  // Batch ALL static idle arrows into at most ~5 compound <Path> layers + separate out only the 1-3 animating arrows
  const {
    remainingCount,
    haloD,
    blackStemD,
    blackHeadD,
    redStemD,
    redHeadD,
    hintStemD,
    hintHeadD,
    animatingArrows,
  } = useMemo(() => {
    const haloParts: string[] = [];
    const blackStemParts: string[] = [];
    const blackHeadParts: string[] = [];
    const redStemParts: string[] = [];
    const redHeadParts: string[] = [];
    let hintedStem = '';
    let hintedHead = '';
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
      const geom = levelData.geomById.get(a.id);
      if (!geom) continue;
      haloParts.push(geom.restD);
      if (a.id === hintTargetId) {
        hintedStem = geom.restD;
        hintedHead = geom.restHeadD;
      } else if (a.isBlocked) {
        redStemParts.push(geom.restD);
        redHeadParts.push(geom.restHeadD);
      } else {
        blackStemParts.push(geom.restD);
        blackHeadParts.push(geom.restHeadD);
      }
    }

    return {
      remainingCount: remaining,
      haloD: haloParts.join(' '),
      blackStemD: blackStemParts.join(' '),
      blackHeadD: blackHeadParts.join(' '),
      redStemD: redStemParts.join(' '),
      redHeadD: redHeadParts.join(' '),
      hintStemD: hintedStem,
      hintHeadD: hintedHead,
      animatingArrows: active,
    };
  }, [arrows, hintTargetId, levelData.geomById]);

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

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      {/* Top Header Bar */}
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

      {/* Sub-HUD / Status Bar */}
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

      {/* Central Dotted-Matrix Board Card with Pinch-to-Zoom, Pan & O(1) Tap */}
      <View style={styles.boardOuter}>
        <Reanimated.View
          onLayout={(e) => {
            const w = e.nativeEvent.layout.width;
            if (w > 0) boardSize.value = w;
          }}
          style={[
            styles.boardCard,
            celebrating && styles.boardCardCelebrating,
            boardAnimatedStyle,
          ]}
        >
          <GestureDetector gesture={composedGesture}>
            <View collapsable={false} style={styles.zoomLayer}>
              <Reanimated.View style={[styles.zoomLayer, zoomAnimatedStyle]}>
                <Svg
                  pointerEvents="none"
                  width="100%"
                  height="100%"
                  viewBox={`0 0 ${BOARD_VIEWBOX} ${BOARD_VIEWBOX}`}
                >
                  {/* 1-draw-call Dotted Grid Matrix */}
                  <Path
                    d={levelData.dotsPathD}
                    fill="none"
                    stroke="#CBD5E1"
                    strokeWidth={dotRadius * 2}
                    strokeLinecap="round"
                  />

                  {/* Optional Hint Glow Aura */}
                  {hintStemD !== '' && (
                    <Path
                      d={hintStemD}
                      fill="none"
                      stroke="rgba(37, 137, 255, 0.25)"
                      strokeWidth={strokeWidth + 8}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  )}

                  {/* Batched White Halo Backing for All Resting Arrows */}
                  {haloD !== '' && (
                    <Path
                      d={haloD}
                      fill="none"
                      stroke="#FFFFFF"
                      strokeWidth={haloWidth}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      opacity={0.9}
                    />
                  )}

                  {/* Batched Normal Resting Arrows (Stems + Heads) */}
                  {blackStemD !== '' && (
                    <Path
                      d={blackStemD}
                      fill="none"
                      stroke="#0F172A"
                      strokeWidth={strokeWidth}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  )}
                  {blackHeadD !== '' && (
                    <Path
                      d={blackHeadD}
                      fill="#0F172A"
                      stroke="#0F172A"
                      strokeWidth={headStrokeWidth}
                      strokeLinejoin="round"
                    />
                  )}

                  {/* Batched Permanently-Blocked Red Resting Arrows (Stems + Heads) */}
                  {redStemD !== '' && (
                    <Path
                      d={redStemD}
                      fill="none"
                      stroke={BLOCKED_RED}
                      strokeWidth={strokeWidth}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  )}
                  {redHeadD !== '' && (
                    <Path
                      d={redHeadD}
                      fill={BLOCKED_RED}
                      stroke={BLOCKED_RED}
                      strokeWidth={headStrokeWidth}
                      strokeLinejoin="round"
                    />
                  )}

                  {/* Hinted Resting Arrow Highlight (Stem + Head) */}
                  {hintStemD !== '' && (
                    <Path
                      d={hintStemD}
                      fill="none"
                      stroke={ACTIVE_BLUE}
                      strokeWidth={strokeWidth}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  )}
                  {hintHeadD !== '' && (
                    <Path
                      d={hintHeadD}
                      fill={ACTIVE_BLUE}
                      stroke={ACTIVE_BLUE}
                      strokeWidth={headStrokeWidth}
                      strokeLinejoin="round"
                    />
                  )}

                  {/* Active UI-thread Reanimated Runners (mounted ONLY while moving) */}
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
                  {impactFlash && (() => {
                    const center = cellCenter(impactFlash.pt, cellStep);
                    return (
                      <Circle
                        key={impactFlash.key}
                        cx={center.x}
                        cy={center.y}
                        r={Math.max(12, cellStep * 0.38)}
                        fill="rgba(239, 68, 68, 0.14)"
                        stroke="#EF4444"
                        strokeWidth={2.5}
                      />
                    );
                  })()}
                </Svg>
              </Reanimated.View>
            </View>
          </GestureDetector>
        </Reanimated.View>
      </View>

      {/* Celebratory Confetti Overlay */}
      <ConfettiBurst triggerKey={confettiKey} />

      {/* Bottom Floating Hint Control */}
      <View style={styles.footer}>
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
      </View>

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
    paddingHorizontal: 16,
    paddingVertical: 12,
    justifyContent: 'space-between',
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
  boardOuter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
  },
  boardCard: {
    width: '100%',
    maxWidth: 368,
    aspectRatio: 1,
    borderRadius: 24,
    backgroundColor: '#FFFFFF',
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: 'rgba(226, 232, 240, 0.85)',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.09,
    shadowRadius: 24,
    elevation: 6,
  },
  boardCardCelebrating: {
    borderWidth: 2,
    borderColor: 'rgba(52, 211, 153, 0.75)',
    shadowColor: '#10B981',
    shadowOpacity: 0.25,
  },
  zoomLayer: {
    width: '100%',
    height: '100%',
  },
  footer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingBottom: 8,
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
