import { NativeModules, Platform, TurboModuleRegistry } from 'react-native';
import type * as GoogleMobileAdsNamespace from 'react-native-google-mobile-ads';

type GoogleMobileAdsSDK = typeof GoogleMobileAdsNamespace;
type RewardedAdInstance = GoogleMobileAdsNamespace.RewardedAd;
type InterstitialAdInstance = GoogleMobileAdsNamespace.InterstitialAd;

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

// Official Google AdMob Test Ad Unit IDs (safe for testing, zero policy risk)
const TEST_REWARDED_UNIT_ID = Platform.select({
  ios: 'ca-app-pub-3940256099942544/1712485313',
  android: 'ca-app-pub-3940256099942544/5224354917',
  default: 'ca-app-pub-3940256099942544/5224354917',
});

const TEST_INTERSTITIAL_UNIT_ID = Platform.select({
  ios: 'ca-app-pub-3940256099942544/4411468910',
  android: 'ca-app-pub-3940256099942544/1033173712',
  default: 'ca-app-pub-3940256099942544/1033173712',
});

const REWARDED_LOAD_TIMEOUT_MS = 12000;
const INTERSTITIAL_LOAD_TIMEOUT_MS = 3500;
const AD_OPEN_TIMEOUT_MS = 8000;
const SDK_INIT_WAIT_MS = 4000;

let sdkCache: GoogleMobileAdsSDK | null | undefined = undefined;
let initPromise: Promise<boolean> | null = null;
let sdkInitialized = false;
let activeAdSession = false;

interface PreloadedSlot<T> {
  ad: T;
  cleanup: () => void;
  ready: boolean;
  loadingPromise: Promise<boolean>;
}

let rewardedSlot: PreloadedSlot<RewardedAdInstance> | null = null;
let interstitialSlot: PreloadedSlot<InterstitialAdInstance> | null = null;
let rewardedPreloadTimer: ReturnType<typeof setTimeout> | null = null;
let interstitialPreloadTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Checks if the native RNGoogleMobileAdsModule is linked in the binary BEFORE
 * calling require('react-native-google-mobile-ads').
 *
 * CRITICAL: react-native-google-mobile-ads v17 calls
 * TurboModuleRegistry.getEnforcing('RNGoogleMobileAdsModule') at module import
 * time, which would crash Expo Go if imported unconditionally.
 */
function hasNativeAdMobModule(): boolean {
  if (Platform.OS !== 'android' && Platform.OS !== 'ios') {
    return false;
  }
  try {
    const legacyModules = NativeModules as Record<string, unknown> | undefined;
    const hasTurbo =
      TurboModuleRegistry && typeof TurboModuleRegistry.get === 'function';

    const hasAdsModule =
      (hasTurbo && TurboModuleRegistry.get('RNGoogleMobileAdsModule') != null) ||
      Boolean(legacyModules?.RNGoogleMobileAdsModule);

    const hasAppModule =
      (hasTurbo && TurboModuleRegistry.get('RNAppModule') != null) ||
      Boolean(legacyModules?.RNAppModule);

    return hasAdsModule && hasAppModule;
  } catch {
    return false;
  }
}

function getAdMobSDK(): GoogleMobileAdsSDK | null {
  if (sdkCache !== undefined) {
    return sdkCache;
  }
  if (!hasNativeAdMobModule()) {
    sdkCache = null;
    return null;
  }
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('react-native-google-mobile-ads') as GoogleMobileAdsSDK;
    if (
      !mod ||
      typeof mod.default !== 'function' ||
      !mod.RewardedAd ||
      !mod.InterstitialAd
    ) {
      sdkCache = null;
      return null;
    }
    sdkCache = mod;
    return sdkCache;
  } catch {
    sdkCache = null;
    return null;
  }
}

export function isAdMobSupported(): boolean {
  return getAdMobSDK() !== null;
}

function safeDestroy(ad: { destroy?: () => void } | null | undefined): void {
  if (!ad) return;
  try {
    ad.destroy?.();
  } catch {
    // Best-effort native release
  }
}

function waitWithTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  fallbackValue: T
): Promise<T> {
  return new Promise<T>((resolve) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      resolve(fallbackValue);
    }, timeoutMs);

    promise
      .then((value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(value);
      })
      .catch(() => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve(fallbackValue);
      });
  });
}

