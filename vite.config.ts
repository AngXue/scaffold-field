import { ensureRuleFingerprint } from './scripts/rule-fingerprint.ts'
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
export default defineConfig({
  plugins: [{ name: 'calculation-fingerprint', buildStart() { ensureRuleFingerprint() }, handleHotUpdate(context) {
    if (context.file.includes('/src/domain/') && !context.file.endsWith('/diagnostics/build.ts')) ensureRuleFingerprint()
  } }, react()],
  // Capacitor loads the bundle from a local scheme, so asset URLs must stay relative.
  base: './',
  build: {
    // Field tablets can ship an older Android System WebView; keep output conservative.
    target: 'es2019',
  },
})
