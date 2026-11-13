import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated as RNAnimated,
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
} from 'react-native-reanimated';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle } from 'react-native-svg';
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
 * Minimalist light-mode Gameplay Screen for Arrow Escape (React Native).
 * Uses react-native-svg for dotted grid & curved path arrows,
 * react-native-gesture-handler + react-native-reanimated for bounded pinch-to-zoom & pan.
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
  const suppressTapUntilRef = useRef<number>(0);

  const heartsShakeAnim = useRef(new RNAnimated.Value(0)).current;
  const boardShakeAnim = useRef(new RNAnimated.Value(0)).current;

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

  const maxZoomScale = useMemo(
    () => Math.min(3.6, Math.max(2.2, generated.gridSize * 0.42)),
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
    setArrows(generated.arrows);
    setLives(MAX_LIVES);
    livesRef.current = MAX_LIVES;
    setHintTargetId(null);
    setImpactFlash(null);
    setCelebrating(false);
    setStatusModal('none');
    resetZoomTransform();
    return clearScheduledTimeouts;
  }, [generated, resetZoomTransform]);

  const triggerHeartsShake = useCallback(() => {
    heartsShakeAnim.setValue(0);
    RNAnimated.sequence([
      RNAnimated.timing(heartsShakeAnim, { toValue: -5, duration: 55, useNativeDriver: true }),
      RNAnimated.timing(heartsShakeAnim, { toValue: 5, duration: 55, useNativeDriver: true }),
      RNAnimated.timing(heartsShakeAnim, { toValue: -3, duration: 55, useNativeDriver: true }),
      RNAnimated.timing(heartsShakeAnim, { toValue: 3, duration: 55, useNativeDriver: true }),
      RNAnimated.timing(heartsShakeAnim, { toValue: 0, duration: 55, useNativeDriver: true }),
    ]).start();
  }, [heartsShakeAnim]);

  const triggerBoardCelebrateShake = useCallback(() => {
    boardShakeAnim.setValue(0);
    RNAnimated.sequence([
      RNAnimated.timing(boardShakeAnim, { toValue: -6, duration: 60, useNativeDriver: true }),
      RNAnimated.timing(boardShakeAnim, { toValue: 6, duration: 60, useNativeDriver: true }),
      RNAnimated.timing(boardShakeAnim, { toValue: -4, duration: 60, useNativeDriver: true }),
      RNAnimated.timing(boardShakeAnim, { toValue: 4, duration: 60, useNativeDriver: true }),
      RNAnimated.timing(boardShakeAnim, { toValue: 0, duration: 60, useNativeDriver: true }),
    ]).start();
  }, [boardShakeAnim]);

  const markGestureEnd = useCallback(() => {
    suppressTapUntilRef.current = Date.now() + 280;
  }, []);

  const pinchGesture = useMemo(
    () =>
      Gesture.Pinch()
        .onStart((e) => {
          savedScale.value = scale.value;
          savedTx.value = tx.value;
          savedTy.value = ty.value;
          pinchStartFx.value = e.focalX - boardSize.value * 0.5;
          pinchStartFy.value = e.focalY - boardSize.value * 0.5;
        })
        .onUpdate((e) => {
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
          runOnJS(markGestureEnd)();
        }),
    [
      boardSize,
      markGestureEnd,
      maxZoomScale,
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
        .minDistance(10)
        .maxPointers(1)
        .onStart(() => {
          savedTx.value = tx.value;
          savedTy.value = ty.value;
        })
        .onUpdate((e) => {
          if (scale.value <= MIN_ZOOM_SCALE) return;
          const maxOffset = boardSize.value * (scale.value - 1) * 0.5;
          tx.value = Math.max(-maxOffset, Math.min(maxOffset, savedTx.value + e.translationX));
          ty.value = Math.max(-maxOffset, Math.min(maxOffset, savedTy.value + e.translationY));
        })
        .onEnd(() => {
          if (scale.value > MIN_ZOOM_SCALE) {
            runOnJS(markGestureEnd)();
          }
        }),
    [boardSize, markGestureEnd, savedTx, savedTy, scale, tx, ty]
  );

  const composedGesture = useMemo(
    () => Gesture.Simultaneous(pinchGesture, panGesture),
    [pinchGesture, panGesture]
  );

  const zoomAnimatedStyle = useAnimatedStyle(() => ({
    transform: [
      { translateX: tx.value },
      { translateY: ty.value },
      { scale: scale.value },
    ],
  }));

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
          triggerBoardCelebrateShake();
          setConfettiKey((k) => k + 1);
          const modalTimer = setTimeout(() => {
            setStatusModal('cleared');
          }, 450);
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

  const handleTapArrow = (arrow: ArrowTile) => {
    if (statusModal !== 'none') return;
    if (arrow.state !== 'idle') return;
    if (Date.now() < suppressTapUntilRef.current) return;

    feedback.unlock();
    const { clear, blockerCell, freeCells } = traceArrowPath(
      arrows,
      arrow,
      generated.gridSize
    );

    if (clear) {
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
          triggerHeartsShake();
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
        triggerHeartsShake();
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
          <Text style={styles.remainingText}>{activeArrows.length}</Text>
        </View>

        <RNAnimated.View
          style={[
            styles.heartsRow,
            { transform: [{ translateX: heartsShakeAnim }] },
          ]}
        >
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
        </RNAnimated.View>

        <View style={[styles.difficultyPill, { backgroundColor: difficultyBg }]}>
          <Text style={[styles.difficultyLabel, { color: difficultyText }]}>
            {generated.difficulty}
          </Text>
        </View>
      </View>

      {/* Central Dotted-Matrix Board Card with Pinch-to-Zoom & Pan */}
      <View style={styles.boardOuter}>
        <RNAnimated.View
          onLayout={(e) => {
            const w = e.nativeEvent.layout.width;
            if (w > 0) boardSize.value = w;
          }}
          style={[
            styles.boardCard,
            celebrating && styles.boardCardCelebrating,
            { transform: [{ translateX: boardShakeAnim }] },
          ]}
        >
          <GestureDetector gesture={composedGesture}>
            <Reanimated.View style={[styles.zoomLayer, zoomAnimatedStyle]}>
              <Svg
                width="100%"
                height="100%"
                viewBox={`0 0 ${BOARD_VIEWBOX} ${BOARD_VIEWBOX}`}
              >
                {/* Dotted Grid Matrix */}
                {Array.from({
                  length: generated.gridSize * generated.gridSize,
                }).map((_, index) => {
                  const r = Math.floor(index / generated.gridSize);
                  const c = index % generated.gridSize;
                  const { x, y } = cellCenter({ r, c }, cellStep);
                  return (
                    <Circle
                      key={`dot-${r}-${c}`}
                      cx={x}
                      cy={y}
                      r={dotRadius}
                      fill="#CBD5E1"
                    />
                  );
                })}

                {/* Curved & Winding Path Arrows */}
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
          </GestureDetector>
        </RNAnimated.View>
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
