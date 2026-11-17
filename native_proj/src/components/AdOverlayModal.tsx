import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Animated,
  Easing,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
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
} from 'lucide-react-native';
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
  colors: [string, string];
  accent: string;
}

const SPONSORS: SponsorCreative[] = [
  {
    id: 'cube-flow',
    title: 'Cube Flow 3D',
    subtitle: 'Unblock colorful sliding paths across 1,000+ handcrafted boards.',
    rating: '4.8',
    downloads: '10M+ Plays',
    colors: ['#2563EB', '#0EA5E9'],
    accent: '#38BDF8',
  },
  {
    id: 'zen-sort',
    title: 'Zen Grid Sort',
    subtitle: 'Relaxing logic puzzles with crisp tactile haptics and zero timers.',
    rating: '4.9',
    downloads: '5M+ Plays',
    colors: ['#059669', '#10B981'],
    accent: '#34D399',
  },
  {
    id: 'tile-studio',
    title: 'Pathway Classic',
    subtitle: 'Train spatial focus every day with endless spatial brain teasers.',
    rating: '4.7',
    downloads: '8M+ Plays',
    colors: ['#D97706', '#F59E0B'],
    accent: '#FBBF24',
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
 * Full-screen Simulated Ad Player (Rewarded & Interstitial) for React Native.
 * Acts as a clean drop-in UI stand-in until native AdMob SDK is linked.
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

  const progressAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    if (!visible) return;
    setSecondsLeft(meta.durationSec);
    setConfirmEarlyExit(false);
    setSponsorIdx((prev) => (prev + 1) % SPONSORS.length);

    progressAnim.setValue(0);
    const barAnim = Animated.timing(progressAnim, {
      toValue: 1,
      duration: meta.durationSec * 1000,
      easing: Easing.linear,
      useNativeDriver: false,
    });
    barAnim.start();

    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.04,
          duration: 1000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1000,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );
    pulseLoop.start();

    const interval = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          clearInterval(interval);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      clearInterval(interval);
      barAnim.stop();
      pulseLoop.stop();
    };
  }, [visible, meta.durationSec, progressAnim, pulseAnim]);

  const sponsor = SPONSORS[sponsorIdx];
  const isReady = secondsLeft <= 0;

  const handleClosePress = () => {
    if (isReady && placement) {
      onComplete(placement);
      return;
    }
    if (!meta.isRewarded) {
      return;
    }
    setConfirmEarlyExit(true);
  };

  const progressWidth = progressAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0%', '100%'],
  });

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
      onRequestClose={handleClosePress}
    >
      <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
        {/* Top Ad Bar */}
        <View style={styles.topBar}>
          <View style={styles.adTagRow}>
            <View style={styles.adBadge}>
              <Text style={styles.adBadgeText}>AD</Text>
            </View>
            <Text style={styles.kindLabel}>{meta.kindLabel}</Text>
          </View>

          <View style={styles.topRightRow}>
            <View
              style={[
                styles.timerPill,
                isReady ? styles.timerPillReady : styles.timerPillCounting,
              ]}
            >
              {isReady ? (
                <>
                  <CheckCircle2 size={14} color="#34D399" strokeWidth={2.5} />
                  <Text style={styles.timerReadyText}>
                    {meta.isRewarded ? 'Reward Ready' : 'Ready'}
                  </Text>
                </>
              ) : (
                <Text style={styles.timerCountText}>
                  {meta.isRewarded
                    ? `Reward in ${secondsLeft}s`
                    : `Continue in ${secondsLeft}s`}
                </Text>
              )}
            </View>

            {(isReady || meta.isRewarded) && (
              <TouchableOpacity
                activeOpacity={0.8}
                onPress={handleClosePress}
                accessibilityLabel={isReady ? 'Claim and close ad' : 'Close ad'}
                style={[styles.closeBtn, isReady && styles.closeBtnReady]}
              >
                <X size={18} color={isReady ? '#0F172A' : '#CBD5E1'} strokeWidth={2.5} />
              </TouchableOpacity>
            )}
          </View>
        </View>

        {/* Reward Context Banner */}
        <View style={styles.rewardBanner}>
          <View style={styles.rewardIconBox}>
            {placement === 'rewarded_revive' ? (
              <Heart size={20} color="#F43F5E" fill="#F43F5E" />
            ) : placement === 'interstitial_level' ? (
              <Sparkles size={20} color="#38BDF8" />
            ) : (
              <Lightbulb size={20} color="#FBBF24" />
            )}
          </View>
          <View style={styles.rewardTextCol}>
            <Text style={styles.rewardBannerTitle}>{meta.rewardTitle}</Text>
            <Text style={styles.rewardBannerSub}>{meta.rewardHint}</Text>
          </View>
        </View>

        {/* Center Sponsored Creative Showcase */}
        <View style={styles.centerStage}>
          <Animated.View
            style={[styles.creativeCard, { transform: [{ scale: pulseAnim }] }]}
          >
            <LinearGradient
              colors={sponsor.colors}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={styles.creativeArt}
            >
              <View style={styles.creativeIconCircle}>
                <Layers size={40} color="#FFFFFF" strokeWidth={2.2} />
              </View>
              <View style={styles.creativePlayRow}>
                <Play size={14} color="#FFFFFF" fill="#FFFFFF" />
                <Text style={styles.creativePreviewTag}>INTERACTIVE PREVIEW</Text>
              </View>
            </LinearGradient>

            <View style={styles.creativeBody}>
              <Text style={styles.sponsorTitle}>{sponsor.title}</Text>
              <Text style={styles.sponsorSub}>{sponsor.subtitle}</Text>

              <View style={styles.sponsorMetaRow}>
                <View style={styles.ratingRow}>
                  <Star size={14} color="#FBBF24" fill="#FBBF24" />
                  <Text style={styles.sponsorMetaText}>{sponsor.rating}</Text>
                </View>
                <Text style={styles.metaDot}>·</Text>
                <Text style={styles.sponsorMetaText}>{sponsor.downloads}</Text>
                <Text style={styles.metaDot}>·</Text>
                <Text style={styles.sponsorFreeText}>Free</Text>
              </View>
            </View>
          </Animated.View>
        </View>

        {/* Early Exit Guard Strip (only if tapped X mid-rewarded ad) */}
        {confirmEarlyExit && !isReady && (
          <View style={styles.earlyExitBox}>
            <Text style={styles.earlyExitTitle}>
              Watch until the timer ends to earn your reward.
            </Text>
            <View style={styles.earlyExitActions}>
              <TouchableOpacity
                activeOpacity={0.85}
                onPress={() => setConfirmEarlyExit(false)}
                style={styles.keepWatchingBtn}
              >
                <Text style={styles.keepWatchingText}>Keep Watching</Text>
              </TouchableOpacity>
              <TouchableOpacity
                activeOpacity={0.85}
                onPress={() => {
                  setConfirmEarlyExit(false);
                  onSkipOrClose();
                }}
                style={styles.leaveNoRewardBtn}
              >
                <Text style={styles.leaveNoRewardText}>Exit (No Reward)</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Bottom Progress & Claim Action */}
        <View style={styles.footer}>
          <View style={styles.progressTrack}>
            <Animated.View
              style={[
                styles.progressFill,
                {
                  width: progressWidth,
                  backgroundColor: isReady ? '#10B981' : '#38BDF8',
                },
              ]}
            />
          </View>

          <TouchableOpacity
            activeOpacity={isReady ? 0.9 : 1}
            disabled={!isReady}
            onPress={() => {
              if (isReady && placement) {
                onComplete(placement);
              }
            }}
            style={[
              styles.claimCta,
              isReady ? styles.claimCtaReady : styles.claimCtaLocked,
            ]}
          >
            <Text
              style={[
                styles.claimCtaText,
                !isReady && styles.claimCtaTextLocked,
              ]}
            >
              {isReady
                ? meta.ctaLabel
                : `Please wait ${secondsLeft}s…`}
            </Text>
          </TouchableOpacity>

          <View style={styles.sdkNoteRow}>
            <ShieldCheck size={13} color="#64748B" />
            <Text style={styles.sdkNoteText}>
              Simulated Ad Screen · Ready for AdMob integration
            </Text>
          </View>
        </View>
      </SafeAreaView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0B1120',
    paddingHorizontal: 20,
    paddingVertical: 14,
    justifyContent: 'space-between',
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  adTagRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  adBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 6,
    backgroundColor: '#F59E0B',
  },
  adBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    color: '#0F172A',
    letterSpacing: 0.6,
  },
  kindLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#94A3B8',
  },
  topRightRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  timerPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 999,
    borderWidth: 1,
  },
  timerPillCounting: {
    backgroundColor: 'rgba(30, 41, 59, 0.9)',
    borderColor: 'rgba(71, 85, 105, 0.8)',
  },
  timerPillReady: {
    backgroundColor: 'rgba(16, 185, 129, 0.16)',
    borderColor: 'rgba(52, 211, 153, 0.45)',
  },
  timerCountText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#E2E8F0',
    fontVariant: ['tabular-nums'],
  },
  timerReadyText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#34D399',
  },
  closeBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: 'rgba(30, 41, 59, 0.85)',
    borderWidth: 1,
    borderColor: 'rgba(71, 85, 105, 0.8)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeBtnReady: {
    backgroundColor: '#FFFFFF',
    borderColor: '#FFFFFF',
  },
  rewardBanner: {
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 16,
    backgroundColor: 'rgba(30, 41, 59, 0.72)',
    borderWidth: 1,
    borderColor: 'rgba(51, 65, 85, 0.9)',
  },
  rewardIconBox: {
    width: 40,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  rewardTextCol: {
    flex: 1,
  },
  rewardBannerTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#F8FAFC',
  },
  rewardBannerSub: {
    marginTop: 2,
    fontSize: 12,
    color: '#94A3B8',
  },
  centerStage: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingVertical: 16,
  },
  creativeCard: {
    width: '100%',
    maxWidth: 340,
    borderRadius: 24,
    backgroundColor: '#1E293B',
    borderWidth: 1,
    borderColor: '#334155',
    overflow: 'hidden',
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.4,
    shadowRadius: 28,
    elevation: 10,
  },
  creativeArt: {
    height: 196,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 14,
  },
  creativeIconCircle: {
    width: 82,
    height: 82,
    borderRadius: 24,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    borderWidth: 1.5,
    borderColor: 'rgba(255, 255, 255, 0.35)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  creativePlayRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: 'rgba(15, 23, 42, 0.38)',
  },
  creativePreviewTag: {
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 0.8,
    color: '#FFFFFF',
  },
  creativeBody: {
    padding: 20,
  },
  sponsorTitle: {
    fontSize: 20,
    fontWeight: '800',
    color: '#F8FAFC',
  },
  sponsorSub: {
    marginTop: 6,
    fontSize: 13,
    lineHeight: 19,
    color: '#CBD5E1',
  },
  sponsorMetaRow: {
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  ratingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  sponsorMetaText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#E2E8F0',
  },
  metaDot: {
    fontSize: 12,
    color: '#64748B',
  },
  sponsorFreeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#34D399',
  },
  earlyExitBox: {
    marginBottom: 12,
    borderRadius: 16,
    backgroundColor: 'rgba(244, 63, 94, 0.14)',
    borderWidth: 1,
    borderColor: 'rgba(244, 63, 94, 0.45)',
    padding: 14,
    gap: 10,
  },
  earlyExitTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#FFE4E6',
    textAlign: 'center',
  },
  earlyExitActions: {
    flexDirection: 'row',
    gap: 10,
  },
  keepWatchingBtn: {
    flex: 1,
    height: 40,
    borderRadius: 12,
    backgroundColor: '#10B981',
    alignItems: 'center',
    justifyContent: 'center',
  },
  keepWatchingText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  leaveNoRewardBtn: {
    flex: 1,
    height: 40,
    borderRadius: 12,
    backgroundColor: 'rgba(15, 23, 42, 0.75)',
    borderWidth: 1,
    borderColor: 'rgba(148, 163, 184, 0.4)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  leaveNoRewardText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#E2E8F0',
  },
  footer: {
    gap: 12,
  },
  progressTrack: {
    height: 6,
    width: '100%',
    borderRadius: 3,
    backgroundColor: '#1E293B',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 3,
  },
  claimCta: {
    height: 54,
    width: '100%',
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  claimCtaReady: {
    backgroundColor: '#10B981',
    shadowColor: '#10B981',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.35,
    shadowRadius: 14,
    elevation: 6,
  },
  claimCtaLocked: {
    backgroundColor: '#1E293B',
    borderWidth: 1,
    borderColor: '#334155',
  },
  claimCtaText: {
    fontSize: 15,
    fontWeight: '800',
    color: '#FFFFFF',
    letterSpacing: 0.4,
  },
  claimCtaTextLocked: {
    color: '#94A3B8',
  },
  sdkNoteRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingBottom: 4,
  },
  sdkNoteText: {
    fontSize: 11,
    color: '#64748B',
  },
});
