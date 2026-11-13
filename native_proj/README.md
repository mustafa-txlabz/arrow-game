# Arrow Escape — React Native (`native_proj`)

Standalone React Native (Expo SDK 58 / React Native 0.88) migration of **Arrow Escape**, preserving 100% of the deterministic procedural puzzle generator, collision/rebound physics, and clean minimalist UI using native components.

---

## Architecture & Migrated Features

- **100% Preserved Puzzle Engine (`src/utils/puzzleGenerator.ts`, `src/utils/arrowGeometry.ts`)**:
  - Deterministic **Mulberry32** seeded level generation keyed strictly by level number.
  - **Rapid progressive grid scaling** from `6x6` (~11 arrows) through `18x18` (100+ arrows) up to `24x24` (~165–185 arrows) with 90–96% grid occupancy.
  - Labyrinthine mix of long winding pipes, C-clamps, S-curves, and short strategic blockers with guaranteed deadlock-free solvability.
- **Native SVG & 60fps Path Physics (`src/components/AnimatedPathArrow.tsx`)**:
  - Built with `react-native-svg` (`Svg`, `G`, `Path`, `Circle`) and `setNativeProps` animation frames for smooth flow-along-track escapes and full-distance blocked rebounds (turning permanently red after collision while deducting a heart only on the first blocked tap).
- **Pinch-to-Zoom & Pan (`src/components/GameplayScreen.tsx`)**:
  - Powered by `react-native-gesture-handler` (`Gesture.Simultaneous(Pinch, Pan)`) and `react-native-reanimated` (`useSharedValue`, `useAnimatedStyle`) with strict `[1.0, maxZoomScale]` clamping and viewport boundary capping.
- **Native Persistence & Feedback**:
  - Uses `@react-native-async-storage/async-storage` for saving level progress, hints, daily streak, and settings.
  - Uses `expo-haptics` for tactile feedback and `expo-audio` with synthesized WAV tones for audio SFX / ambient chords.
- **Portrait Orientation Lock**: Configured in `app.json` (`"orientation": "portrait"`).

---

## Prerequisites

- **Node.js** `v20.x` LTS or newer (`npm` `v10.x`+)
- **Expo Go** mobile app on iOS/Android (for instant preview), **or**
- **Android Studio** (JDK 21, Android SDK) / **Xcode** (macOS, for iOS) if building native binaries with React Native CLI / Expo Prebuild.

---

## Quick Start (Expo Go)

```bash
cd native_proj

# 1. Install dependencies
npm install

# 2. Start Metro bundler
npx expo start
```

- Scan the QR code with **Expo Go** (Android) or the **Camera app** (iOS), or press **`a`** for Android Emulator / **`i`** for iOS Simulator.

---

## Running as a Native React Native CLI / Prebuild App

Because all dependencies use standard React Native modules (`react-native-svg`, `react-native-gesture-handler`, `react-native-reanimated`, `@react-native-async-storage/async-storage`), you can generate native `android/` and `ios/` folders and build directly:

```bash
cd native_proj
npm install

# Generate native android/ and ios/ projects
npx expo prebuild

# Run directly on Android or iOS
npx expo run:android
npx expo run:ios
```

### TypeScript Check

```bash
cd native_proj
npm run lint
```

---

## Project Structure

```text
native_proj/
├── App.tsx                             # GestureHandlerRootView & SafeAreaProvider entry
├── app.json                            # Expo configuration (portrait lock, package ID)
├── babel.config.js                     # Babel preset + Reanimated plugin
├── package.json                        # React Native & Expo dependencies
├── tsconfig.json                       # TypeScript configuration
├── README.md                           # Setup & run instructions
└── src/
    ├── App.tsx                         # AsyncStorage persistence, navigation, modals
    ├── types/
    │   └── game.ts                     # Arrow, level, settings, progress types
    ├── utils/
    │   ├── puzzleGenerator.ts          # Mulberry32 seeded generator & solvability solver
    │   ├── arrowGeometry.ts            # Rounded bend polyline builder & path slicer
    │   └── soundAndHaptics.ts          # expo-haptics + expo-av WAV sound synthesizer
    └── components/
        ├── HomeScreen.tsx              # Home menu with floating SVG board preview
        ├── GameplayScreen.tsx          # Board, pinch/pan gestures, HUD, Win/Fail modals
        ├── AnimatedPathArrow.tsx       # 60fps react-native-svg path arrow physics
        ├── ConfettiBurst.tsx           # Native-driver celebratory confetti overlay
        └── Modals.tsx                  # Settings & 7-day Daily Bonus modals
```
