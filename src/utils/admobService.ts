import { Capacitor, type PluginListenerHandle } from '@capacitor/core';
import {
  AdMob,
  InterstitialAdPluginEvents,
  MaxAdContentRating,
  RewardAdPluginEvents,
} from '@capacitor-community/admob';

export type RewardedAdReason =
  | 'earned'
  | 'dismissed_early'
  | 'load_failed'
  | 'show_failed'
  | 'busy'
  | 'unavailable';

export interface RewardedAdResult {
  rewarded: boolean;
  reason: RewardedAdReason;
  message?: string;
}

export interface InterstitialAdResult {
  shown: boolean;
}

// Official Google AdMob Test Ad Unit IDs (safe for development & testing)
const ANDROID_TEST_REWARDED_ID = 'ca-app-pub-3940256099942544/5224354917';
const IOS_TEST_REWARDED_ID = 'ca-app-pub-3940256099942544/1712485313';
const ANDROID_TEST_INTERSTITIAL_ID = 'ca-app-pub-3940256099942544/1033173712';
const IOS_TEST_INTERSTITIAL_ID = 'ca-app-pub-3940256099942544/4411468910';

const REWARDED_LOAD_TIMEOUT_MS = 12000;
const INTERSTITIAL_LOAD_TIMEOUT_MS = 3500;
const AD_OPEN_TIMEOUT_MS = 8000;
const SDK_INIT_WAIT_MS = 4000;

let sdkInitialized = false;
let initPromise: Promise<boolean> | null = null;
let activeAdSession = false;
let rewardedPrepared = false;
let rewardedPrepPromise: Promise<boolean> | null = null;
let interstitialPrepared = false;
let interstitialPrepPromise: Promise<boolean> | null = null;

function isNativeAdMobAvailable(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

export function isAdMobSupported(): boolean {
  return isNativeAdMobAvailable();
}

function getRewardedUnitId(): string {
  return Capacitor.getPlatform() === 'ios'
    ? IOS_TEST_REWARDED_ID
    : ANDROID_TEST_REWARDED_ID;
}

function getInterstitialUnitId(): string {
  return Capacitor.getPlatform() === 'ios'
    ? IOS_TEST_INTERSTITIAL_ID
    : ANDROID_TEST_INTERSTITIAL_ID;
}

function waitWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  fallbackValue: T
): Promise<T> {
  return new Promise<T>((resolve) => {
    let settled = false;
    const timer = window.setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(fallbackValue);
    }, timeoutMs);

    promise
      .then((value) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        resolve(value);
      })
      .catch(() => {
        if (settled) return;
        settled = true;
        window.clearTimeout(timer);
        resolve(fallbackValue);
      });
  });
}

async function removeListeners(
  handles: Array<PluginListenerHandle | null>
): Promise<void> {
  await Promise.all(
    handles.map((h) =>
      h
        ? h.remove().catch(() => {
            // Best-effort cleanup
          })
        : Promise.resolve()
    )
  );
}

function preloadRewardedAd(): Promise<boolean> {
  if (!isNativeAdMobAvailable() || !sdkInitialized) {
    return Promise.resolve(false);
  }
  if (rewardedPrepared) {
    return Promise.resolve(true);
  }
  if (rewardedPrepPromise) {
    return rewardedPrepPromise;
  }

  rewardedPrepPromise = AdMob.prepareRewardVideoAd({
    adId: getRewardedUnitId(),
    isTesting: true,
    npa: true,
  })
    .then(() => {
      rewardedPrepared = true;
      return true;
    })
    .catch(() => {
      rewardedPrepared = false;
      return false;
    })
    .finally(() => {
      rewardedPrepPromise = null;
    });

  return rewardedPrepPromise;
}

