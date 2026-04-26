import { defineConfig } from 'vitest/config'
import path from 'node:path'

export default defineConfig({
  test: {
    include: ['electron/**/*.test.ts', 'src/**/*.test.ts'],
    environment: 'node',
    globals: false,
    pool: 'forks',
  },
  resolve: {
    alias: {
      // Stub `electron` module for unit tests so files that pull in `app.getPath`
      // can be loaded outside of the Electron runtime. Tests that exercise DB
      // initialization create their own temp dir and call `setDbPath` directly.
      electron: path.resolve(__dirname, 'electron/main/__test-helpers__/electron-stub.ts'),
    },
  },
})
