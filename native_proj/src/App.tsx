import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SplashScreen from 'expo-splash-screen';
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

function sanitizeProgress(raw: string | null): PlayerProgress {
  if (!raw) return DEFAULT_PROGRESS;
  try {
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

export default function App() {
  const [hydrated, setHydrated] = useState(false);
  const [currentScreen, setCurrentScreen] = useState<ScreenView>('home');
  const [progress, setProgress] = useState<PlayerProgress>(DEFAULT_PROGRESS);
  const [settings, setSettings] = useState<GameSettings>(DEFAULT_SETTINGS);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [dailyOpen, setDailyOpen] = useState(false);
  const [adBusy, setAdBusy] = useState(false);
  const [adNotice, setAdNotice] = useState<string | null>(null);

  const adBusyRef = useRef(false);
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const canClaimDaily = progress.lastDailyClaimDate !== getTodayKey();

  const showAdNotice = useCallback((message: string) => {
    if (noticeTimerRef.current) {
      clearTimeout(noticeTimerRef.current);
    }
    setAdNotice(message);
    noticeTimerRef.current = setTimeout(() => {
      noticeTimerRef.current = null;
      setAdNotice(null);
    }, 3400);
  }, []);

  // Initialize Google AdMob SDK once on startup (safe no-op in Expo Go)
  useEffect(() => {
    void initializeAdMob();
    return () => {
      if (noticeTimerRef.current) {
        clearTimeout(noticeTimerRef.current);
      }
    };
  }, []);

  // Load persisted progress and settings from AsyncStorage on startup
  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const [rawProgress, rawSettings] = await Promise.all([
          AsyncStorage.getItem(PROGRESS_STORAGE_KEY),
          AsyncStorage.getItem(SETTINGS_STORAGE_KEY),
        ]);
        if (!active) return;
        setProgress(sanitizeProgress(rawProgress));
        if (rawSettings) {
          const parsedSettings = JSON.parse(rawSettings) as Partial<GameSettings>;
          setSettings({ ...DEFAULT_SETTINGS, ...parsedSettings });
        }
      } catch {
        // Fallback cleanly to defaults
      } finally {
        if (active) setHydrated(true);
      }
    })();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (hydrated) {
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [hydrated]);

  useEffect(() => {
    feedback.updateSettings(settings);
    if (!hydrated) return;
    AsyncStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings)).catch(
      () => {}
    );
  }, [settings, hydrated]);

  useEffect(() => {
    if (!hydrated) return;
    AsyncStorage.setItem(PROGRESS_STORAGE_KEY, JSON.stringify(progress)).catch(
      () => {}
    );
  }, [progress, hydrated]);

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
          // Never block level progression in Expo Go or unsupported runtimes
          onRewarded();
          return;
        }
        adBusyRef.current = true;
        setAdBusy(true);
        try {
          // Allow active RN Modal to dismiss cleanly before presenting native ad
          await new Promise((r) => setTimeout(r, 140));
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

      // Rewarded ad placements: NEVER grant reward unless SDK confirms completion
      adBusyRef.current = true;
      setAdBusy(true);
      try {
        if (isAdMobSupported()) {
          // Allow RN Modal (Level Complete / Out of Lives) to dismiss before native ad opens
          await new Promise((r) => setTimeout(r, 140));
        }
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

  if (!hydrated) {
    return <View style={styles.container} />;
  }

  return (
    <View style={styles.container}>
      {currentScreen === 'home' && (
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
      )}

      {currentScreen === 'game' && (
        <GameplayScreen
          level={progress.currentLevel}
          hints={progress.hints}
          isAdShowing={adBusy}
          onBackHome={() => navigateTo('home')}
          onOpenSettings={() => setSettingsOpen(true)}
          onConsumeHint={handleConsumeHint}
          onGrantHint={handleGrantHint}
          onRequestAd={(placement, cb) => {
            void handleRequestAd(placement, cb);
          }}
          onLevelComplete={handleLevelComplete}
        />
      )}

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
        <View style={styles.adLoadingBackdrop}>
          <View style={styles.adLoadingCard}>
            <ActivityIndicator size="small" color="#2589FF" />
            <Text style={styles.adLoadingText}>Loading ad...</Text>
          </View>
        </View>
      )}

      {adNotice && (
        <View pointerEvents="none" style={styles.toastWrap}>
          <View style={styles.toastCard}>
            <Text style={styles.toastText}>{adNotice}</Text>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F8FC',
  },
  adLoadingBackdrop: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: 'rgba(15, 23, 42, 0.32)',
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 40,
  },
  adLoadingCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderRadius: 16,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.16,
    shadowRadius: 16,
    elevation: 6,
  },
  adLoadingText: {
    fontSize: 14,
    fontWeight: '700',
    color: '#0F172A',
  },
  toastWrap: {
    position: 'absolute',
    left: 20,
    right: 20,
    bottom: 44,
    alignItems: 'center',
    zIndex: 50,
  },
  toastCard: {
    backgroundColor: 'rgba(15, 23, 42, 0.92)',
    paddingHorizontal: 16,
    paddingVertical: 11,
    borderRadius: 14,
    maxWidth: 340,
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.22,
    shadowRadius: 12,
    elevation: 6,
  },
  toastText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '600',
    textAlign: 'center',
    lineHeight: 18,
  },
});
