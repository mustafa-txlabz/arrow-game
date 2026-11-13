import { memo, useEffect, useMemo, useRef, useState } from 'react';
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
 * Renders a meandering/bent SVG path arrow with 60fps flow-along-track animation.
 * - Escaping: entire connected body flows deliberately (~470-600ms) around its bends and exits.
 * - Blocked: slides across empty space to hit the blocker, turns permanently red, and rebounds.
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

  const groupRef = useRef<SVGGElement | null>(null);
  const haloRef = useRef<SVGPathElement | null>(null);
  const stemRef = useRef<SVGPathElement | null>(null);
  const hitRef = useRef<SVGPathElement | null>(null);
  const headRef = useRef<SVGGElement | null>(null);
  const headPathRef = useRef<SVGPathElement | null>(null);

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
    if (stemRef.current) stemRef.current.setAttribute('stroke', color);
    if (headPathRef.current) {
      headPathRef.current.setAttribute('fill', color);
      headPathRef.current.setAttribute('stroke', color);
    }
  };

  const applySlice = (offsetPx: number, opacity: number) => {
    const slice = sliceArrowGeometry(geom, offsetPx);
    if (haloRef.current) haloRef.current.setAttribute('d', slice.d);
    if (stemRef.current) stemRef.current.setAttribute('d', slice.d);
    if (hitRef.current) hitRef.current.setAttribute('d', slice.d);
    if (headRef.current) {
      headRef.current.setAttribute(
        'transform',
        `translate(${slice.headX.toFixed(2)}, ${slice.headY.toFixed(
          2
        )}) rotate(${slice.headAngle.toFixed(2)}) scale(${arrowTipScale})`
      );
    }
    if (groupRef.current) {
      groupRef.current.style.opacity = String(opacity);
    }
  };

  useEffect(() => {
    if (arrow.state === 'idle' && groupRef.current) {
      groupRef.current.style.transform = pressed ? 'scale(0.98)' : '';
    }
  }, [arrow.state, pressed]);

  useEffect(() => {
    if (arrow.state === 'idle') {
      applySlice(0, 1);
      applyColor(restColor);
      return;
    }

    let rafId = 0;
    const startTime = performance.now();

    if (arrow.state === 'escaping') {
      applyColor(arrow.isBlocked ? BLOCKED_RED : ACTIVE_BLUE);
      const travelDist = geom.bodyLen + 360;
      const duration = Math.min(600, Math.max(470, 440 + geom.bodyLen * 0.45));

      const tick = (now: number) => {
        const rawT = Math.min(1, (now - startTime) / duration);
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

      const tick = (now: number) => {
        const t = Math.min(1, (now - startTime) / duration);
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
      // Quick subtle mini-shake in place without changing arrow path or routing
      applySlice(0, 1);
      applyColor(BLOCKED_RED);
      const duration = 240;

      const tick = (now: number) => {
        const t = Math.min(1, (now - startTime) / duration);
        const shakeX = Math.sin(t * Math.PI * 5) * (1 - t) * 4.5;
        if (groupRef.current) {
          groupRef.current.style.transform = `translateX(${shakeX.toFixed(2)}px)`;
        }

        if (t < 1) {
          rafId = requestAnimationFrame(tick);
        } else {
          if (groupRef.current) {
            groupRef.current.style.transform = '';
          }
          applyColor(BLOCKED_RED);
          onPenaltyCompleteRef.current(arrow.id);
        }
      };

      rafId = requestAnimationFrame(tick);
      return () => {
        cancelAnimationFrame(rafId);
        if (groupRef.current) {
          groupRef.current.style.transform = '';
        }
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

  return (
    <g
      ref={groupRef}
      filter={
        isHinted || (arrow.state === 'escaping' && !arrow.isBlocked)
          ? 'url(#hint-glow)'
          : undefined
      }
      className="cursor-pointer transition-transform duration-100"
      style={{
        transformOrigin: `${geom.restHead.x}px ${geom.restHead.y}px`,
      }}
      onPointerDown={() => setPressed(true)}
      onPointerUp={() => setPressed(false)}
      onPointerLeave={() => setPressed(false)}
      onClick={() => onTap(arrow)}
    >
      {/* Crisp white backing halo so crossing dots never clutter the line */}
      <path
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
      <path
        ref={stemRef}
        d={geom.restD}
        fill="none"
        stroke={restColor}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Solid triangular arrowhead at tip */}
      <g
        ref={headRef}
        transform={`translate(${geom.restHead.x.toFixed(
          2
        )}, ${geom.restHead.y.toFixed(2)}) rotate(${geom.restHead.angle.toFixed(
          2
        )}) scale(${arrowTipScale})`}
      >
        <path
          ref={headPathRef}
          d="M 6 0 L -5.5 -5.8 L -3.5 0 L -5.5 5.8 Z"
          fill={restColor}
          stroke={restColor}
          strokeWidth={1.2}
          strokeLinejoin="round"
        />
      </g>

      {/* Proportional invisible touch hit-target along entire bent path */}
      <path
        ref={hitRef}
        d={geom.restD}
        fill="none"
        stroke="transparent"
        strokeWidth={Math.max(7.5, Math.min(28, cellStep * 0.85))}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </g>
  );
});
