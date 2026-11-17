import { motion } from 'motion/react';
import { Gift, Lightbulb, Play, Settings, Video } from 'lucide-react';
import type { PlayerProgress } from '../types/game';

interface HomeScreenProps {
  progress: PlayerProgress;
  canClaimDaily: boolean;
  onPlay: () => void;
  onOpenDaily: () => void;
  onOpenSettings: () => void;
  onWatchFreeHintAd: () => void;
}

/**
 * Clean minimalist light-mode Home Screen / Main Menu for Arrow Escape.
 * Matches the active Gameplay Screen's off-white canvas, white card frames,
 * dark navy typography, and electric-blue accents.
 */
export function HomeScreen({
  progress,
  canClaimDaily,
  onPlay,
  onOpenDaily,
  onOpenSettings,
  onWatchFreeHintAd,
}: HomeScreenProps) {
  const isReturningPlayer = progress.currentLevel > 1;

  return (
    <div className="safe-top safe-bottom relative flex h-full w-full flex-col justify-between overflow-hidden bg-[#F5F8FC] px-5 py-4 text-slate-900">
      {/* Subtle soft ambient tint behind hero */}
      <div
        className="pointer-events-none absolute -top-20 left-1/2 h-80 w-80 -translate-x-1/2 rounded-full bg-sky-200/45 blur-3xl"
        aria-hidden="true"
      />
      <div
        className="pointer-events-none absolute bottom-16 left-1/2 h-72 w-72 -translate-x-1/2 rounded-full bg-emerald-100/50 blur-3xl"
        aria-hidden="true"
      />

      {/* Top Header Bar */}
      <header className="relative z-10 mt-4 flex items-center justify-between sm:mt-1">
        <button
          type="button"
          onClick={onOpenSettings}
          aria-label="Open settings"
          className="flex h-11 w-11 items-center justify-center rounded-full bg-white text-[#2589FF] shadow-[0_6px_18px_-4px_rgba(15,23,42,0.08)] ring-1 ring-slate-200/80 transition-transform active:scale-95"
        >
          <Settings className="h-5 w-5 stroke-[2.2]" />
        </button>

        <button
          type="button"
          onClick={onWatchFreeHintAd}
          aria-label="Watch ad for 1 free hint"
          className={`flex items-center gap-1.5 rounded-full py-1.5 pr-2 pl-3 text-slate-800 shadow-[0_6px_18px_-4px_rgba(15,23,42,0.06)] ring-1 transition-transform active:scale-95 ${
            progress.hints === 0
              ? 'bg-emerald-50 ring-emerald-300'
              : 'bg-white ring-slate-200/80'
          }`}
        >
          <Lightbulb className="h-4 w-4 text-[#2589FF]" aria-hidden="true" />
          <span className="font-mono-tabular text-sm font-bold">
            {progress.hints}
          </span>
          <span className="flex items-center gap-0.5 rounded-full bg-emerald-500 px-2 py-0.5 text-[10px] font-extrabold text-white">
            <Video className="h-2.5 w-2.5 stroke-[2.5]" aria-hidden="true" />
            <span>+1</span>
          </span>
        </button>
      </header>

      {/* Hero / Brand Section */}
      <section className="relative z-10 my-auto flex flex-col items-center text-center">
        <h1 className="font-display text-balance text-4xl font-extrabold tracking-wider text-slate-900">
          ARROW{' '}
          <span className="bg-gradient-to-r from-[#2589FF] via-sky-500 to-emerald-500 bg-clip-text text-transparent drop-shadow-[0_6px_16px_rgba(37,137,255,0.25)]">
            ESCAPE
          </span>
        </h1>

        {/* Floating white dotted-matrix card showcasing bent & L-shaped arrows */}
        <div className="animate-float-slow relative mt-7 rounded-3xl bg-white p-4 shadow-[0_18px_42px_-14px_rgba(15,23,42,0.12)] ring-1 ring-slate-200/80">
          <svg viewBox="0 0 168 168" className="h-40 w-40" aria-hidden="true">
            <defs>
              <filter id="home-arrow-glow" x="-25%" y="-25%" width="150%" height="150%">
                <feDropShadow
                  dx="0"
                  dy="2"
                  stdDeviation="2.5"
                  floodColor="#2589FF"
                  floodOpacity="0.28"
                />
              </filter>
            </defs>

            {/* 4x4 Dotted Matrix */}
            {[24, 64, 104, 144].map((y) =>
              [24, 64, 104, 144].map((x) => (
                <circle key={`${x}-${y}`} cx={x} cy={y} r={2.2} fill="#CBD5E1" />
              ))
            )}

            {/* Electric Blue L-shaped arrow pointing Right */}
            <motion.g
              filter="url(#home-arrow-glow)"
              animate={{ opacity: [0.88, 1, 0.88] }}
              transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
            >
              <path
                d="M 24 64 L 24 34 Q 24 24 34 24 L 98 24"
                fill="none"
                stroke="#2589FF"
                strokeWidth="4.2"
                strokeLinecap="round"
              />
              <path d="M 106 24 L 94 17.5 L 96.5 24 L 94 30.5 Z" fill="#2589FF" />
            </motion.g>

            {/* Emerald S-shaped meandering arrow pointing Down */}
            <motion.g
              animate={{ opacity: [0.88, 1, 0.88] }}
              transition={{ duration: 2.4, repeat: Infinity, delay: 0.6, ease: 'easeInOut' }}
            >
              <path
                d="M 64 104 L 64 74 Q 64 64 74 64 L 134 64 Q 144 64 144 74 L 144 138"
                fill="none"
                stroke="#10B981"
                strokeWidth="4.2"
                strokeLinecap="round"
              />
              <path d="M 144 146 L 137.5 134 L 144 136.5 L 150.5 134 Z" fill="#10B981" />
            </motion.g>

            {/* Crisp Dark Navy U-turn arrow pointing Left */}
            <motion.g
              animate={{ opacity: [0.88, 1, 0.88] }}
              transition={{ duration: 2.4, repeat: Infinity, delay: 1.2, ease: 'easeInOut' }}
            >
              <path
                d="M 104 104 L 104 134 Q 104 144 94 144 L 30 144"
                fill="none"
                stroke="#0F172A"
                strokeWidth="4.2"
                strokeLinecap="round"
              />
              <path d="M 22 144 L 34 137.5 L 31.5 144 L 34 150.5 Z" fill="#0F172A" />
            </motion.g>
          </svg>
        </div>

        {/* Primary CTA */}
        <div className="mt-8 w-full max-w-[300px]">
          <button
            type="button"
            onClick={onPlay}
            className="animate-pulse-cta flex h-14 w-full items-center justify-center gap-2.5 rounded-2xl bg-gradient-to-r from-[#2589FF] via-sky-500 to-blue-600 px-6 text-base font-extrabold tracking-wider text-white transition-transform active:scale-95"
          >
            <Play className="h-5 w-5 fill-white" aria-hidden="true" />
            <span>
              {isReturningPlayer ? `CONTINUE · LV ${progress.currentLevel}` : 'TAP TO PLAY'}
            </span>
          </button>
        </div>
      </section>

      {/* Secondary Bottom Navigation Hub */}
      <nav
        aria-label="Game menu navigation"
        className="relative z-10 mx-auto w-full max-w-[300px] pt-2"
      >
        <button
          type="button"
          onClick={onOpenDaily}
          className="relative flex min-h-[56px] w-full items-center justify-center gap-2 rounded-2xl bg-white px-4 py-2.5 text-slate-800 shadow-[0_8px_20px_-6px_rgba(15,23,42,0.08)] ring-1 ring-slate-200/80 transition-transform active:scale-95"
        >
          {canClaimDaily && (
            <span
              className="absolute top-2.5 right-3.5 h-2 w-2 rounded-full bg-emerald-500"
              aria-label="Daily reward available"
            />
          )}
          <Gift className="h-5 w-5 text-emerald-500" aria-hidden="true" />
          <span className="text-xs font-semibold">Daily Bonus</span>
        </button>
      </nav>
    </div>
  );
}