function preloadInterstitialAd(): Promise<boolean> {
  if (!isNativeAdMobAvailable() || !sdkInitialized) {
    return Promise.resolve(false);
  }
  if (interstitialPrepared) {
    return Promise.resolve(true);
  }
  if (interstitialPrepPromise) {
    return interstitialPrepPromise;
  }

  interstitialPrepPromise = AdMob.prepareInterstitial({
    adId: getInterstitialUnitId(),
    isTesting: true,
    npa: true,
  })
    .then(() => {
      interstitialPrepared = true;
      return true;
    })
    .catch(() => {
      interstitialPrepared = false;
      return false;
    })
    .finally(() => {
      interstitialPrepPromise = null;
    });

  return interstitialPrepPromise;
}

/**
 * Initializes @capacitor-community/admob on native Capacitor builds (Android/iOS)
 * using official Google AdMob test mode, and warms Rewarded + Interstitial ads.
 * Safe no-op on desktop/mobile web browsers.
 */
export function initializeAdMob(): Promise<boolean> {
  if (!isNativeAdMobAvailable()) {
    return Promise.resolve(false);
  }
  if (sdkInitialized) {
    return Promise.resolve(true);
  }
  if (initPromise) {
    return initPromise;
  }

  initPromise = (async () => {
    try {
      await AdMob.initialize({
        initializeForTesting: true,
        tagForChildDirectedTreatment: false,
        tagForUnderAgeOfConsent: false,
        maxAdContentRating: MaxAdContentRating.General,
      });
      sdkInitialized = true;
      void preloadRewardedAd();
      void preloadInterstitialAd();
      return true;
    } catch {
      initPromise = null;
      return false;
    }
  })();

  return initPromise;
}

/**
 * Presents a real Google AdMob Test Rewarded Ad on Capacitor Android/iOS.
 *
 * STRICT REWARD GUARANTEE:
 * - On web browsers (`!Capacitor.isNativePlatform()`), ALWAYS returns
 *   `{ rewarded: false, reason: 'unavailable' }` — never grants fake rewards.
 * - On native builds, resolves `{ rewarded: true }` ONLY when the native SDK
 *   fires `RewardAdPluginEvents.Rewarded` AND after `RewardAdPluginEvents.Dismissed`.
 * - Early dismiss, load failure, offline state, timeout, or show error NEVER grants a reward.
 */
export async function showRewardedAd(): Promise<RewardedAdResult> {
  if (!isNativeAdMobAvailable()) {
    return {
      rewarded: false,
      reason: 'unavailable',
      message:
        'AdMob test ads are available on Android/iOS app builds (unavailable in web browser).',
    };
  }

  if (activeAdSession) {
    return {
      rewarded: false,
      reason: 'busy',
      message: 'An ad is already in progress.',
    };
  }

  activeAdSession = true;
  const handles: Array<PluginListenerHandle | null> = [];

  try {
    const initialized = await waitWithTimeout(
      initializeAdMob(),
      SDK_INIT_WAIT_MS,
      false
    );
    if (!initialized) {
      return {
        rewarded: false,
        reason: 'load_failed',
        message: 'Ad service could not initialize. Please try again.',
      };
    }

    if (!rewardedPrepared) {
      const loaded = await waitWithTimeout(
        preloadRewardedAd(),
        REWARDED_LOAD_TIMEOUT_MS,
        false
      );
      if (!loaded) {
        return {
          rewarded: false,
          reason: 'load_failed',
          message:
            'Ad could not load. Check your internet connection and try again.',
        };
      }
    }

    rewardedPrepared = false;

    return await new Promise<RewardedAdResult>((resolve) => {
      let settled = false;
      let opened = false;
      let earnedReward = false;

      const openTimeout = window.setTimeout(() => {
        if (!opened) {
          finish({
            rewarded: false,
            reason: 'show_failed',
            message: 'Ad did not open in time. No reward granted.',
          });
        }
      }, AD_OPEN_TIMEOUT_MS);

      const finish = (result: RewardedAdResult) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(openTimeout);
        resolve(result);
      };

      (async () => {
        try {
          handles.push(
            await AdMob.addListener(RewardAdPluginEvents.Showed, () => {
              opened = true;
              window.clearTimeout(openTimeout);
            })
          );

          handles.push(
            await AdMob.addListener(
              RewardAdPluginEvents.Rewarded,
              (reward) => {
                if (
                  reward != null &&
                  (typeof reward.amount !== 'number' || reward.amount > 0)
                ) {
                  earnedReward = true;
                }
              }
            )
          );

          handles.push(
            await AdMob.addListener(RewardAdPluginEvents.Dismissed, () => {
              if (earnedReward) {
                finish({ rewarded: true, reason: 'earned' });
              } else {
                finish({
                  rewarded: false,
                  reason: 'dismissed_early',
                  message: 'Watch the full ad to earn your reward.',
                });
              }
            })
          );

          handles.push(
            await AdMob.addListener(RewardAdPluginEvents.FailedToShow, () => {
              finish({
                rewarded: false,
                reason: 'show_failed',
                message: 'Ad failed to play. No reward granted.',
              });
            })
          );

          await AdMob.showRewardVideoAd();
        } catch (err: unknown) {
          const errObj = err as { code?: string; message?: string } | null;
          const code = String(errObj?.code ?? '').toUpperCase();
          const msg = String(errObj?.message ?? '').toLowerCase();
          if (
            code.includes('CANCEL') ||
            msg.includes('dismissed') ||
            msg.includes('cancel')
          ) {
            finish({
              rewarded: false,
              reason: 'dismissed_early',
              message: 'Watch the full ad to earn your reward.',
            });
          } else {
            finish({
              rewarded: false,
              reason: 'show_failed',
              message: 'Ad could not be displayed. Please try again.',
            });
          }
        }
      })();
    });
  } finally {
    await removeListeners(handles);
    activeAdSession = false;
    window.setTimeout(() => {
      if (!activeAdSession) {
        void preloadRewardedAd();
      }
    }, 900);
  }
}

