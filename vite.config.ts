import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

/**
 * Build stamp for analytics — so a deploy is visible in the data instead of
 * being guessed from dates. Written to `__APP_VERSION__` on every batch.
 */
const pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL('./package.json', import.meta.url)), 'utf-8'),
) as { version?: string }
const buildStamp = new Date().toISOString().slice(0, 10)

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  define: {
    __APP_VERSION__: JSON.stringify(`${pkg.version ?? '0.0.0'}+${buildStamp}`),
  },
  // The phone-verification API is Vercel functions (`api/otp/*`). In production the site and the
  // API share a domain, so the client simply calls `/api/otp/send` — no URL, no CORS. Development
  // has no Vercel, so this proxy hands those same relative calls to `npm run otp`
  // (`server/dev.js`) running the identical handlers. One path, both worlds.
  server: {
    proxy: {
      '/api': { target: 'http://localhost:3001', changeOrigin: true },
    },
  },
})
