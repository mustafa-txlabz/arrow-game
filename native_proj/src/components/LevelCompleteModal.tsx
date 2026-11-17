import { useEffect, useRef } from 'react';
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
  ArrowRight,
  Check,
  Heart,
  Home,
  Navigation2,
  Star,
  Trophy,
  Video,
} from 'lucide-react-native';
import type { Difficulty } from '../types/game';
import { ConfettiBurst } from './ConfettiBurst';

interface LevelCompleteModalProps {
  visible: boolean;
  isAdShowing?: boolean;
  level: number;
  lives: number;
  totalArrows: number;
  gridSize: number;
  difficulty: Difficulty;
  confettiKey: number;
  bonusClaimed?: boolean;
  onWatchBonusAd?: () => void;
  onNextLevel: () => void;
  onBackHome: () => void;
}

/**
 * Full-screen studio Victory Celebration screen inspired by classic Arrow Escape:
 * - Soft ambient glow backdrop with live confetti burst
 * - Pulsing emerald victory trophy emblem + staggered 3-star rating based on lives left
 * - Minimalist 3-stat run summary (Arrows, Lives, Board Tier)
 * - Primary gradient Next Level CTA + distinct neutral Home secondary CTA
 */
export function LevelCompleteModal({
  visible,
  isAdShowing = false,
  level,
  lives,
  totalArrows,
  gridSize,
  difficulty,
  confettiKey,
  bonusClaimed = false,
  onWatchBonusAd,
  onNextLevel,
  onBackHome,
}: LevelCompleteModalProps) {
  const cardScale = useRef(new Animated.Value(0.88)).current;
  const cardOpacity = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;
  const star1 = useRef(new Animated.Value(0)).current;
  const star2 = useRef(new Animated.Value(0)).current;
  const star3 = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) {
      cardScale.setValue(0.88);
      cardOpacity.setValue(0);
      star1.setValue(0);
      star2.setValue(0);
      star3.setValue(0);
      return;
    }

    Animated.parallel([
      Animated.spring(cardScale, {
        toValue: 1,
        friction: 7,
        tension: 65,
        useNativeDriver: true,
      }),
      Animated.timing(cardOpacity, {
        toValue: 1,
        duration: 240,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
    ]).start();

    Animated.stagger(120, [
      Animated.spring(star1, {
        toValue: 1,
        friction: 5,
        tension: 90,
        useNativeDriver: true,
      }),
      Animated.spring(star2, {
        toValue: 1,
        friction: 5,
        tension: 90,
        useNativeDriver: true,
      }),
      Animated.spring(star3, {
        toValue: 1,
        friction: 5,
        tension: 90,
        useNativeDriver: true,
      }),
    ]).start();

    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.07,
          duration: 1200,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1200,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );
    loop.start();

    return () => {
      loop.stop();
    };
  }, [visible, cardOpacity, cardScale, pulseAnim, star1, star2, star3]);

  const headline =
    lives >= 3 ? 'PERFECT CLEAR!' : lives === 2 ? 'GREAT JOB!' : 'LEVEL CLEARED!';

  const starAnims = [star1, star2, star3];

  return (
    <Modal visible={visible && !isAdShowing} transparent animationType="fade">
      <View style={styles.overlay}>
        <View pointerEvents="none" style={styles.topGlow} />
        <View pointerEvents="none" style={styles.bottomGlow} />

        <SafeAreaView style={styles.safeWrap} edges={['top', 'bottom']}>
          <Animated.View
            style={[
              styles.content,
              {
                opacity: cardOpacity,
                transform: [{ scale: cardScale }],
              },
            ]}
          >
            {/* Pulsing Victory Emblem */}
            <View style={styles.emblemWrap}>
              <Animated.View
                style={[
                  styles.emblemHaloOuter,
                  { transform: [{ scale: pulseAnim }] },
                ]}
              />
              <View style={styles.emblemHaloInner} />
              <LinearGradient
                colors={['#34D399', '#10B981', '#059669']}
                start={{ x: 0, y: 0 }}
                end={{ x: 1, y: 1 }}
                style={styles.emblemCircle}
              >
                <Trophy size={38} color="#FFFFFF" strokeWidth={2.2} />
              </LinearGradient>
            </View>

            {/* Staggered 3-Star Rating */}
            <View style={styles.starsRow}>
              {[0, 1, 2].map((idx) => {
                const earned = idx < lives;
                const scaleVal = starAnims[idx].interpolate({
                  inputRange: [0, 0.7, 1],
                  outputRange: [0.2, 1.18, idx === 1 ? 1.12 : 1],
                });
                return (
                  <Animated.View
                    key={idx}
                    style={[
                      styles.starSlot,
                      idx === 1 && styles.starCenterOffset,
                      {
                        opacity: starAnims[idx],
                        transform: [{ scale: scaleVal }],
                      },
                    ]}
                  >
                    <Star
                      size={idx === 1 ? 38 : 30}
                      color={earned ? '#F59E0B' : '#CBD5E1'}
                      fill={earned ? '#FBBF24' : '#E2E8F0'}
                      strokeWidth={2}
                    />
                  </Animated.View>
                );
              })}
            </View>

            {/* Level Eyebrow & Victory Headline */}
            <View style={styles.levelBadge}>
              <Text style={styles.levelBadgeText}>LEVEL {level}</Text>
            </View>
            <Text style={styles.headline}>{headline}</Text>
            <Text style={styles.subtitle}>
              All {totalArrows} arrows escaped smoothly
            </Text>

            {/* Minimalist Run Summary Card */}
            <View style={styles.statsCard}>
              <View style={styles.statCol}>
                <View style={styles.statIconRow}>
                  <View style={styles.navIconRotated}>
                    <Navigation2 size={13} color="#2589FF" fill="#2589FF" />
                  </View>
                  <Text style={styles.statValue}>{totalArrows}</Text>
                </View>
                <Text style={styles.statLabel}>ARROWS</Text>
              </View>

              <View style={styles.statDivider} />

              <View style={styles.statCol}>
                <View style={styles.statIconRow}>
                  <Heart size={14} color="#EF4444" fill="#EF4444" />
                  <Text style={styles.statValue}>{lives}/3</Text>
                </View>
                <Text style={styles.statLabel}>LIVES</Text>
              </View>

              <View style={styles.statDivider} />

              <View style={styles.statCol}>
                <Text style={styles.statValue}>
                  {gridSize}×{gridSize}
                </Text>
                <Text style={styles.statLabel}>{difficulty.toUpperCase()}</Text>
              </View>
            </View>

            {/* Action CTAs */}
            <View style={styles.actionsWrap}>
              {onWatchBonusAd && (
                <TouchableOpacity
                  activeOpacity={bonusClaimed ? 1 : 0.85}
                  disabled={bonusClaimed}
                  onPress={onWatchBonusAd}
                  style={[
                    styles.bonusAdBtn,
                    bonusClaimed && styles.bonusAdBtnClaimed,
                  ]}
                >
                  {bonusClaimed ? (
                    <Check size={16} color="#059669" strokeWidth={2.5} />
                  ) : (
                    <Video size={16} color="#059669" strokeWidth={2.3} />
                  )}
                  <Text
                    style={[
                      styles.bonusAdText,
                      bonusClaimed && styles.bonusAdTextClaimed,
                    ]}
                  >
                    {bonusClaimed
                      ? '+1 Bonus Hint Claimed'
                      : 'Watch Ad · +1 Bonus Hint'}
                  </Text>
                </TouchableOpacity>
              )}

              <TouchableOpacity
                activeOpacity={0.9}
                onPress={onNextLevel}
                style={styles.primaryBtnShadow}
              >
                <LinearGradient
                  colors={['#2589FF', '#0EA5E9', '#2563EB']}
                  start={{ x: 0, y: 0 }}
                  end={{ x: 1, y: 0 }}
                  style={styles.primaryBtn}
                >
                  <Text style={styles.primaryBtnText}>
                    NEXT LEVEL · LV {level + 1}
                  </Text>
                  <ArrowRight size={19} color="#FFFFFF" strokeWidth={2.5} />
                </LinearGradient>
              </TouchableOpacity>

              <TouchableOpacity
                activeOpacity={0.85}
                onPress={onBackHome}
                style={styles.secondaryBtn}
              >
                <Home size={16} color="#334155" strokeWidth={2.2} />
                <Text style={styles.secondaryBtnText}>Back to Home</Text>
              </TouchableOpacity>
            </View>
          </Animated.View>
        </SafeAreaView>

        <ConfettiBurst triggerKey={confettiKey} />
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(245, 248, 252, 0.96)',
    overflow: 'hidden',
  },
  topGlow: {
    position: 'absolute',
    top: -90,
    alignSelf: 'center',
    width: 340,
    height: 340,
    borderRadius: 170,
    backgroundColor: 'rgba(167, 243, 208, 0.45)',
  },
  bottomGlow: {
    position: 'absolute',
    bottom: -60,
    alignSelf: 'center',
    width: 320,
    height: 320,
    borderRadius: 160,
    backgroundColor: 'rgba(186, 230, 253, 0.45)',
  },
  safeWrap: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  content: {
    width: '100%',
    maxWidth: 340,
    alignItems: 'center',
  },
  emblemWrap: {
    width: 112,
    height: 112,
    alignItems: 'center',
    justifyContent: 'center',
  },
  emblemHaloOuter: {
    position: 'absolute',
    width: 112,
    height: 112,
    borderRadius: 56,
    backgroundColor: 'rgba(16, 185, 129, 0.14)',
  },
  emblemHaloInner: {
    position: 'absolute',
    width: 92,
    height: 92,
    borderRadius: 46,
    backgroundColor: 'rgba(16, 185, 129, 0.22)',
  },
  emblemCircle: {
    width: 76,
    height: 76,
    borderRadius: 38,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#10B981',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.35,
    shadowRadius: 18,
    elevation: 8,
  },
  starsRow: {
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'flex-end',
    justifyContent: 'center',
    gap: 12,
  },
  starSlot: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  starCenterOffset: {
    marginBottom: 8,
  },
  levelBadge: {
    marginTop: 18,
    paddingHorizontal: 14,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: '#E0F2FE',
    borderWidth: 1,
    borderColor: '#BAE6FD',
  },
  levelBadgeText: {
    fontSize: 11,
    fontWeight: '800',
    letterSpacing: 1.4,
    color: '#0369A1',
  },
  headline: {
    marginTop: 10,
    fontSize: 28,
    fontWeight: '800',
    letterSpacing: 0.4,
    color: '#0F172A',
    textAlign: 'center',
  },
  subtitle: {
    marginTop: 4,
    fontSize: 13,
    fontWeight: '500',
    color: '#64748B',
    textAlign: 'center',
  },
  statsCard: {
    marginTop: 22,
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    paddingVertical: 16,
    paddingHorizontal: 10,
    borderWidth: 1,
    borderColor: 'rgba(226, 232, 240, 0.95)',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.06,
    shadowRadius: 18,
    elevation: 3,
  },
  statCol: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  statIconRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  navIconRotated: {
    transform: [{ rotate: '45deg' }],
  },
  statValue: {
    fontSize: 17,
    fontWeight: '800',
    color: '#0F172A',
    fontVariant: ['tabular-nums'],
  },
  statLabel: {
    fontSize: 10,
    fontWeight: '700',
    letterSpacing: 0.9,
    color: '#94A3B8',
  },
  statDivider: {
    width: 1,
    height: 30,
    backgroundColor: '#E2E8F0',
  },
  actionsWrap: {
    marginTop: 24,
    width: '100%',
    gap: 12,
  },
  primaryBtnShadow: {
    borderRadius: 18,
    shadowColor: '#2589FF',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.3,
    shadowRadius: 18,
    elevation: 6,
  },
  primaryBtn: {
    height: 56,
    width: '100%',
    borderRadius: 18,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 20,
  },
  primaryBtnText: {
    fontSize: 15,
    fontWeight: '800',
    letterSpacing: 0.8,
    color: '#FFFFFF',
  },
  secondaryBtn: {
    height: 48,
    width: '100%',
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    borderWidth: 1.5,
    borderColor: '#CBD5E1',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  secondaryBtnText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#334155',
  },
  bonusAdBtn: {
    height: 46,
    width: '100%',
    borderRadius: 15,
    backgroundColor: '#ECFDF5',
    borderWidth: 1.5,
    borderColor: '#6EE7B7',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  bonusAdBtnClaimed: {
    backgroundColor: '#F1F5F9',
    borderColor: '#E2E8F0',
  },
  bonusAdText: {
    fontSize: 13,
    fontWeight: '700',
    color: '#047857',
  },
  bonusAdTextClaimed: {
    color: '#059669',
  },
});
