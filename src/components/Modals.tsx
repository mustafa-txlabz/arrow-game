import { useState } from 'react';
import { motion } from 'motion/react';
import {
  Check,
  Gift,
  Lightbulb,
  Music,
  Smartphone,
  Volume2,
  X,
} from 'lucide-react';
import type { GameSettings } from '../types/game';

interface SettingsModalProps {
  open: boolean;
  settings: GameSettings;
  onUpdateSettings: (next: GameSettings) => void;
  onResetProgress: () => void;
  onClose: () => void;
}

export function SettingsModal({
  open,
  settings,
  onUpdateSettings,
  onResetProgress,
  onClose,
}: SettingsModalProps) {
  const [confirmReset, setConfirmReset] = useState(false);

  if (!open) return null;

  const toggle = (key: keyof GameSettings) => {
    onUpdateSettings({
      ...settings,
      [key]: !settings[key],
    });
  };

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-slate-900/40 px-5 backdrop-blur-xs">
      <motion.div
        initial={{ scale: 0.94, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="w-full max-w-[340px] rounded-3xl border border-slate-200 bg-white p-6 text-slate-900 shadow-2xl"
      >
        <div className="flex items-center justify-between">
          <h2 className="font-display text-xl font-bold text-slate-900">Settings</h2>
          <button
            type="button"
            onClick={() => {
              setConfirmReset(false);
              onClose();
            }}
            aria-label="Close settings"
            className="flex h-10 w-10 items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-5 space-y-3">
          {/* Audio SFX */}
          <button
            type="button"
            onClick={() => toggle('sfx')}
            className="flex h-13 w-full items-center justify-between rounded-2xl border border-slate-200/80 bg-[#F5F8FC] px-4"
          >
            <div className="flex items-center gap-3">
              <Volume2 className="h-5 w-5 text-[#2589FF]" />
              <span className="text-sm font-semibold text-slate-800">Audio SFX</span>
            </div>
            <span
              className={`flex h-6 w-11 items-center rounded-full p-0.5 transition-colors ${
                settings.sfx ? 'justify-end bg-[#2589FF]' : 'justify-start bg-slate-300'
              }`}
            >
              <span className="h-5 w-5 rounded-full bg-white shadow" />
            </span>
          </button>

          {/* Music */}
          <button
            type="button"
            onClick={() => toggle('music')}
            className="flex h-13 w-full items-center justify-between rounded-2xl border border-slate-200/80 bg-[#F5F8FC] px-4"
          >
            <div className="flex items-center gap-3">
              <Music className="h-5 w-5 text-emerald-500" />
              <span className="text-sm font-semibold text-slate-800">Ambient Music</span>
            </div>
            <span
              className={`flex h-6 w-11 items-center rounded-full p-0.5 transition-colors ${
                settings.music ? 'justify-end bg-emerald-500' : 'justify-start bg-slate-300'
              }`}
            >
              <span className="h-5 w-5 rounded-full bg-white shadow" />
            </span>
          </button>

          {/* Haptics */}
          <button
            type="button"
            onClick={() => toggle('haptics')}
            className="flex h-13 w-full items-center justify-between rounded-2xl border border-slate-200/80 bg-[#F5F8FC] px-4"
          >
            <div className="flex items-center gap-3">
              <Smartphone className="h-5 w-5 text-rose-500" />
              <span className="text-sm font-semibold text-slate-800">Haptics</span>
            </div>
            <span
              className={`flex h-6 w-11 items-center rounded-full p-0.5 transition-colors ${
                settings.haptics ? 'justify-end bg-rose-500' : 'justify-start bg-slate-300'
              }`}
            >
              <span className="h-5 w-5 rounded-full bg-white shadow" />
            </span>
          </button>
        </div>

        {/* Inline Reset Confirmation */}
        <div className="mt-5 border-t border-slate-100 pt-4">
          {!confirmReset ? (
            <button
              type="button"
              onClick={() => setConfirmReset(true)}
              className="w-full py-2 text-center text-xs font-medium text-slate-400 transition-colors hover:text-rose-500"
            >
              Reset Saved Progress
            </button>
          ) : (
            <div className="flex items-center justify-between gap-2">
              <button
                type="button"
                onClick={() => setConfirmReset(false)}
                className="h-10 flex-1 rounded-xl border border-slate-200 text-xs font-semibold text-slate-600"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  onResetProgress();
                  setConfirmReset(false);
                  onClose();
                }}
                className="h-10 flex-1 rounded-xl bg-rose-500 text-xs font-bold text-white"
              >
                Confirm Reset
              </button>
            </div>
          )}
        </div>
      </motion.div>
    </div>
  );
}

