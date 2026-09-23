import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.chunshan.blackjack',
  appName: '春山 21点',
  webDir: 'www',
  server: { androidScheme: 'https' },
  android: { adjustMarginsForEdgeToEdge: 'force' },
};

export default config;
