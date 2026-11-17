import { useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import {
  CheckCircle2,
  Heart,
  Layers,
  Lightbulb,
  Play,
  ShieldCheck,
  Sparkles,
  Star,
  X,
} from 'lucide-react';
import type { AdPlacement } from '../types/game';

interface AdOverlayModalProps {
  visible: boolean;
  placement: AdPlacement | null;
  onComplete: (placement: AdPlacement) => void;
  onSkipOrClose: () => void;
}

interface SponsorCreative {
  id: string;
  title: string;
  subtitle: string;
  rating: string;
  downloads: string;
  gradientClass: string;
}

const SPONSORS: SponsorCreative[] = [
  {
    id: 'cube-flow',
    title: 'Cube Flow 3D',
    subtitle: 'Unblock colorful sliding paths across 1,000+ handcrafted boards.',
    rating: '4.8',
    downloads: '10M+ Plays',
    gradientClass: 'from-blue-600 to-sky-500',
  },
  {
    id: 'zen-sort',
    title: 'Zen Grid Sort',
    subtitle: 'Relaxing logic puzzles with crisp tactile haptics and zero timers.',
    rating: '4.9',
    downloads: '5M+ Plays',
    gradientClass: 'from-emerald-600 to-emerald-500',
  },
  {
    id: 'tile-studio',
    title: 'Pathway Classic',
    subtitle: 'Train spatial focus every day with endless spatial brain teasers.',
    rating: '4.7',
    downloads: '8M+ Plays',
    gradientClass: 'from-amber-600 to-amber-500',
  },
];

function getAdMeta(placement: AdPlacement | null) {
  switch (placement) {
    case 'rewarded_revive':
      return {
        isRewarded: true,
        durationSec: 5,
        kindLabel: 'Rewarded Video',
        rewardTitle: 'Revive with 3 Full Hearts',
        rewardHint: 'Continue right from where you left off',
        ctaLabel: 'Claim 3 Hearts & Resume',
      };
    case 'rewarded_victory_bonus':
      return {
        isRewarded: true,
        durationSec: 5,
        kindLabel: 'Rewarded Video',
        rewardTitle: '+1 Bonus Hint',
        rewardHint: 'Added straight to your hint balance',
        ctaLabel: 'Claim +1 Bonus Hint',
      };
    case 'interstitial_level':
      return {
        isRewarded: false,
        durationSec: 3,
        kindLabel: 'Sponsored Break',
        rewardTitle: 'Next Level Ready',
        rewardHint: 'Thanks for playing Arrow Escape',
        ctaLabel: 'Continue to Next Level',
      };
    case 'rewarded_hint':
    default:
      return {
        isRewarded: true,
        durationSec: 5,
        kindLabel: 'Rewarded Video',
        rewardTitle: '+1 Free Hint',
        rewardHint: 'Highlights a clear arrow on your board',
        ctaLabel: 'Claim +1 Hint',
      };
  }
}

/**
 * Full-screen Simulated Ad Player (Rewarded & Interstitial) for Web & Capacitor.
 * Acts as a clean drop-in UI stand-in until live AdMob SDK is integrated.
 */
export function AdOverlayModal({
  visible,
  placement,
  onComplete,
  onSkipOrClose,
}: AdOverlayModalProps) {
  const meta = useMemo(() => getAdMeta(placement), [placement]);
  const [secondsLeft, setSecondsLeft] = useState<number>(meta.durationSec);
  const [confirmEarlyExit, setConfirmEarlyExit] = useState(false);
  const [sponsorIdx, setSponsorIdx] = useState(0);

  useEffect(() => {
    if (!visible) return;
    setSecondsLeft(meta.durationSec);
    setConfirmEarlyExit(false);
    setSponsorIdx((prev) => (prev + 1) % SPONSORS.length);

    const interval = window.setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          window.clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      window.clearInterval(interval);
    };
  }, [visible, meta.durationSec]);

  if (!visible) return null;

  const sponsor = SPONSORS[sponsorIdx];
  const isReady = secondsLeft <= 0;

  const handleClosePress = () => {
    if (isReady && placement) {
      onComplete(placement);
      return;
    }
    if (!meta.isRewarded) return;
    setConfirmEarlyExit(true);
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 24 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.2 }}
      className="safe-top safe-bottom absolute inset-0 z-50 flex flex-col justify-between bg-[#0B1120] px-5 py-4 text-slate-100"
    >
      {/* Top Ad Bar */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="rounded-md bg-amber-500 px-2 py-0.5 text-[11px] font-extrabold tracking-wider text-slate-900">
            AD
          </span>
          <span className="text-[13px] font-semibold text-slate-400">
            {meta.kindLabel}
          </span>
        </div>

        <div className="flex items-center gap-2.5">
          <div
            className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-bold ${
              isReady
                ? 'border-emerald-400/45 bg-emerald-500/15 text-emerald-300'
                : 'border-slate-600/80 bg-slate-800/90 text-slate-200'
            }`}
          >
            {isReady ? (
              <>
                <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" />
                <span>{meta.isRewarded ? 'Reward Ready' : 'Ready'}</span>
              </>
            ) : (
              <span className="font-mono-tabular">
                {meta.isRewarded
                  ? `Reward in ${secondsLeft}s`
                  : `Continue in ${secondsLeft}s`}
              </span>
            )}
          </div>

          {(isReady || meta.isRewarded) && (
            <button
              type="button"
              onClick={handleClosePress}
              aria-label={isReady ? 'Claim and close ad' : 'Close ad'}
              className={`flex h-9 w-9 items-center justify-center rounded-full border transition-transform active:scale-90 ${
                isReady
                  ? 'border-white bg-white text-slate-900'
                  : 'border-slate-600/80 bg-slate-800/85 text-slate-300'
              }`}
            >
              <X className="h-4 w-4 stroke-[2.5]" />
            </button>
          )}
        </div>
      </div>

      {/* Reward Context Banner */}
      <div className="mt-3.5 flex items-center gap-3 rounded-2xl border border-slate-700/90 bg-slate-800/75 px-3.5 py-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-900/90">
          {placement === 'rewarded_revive' ? (
            <Heart className="h-5 w-5 fill-rose-500 text-rose-500" />
          ) : placement === 'interstitial_level' ? (
            <Sparkles className="h-5 w-5 text-sky-400" />
          ) : (
            <Lightbulb className="h-5 w-5 text-amber-400" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-slate-50">
            {meta.rewardTitle}
          </p>
          <p className="truncate text-xs text-slate-400">{meta.rewardHint}</p>
        </div>
      </div>

      {/* Center Sponsored Creative Showcase */}
      <div className="my-auto flex items-center justify-center py-4">
        <motion.div
          animate={{ scale: [1, 1.025, 1] }}
          transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
          className="w-full max-w-[340px] overflow-hidden rounded-3xl border border-slate-700 bg-slate-800 shadow-2xl"
        >
          <div
            className={`flex h-48 flex-col items-center justify-center gap-3.5 bg-gradient-to-br ${sponsor.gradientClass}`}
          >
            <div className="flex h-20 w-20 items-center justify-center rounded-3xl border border-white/35 bg-white/20">
              <Layers className="h-10 w-10 text-white" />
            </div>
            <div className="flex items-center gap-1.5 rounded-full bg-slate-950/35 px-3 py-1 text-[11px] font-bold tracking-wider text-white">
              <Play className="h-3 w-3 fill-white" />
              <span>INTERACTIVE PREVIEW</span>
            </div>
          </div>

          <div className="p-5">
            <h3 className="font-display text-xl font-extrabold text-slate-50">
              {sponsor.title}
            </h3>
            <p className="mt-1.5 text-[13px] leading-relaxed text-slate-300">
              {sponsor.subtitle}
            </p>
            <div className="mt-3.5 flex items-center gap-2 text-xs font-bold text-slate-200">
              <span className="flex items-center gap-1">
                <Star className="h-3.5 w-3.5 fill-amber-400 text-amber-400" />
                {sponsor.rating}
              </span>
              <span className="text-slate-500">·</span>
              <span>{sponsor.downloads}</span>
              <span className="text-slate-500">·</span>
              <span className="text-emerald-400">Free</span>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Early Exit Guard Strip */}
      {confirmEarlyExit && !isReady && (
        <div className="mb-3 rounded-2xl border border-rose-500/45 bg-rose-500/15 p-3.5">
          <p className="text-center text-[13px] font-semibold text-rose-100">
            Watch until the timer ends to earn your reward.
          </p>
          <div className="mt-2.5 flex gap-2.5">
            <button
              type="button"
              onClick={() => setConfirmEarlyExit(false)}
              className="h-10 flex-1 rounded-xl bg-emerald-500 text-xs font-bold text-white"
            >
              Keep Watching
            </button>
            <button
              type="button"
              onClick={() => {
                setConfirmEarlyExit(false);
                onSkipOrClose();
              }}
              className="h-10 flex-1 rounded-xl border border-slate-400/40 bg-slate-900/75 text-xs font-semibold text-slate-200"
            >
              Exit (No Reward)
            </button>
          </div>
        </div>
      )}

      {/* Bottom Progress & Claim Action */}
      <div className="flex flex-col gap-3">
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-slate-800">
          <motion.div
            key={`${placement ?? 'ad'}-${sponsorIdx}`}
            initial={{ width: '0%' }}
            animate={{ width: '100%' }}
            transition={{ duration: meta.durationSec, ease: 'linear' }}
            className={`h-full rounded-full ${isReady ? 'bg-emerald-500' : 'bg-sky-400'}`}
          />
        </div>

        <button
          type="button"
          disabled={!isReady}
          onClick={() => {
            if (isReady && placement) {
              onComplete(placement);
            }
          }}
          className={`flex h-[54px] w-full items-center justify-center rounded-2xl text-[15px] font-extrabold tracking-wide transition-transform ${
            isReady
              ? 'bg-emerald-500 text-white shadow-[0_8px_20px_-4px_rgba(16,185,129,0.45)] active:scale-96'
              : 'cursor-not-allowed border border-slate-700 bg-slate-800 text-slate-400'
          }`}
        >
          {isReady ? meta.ctaLabel : `Please wait ${secondsLeft}s…`}
        </button>

        <div className="flex items-center justify-center gap-1.5 pb-1 text-[11px] text-slate-500">
          <ShieldCheck className="h-3.5 w-3.5" />
          <span>Simulated Ad Screen · Ready for AdMob integration</span>
        </div>
      </div>
    </motion.div>
  );
}