interface DailyBonusModalProps {
  open: boolean;
  canClaim: boolean;
  streak: number;
  onClaim: (hintsEarned: number) => void;
  onClose: () => void;
}

export function DailyBonusModal({
  open,
  canClaim,
  streak,
  onClaim,
  onClose,
}: DailyBonusModalProps) {
  if (!open) return null;

  const nextDay = (streak % 7) + 1;
  const hintReward = nextDay === 7 ? 2 : 1;

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-slate-900/40 px-5 backdrop-blur-xs">
      <motion.div
        initial={{ scale: 0.92, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        className="w-full max-w-[340px] rounded-3xl border border-slate-200 bg-white p-6 text-center text-slate-900 shadow-2xl"
      >
        <div className="flex justify-end">
          <button
            type="button"
            onClick={onClose}
            aria-label="Close daily bonus"
            className="flex h-9 w-9 items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100 hover:text-slate-700"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-500">
          <Gift className="h-7 w-7" />
        </div>

        <h2 className="font-display mt-3 text-2xl font-bold text-slate-900">
          Daily Bonus
        </h2>
        <p className="mt-1 text-xs text-slate-500">
          {canClaim
            ? `Day ${nextDay} reward is ready to claim`
            : 'Today’s bonus has been claimed. Come back tomorrow!'}
        </p>

        {/* 7-day mini streak tracker */}
        <div className="mt-5 grid grid-cols-7 gap-1.5">
          {Array.from({ length: 7 }).map((_, idx) => {
            const dayNum = idx + 1;
            const claimedDay = canClaim
              ? dayNum <= streak % 7
              : dayNum <= ((streak - 1) % 7) + 1;
            const isToday = canClaim && dayNum === nextDay;

            return (
              <div
                key={dayNum}
                className={`flex h-11 flex-col items-center justify-center rounded-xl border text-[10px] font-bold ${
                  isToday
                    ? 'border-emerald-400 bg-emerald-50 text-emerald-700'
                    : claimedDay
                      ? 'border-slate-200 bg-slate-100 text-emerald-600'
                      : 'border-slate-200/70 bg-[#F5F8FC] text-slate-400'
                }`}
              >
                {claimedDay ? <Check className="h-3.5 w-3.5" /> : <span>D{dayNum}</span>}
              </div>
            );
          })}
        </div>

        <div className="mt-5 inline-flex items-center gap-2 rounded-2xl border border-blue-200 bg-blue-50 px-5 py-2.5 text-[#2589FF]">
          <Lightbulb className="h-5 w-5 text-[#2589FF]" />
          <span className="font-mono-tabular text-lg font-extrabold">
            +{hintReward} Hint{hintReward > 1 ? 's' : ''}
          </span>
        </div>

        <button
          type="button"
          disabled={!canClaim}
          onClick={() => onClaim(hintReward)}
          className={`mt-5 flex h-12 w-full items-center justify-center rounded-2xl text-sm font-bold transition-transform ${
            canClaim
              ? 'bg-gradient-to-r from-[#2589FF] to-emerald-500 text-white shadow-lg shadow-blue-500/25 active:scale-95'
              : 'cursor-not-allowed bg-slate-100 text-slate-400'
          }`}
        >
          {canClaim ? 'Claim Reward' : 'Claimed Today'}
        </button>
      </motion.div>
    </div>
  );
}
