import { useEffect, useRef } from 'react';
import {
  Animated,
  Easing,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Circle, G, Path } from 'react-native-svg';
import { LinearGradient } from 'expo-linear-gradient';
import { Gift, Lightbulb, Play, Settings, Video } from 'lucide-react-native';
import type { PlayerProgress } from '../types/game';

interface HomeScreenProps {
  progress: PlayerProgress;
  canClaimDaily: boolean;
  onPlay: () => void;
  onOpenDaily: () => void;
  onOpenSettings: () => void;
  onWatchFreeHintAd: () => void;
}

const PREVIEW_COORDS = [24, 64, 104, 144];

/**
 * Minimalist light-mode Home Screen / Main Menu for Arrow Escape (React Native).
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
  const floatAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const floatLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(floatAnim, {
          toValue: -6,
          duration: 1800,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
        Animated.timing(floatAnim, {
          toValue: 0,
          duration: 1800,
          easing: Easing.inOut(Easing.sin),
          useNativeDriver: true,
        }),
      ])
    );

    const pulseLoop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, {
          toValue: 1.025,
          duration: 1100,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
        Animated.timing(pulseAnim, {
          toValue: 1,
          duration: 1100,
          easing: Easing.inOut(Easing.ease),
          useNativeDriver: true,
        }),
      ])
    );

    floatLoop.start();
    pulseLoop.start();

    return () => {
      floatLoop.stop();
      pulseLoop.stop();
    };
  }, [floatAnim, pulseAnim]);

  return (
    <SafeAreaView style={styles.container} edges={['top', 'bottom']}>
      {/* Soft ambient background blobs */}
      <View pointerEvents="none" style={styles.topGlow} />
      <View pointerEvents="none" style={styles.bottomGlow} />

      {/* Top Header Bar */}
      <View style={styles.header}>
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={onOpenSettings}
          accessibilityLabel="Open settings"
          style={styles.iconButton}
        >
          <Settings size={20} color="#2589FF" strokeWidth={2.2} />
        </TouchableOpacity>

        <TouchableOpacity
          activeOpacity={0.85}
          onPress={onWatchFreeHintAd}
          accessibilityLabel="Watch ad for 1 free hint"
          style={[
            styles.hintPill,
            progress.hints === 0 && styles.hintPillEmpty,
          ]}
        >
          <Lightbulb size={16} color="#2589FF" strokeWidth={2.3} />
          <Text style={styles.hintCount}>{progress.hints}</Text>
          <View style={styles.hintAdChip}>
            <Video size={11} color="#FFFFFF" strokeWidth={2.5} />
            <Text style={styles.hintAdChipText}>+1</Text>
          </View>
        </TouchableOpacity>
      </View>

      {/* Hero Section */}
      <View style={styles.hero}>
        <Text style={styles.title}>
          ARROW <Text style={styles.titleAccent}>ESCAPE</Text>
        </Text>

        {/* Floating white dotted-matrix showcase card */}
        <Animated.View
          style={[
            styles.showcaseCard,
            { transform: [{ translateY: floatAnim }] },
          ]}
        >
          <Svg width={160} height={160} viewBox="0 0 168 168">
            {/* 4x4 Dotted Matrix */}
            {PREVIEW_COORDS.map((y) =>
              PREVIEW_COORDS.map((x) => (
                <Circle
                  key={`${x}-${y}`}
                  cx={x}
                  cy={y}
                  r={2.2}
                  fill="#CBD5E1"
                />
              ))
            )}

            {/* Electric Blue L-shaped arrow pointing Right */}
            <G>
              <Path
                d="M 24 64 L 24 34 Q 24 24 34 24 L 98 24"
                fill="none"
                stroke="#2589FF"
                strokeWidth={4.2}
                strokeLinecap="round"
              />
              <Path
                d="M 106 24 L 94 17.5 L 96.5 24 L 94 30.5 Z"
                fill="#2589FF"
              />
            </G>

            {/* Emerald S-shaped meandering arrow pointing Down */}
            <G>
              <Path
                d="M 64 104 L 64 74 Q 64 64 74 64 L 134 64 Q 144 64 144 74 L 144 138"
                fill="none"
                stroke="#10B981"
                strokeWidth={4.2}
                strokeLinecap="round"
              />
              <Path
                d="M 144 146 L 137.5 134 L 144 136.5 L 150.5 134 Z"
                fill="#10B981"
              />
            </G>

            {/* Crisp Dark Navy U-turn arrow pointing Left */}
            <G>
              <Path
                d="M 104 104 L 104 134 Q 104 144 94 144 L 30 144"
                fill="none"
                stroke="#0F172A"
                strokeWidth={4.2}
                strokeLinecap="round"
              />
              <Path
                d="M 22 144 L 34 137.5 L 31.5 144 L 34 150.5 Z"
                fill="#0F172A"
              />
            </G>
          </Svg>
        </Animated.View>

        {/* Primary Play CTA */}
        <Animated.View
          style={[styles.ctaWrap, { transform: [{ scale: pulseAnim }] }]}
        >
          <TouchableOpacity
            activeOpacity={0.9}
            onPress={onPlay}
            style={styles.ctaShadow}
          >
            <LinearGradient
              colors={['#2589FF', '#0EA5E9', '#2563EB']}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 0 }}
              style={styles.ctaButton}
            >
              <Play size={20} color="#FFFFFF" fill="#FFFFFF" />
              <Text style={styles.ctaText}>
                {isReturningPlayer
                  ? `CONTINUE · LV ${progress.currentLevel}`
                  : 'TAP TO PLAY'}
              </Text>
            </LinearGradient>
          </TouchableOpacity>
        </Animated.View>
      </View>

      {/* Bottom Daily Bonus Card */}
      <View style={styles.bottomNav}>
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={onOpenDaily}
          style={styles.dailyButton}
        >
          {canClaimDaily && <View style={styles.dailyBadgeDot} />}
          <Gift size={20} color="#10B981" strokeWidth={2.2} />
          <Text style={styles.dailyButtonText}>Daily Bonus</Text>
        </TouchableOpacity>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F8FC',
    paddingHorizontal: 20,
    paddingVertical: 16,
    justifyContent: 'space-between',
    overflow: 'hidden',
  },
  topGlow: {
    position: 'absolute',
    top: -80,
    alignSelf: 'center',
    width: 300,
    height: 300,
    borderRadius: 150,
    backgroundColor: 'rgba(186, 230, 253, 0.45)',
  },
  bottomGlow: {
    position: 'absolute',
    bottom: 60,
    alignSelf: 'center',
    width: 280,
    height: 280,
    borderRadius: 140,
    backgroundColor: 'rgba(209, 250, 229, 0.5)',
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 8,
    zIndex: 10,
  },
  iconButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(226, 232, 240, 0.85)',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.08,
    shadowRadius: 14,
    elevation: 3,
  },
  hintPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    borderRadius: 999,
    backgroundColor: '#FFFFFF',
    paddingLeft: 12,
    paddingRight: 8,
    paddingVertical: 6,
    borderWidth: 1,
    borderColor: 'rgba(226, 232, 240, 0.85)',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.06,
    shadowRadius: 14,
    elevation: 2,
  },
  hintPillEmpty: {
    borderColor: '#6EE7B7',
    backgroundColor: '#F0FDF4',
  },
  hintCount: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1E293B',
    fontVariant: ['tabular-nums'],
  },
  hintAdChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
    backgroundColor: '#10B981',
    borderRadius: 999,
    paddingHorizontal: 7,
    paddingVertical: 3,
  },
  hintAdChipText: {
    fontSize: 10,
    fontWeight: '800',
    color: '#FFFFFF',
  },
  hero: {
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 10,
  },
  title: {
    fontSize: 34,
    fontWeight: '800',
    letterSpacing: 1.5,
    color: '#0F172A',
    textAlign: 'center',
  },
  titleAccent: {
    color: '#2589FF',
  },
  showcaseCard: {
    marginTop: 28,
    borderRadius: 24,
    backgroundColor: '#FFFFFF',
    padding: 16,
    borderWidth: 1,
    borderColor: 'rgba(226, 232, 240, 0.85)',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 14 },
    shadowOpacity: 0.12,
    shadowRadius: 24,
    elevation: 6,
  },
  ctaWrap: {
    marginTop: 32,
    width: '100%',
    maxWidth: 300,
  },
  ctaShadow: {
    borderRadius: 16,
    shadowColor: '#2589FF',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.28,
    shadowRadius: 18,
    elevation: 6,
  },
  ctaButton: {
    height: 56,
    borderRadius: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingHorizontal: 24,
  },
  ctaText: {
    fontSize: 16,
    fontWeight: '800',
    letterSpacing: 1.2,
    color: '#FFFFFF',
  },
  bottomNav: {
    width: '100%',
    maxWidth: 300,
    alignSelf: 'center',
    paddingTop: 8,
    zIndex: 10,
  },
  dailyButton: {
    position: 'relative',
    minHeight: 56,
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderWidth: 1,
    borderColor: 'rgba(226, 232, 240, 0.85)',
    shadowColor: '#0F172A',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 16,
    elevation: 3,
  },
  dailyBadgeDot: {
    position: 'absolute',
    top: 10,
    right: 14,
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#10B981',
  },
  dailyButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1E293B',
  },
});
