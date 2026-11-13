import { useEffect, useRef } from 'react';

interface ConfettiBurstProps {
  triggerKey: number;
}

interface ConfettiParticle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  w: number;
  h: number;
  color: string;
  rotation: number;
  vRot: number;
  tiltPhase: number;
  tiltSpeed: number;
  shape: 'rect' | 'circle';
  alpha: number;
}

const CONFETTI_COLORS = [
  '#2589FF', // Electric blue
  '#34D399', // Mint emerald
  '#FBBF24', // Warm gold
  '#F472B6', // Neon pink
  '#A78BFA', // Soft violet
  '#38BDF8', // Sky cyan
];

/**
 * Lightweight 60fps HTML5 Canvas confetti cannon overlay.
 * Fires celebratory particles from left, right, and center whenever `triggerKey` increments.
 */
export function ConfettiBurst({ triggerKey }: ConfettiBurstProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (triggerKey <= 0) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reducedMotion =
      typeof window !== 'undefined' &&
      window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

    const parent = canvas.parentElement;
    const width = parent?.clientWidth || 390;
    const height = parent?.clientHeight || 760;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    canvas.width = Math.floor(width * dpr);
    canvas.height = Math.floor(height * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const count = reducedMotion ? 24 : 85;
    const particles: ConfettiParticle[] = [];

    for (let i = 0; i < count; i++) {
      // Split between left cannon, right cannon, and center-board burst
      const source = i % 3;
      const startX =
        source === 0
          ? width * 0.14
          : source === 1
            ? width * 0.86
            : width * 0.5 + (Math.random() - 0.5) * width * 0.35;
      const startY =
        source === 2 ? height * 0.44 : height * 0.54 + (Math.random() - 0.5) * 30;

      const angle =
        source === 0
          ? -Math.PI * (0.28 + Math.random() * 0.18)
          : source === 1
            ? -Math.PI * (0.54 + Math.random() * 0.18)
            : -Math.PI * (0.25 + Math.random() * 0.5);

      const speed = (reducedMotion ? 220 : 340) + Math.random() * 340;

      particles.push({
        x: startX,
        y: startY,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - 90,
        w: 6 + Math.random() * 5,
        h: 4 + Math.random() * 4,
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
        rotation: Math.random() * Math.PI * 2,
        vRot: (Math.random() - 0.5) * 9,
        tiltPhase: Math.random() * Math.PI * 2,
        tiltSpeed: 6 + Math.random() * 8,
        shape: i % 5 === 0 ? 'circle' : 'rect',
        alpha: 1,
      });
    }

    let rafId = 0;
    let lastTime = performance.now();

    const tick = (now: number) => {
      const dt = Math.min((now - lastTime) / 1000, 0.05);
      lastTime = now;

      ctx.clearRect(0, 0, width, height);

      let alive = 0;
      for (const p of particles) {
        p.vx *= Math.pow(0.28, dt); // Air drag
        p.vy += 760 * dt; // Gravity
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.rotation += p.vRot * dt;
        p.tiltPhase += p.tiltSpeed * dt;

        if (p.y > height * 0.78) {
          p.alpha = Math.max(0, p.alpha - dt * 2.1);
        }

        if (p.y < height + 30 && p.alpha > 0.02) {
          alive += 1;
          ctx.save();
          ctx.globalAlpha = p.alpha;
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rotation);
          ctx.fillStyle = p.color;

          if (p.shape === 'circle') {
            ctx.beginPath();
            ctx.arc(0, 0, p.h * 0.6, 0, Math.PI * 2);
            ctx.fill();
          } else {
            const scaleY = Math.cos(p.tiltPhase);
            ctx.fillRect(-p.w * 0.5, (-p.h * scaleY) * 0.5, p.w, p.h * scaleY);
          }
          ctx.restore();
        }
      }

      if (alive > 0) {
        rafId = requestAnimationFrame(tick);
      } else {
        ctx.clearRect(0, 0, width, height);
      }
    };

    rafId = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(rafId);
      ctx.clearRect(0, 0, width, height);
    };
  }, [triggerKey]);

  return (
    <canvas
      ref={canvasRef}
      className="pointer-events-none absolute inset-0 z-40 h-full w-full"
      aria-hidden="true"
    />
  );
}
