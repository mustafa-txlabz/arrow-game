# Add project specific ProGuard rules here.
# By default, the flags in this file are appended to flags specified
# in /usr/local/Cellar/android-sdk/24.3.3/tools/proguard/proguard-android.txt
# You can edit the include path and order by changing the proguardFiles
# directive in build.gradle.
#
# For more details, see
#   http://developer.android.com/guide/developing/tools/proguard.html

# react-native-reanimated & react-native-worklets
-keep class com.swmansion.reanimated.** { *; }
-keep class com.swmansion.worklets.** { *; }
-keep class com.swmansion.gesturehandler.** { *; }

# @shopify/react-native-skia (JNI classes looked up directly from librnskia.so)
-keep class com.reactnative.skia.** { *; }
-keep class com.shopify.reactnative.skia.** { *; }

# react-native-google-mobile-ads & Google Mobile Ads SDK
-keep class io.invertase.googlemobileads.** { *; }
-keep class com.google.android.gms.ads.** { *; }

# react-native-svg & Expo native modules
-keep class com.horcrux.svg.** { *; }
-keep class expo.modules.** { *; }

# React Native New Architecture / TurboModules / Fabric / Codegen specs
-keep class com.facebook.react.turbomodule.** { *; }
-keep class com.facebook.react.fabric.** { *; }
-keep class com.facebook.fbreact.specs.** { *; }
-keep class com.facebook.jni.** { *; }