function startRewardedPreload(): PreloadedSlot<RewardedAdInstance> | null {
  const sdk = getAdMobSDK();
  if (!sdk || !sdkInitialized) return null;

  if (rewardedSlot) {
    return rewardedSlot;
  }

  const unitId = sdk.TestIds?.REWARDED || TEST_REWARDED_UNIT_ID;
  let ad: RewardedAdInstance;
  try {
    ad = sdk.RewardedAd.createForAdRequest(unitId, {
      requestNonPersonalizedAdsOnly: true,
    });
  } catch {
    return null;
  }

  let unsubLoaded: (() => void) | null = null;
  let unsubError: (() => void) | null = null;
  let resolved = false;
  let resolveLoad!: (ok: boolean) => void;

  const loadingPromise = new Promise<boolean>((resolve) => {
    resolveLoad = resolve;
  });

  const cleanup = () => {
    try {
      unsubLoaded?.();
    } catch {
      // Ignore unsubscribe errors
    }
    try {
      unsubError?.();
    } catch {
      // Ignore unsubscribe errors
    }
    unsubLoaded = null;
    unsubError = null;
  };

  const slot: PreloadedSlot<RewardedAdInstance> = {
    ad,
    cleanup,
    ready: false,
    loadingPromise,
  };

  rewardedSlot = slot;

  try {
    unsubLoaded = ad.addAdEventListener(sdk.RewardedAdEventType.LOADED, () => {
      if (resolved) return;
      resolved = true;
      slot.ready = true;
      cleanup();
      resolveLoad(true);
    });

    unsubError = ad.addAdEventListener(sdk.AdEventType.ERROR, () => {
      if (resolved) return;
      resolved = true;
      slot.ready = false;
      cleanup();
      if (rewardedSlot === slot) {
        rewardedSlot = null;
      }
      safeDestroy(ad);
      resolveLoad(false);
    });

    ad.load();
  } catch {
    cleanup();
    if (rewardedSlot === slot) {
      rewardedSlot = null;
    }
    safeDestroy(ad);
    resolveLoad(false);
    return null;
  }

  return slot;
}

function startInterstitialPreload(): PreloadedSlot<InterstitialAdInstance> | null {
  const sdk = getAdMobSDK();
  if (!sdk || !sdkInitialized) return null;

  if (interstitialSlot) {
    return interstitialSlot;
  }

  const unitId = sdk.TestIds?.INTERSTITIAL || TEST_INTERSTITIAL_UNIT_ID;
  let ad: InterstitialAdInstance;
  try {
    ad = sdk.InterstitialAd.createForAdRequest(unitId, {
      requestNonPersonalizedAdsOnly: true,
    });
  } catch {
    return null;
  }

  let unsubLoaded: (() => void) | null = null;
  let unsubError: (() => void) | null = null;
  let resolved = false;
  let resolveLoad!: (ok: boolean) => void;

  const loadingPromise = new Promise<boolean>((resolve) => {
    resolveLoad = resolve;
  });

  const cleanup = () => {
    try {
      unsubLoaded?.();
    } catch {
      // Ignore
    }
    try {
      unsubError?.();
    } catch {
      // Ignore
    }
    unsubLoaded = null;
    unsubError = null;
  };

  const slot: PreloadedSlot<InterstitialAdInstance> = {
    ad,
    cleanup,
    ready: false,
    loadingPromise,
  };

  interstitialSlot = slot;

  try {
    unsubLoaded = ad.addAdEventListener(sdk.AdEventType.LOADED, () => {
      if (resolved) return;
      resolved = true;
      slot.ready = true;
      cleanup();
      resolveLoad(true);
    });

    unsubError = ad.addAdEventListener(sdk.AdEventType.ERROR, () => {
      if (resolved) return;
      resolved = true;
      slot.ready = false;
      cleanup();
      if (interstitialSlot === slot) {
        interstitialSlot = null;
      }
      safeDestroy(ad);
      resolveLoad(false);
    });

    ad.load();
  } catch {
    cleanup();
    if (interstitialSlot === slot) {
      interstitialSlot = null;
    }
    safeDestroy(ad);
    resolveLoad(false);
    return null;
  }

  return slot;
}

