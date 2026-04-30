import type { ForgeConfig } from '@electron-forge/shared-types'
import { VitePlugin } from '@electron-forge/plugin-vite'

const config: ForgeConfig = {
  packagerConfig: {
    name: 'WOS',
    appBundleId: 'com.wos.app',
    icon: 'resources/icon',
    asar: {
      // better-sqlite3 ships a native `.node` binding that must live on disk
      // (Electron can't dlopen from inside an asar archive).
      unpack: '**/{better_sqlite3.node,build/Release/*.node}',
    },
    extraResource: ['resources/wos-transcribe'],
    extendInfo: {
      // The Apple Speech helper requires macOS 26+, but the rest of the app
      // works on older macOS. Surface a friendly error from the helper instead
      // of refusing to launch.
      LSMinimumSystemVersion: '13.0',
      NSMicrophoneUsageDescription: 'WOS uses the microphone only when you enable local meeting transcription.',
      NSSpeechRecognitionUsageDescription: 'WOS uses Apple Speech on-device to transcribe consented meetings and uploaded recordings.',
    },
  },
  makers: [
    {
      name: '@electron-forge/maker-zip',
      platforms: ['darwin', 'linux'],
      config: {},
    },
    {
      name: '@electron-forge/maker-dmg',
      config: {
        format: 'ULFO',
      },
    },
  ],
  plugins: [
    new VitePlugin({
      build: [
        {
          entry: 'electron/main/index.ts',
          config: 'vite.main.config.ts',
          target: 'main',
        },
        {
          entry: 'electron/preload/index.ts',
          config: 'vite.preload.config.ts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.ts',
        },
      ],
    }),
  ],
}

export default config
