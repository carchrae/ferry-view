import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    // Blocks live bcferries.com requests from tests (see the file).
    setupFiles: ['./test/setup-no-bcferries.js'],
  },
})
