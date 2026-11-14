import { useCallback, useEffect, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as SplashScreen from 'expo-splash-screen';
import { GameplayScreen } from './components/GameplayScreen';
import { HomeScreen } from './components/HomeScreen';
import { DailyBonusModal, SettingsModal } from './components/Modals';
import type { GameSettings, PlayerProgress, ScreenView } from './types/game';
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

  const canClaimDaily = progress.lastDailyClaimDate !== getTodayKey();

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
        />
      )}

      {currentScreen === 'game' && (
        <GameplayScreen
          level={progress.currentLevel}
          hints={progress.hints}
          onBackHome={() => navigateTo('home')}
          onOpenSettings={() => setSettingsOpen(true)}
          onConsumeHint={handleConsumeHint}
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F8FC',
  },
});
