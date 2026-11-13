import { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import Reanimated, {
  Easing,
  runOnJS,
  useAnimatedProps,
  useDerivedValue,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import { G, Path } from 'react-native-svg';
import type { ArrowTile } from '../types/game';
import {
  buildArrowGeometry,
  type ArrowPolylineGeometry,
} from '../utils/arrowGeometry';

const AnimatedPath = Reanimated.createAnimatedComponent(Path);

interface AnimatedPathArrowProps {
  arrow: ArrowTile;
  cellStep: number;
  strokeWidth: number;
  arrowTipScale: number;
  baseStrokeColor: string;
  isHinted: boolean;
  onTap: (arrow: ArrowTile) => void;
  onEscapeComplete: (id: string) => void;
  onBlockedComplete: (id: string) => void;
  onPenaltyComplete: (id: string) => void;
}

const BLOCKED_RED = '#EF4444';
const ACTIVE_BLUE = '#2589FF';

interface SlicedFrame {
  stemD: string;
  headD: string;
  color: string;
  opacity: number;
}

function buildHeadPathWorklet(
  hx: number,
  hy: number,
  rad: number,
  tipScale: number
): string {
  'worklet';
  const cos = Math.cos(rad) * tipScale;
  const sin = Math.sin(rad) * tipScale;
  const p0x = (hx + 6 * cos).toFixed(2);
  const p0y = (hy + 6 * sin).toFixed(2);
  const p1x = (hx - 5.5 * cos + 5.8 * sin).toFixed(2);
  const p1y = (hy - 5.5 * sin - 5.8 * cos).toFixed(2);
  const p2x = (hx - 3.5 * cos).toFixed(2);
  const p2y = (hy - 3.5 * sin).toFixed(2);
  const p3x = (hx - 5.5 * cos - 5.8 * sin).toFixed(2);
  const p3y = (hy - 5.5 * sin + 5.8 * cos).toFixed(2);
  return (
    'M ' +
    p0x +
    ' ' +
    p0y +
    ' L ' +
    p1x +
    ' ' +
    p1y +
    ' L ' +
    p2x +
    ' ' +
    p2y +
    ' L ' +
    p3x +
    ' ' +
    p3y +
    ' Z'
  );
}

function samplePointWorklet(
  ptsX: number[],
  ptsY: number[],
  cumLen: number[],
  totalLen: number,
  targetDist: number
): { x: number; y: number; rad: number } {
  'worklet';
  const d = targetDist < 0 ? 0 : targetDist > totalLen ? totalLen : targetDist;
  let lo = 0;
  let hi = cumLen.length - 2;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (cumLen[mid] <= d) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  const segStart = cumLen[lo];
  const segEnd = cumLen[lo + 1];
  const segLen = segEnd - segStart || 1;
  const t = Math.max(0, Math.min(1, (d - segStart) / segLen));
  const ax = ptsX[lo];
  const ay = ptsY[lo];
  const bx = ptsX[lo + 1];
  const by = ptsY[lo + 1];
  return {
    x: ax + (bx - ax) * t,
    y: ay + (by - ay) * t,
    rad: Math.atan2(by - ay, bx - ax),
  };
}

function sliceArrowFrameWorklet(
  ptsX: number[],
  ptsY: number[],
  cumLen: number[],
  totalLen: number,
  backLen: number,
  bodyLen: number,
  tipTrim: number,
  tipScale: number,
  offsetPx: number,
  shiftX: number
): { stemD: string; headD: string } {
  'worklet';
  const startDist = Math.max(0, backLen + offsetPx);
  const headDist = Math.min(totalLen, backLen + offsetPx + bodyLen);
  const stemEndDist = Math.max(startDist + 0.5, headDist - tipTrim);

  const startPt = samplePointWorklet(ptsX, ptsY, cumLen, totalLen, startDist);
  const endPt = samplePointWorklet(ptsX, ptsY, cumLen, totalLen, stemEndDist);
  const headPt = samplePointWorklet(ptsX, ptsY, cumLen, totalLen, headDist);

  let stemD =
    'M ' + (startPt.x + shiftX).toFixed(2) + ' ' + startPt.y.toFixed(2);
  const limit = cumLen.length - 1;
  for (let i = 1; i < limit; i++) {
    const len = cumLen[i];
    if (len > startDist && len < stemEndDist) {
      stemD +=
        ' L ' + (ptsX[i] + shiftX).toFixed(2) + ' ' + ptsY[i].toFixed(2);
    }
  }
  stemD += ' L ' + (endPt.x + shiftX).toFixed(2) + ' ' + endPt.y.toFixed(2);

  const headD = buildHeadPathWorklet(
    headPt.x + shiftX,
    headPt.y,
    headPt.rad,
    tipScale
  );

  return { stemD, headD };
}

interface ActiveArrowRunnerProps {
  id: string;
  mode: 'escaping' | 'blocked' | 'penalty_shake';
  isBlocked: boolean;
  restColor: string;
  strokeWidth: number;
  arrowTipScale: number;
  cellStep: number;
  bumpDistancePx?: number;
  bumpDurationMs?: number;
  geom: ArrowPolylineGeometry;
  showHintHalo: boolean;
  onEscapeComplete: (id: string) => void;
  onBlockedComplete: (id: string) => void;
  onPenaltyComplete: (id: string) => void;
}

/**
 * UI-thread Reanimated worklet runner mounted ONLY while an arrow is actively animating.
 * Idle arrows remain lightweight static SVG primitives so 300+ arrow grids incur zero shared-value overhead.
 */
function ActiveArrowRunner({
  id,
  mode,
  isBlocked,
  restColor,
  strokeWidth,
  arrowTipScale,
  cellStep,
  bumpDistancePx,
  bumpDurationMs,
  geom,
  showHintHalo,
  onEscapeComplete,
  onBlockedComplete,
  onPenaltyComplete,
}: ActiveArrowRunnerProps) {
  const progress = useSharedValue(0);

  const onEscapeRef = useRef(onEscapeComplete);
  const onBlockedRef = useRef(onBlockedComplete);
  const onPenaltyRef = useRef(onPenaltyComplete);
  onEscapeRef.current = onEscapeComplete;
  onBlockedRef.current = onBlockedComplete;
  onPenaltyRef.current = onPenaltyComplete;

  const notifyFinished = useCallback(
    (finishedMode: 'escaping' | 'blocked' | 'penalty_shake') => {
      if (finishedMode === 'escaping') {
        onEscapeRef.current(id);
      } else if (finishedMode === 'blocked') {
        onBlockedRef.current(id);
      } else {
        onPenaltyRef.current(id);
      }
    },
    [id]
  );

  const travelDist = geom.bodyLen + 360;
  const peakBump = bumpDistancePx ?? Math.max(24, cellStep * 0.65);
  const duration =
    mode === 'escaping'
      ? Math.min(600, Math.max(470, 440 + geom.bodyLen * 0.45))
      : mode === 'blocked'
        ? (bumpDurationMs ?? 520)
        : 240;

  useEffect(() => {
    progress.value = 0;
    progress.value = withTiming(
      1,
      { duration, easing: Easing.linear },
      (finished) => {
        'worklet';
        if (finished) {
          runOnJS(notifyFinished)(mode);
        }
      }
    );
  }, [duration, mode, notifyFinished, progress]);

  const { ptsX, ptsY, cumLen, totalLen, backLen, bodyLen, tipTrim, restHead } =
    geom;
  const escapeColor = isBlocked ? BLOCKED_RED : ACTIVE_BLUE;

  const frame = useDerivedValue<SlicedFrame>(() => {
    'worklet';
    const t = progress.value;
    let offsetPx = 0;
    let shiftX = 0;
    let opacity = 1;
    let color = restColor;

    if (mode === 'escaping') {
      const eased = 0.35 * t + 0.65 * Math.pow(t, 1.75);
      offsetPx = travelDist * eased;
      opacity = t > 0.76 ? Math.max(0, 1 - (t - 0.76) / 0.24) : 1;
      color = escapeColor;
    } else if (mode === 'blocked') {
      const hitFraction = 0.34;
      if (t < hitFraction) {
        const u = t / hitFraction;
        offsetPx = peakBump * (1 - Math.pow(1 - u, 1.7));
        color = restColor;
      } else {
        const u = (t - hitFraction) / (1 - hitFraction);
        const rawRebound =
          peakBump * Math.exp(-3.8 * u) * Math.cos(Math.PI * 1.5 * u);
        offsetPx = Math.max(-7, rawRebound);
        color = BLOCKED_RED;
      }
    } else {
      shiftX = Math.sin(t * Math.PI * 5) * (1 - t) * 4.5;
      color = BLOCKED_RED;
    }

    const sliced = sliceArrowFrameWorklet(
      ptsX,
      ptsY,
      cumLen,
      totalLen,
      backLen,
      bodyLen,
      tipTrim,
      arrowTipScale,
      offsetPx,
      shiftX
    );

    return {
      stemD: sliced.stemD,
      headD: sliced.headD,
      color,
      opacity,
    };
  }, [
    ptsX,
    ptsY,
    cumLen,
    totalLen,
    backLen,
    bodyLen,
    tipTrim,
    arrowTipScale,
    mode,
    travelDist,
    peakBump,
    restColor,
    escapeColor,
  ]);

  const haloProps = useAnimatedProps(() => ({
    d: frame.value.stemD,
    strokeOpacity: frame.value.opacity * 0.9,
  }));

  const stemProps = useAnimatedProps(() => ({
    d: frame.value.stemD,
    stroke: frame.value.color,
    strokeOpacity: frame.value.opacity,
  }));

  const headProps = useAnimatedProps(() => ({
    d: frame.value.headD,
    fill: frame.value.color,
    stroke: frame.value.color,
    fillOpacity: frame.value.opacity,
    strokeOpacity: frame.value.opacity,
  }));

  const initialHeadD = useMemo(
    () =>
      buildHeadPathWorklet(
        restHead.x,
        restHead.y,
        (restHead.angle * Math.PI) / 180,
        arrowTipScale
      ),
    [arrowTipScale, restHead.angle, restHead.x, restHead.y]
  );

  return (
    <G>
      {showHintHalo && mode !== 'escaping' && (
        <Path
          d={geom.restD}
          fill="none"
          stroke="rgba(37, 137, 255, 0.25)"
          strokeWidth={strokeWidth + 8}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}

      <AnimatedPath
        animatedProps={haloProps}
        d={geom.restD}
        fill="none"
        stroke="#FFFFFF"
        strokeWidth={strokeWidth + Math.min(4.0, strokeWidth * 0.95)}
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      <AnimatedPath
        animatedProps={stemProps}
        d={geom.restD}
        fill="none"
        stroke={restColor}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      <AnimatedPath
        animatedProps={headProps}
        d={initialHeadD}
        fill={restColor}
        stroke={restColor}
        strokeWidth={Math.max(0.45, 1.2 * arrowTipScale)}
        strokeLinejoin="round"
      />
    </G>
  );
}

/**
 * High-performance Arrow Renderer:
 * - Static SVG primitives while idle (zero Reanimated worklet registrations for 300+ resting arrows).
 * - UI-thread Reanimated `useAnimatedProps` worklet while escaping/rebounding/shaking (60/120fps, zero JS animation loop).
 */
export const AnimatedPathArrow = memo(
  function AnimatedPathArrow({
    arrow,
    cellStep,
    strokeWidth,
    arrowTipScale,
    baseStrokeColor,
    isHinted,
    onTap,
    onEscapeComplete,
    onBlockedComplete,
    onPenaltyComplete,
  }: AnimatedPathArrowProps) {
    const geom = useMemo(
      () => buildArrowGeometry(arrow.cells, arrow.dir, cellStep),
      [arrow.cells, arrow.dir, cellStep]
    );

    const restColor = arrow.isBlocked
      ? BLOCKED_RED
      : isHinted
        ? ACTIVE_BLUE
        : baseStrokeColor;

    const showHintHalo =
      isHinted || (arrow.state === 'escaping' && !arrow.isBlocked);

    const handlePress = useCallback(() => {
      onTap(arrow);
    }, [arrow, onTap]);

    if (arrow.state !== 'idle') {
      return (
        <ActiveArrowRunner
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
          showHintHalo={showHintHalo}
          onEscapeComplete={onEscapeComplete}
          onBlockedComplete={onBlockedComplete}
          onPenaltyComplete={onPenaltyComplete}
        />
      );
    }

    return (
      <G onPress={handlePress}>
        {showHintHalo && (
          <Path
            d={geom.restD}
            fill="none"
            stroke="rgba(37, 137, 255, 0.25)"
            strokeWidth={strokeWidth + 8}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        )}

        <Path
          d={geom.restD}
          fill="none"
          stroke="#FFFFFF"
          strokeWidth={strokeWidth + Math.min(4.0, strokeWidth * 0.95)}
          strokeLinecap="round"
          strokeLinejoin="round"
          opacity={0.9}
        />

        <Path
          d={geom.restD}
          fill="none"
          stroke={restColor}
          strokeWidth={strokeWidth}
          strokeLinecap="round"
          strokeLinejoin="round"
        />

        <G
          x={geom.restHead.x}
          y={geom.restHead.y}
          rotation={geom.restHead.angle}
          scale={arrowTipScale}
        >
          <Path
            d="M 6 0 L -5.5 -5.8 L -3.5 0 L -5.5 5.8 Z"
            fill={restColor}
            stroke={restColor}
            strokeWidth={1.2}
            strokeLinejoin="round"
          />
        </G>

        <Path
          d={geom.restD}
          fill="none"
          stroke="transparent"
          strokeWidth={Math.max(7.5, Math.min(28, cellStep * 0.85))}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </G>
    );
  },
  (prev, next) =>
    prev.arrow === next.arrow &&
    prev.cellStep === next.cellStep &&
    prev.strokeWidth === next.strokeWidth &&
    prev.arrowTipScale === next.arrowTipScale &&
    prev.baseStrokeColor === next.baseStrokeColor &&
    prev.isHinted === next.isHinted
);
