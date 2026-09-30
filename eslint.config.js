import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // `dist` is build output. `android` is the generated Capacitor project: it has its
  // own toolchain and contains a copy of the built web bundle under
  // android/app/src/main/assets/public, which must not be linted as source.
  // `.toolchain` holds the local JDK/SDK/Gradle caches, which contain third-party
  // JS assets (e.g. Capacitor's native-bridge.js) that are not our source.
  globalIgnores(['dist', 'android', '.toolchain']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      globals: globals.browser,
    },
  },
])
