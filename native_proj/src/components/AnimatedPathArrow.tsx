import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { G, Path } from 'react-native-svg';
import type { ArrowTile } from '../types/game';
import {
  buildArrowGeometry,
  sliceArrowGeometry,
} from '../utils/arrowGeometry';

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

/**
 * Renders a meandering/bent SVG path arrow using react-native-svg with 60fps flow-along-track animation.
 * - Escaping: entire connected body flows around its bends and exits along its head direction.
 * - Blocked: slides across open space to hit the blocker, turns permanently red, and rebounds elastically.
 * - Penalty shake: subtle mini-shake in place when tapping an already-blocked red arrow.
 */
export const AnimatedPathArrow = memo(function AnimatedPathArrow({
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
  const [pressed, setPressed] = useState(false);

  const geom = useMemo(
    () => buildArrowGeometry(arrow.cells, arrow.dir, cellStep),
    [arrow.cells, arrow.dir, cellStep]
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const groupRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const haloRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stemRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const hitRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const headRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const headPathRef = useRef<any>(null);

  const onEscapeCompleteRef = useRef(onEscapeComplete);
  const onBlockedCompleteRef = useRef(onBlockedComplete);
  const onPenaltyCompleteRef = useRef(onPenaltyComplete);

  useEffect(() => {
    onEscapeCompleteRef.current = onEscapeComplete;
    onBlockedCompleteRef.current = onBlockedComplete;
    onPenaltyCompleteRef.current = onPenaltyComplete;
  }, [onEscapeComplete, onBlockedComplete, onPenaltyComplete]);

  // Persistent red takes precedence over base color
  const restColor = arrow.isBlocked
    ? BLOCKED_RED
    : isHinted
      ? ACTIVE_BLUE
      : baseStrokeColor;

  const applyColor = (color: string) => {
    stemRef.current?.setNativeProps({ stroke: color });
    headPathRef.current?.setNativeProps({ fill: color, stroke: color });
  };

  const applySlice = (offsetPx: number, opacity: number) => {
    const slice = sliceArrowGeometry(geom, offsetPx);
    haloRef.current?.setNativeProps({ d: slice.d });
    stemRef.current?.setNativeProps({ d: slice.d });
    hitRef.current?.setNativeProps({ d: slice.d });
    headRef.current?.setNativeProps({
      x: slice.headX,
      y: slice.headY,
      rotation: slice.headAngle,
      scale: arrowTipScale,
    });
    groupRef.current?.setNativeProps({ opacity });
  };

  useEffect(() => {
    if (arrow.state === 'idle') {
      groupRef.current?.setNativeProps({
        scale: pressed ? 0.98 : 1,
        originX: geom.restHead.x,
        originY: geom.restHead.y,
      });
    }
  }, [arrow.state, pressed, geom.restHead.x, geom.restHead.y]);

  useEffect(() => {
    if (arrow.state === 'idle') {
      applySlice(0, 1);
      applyColor(restColor);
      groupRef.current?.setNativeProps({ x: 0 });
      return;
    }

    let rafId = 0;
    const startTime = Date.now();

    if (arrow.state === 'escaping') {
      applyColor(arrow.isBlocked ? BLOCKED_RED : ACTIVE_BLUE);
      const travelDist = geom.bodyLen + 360;
      const duration = Math.min(600, Math.max(470, 440 + geom.bodyLen * 0.45));

      const tick = () => {
        const rawT = Math.min(1, (Date.now() - startTime) / duration);
        const eased = 0.35 * rawT + 0.65 * Math.pow(rawT, 1.75);
        const offsetPx = travelDist * eased;
        const opacity = rawT > 0.76 ? Math.max(0, 1 - (rawT - 0.76) / 0.24) : 1;

        applySlice(offsetPx, opacity);

        if (rawT < 1) {
          rafId = requestAnimationFrame(tick);
        } else {
          onEscapeCompleteRef.current(arrow.id);
        }
      };

      rafId = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(rafId);
    }

    if (arrow.state === 'blocked') {
      const peakBump = arrow.bumpDistancePx ?? Math.max(24, cellStep * 0.65);
      const duration = arrow.bumpDurationMs ?? 520;
      const hitFraction = 0.34;

      applyColor(restColor);

      const tick = () => {
        const t = Math.min(1, (Date.now() - startTime) / duration);
        let offsetPx = 0;

        if (t < hitFraction) {
          const u = t / hitFraction;
          offsetPx = peakBump * (1 - Math.pow(1 - u, 1.7));
          applyColor(restColor);
        } else {
          // Impact reached: turn permanently red and rebound elastically home
          const u = (t - hitFraction) / (1 - hitFraction);
          const rawRebound =
            peakBump * Math.exp(-3.8 * u) * Math.cos(Math.PI * 1.5 * u);
          offsetPx = Math.max(-7, rawRebound);
          applyColor(BLOCKED_RED);
        }

        applySlice(offsetPx, 1);

        if (t < 1) {
          rafId = requestAnimationFrame(tick);
        } else {
          applySlice(0, 1);
          applyColor(BLOCKED_RED);
          onBlockedCompleteRef.current(arrow.id);
        }
      };

      rafId = requestAnimationFrame(tick);
      return () => cancelAnimationFrame(rafId);
    }

    if (arrow.state === 'penalty_shake') {
      applySlice(0, 1);
      applyColor(BLOCKED_RED);
      const duration = 240;

      const tick = () => {
        const t = Math.min(1, (Date.now() - startTime) / duration);
        const shakeX = Math.sin(t * Math.PI * 5) * (1 - t) * 4.5;
        groupRef.current?.setNativeProps({ x: shakeX });

        if (t < 1) {
          rafId = requestAnimationFrame(tick);
        } else {
          groupRef.current?.setNativeProps({ x: 0 });
          applyColor(BLOCKED_RED);
          onPenaltyCompleteRef.current(arrow.id);
        }
      };

      rafId = requestAnimationFrame(tick);
      return () => {
        cancelAnimationFrame(rafId);
        groupRef.current?.setNativeProps({ x: 0 });
      };
    }
  }, [
    arrow.id,
    arrow.state,
    arrow.isBlocked,
    arrow.bumpDistancePx,
    arrow.bumpDurationMs,
    geom,
    arrowTipScale,
    cellStep,
    restColor,
  ]);

  const showHintHalo = isHinted || (arrow.state === 'escaping' && !arrow.isBlocked);

  return (
    <G
      ref={groupRef}
      opacity={1}
      originX={geom.restHead.x}
      originY={geom.restHead.y}
      onPressIn={() => setPressed(true)}
      onPressOut={() => setPressed(false)}
      onPress={() => onTap(arrow)}
    >
      {/* Subtle blue halo when hinted */}
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

      {/* Crisp white backing halo so crossing dots never clutter the line */}
      <Path
        ref={haloRef}
        d={geom.restD}
        fill="none"
        stroke="#FFFFFF"
        strokeWidth={strokeWidth + Math.min(4.0, strokeWidth * 0.95)}
        strokeLinecap="round"
        strokeLinejoin="round"
        opacity={0.9}
      />

      {/* Sleek minimalist arrow stem */}
      <Path
        ref={stemRef}
        d={geom.restD}
        fill="none"
        stroke={restColor}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Solid triangular arrowhead at tip */}
      <G
        ref={headRef}
        x={geom.restHead.x}
        y={geom.restHead.y}
        rotation={geom.restHead.angle}
        scale={arrowTipScale}
      >
        <Path
          ref={headPathRef}
          d="M 6 0 L -5.5 -5.8 L -3.5 0 L -5.5 5.8 Z"
          fill={restColor}
          stroke={restColor}
          strokeWidth={1.2}
          strokeLinejoin="round"
        />
      </G>

      {/* Proportional invisible touch hit-target along entire bent path */}
      <Path
        ref={hitRef}
        d={geom.restD}
        fill="none"
        stroke="transparent"
        strokeWidth={Math.max(9.5, Math.min(28, cellStep * 0.85))}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </G>
  );
});
