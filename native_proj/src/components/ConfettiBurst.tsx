import { useEffect, useRef, useState } from 'react';
import { Animated, Dimensions, StyleSheet, View } from 'react-native';

interface ConfettiBurstProps {
  triggerKey: number;
}

interface NativeParticle {
  id: number;
  startX: number;
  startY: number;
  dx: number;
  peakY: number;
  endY: number;
  w: number;
  h: number;
  color: string;
  rotDeg: string;
  isCircle: boolean;
  progress: Animated.Value;
}

const CONFETTI_COLORS = [
  '#2589FF',
  '#34D399',
  '#FBBF24',
  '#F472B6',
  '#A78BFA',
  '#38BDF8',
];

/**
 * 60fps native-driver confetti burst firing from left, right, and center cannons.
 */
export function ConfettiBurst({ triggerKey }: ConfettiBurstProps) {
  const [particles, setParticles] = useState<NativeParticle[]>([]);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    if (triggerKey <= 0) return;

    const { width, height } = Dimensions.get('window');
    const count = 64;
    const nextParticles: NativeParticle[] = [];

    for (let i = 0; i < count; i++) {
      const source = i % 3;
      const startX =
        source === 0
          ? width * 0.14
          : source === 1
            ? width * 0.86
            : width * 0.5 + (Math.random() - 0.5) * width * 0.35;
      const startY =
        source === 2 ? height * 0.44 : height * 0.54 + (Math.random() - 0.5) * 30;

      const angle =
        source === 0
          ? -Math.PI * (0.28 + Math.random() * 0.18)
          : source === 1
            ? -Math.PI * (0.54 + Math.random() * 0.18)
            : -Math.PI * (0.25 + Math.random() * 0.5);

      const speed = 170 + Math.random() * 210;

      nextParticles.push({
        id: i,
        startX,
        startY,
        dx: Math.cos(angle) * speed,
        peakY: Math.sin(angle) * speed - 60,
        endY: 280 + Math.random() * 220,
        w: 6 + Math.random() * 5,
        h: 5 + Math.random() * 4,
        color: CONFETTI_COLORS[i % CONFETTI_COLORS.length],
        rotDeg: `${Math.round((Math.random() - 0.5) * 720)}deg`,
        isCircle: i % 5 === 0,
        progress: new Animated.Value(0),
      });
    }

    setParticles(nextParticles);

    const anims = nextParticles.map((p) =>
      Animated.timing(p.progress, {
        toValue: 1,
        duration: 1200 + Math.random() * 450,
        useNativeDriver: true,
      })
    );

    Animated.parallel(anims).start(({ finished }) => {
      if (finished && mountedRef.current) {
        setParticles([]);
      }
    });
  }, [triggerKey]);

  if (particles.length === 0) return null;

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {particles.map((p) => {
        const translateX = p.progress.interpolate({
          inputRange: [0, 1],
          outputRange: [0, p.dx],
        });
        const translateY = p.progress.interpolate({
          inputRange: [0, 0.32, 1],
          outputRange: [0, p.peakY, p.endY],
        });
        const rotate = p.progress.interpolate({
          inputRange: [0, 1],
          outputRange: ['0deg', p.rotDeg],
        });
        const opacity = p.progress.interpolate({
          inputRange: [0, 0.7, 1],
          outputRange: [1, 0.9, 0],
        });

        return (
          <Animated.View
            key={p.id}
            style={[
              styles.particle,
              {
                left: p.startX,
                top: p.startY,
                width: p.w,
                height: p.isCircle ? p.w : p.h,
                borderRadius: p.isCircle ? p.w / 2 : 2,
                backgroundColor: p.color,
                opacity,
                transform: [{ translateX }, { translateY }, { rotate }],
              },
            ]}
          />
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  particle: {
    position: 'absolute',
  },
});