function scheduleRewardedPreload(delayMs = 900): void {
  if (rewardedPreloadTimer) {
    clearTimeout(rewardedPreloadTimer);
  }
  rewardedPreloadTimer = setTimeout(() => {
    rewardedPreloadTimer = null;
    if (!activeAdSession) {
      startRewardedPreload();
    }
  }, delayMs);
}

function scheduleInterstitialPreload(delayMs = 1200): void {
  if (interstitialPreloadTimer) {
    clearTimeout(interstitialPreloadTimer);
  }
  interstitialPreloadTimer = setTimeout(() => {
    interstitialPreloadTimer = null;
    if (!activeAdSession) {
      startInterstitialPreload();
    }
  }, delayMs);
}

/**
 * Initializes the Google Mobile Ads SDK once on native builds and warms
 * test rewarded & interstitial inventory in the background.
 * Safe no-op in Expo Go or web runtimes.
 */
export function initializeAdMob(): Promise<boolean> {
  if (sdkInitialized) {
    return Promise.resolve(true);
  }
  if (initPromise) {
    return initPromise;
  }

  const sdk = getAdMobSDK();
  if (!sdk) {
    return Promise.resolve(false);
  }

  initPromise = (async () => {
    try {
      const mobileAds = sdk.default();
      await mobileAds
        .setRequestConfiguration({
          maxAdContentRating: sdk.MaxAdContentRating.PG,
          tagForChildDirectedTreatment: false,
          tagForUnderAgeOfConsent: false,
        })
        .catch(() => {});

      await mobileAds.initialize();
      sdkInitialized = true;

      // Warm one rewarded ad and one interstitial ad in background
      startRewardedPreload();
      startInterstitialPreload();
      return true;
    } catch {
      initPromise = null;
      return false;
    }
  })();

  return initPromise;
}

/**
 * Presents a real Google AdMob Test Rewarded Ad.
 *
 * STRICT REWARD GUARANTEE:
 * - Resolves `{ rewarded: true }` ONLY when the Google Mobile Ads SDK fires
 *   `RewardedAdEventType.EARNED_REWARD` with a non-null reward payload AND
 *   after the fullscreen ad closes (`AdEventType.CLOSED`).
 * - If unavailable (Expo Go / Web), offline, timed out, failed to load/show,
 *   or dismissed early before completion, ALWAYS resolves `{ rewarded: false }`.
 */
