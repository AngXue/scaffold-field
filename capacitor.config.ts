import type { CapacitorConfig } from '@capacitor/cli'

const config: CapacitorConfig = {
  appId: 'com.scaffoldfield.app',
  appName: '架算',
  webDir: 'dist',
  android: {
    // The app is fully offline; a fixed https origin keeps localStorage stable
    // across installs and upgrades so the saved `scaffold-project` survives.
    allowMixedContent: false,
  },
  server: {
    androidScheme: 'https',
  },
}

export default config
