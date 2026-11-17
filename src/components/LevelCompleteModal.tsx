import { motion } from 'motion/react';
import {
  ArrowRight,
  Check,
  Heart,
  Home,
  Navigation2,
  Star,
  Trophy,
  Video,
} from 'lucide-react';
import type { Difficulty } from '../types/game';

interface LevelCompleteModalProps {
  visible: boolean;
  level: number;
  lives: number;
  totalArrows: number;
  gridSize: number;
  difficulty: Difficulty;
  bonusClaimed?: boolean;
  onWatchBonusAd?: () => void;
  onNextLevel: () => void;
  onBackHome: () => void;
}

/**
 * Full-screen studio Victory Celebration overlay for Web & Capacitor:
 * - Soft ambient glow backdrop matching HomeScreen aesthetic
 * - Pulsing emerald victory trophy emblem + staggered 3-star rating based on lives left
 * - Minimalist 3-stat run summary (Arrows, Lives, Board Tier)
 * - Primary gradient Next Level CTA + distinct neutral Home secondary CTA
 */
export function LevelCompleteModal({
  visible,
  level,
  lives,
  totalArrows,
  gridSize,
  difficulty,
  bonusClaimed = false,
  onWatchBonusAd,
  onNextLevel,
  onBackHome,
}: LevelCompleteModalProps) {
  if (!visible) return null;

  const headline =
    lives >= 3 ? 'PERFECT CLEAR!' : lives === 2 ? 'GREAT JOB!' : 'LEVEL CLEARED!';

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.22 }}
      className="safe-top safe-bottom absolute inset-0 z-30 flex items-center justify-center overflow-hidden bg-[#F5F8FC]/96 px-6 backdrop-blur-sm"
    >
      {/* Soft ambient background glows */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -top-24 left-1/2 h-80 w-80 -translate-x-1/2 rounded-full bg-emerald-200/45 blur-3xl"
      />
      <div
        aria-hidden="true"
        className="pointer-events-none absolute -bottom-16 left-1/2 h-72 w-72 -translate-x-1/2 rounded-full bg-sky-200/45 blur-3xl"
      />

      <motion.div
        initial={{ scale: 0.88, opacity: 0, y: 12 }}
        animate={{ scale: 1, opacity: 1, y: 0 }}
        transition={{ type: 'spring', stiffness: 260, damping: 20 }}
        className="relative z-10 flex w-full max-w-[340px] flex-col items-center text-center"
      >
        {/* Pulsing Victory Emblem */}
        <div className="relative flex h-28 w-28 items-center justify-center">
          <motion.div
            animate={{ scale: [1, 1.09, 1] }}
            transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
            className="absolute h-28 w-28 rounded-full bg-emerald-500/14"
          />
          <div className="absolute h-[92px] w-[92px] rounded-full bg-emerald-500/22" />
          <div className="relative flex h-[76px] w-[76px] items-center justify-center rounded-full bg-gradient-to-br from-emerald-400 via-emerald-500 to-emerald-600 shadow-[0_12px_28px_-4px_rgba(16,185,129,0.45)]">
            <Trophy className="h-9 w-9 text-white stroke-[2.2]" />
          </div>
        </div>

        {/* Staggered 3-Star Rating */}
        <div className="mt-3.5 flex items-end justify-center gap-3">
          {[0, 1, 2].map((idx) => {
            const earned = idx < lives;
            return (
              <motion.div
                key={idx}
                initial={{ scale: 0.2, opacity: 0 }}
                animate={{ scale: idx === 1 ? 1.12 : 1, opacity: 1 }}
                transition={{
                  delay: 0.1 + idx * 0.12,
                  type: 'spring',
                  stiffness: 340,
                  damping: 16,
                }}
                className={idx === 1 ? 'mb-2' : ''}
              >
                <Star
                  className={`${idx === 1 ? 'h-9 w-9' : 'h-7 w-7'} ${
                    earned
                      ? 'fill-amber-400 text-amber-500 drop-shadow-xs'
                      : 'fill-slate-200 text-slate-300'
                  }`}
                />
              </motion.div>
            );
          })}
        </div>

        {/* Level Eyebrow & Victory Headline */}
        <div className="mt-4 rounded-full border border-sky-200 bg-sky-100 px-3.5 py-1 text-[11px] font-extrabold tracking-[0.14em] text-sky-700">
          LEVEL {level}
        </div>
        <h2 className="font-display mt-2.5 text-[28px] font-extrabold tracking-tight text-slate-900">
          {headline}
        </h2>
        <p className="mt-1 text-[13px] font-medium text-slate-500">
          All {totalArrows} arrows escaped smoothly
        </p>

        {/* Minimalist Run Summary Card */}
        <div className="mt-5 flex w-full items-center rounded-[20px] border border-slate-200/95 bg-white px-2.5 py-4 shadow-[0_10px_28px_-8px_rgba(15,23,42,0.08)]">
          <div className="flex flex-1 flex-col items-center gap-1">
            <div className="flex items-center gap-1.5">
              <Navigation2 className="h-3.5 w-3.5 rotate-45 fill-[#2589FF] text-[#2589FF]" />
              <span className="font-mono-tabular text-[17px] font-extrabold text-slate-900">
                {totalArrows}
              </span>
            </div>
            <span className="text-[10px] font-bold tracking-widest text-slate-400">
              ARROWS
            </span>
          </div>

          <div className="h-7 w-px bg-slate-200" />

          <div className="flex flex-1 flex-col items-center gap-1">
            <div className="flex items-center gap-1.5">
              <Heart className="h-3.5 w-3.5 fill-[#EF4444] text-[#EF4444]" />
              <span className="font-mono-tabular text-[17px] font-extrabold text-slate-900">
                {lives}/3
              </span>
            </div>
            <span className="text-[10px] font-bold tracking-widest text-slate-400">
              LIVES
            </span>
          </div>

          <div className="h-7 w-px bg-slate-200" />

          <div className="flex flex-1 flex-col items-center gap-1">
            <span className="font-mono-tabular text-[17px] font-extrabold text-slate-900">
              {gridSize}×{gridSize}
            </span>
            <span className="text-[10px] font-bold tracking-widest text-slate-400">
              {difficulty.toUpperCase()}
            </span>
          </div>
        </div>

        {/* Action CTAs */}
        <div className="mt-6 flex w-full flex-col gap-3">
          {onWatchBonusAd && (
            <button
              type="button"
              disabled={bonusClaimed}
              onClick={onWatchBonusAd}
              className={`flex h-11 w-full items-center justify-center gap-2 rounded-[15px] border-[1.5px] text-[13px] font-bold transition-transform ${
                bonusClaimed
                  ? 'border-slate-200 bg-slate-100 text-emerald-600'
                  : 'border-emerald-300 bg-emerald-50 text-emerald-700 hover:bg-emerald-100/80 active:scale-96'
              }`}
            >
              {bonusClaimed ? (
                <Check className="h-4 w-4 stroke-[2.5]" />
              ) : (
                <Video className="h-4 w-4 stroke-[2.3]" />
              )}
              <span>
                {bonusClaimed
                  ? '+1 Bonus Hint Claimed'
                  : 'Watch Ad · +1 Bonus Hint'}
              </span>
            </button>
          )}

          <button
            type="button"
            onClick={onNextLevel}
            className="flex h-14 w-full items-center justify-center gap-2.5 rounded-[18px] bg-gradient-to-r from-[#2589FF] via-[#0EA5E9] to-[#2563EB] px-5 text-[15px] font-extrabold tracking-wide text-white shadow-[0_10px_24px_-4px_rgba(37,137,255,0.4)] transition-transform active:scale-96"
          >
            <span>NEXT LEVEL · LV {level + 1}</span>
            <ArrowRight className="h-[19px] w-[19px] stroke-[2.5]" />
          </button>

          <button
            type="button"
            onClick={onBackHome}
            className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl border-[1.5px] border-slate-300 bg-white text-[13px] font-bold text-slate-700 transition-colors hover:bg-slate-50 active:scale-96"
          >
            <Home className="h-4 w-4 stroke-[2.2]" />
            <span>Back to Home</span>
          </button>
        </div>
      </motion.div>
    </motion.div>
  );
}
