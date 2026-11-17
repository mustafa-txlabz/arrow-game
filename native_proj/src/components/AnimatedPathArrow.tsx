import { memo, useCallback, useEffect, useMemo, useRef } from 'react';
import { Group, Path, Skia, usePathValue } from '@shopify/react-native-skia';
import {
  Easing,
  runOnJS,
  useDerivedValue,
  useSharedValue,
  withTiming,
} from 'react-native-reanimated';
import type { ArrowPolylineGeometry } from '../utils/arrowGeometry';

const BLOCKED_RED = '#EF4444';
const ACTIVE_BLUE = '#2589FF';

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

export interface ActiveArrowRunnerProps {
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
 * Pure GPU-accelerated Skia + Reanimated worklet runner mounted ONLY while an arrow is moving.
 * Builds SkPath vertices directly on the UI thread via SkPathBuilder (zero SVG string churn,
 * zero bitmap rasterization, razor-sharp vector tessellation at any zoom level).
 */
export const ActiveArrowRunner = memo(function ActiveArrowRunner({
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

  const travelDist = geom.bodyLen + 560;
  const peakBump = bumpDistancePx ?? Math.max(24, cellStep * 0.65);
  const duration =
    mode === 'escaping'
      ? Math.min(340, Math.max(220, 190 + geom.bodyLen * 0.24))
      : mode === 'blocked'
        ? (bumpDurationMs ?? 300)
        : 190;

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

  const { ptsX, ptsY, cumLen, totalLen, backLen, bodyLen, tipTrim, restPtsX, restPtsY } =
    geom;
  const escapeColor = isBlocked ? BLOCKED_RED : ACTIVE_BLUE;

  const frame = useDerivedValue(() => {
    'worklet';
    const t = progress.value;
    let offsetPx = 0;
    let shiftX = 0;
    let opacity = 1;
    let color = restColor;

    if (mode === 'escaping') {
      const eased = 0.35 * t + 0.65 * Math.pow(t, 1.75);
      offsetPx = travelDist * eased;
      opacity = t > 0.78 ? Math.max(0, 1 - (t - 0.78) / 0.22) : 1;
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

    return { offsetPx, shiftX, opacity, color };
  }, [mode, travelDist, peakBump, restColor, escapeColor]);

  const stemPath = usePathValue((builder) => {
    'worklet';
    const { offsetPx, shiftX } = frame.value;
    const startDist = Math.max(0, backLen + offsetPx);
    const headDist = Math.min(totalLen, backLen + offsetPx + bodyLen);
    const stemEndDist = Math.max(startDist + 0.5, headDist - tipTrim);

    const startPt = samplePointWorklet(ptsX, ptsY, cumLen, totalLen, startDist);
    const endPt = samplePointWorklet(ptsX, ptsY, cumLen, totalLen, stemEndDist);

    builder.moveTo(startPt.x + shiftX, startPt.y);
    const limit = cumLen.length - 1;
    for (let i = 1; i < limit; i++) {
      const len = cumLen[i];
      if (len > startDist && len < stemEndDist) {
        builder.lineTo(ptsX[i] + shiftX, ptsY[i]);
      }
    }
    builder.lineTo(endPt.x + shiftX, endPt.y);
  });

  const headPath = usePathValue((builder) => {
    'worklet';
    const { offsetPx, shiftX } = frame.value;
    const headDist = Math.min(totalLen, backLen + offsetPx + bodyLen);
    const headPt = samplePointWorklet(ptsX, ptsY, cumLen, totalLen, headDist);
    const hx = headPt.x + shiftX;
    const hy = headPt.y;
    const cos = Math.cos(headPt.rad) * arrowTipScale;
    const sin = Math.sin(headPt.rad) * arrowTipScale;

    builder.moveTo(hx + 6 * cos, hy + 6 * sin);
    builder.lineTo(hx - 5.5 * cos + 5.8 * sin, hy - 5.5 * sin - 5.8 * cos);
    builder.lineTo(hx - 3.5 * cos, hy - 3.5 * sin);
    builder.lineTo(hx - 5.5 * cos - 5.8 * sin, hy - 5.5 * sin + 5.8 * cos);
    builder.close();
  });

  const hintStaticPath = useMemo(() => {
    if (!showHintHalo || mode === 'escaping' || restPtsX.length === 0) return null;
    const b = Skia.PathBuilder.Make();
    b.moveTo(restPtsX[0], restPtsY[0]);
    for (let i = 1; i < restPtsX.length; i++) {
      b.lineTo(restPtsX[i], restPtsY[i]);
    }
    return b.detach();
  }, [mode, restPtsX, restPtsY, showHintHalo]);

  const activeColor = useDerivedValue(() => {
    'worklet';
    return frame.value.color;
  });

  const groupOpacity = useDerivedValue(() => {
    'worklet';
    return frame.value.opacity;
  });

  const haloWidth = strokeWidth + Math.min(4.0, strokeWidth * 0.95);
  const headStrokeWidth = Math.max(0.45, 1.2 * arrowTipScale);

  return (
    <Group>
      {hintStaticPath && (
        <Path
          path={hintStaticPath}
          style="stroke"
          color="rgba(37, 137, 255, 0.25)"
          strokeWidth={strokeWidth + 8}
          strokeCap="round"
          strokeJoin="round"
        />
      )}

      <Group opacity={groupOpacity}>
        <Path
          path={stemPath}
          style="stroke"
          color="#FFFFFF"
          opacity={0.9}
          strokeWidth={haloWidth}
          strokeCap="round"
          strokeJoin="round"
        />
        <Path
          path={stemPath}
          style="stroke"
          color={activeColor}
          strokeWidth={strokeWidth}
          strokeCap="round"
          strokeJoin="round"
        />
        <Path path={headPath} style="fill" color={activeColor} />
        <Path
          path={headPath}
          style="stroke"
          color={activeColor}
          strokeWidth={headStrokeWidth}
          strokeJoin="round"
        />
      </Group>
    </Group>
  );
});
