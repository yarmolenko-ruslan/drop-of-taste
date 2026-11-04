import react from '@vitejs/plugin-react'
import { loadEnv } from 'vite'
import { defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig(({ mode, command }) => {
  const env = loadEnv(mode, process.cwd(), ['API_PORT', 'APP_ORIGIN'])
  const apiPort = Number(env.API_PORT || 3001)
  const configuredOrigin = new URL(env.APP_ORIGIN || 'http://localhost:5173')
  if (command === 'serve' && env.APP_ORIGIN && !configuredOrigin.port) {
    throw new Error('APP_ORIGIN must include the local Vite port')
  }
  const sitePort = Number(configuredOrigin.port || 5173)
  if (!Number.isInteger(apiPort) || apiPort < 1 || apiPort > 65535) {
    throw new Error('Invalid API_PORT')
  }
  if (!Number.isInteger(sitePort) || sitePort < 1 || sitePort > 65535) {
    throw new Error('Invalid APP_ORIGIN port')
  }

  return {
    plugins: [react()],
    server: {
      port: sitePort,
      strictPort: true,
      proxy: {
        '/api': `http://127.0.0.1:${apiPort}`,
      },
    },
    css: {
      modules: {
        localsConvention: 'camelCaseOnly',
      },
    },
    test: {
      environment: 'jsdom',
      globals: true,
      setupFiles: ['./src/test/setup.ts'],
      css: { modules: { classNameStrategy: 'non-scoped' } },
    },
  }
})
