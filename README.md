# Arrow Escape

A minimalist, mobile-first Tap Away puzzle game built with React, TypeScript, Tailwind CSS, Motion, and Capacitor for native Android deployment on the Google Play Store.

---

## 1. Project Overview

**Arrow Escape** challenges players to untangle densely packed, procedurally generated arrow mazes step by step without running out of lives.

- **App Name:** Arrow Escape
- **Package ID:** `com.arrowescape.game`
- **Orientation:** Strictly locked to **Portrait** mode (via both `AndroidManifest.xml` and `@capacitor/screen-orientation`)
- **Core Gameplay:**
  - Deterministic, seeded **infinite-level** procedural puzzle generator (`Mulberry32`) scaling rapidly from `6x6` (~11 arrows) through `24x24` (`Lv 76–100`), then expanding every 40 levels up to a `32x32` cap (`Lv 221+`, ~300–330+ arrows at ~90–95% fill).
  - Multi-archetype labyrinth routing mixing long winding pipes, C-clamps, S-curves, and short strategic blockers.
  - Smooth SVG curved-arrow escape paths, collision rebound feedback, pinch-to-zoom and panning on dense boards, sound & haptic feedback, hints, and daily streak rewards.
  - Offline-ready persistence powered by `localStorage`.

---

## 2. Prerequisites

Before building or packaging the native Android application, ensure the following tools are installed:

- **Node.js** (`v20.x` LTS or newer) and **npm** (`v10.x` or newer)
- **Android Studio** (Ladybug / Meerkat or newer) with:
  - **Android SDK Platform** (API Level 35 / matching `android/variables.gradle`)
  - **Android SDK Build-Tools** & **Android SDK Platform-Tools** (`adb`)
  - **Android Emulator** (optional, if not testing on a physical phone)
- **Java Development Kit (JDK)** (`JDK 21` recommended — Android Studio bundles JetBrains Runtime JDK 21)
- **Gradle** (automatically managed via the included `./android/gradlew` Gradle Wrapper)

---

## 3. Local Development & Testing (Web)

Install dependencies and launch the Vite development server on port `3000`:

```bash
# 1. Install dependencies
npm install

# 2. Start the local dev server
npm run dev
```

Open `http://localhost:3000` in your browser (or use Chrome DevTools mobile device emulation at ~390x844) to playtest levels, audio/UI flows, and pinch-to-zoom interactions.

To verify TypeScript types cleanly before building:

```bash
npm run lint
```

---

## 4. Building & Syncing with Capacitor

Whenever you modify React, TypeScript, CSS, or asset files in `src/`, rebuild the production bundle (`dist/`) and sync it to the native Android project:

```bash
# 1. Build the optimized Vite production bundle into dist/
npm run build

# 2. Copy dist/ assets and update Capacitor Android plugins/config
npx cap sync android
```

Or run the combined shortcut script defined in `package.json`:

```bash
npm run cap:sync
```

### Configuration Summary (`capacitor.config.ts`)

- `appId`: `com.arrowescape.game`
- `appName`: `Arrow Escape`
- `webDir`: `dist`
- `server.androidScheme`: `https`
- `android.backgroundColor`: `#F5F8FC`
- Portrait orientation is enforced natively in `android/app/src/main/AndroidManifest.xml` (`android:screenOrientation="portrait"`) and at runtime on native launch via `@capacitor/screen-orientation`.

---

## 5. Opening & Testing in Android Studio

Launch the native Android project inside Android Studio:

```bash
npx cap open android
# or: npm run cap:android
```

Once Android Studio finishes Gradle Sync:

1. **Test on a Physical Android Device (Recommended):**
   - Enable **Developer Options** and **USB Debugging** on your Android phone.
   - Connect via USB, approve the RSA debugging prompt on the phone, select your device in the top toolbar, and click **Run (`Shift+F10`)**.
2. **Test on an Android Emulator:**
   - Open **Device Manager** in Android Studio, create/start a portrait phone AVD (e.g., Pixel 8), and click **Run (`Shift+F10`)**.

---

## 6. Generating a Release Build (`.aab` for Google Play Store)

Google Play Console requires new apps to be uploaded as signed **Android App Bundles (`.aab`)**.

### Step A: Update Version Numbers

Before each release, bump `versionCode` (integer, must increase every upload) and `versionName` (user-facing string) inside `android/app/build.gradle`:

```gradle
defaultConfig {
    applicationId "com.arrowescape.game"
    ...
    versionCode 1
    versionName "1.0.0"
}
```

### Step B: Sync Latest Web Build

```bash
npm run cap:sync
npx cap open android
```

### Step C: Create a Signing Keystore & Build the Signed `.aab`

1. In Android Studio's top menu, select **Build → Generate Signed Bundle / APK...**
2. Choose **Android App Bundle** and click **Next**.
3. Under **Key store path**:
   - **First release:** Click **Create new...**, choose a secure path *outside* the repository (e.g., `~/keystores/arrow-escape-upload.jks`), set strong passwords, fill in the key alias (e.g., `arrow-escape-key`), validity (`25+` years), and certificate details.
   - **Subsequent releases:** Select your existing `.jks` keystore and enter your passwords and alias.
   > **Important:** Back up your upload keystore and passwords securely. Never commit `.jks`/`.keystore` files to Git.
4. Click **Next**, select the **release** build variant, and click **Create** (or **Finish**).
5. Once the build completes, click **locate** in the notification banner (or find the bundle at `android/app/release/app-release.aab`).

### Step D: Upload to Google Play Console

1. Open [Google Play Console](https://play.google.com/console) and create your **Arrow Escape** app entry.
2. Start with **Internal testing** (or **Closed testing**) to verify installation, touch controls, audio, and portrait orientation on real devices.
3. Upload `android/app/release/app-release.aab`, add release notes, review warnings, and roll out.