/**
 * Presents a real Google AdMob Test Interstitial Ad on Capacitor Android/iOS.
 * Always resolves cleanly without blocking level transitions on web or when offline.
 */
export async function showInterstitialAd(): Promise<InterstitialAdResult> {
  if (!isNativeAdMobAvailable() || activeAdSession) {
    return { shown: false };
  }

  activeAdSession = true;
  const handles: Array<PluginListenerHandle | null> = [];

  try {
    const initialized = await waitWithTimeout(
      initializeAdMob(),
      2000,
      false
    );
    if (!initialized) {
      return { shown: false };
    }

    if (!interstitialPrepared) {
      const loaded = await waitWithTimeout(
        preloadInterstitialAd(),
        INTERSTITIAL_LOAD_TIMEOUT_MS,
        false
      );
      if (!loaded) {
        return { shown: false };
      }
    }

    interstitialPrepared = false;

    return await new Promise<InterstitialAdResult>((resolve) => {
      let settled = false;
      let opened = false;

      const openTimeout = window.setTimeout(() => {
        if (!opened) {
          finish({ shown: false });
        }
      }, 6000);

      const finish = (result: InterstitialAdResult) => {
        if (settled) return;
        settled = true;
        window.clearTimeout(openTimeout);
        resolve(result);
      };

      (async () => {
        try {
          handles.push(
            await AdMob.addListener(InterstitialAdPluginEvents.Showed, () => {
              opened = true;
              window.clearTimeout(openTimeout);
            })
          );

          handles.push(
            await AdMob.addListener(InterstitialAdPluginEvents.Dismissed, () => {
              finish({ shown: true });
            })
          );

          handles.push(
            await AdMob.addListener(
              InterstitialAdPluginEvents.FailedToShow,
              () => {
                finish({ shown: false });
              }
            )
          );

          await AdMob.showInterstitial();
        } catch {
          finish({ shown: false });
        }
      })();
    });
  } finally {
    await removeListeners(handles);
    activeAdSession = false;
    window.setTimeout(() => {
      if (!activeAdSession) {
        void preloadInterstitialAd();
      }
    }, 1200);
  }
}