export async function showRewardedAd(): Promise<RewardedAdResult> {
  const sdk = getAdMobSDK();
  if (!sdk) {
    return {
      rewarded: false,
      reason: 'unavailable',
      message:
        'AdMob test ads require an Android/iOS build (unavailable in Expo Go).',
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

    // Reuse preloaded slot or start loading a fresh test rewarded ad
    const slot = rewardedSlot ?? startRewardedPreload();
    if (!slot) {
      return {
        rewarded: false,
        reason: 'load_failed',
        message: 'Unable to request an ad right now. Please try again.',
      };
    }

    if (!slot.ready && !slot.ad.loaded) {
      const loaded = await waitWithTimeout(
        slot.loadingPromise,
        REWARDED_LOAD_TIMEOUT_MS,
        false
      );
      if (!loaded || !slot.ad.loaded) {
        slot.cleanup();
        if (rewardedSlot === slot) {
          rewardedSlot = null;
        }
        safeDestroy(slot.ad);
        scheduleRewardedPreload(2500);
        return {
          rewarded: false,
          reason: 'load_failed',
          message:
            'Ad could not load. Check your internet connection and try again.',
        };
      }
    }

    // Take exclusive ownership of the loaded ad instance
    slot.cleanup();
    if (rewardedSlot === slot) {
      rewardedSlot = null;
    }
    const ad = slot.ad;

    return await new Promise<RewardedAdResult>((resolve) => {
      let settled = false;
      let opened = false;
      let earnedReward = false;
      let unsubEarned: (() => void) | null = null;
      let unsubOpened: (() => void) | null = null;
      let unsubClosed: (() => void) | null = null;
      let unsubError: (() => void) | null = null;

      const openTimeout = setTimeout(() => {
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
        clearTimeout(openTimeout);
        try {
          unsubEarned?.();
        } catch {
          // Ignore
        }
        try {
          unsubOpened?.();
        } catch {
          // Ignore
        }
        try {
          unsubClosed?.();
        } catch {
          // Ignore
        }
        try {
          unsubError?.();
        } catch {
          // Ignore
        }
        safeDestroy(ad);
        resolve(result);
      };

      try {
        unsubOpened = ad.addAdEventListener(sdk.AdEventType.OPENED, () => {
          opened = true;
          clearTimeout(openTimeout);
        });

        unsubEarned = ad.addAdEventListener(
          sdk.RewardedAdEventType.EARNED_REWARD,
          (reward) => {
            // Only mark reward earned if SDK delivers a valid reward payload
            if (reward != null) {
              earnedReward = true;
            }
          }
        );

        unsubClosed = ad.addAdEventListener(sdk.AdEventType.CLOSED, () => {
          if (earnedReward) {
            finish({ rewarded: true, reason: 'earned' });
          } else {
            finish({
              rewarded: false,
              reason: 'dismissed_early',
              message: 'Watch the full ad to earn your reward.',
            });
          }
        });

        unsubError = ad.addAdEventListener(sdk.AdEventType.ERROR, () => {
          finish({
            rewarded: false,
            reason: 'show_failed',
            message: 'Ad failed to play. No reward granted.',
          });
        });

        ad.show().catch(() => {
          finish({
            rewarded: false,
            reason: 'show_failed',
            message: 'Ad could not be displayed. Please try again.',
          });
        });
      } catch {
        finish({
          rewarded: false,
          reason: 'show_failed',
          message: 'Ad could not be displayed. Please try again.',
        });
      }
    });
  } finally {
    activeAdSession = false;
    scheduleRewardedPreload(900);
  }
}

/**
 * Presents a real Google AdMob Test Interstitial Ad between levels.
 * Always resolves cleanly so level progression is never blocked if offline,
 * in Expo Go, or if an ad fails to fill within a short grace period.
 */
export async function showInterstitialAd(): Promise<InterstitialAdResult> {
  const sdk = getAdMobSDK();
  if (!sdk || activeAdSession) {
    return { shown: false };
  }

  activeAdSession = true;

  try {
    const initialized = await waitWithTimeout(
      initializeAdMob(),
      2000,
      false
    );
    if (!initialized) {
      return { shown: false };
    }

    const slot = interstitialSlot ?? startInterstitialPreload();
    if (!slot) {
      return { shown: false };
    }

    if (!slot.ready && !slot.ad.loaded) {
      const loaded = await waitWithTimeout(
        slot.loadingPromise,
        INTERSTITIAL_LOAD_TIMEOUT_MS,
        false
      );
      if (!loaded || !slot.ad.loaded) {
        // Don't destroy if still loading in background; let it finish for next level
        return { shown: false };
      }
    }

    slot.cleanup();
    if (interstitialSlot === slot) {
      interstitialSlot = null;
    }
    const ad = slot.ad;

    return await new Promise<InterstitialAdResult>((resolve) => {
      let settled = false;
      let opened = false;
      let unsubOpened: (() => void) | null = null;
      let unsubClosed: (() => void) | null = null;
      let unsubError: (() => void) | null = null;

      const openTimeout = setTimeout(() => {
        if (!opened) {
          finish({ shown: false });
        }
      }, 6000);

      const finish = (result: InterstitialAdResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(openTimeout);
        try {
          unsubOpened?.();
        } catch {
          // Ignore
        }
        try {
          unsubClosed?.();
        } catch {
          // Ignore
        }
        try {
          unsubError?.();
        } catch {
          // Ignore
        }
        safeDestroy(ad);
        resolve(result);
      };

      try {
        unsubOpened = ad.addAdEventListener(sdk.AdEventType.OPENED, () => {
          opened = true;
          clearTimeout(openTimeout);
        });

        unsubClosed = ad.addAdEventListener(sdk.AdEventType.CLOSED, () => {
          finish({ shown: true });
        });

        unsubError = ad.addAdEventListener(sdk.AdEventType.ERROR, () => {
          finish({ shown: false });
        });

        ad.show().catch(() => {
          finish({ shown: false });
        });
      } catch {
        finish({ shown: false });
      }
    });
  } finally {
    activeAdSession = false;
    scheduleInterstitialPreload(1200);
  }
}
