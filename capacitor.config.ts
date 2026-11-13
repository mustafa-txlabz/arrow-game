import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.arrowescape.game',
  appName: 'Arrow Escape',
  webDir: 'dist',
  server: {
    androidScheme: 'https',
  },
  android: {
    backgroundColor: '#F5F8FC',
    allowMixedContent: false,
  },
};

export default config;
