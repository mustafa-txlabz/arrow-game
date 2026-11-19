import { useCallback, useEffect, useRef, useState } from 'react';
import { Capacitor } from '@capacitor/core';
import { ScreenOrientation } from '@capacitor/screen-orientation';
import { AnimatePresence, motion } from 'motion/react';
import { Loader2 } from 'lucide-react';
import { GameplayScreen } from './components/GameplayScreen';
import { HomeScreen } from './components/HomeScreen';
import { DailyBonusModal, SettingsModal } from './components/Modals';
import type {
  AdPlacement,
  GameSettings,
  PlayerProgress,
  ScreenView,
} from './types/game';
import {
  initializeAdMob,
  isAdMobSupported,
  showInterstitialAd,
  showRewardedAd,
} from './utils/admobService';
import { feedback } from './utils/soundAndHaptics';

const PROGRESS_STORAGE_KEY = 'arrow_escape_progress_v1';
const SETTINGS_STORAGE_KEY = 'arrow_escape_settings_v1';

const DEFAULT_PROGRESS: PlayerProgress = {
  currentLevel: 1,
  highestUnlockedLevel: 1,
  hints: 3,
  lastDailyClaimDate: null,
  dailyStreak: 0,
};

const DEFAULT_SETTINGS: GameSettings = {
  sfx: true,
  music: false,
  haptics: true,
};

function getTodayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(
    d.getDate()
  ).padStart(2, '0')}`;
}

function loadProgress(): PlayerProgress {
  try {
    const raw = localStorage.getItem(PROGRESS_STORAGE_KEY);
    if (!raw) return DEFAULT_PROGRESS;
    const parsed = JSON.parse(raw) as Partial<PlayerProgress>;
    return {
      currentLevel:
        typeof parsed.currentLevel === 'number' && parsed.currentLevel >= 1
          ? parsed.currentLevel
          : DEFAULT_PROGRESS.currentLevel,
      highestUnlockedLevel:
        typeof parsed.highestUnlockedLevel === 'number' &&
        parsed.highestUnlockedLevel >= 1
          ? parsed.highestUnlockedLevel
          : DEFAULT_PROGRESS.highestUnlockedLevel,
      hints:
        typeof parsed.hints === 'number' && parsed.hints >= 0
          ? parsed.hints
          : DEFAULT_PROGRESS.hints,
      lastDailyClaimDate:
        typeof parsed.lastDailyClaimDate === 'string'
          ? parsed.lastDailyClaimDate
          : null,
      dailyStreak:
        typeof parsed.dailyStreak === 'number' && parsed.dailyStreak >= 0
          ? parsed.dailyStreak
          : DEFAULT_PROGRESS.dailyStreak,
    };
  } catch {
    return DEFAULT_PROGRESS;
  }
}

function loadSettings(): GameSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    return { ...DEFAULT_SETTINGS, ...(JSON.parse(raw) as Partial<GameSettings>) };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

/**
 * Root Arrow Escape application container.
 * Strictly mobile-first (max-width 420px, centered phone frame on desktop),
 * managing smooth screen navigation ('home' | 'game') and modals.
 */
export default function App() {
  const [currentScreen, setCurrentScreen] = useState<ScreenView>('home');
  const [progress, setProgress] = useState<PlayerProgress>(loadProgress);
  const [settings, setSettings] = useState<GameSettings>(loadSettings);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [dailyOpen, setDailyOpen] = useState(false);
  const [adBusy, setAdBusy] = useState(false);
  const [adNotice, setAdNotice] = useState<string | null>(null);

  const adBusyRef = useRef(false);
  const noticeTimerRef = useRef<number | null>(null);

  const canClaimDaily = progress.lastDailyClaimDate !== getTodayKey();

  const showAdNotice = useCallback((message: string) => {
    if (noticeTimerRef.current !== null) {
      window.clearTimeout(noticeTimerRef.current);
    }
    setAdNotice(message);
    noticeTimerRef.current = window.setTimeout(() => {
      noticeTimerRef.current = null;
      setAdNotice(null);
    }, 3400);
  }, []);

  useEffect(() => {
    void initializeAdMob();
    if (Capacitor.isNativePlatform()) {
      ScreenOrientation.lock({ orientation: 'portrait' }).catch(() => {
        // Orientation is also locked natively in AndroidManifest.xml
      });
    }
    return () => {
      if (noticeTimerRef.current !== null) {
        window.clearTimeout(noticeTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    feedback.updateSettings(settings);
    try {
      localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
    } catch {
      // Ignore storage errors
    }
  }, [settings]);

  useEffect(() => {
    try {
      localStorage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(progress));
    } catch {
      // Ignore storage errors
    }
  }, [progress]);

  const navigateTo = useCallback((screen: ScreenView) => {
    feedback.unlock();
    feedback.playTap();
    setCurrentScreen(screen);
  }, []);

  const handleLevelComplete = useCallback(() => {
    setProgress((prev) => {
      const nextLevel = prev.currentLevel + 1;
      return {
        ...prev,
        currentLevel: nextLevel,
        highestUnlockedLevel: Math.max(prev.highestUnlockedLevel, nextLevel),
      };
    });
  }, []);

  const handleConsumeHint = useCallback((): boolean => {
    if (progress.hints <= 0) return false;
    setProgress((prev) => ({
      ...prev,
      hints: Math.max(0, prev.hints - 1),
    }));
    return true;
  }, [progress.hints]);

  const handleGrantHint = useCallback((amount = 1) => {
    feedback.unlock();
    feedback.playReward();
    setProgress((prev) => ({
      ...prev,
      hints: prev.hints + amount,
    }));
  }, []);

  const handleRequestAd = useCallback(
    async (placement: AdPlacement, onRewarded: () => void) => {
      if (adBusyRef.current) return;

      feedback.unlock();
      feedback.playTap();

      if (placement === 'interstitial_level') {
        if (!isAdMobSupported()) {
          // Never block level progression in browser preview
          onRewarded();
          return;
        }
        adBusyRef.current = true;
        setAdBusy(true);
        try {
          await showInterstitialAd();
        } catch {
          // Never block level progression on ad failure
        } finally {
          adBusyRef.current = false;
          setAdBusy(false);
          onRewarded();
        }
        return;
      }

      // Rewarded ad placements: NEVER grant reward unless AdMob SDK confirms reward earned
      adBusyRef.current = true;
      setAdBusy(true);
      try {
        const result = await showRewardedAd();
        adBusyRef.current = false;
        setAdBusy(false);

        if (result.rewarded === true) {
          onRewarded();
        } else if (result.message) {
          showAdNotice(result.message);
        }
      } catch {
        adBusyRef.current = false;
        setAdBusy(false);
        showAdNotice('Ad could not be shown. No reward granted.');
      }
    },
    [showAdNotice]
  );

  const handleClaimDaily = useCallback((hintsEarned: number) => {
    const today = getTodayKey();
    feedback.unlock();
    feedback.playReward();
    setProgress((prev) => {
      if (prev.lastDailyClaimDate === today) return prev;
      return {
        ...prev,
        hints: prev.hints + hintsEarned,
        lastDailyClaimDate: today,
        dailyStreak: prev.dailyStreak + 1,
      };
    });
  }, []);

  const handleResetProgress = useCallback(() => {
    feedback.playTap();
    setProgress(DEFAULT_PROGRESS);
    setCurrentScreen('home');
  }, []);

  return (
    <main className="flex h-dvh w-full items-center justify-center overflow-hidden bg-[#E6ECF5]">
      {/* Mobile-first strict 420px portrait phone frame */}
      <div className="relative h-full w-full max-w-[420px] overflow-hidden bg-[#F5F8FC] shadow-[0_24px_64px_-16px_rgba(15,23,42,0.22)] sm:h-[min(100dvh,860px)] sm:rounded-[32px] sm:border sm:border-slate-200">
        <AnimatePresence mode="wait">
          {currentScreen === 'home' && (
            <motion.div
              key="home"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
              className="h-full w-full"
            >
              <HomeScreen
                progress={progress}
                canClaimDaily={canClaimDaily}
                onPlay={() => navigateTo('game')}
                onOpenDaily={() => {
                  feedback.unlock();
                  feedback.playTap();
                  setDailyOpen(true);
                }}
                onOpenSettings={() => {
                  feedback.unlock();
                  feedback.playTap();
                  setSettingsOpen(true);
                }}
                onWatchFreeHintAd={() => {
                  void handleRequestAd('rewarded_hint', () => handleGrantHint(1));
                }}
              />
            </motion.div>
          )}

          {currentScreen === 'game' && (
            <motion.div
              key="game"
              initial={{ opacity: 0, x: 18 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -18 }}
              transition={{ duration: 0.2 }}
              className="h-full w-full"
            >
              <GameplayScreen
                level={progress.currentLevel}
                hints={progress.hints}
                onBackHome={() => navigateTo('home')}
                onOpenSettings={() => setSettingsOpen(true)}
                onConsumeHint={handleConsumeHint}
                onGrantHint={handleGrantHint}
                onRequestAd={(placement, cb) => {
                  void handleRequestAd(placement, cb);
                }}
                onLevelComplete={handleLevelComplete}
              />
            </motion.div>
          )}
        </AnimatePresence>

        <SettingsModal
          open={settingsOpen}
          settings={settings}
          onUpdateSettings={(next) => {
            feedback.playTap();
            setSettings(next);
          }}
          onResetProgress={handleResetProgress}
          onClose={() => setSettingsOpen(false)}
        />

        <DailyBonusModal
          open={dailyOpen}
          canClaim={canClaimDaily}
          streak={progress.dailyStreak}
          onClaim={handleClaimDaily}
          onClose={() => setDailyOpen(false)}
        />

        {adBusy && (
          <div className="absolute inset-0 z-40 flex items-center justify-center bg-slate-900/30 backdrop-blur-[1px]">
            <div className="flex items-center gap-2.5 rounded-2xl bg-white px-5 py-3.5 text-sm font-bold text-slate-900 shadow-xl">
              <Loader2 className="h-4 w-4 animate-spin text-[#2589FF]" />
              <span>Loading ad...</span>
            </div>
          </div>
        )}

        <AnimatePresence>
          {adNotice && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              transition={{ duration: 0.18 }}
              className="pointer-events-none absolute right-5 bottom-10 left-5 z-50 flex justify-center"
            >
              <div className="max-w-[340px] rounded-2xl bg-slate-900/92 px-4 py-2.5 text-center text-xs font-semibold leading-relaxed text-white shadow-lg">
                {adNotice}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </main>
  );
}
