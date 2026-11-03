import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// H3 (security): inject a strict Content-Security-Policy meta into the BUILT
// index.html only. Dev mode intentionally keeps no CSP meta because Vite's HMR
// inline scripts would be blocked. The API already sends its own helmet CSP.
function cspPlugin() {
  const CSP = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    "connect-src 'self' https://*.supabase.co https://*.r2.dev https://*.onrender.com https://*.vercel.app wss://localhost:* https://www.google.com",
    "frame-src https://www.google.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
  ].join('; ')
  return {
    name: 'inject-csp',
    apply: 'build',
    enforce: 'post',
    transformIndexHtml(html) {
      return html.replace(
        '<meta name="theme-color"',
        `<meta http-equiv="Content-Security-Policy" content="${CSP}" /><meta name="theme-color"`
      )
    },
  }
}

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.png', 'apple-touch-icon.png'],
      // Dev-only: skip the service worker (it fights HMR). The production
      // build still emits dist/manifest.webmanifest via the plugin below, and
      // the static public/manifest.webmanifest (duplicating it) clears the
      // "Manifest: Line: 1, column: 1, Syntax error" console warning in dev —
      // without that file, /manifest.webmanifest falls through to the SPA
      // catch-all and returns index.html.
      manifest: {
        name: "RenTech — Mylene's Boutique",
        short_name: 'RenTech',
        description: 'Boutique rental app for Mylene\'s Boutique (Balayan, Batangas)',
        theme_color: '#bf4a53',
        background_color: '#ffffff',
        display: 'standalone',
        icons: [
          { src: '/pwa-192x192.png', sizes: '192x192', type: 'image/png' },
          { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png' },
          { src: '/pwa-512x512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
        ],
      },
      workbox: {
        // Precache the app shell only (HTML/CSS/icons). JS chunks are cached
        // on demand via the runtime rule below — precaching every chunk made
        // the first visit download the entire admin/analytics/PDF bundle.
        globPatterns: ['**/*.{css,html,svg,png,ico,webp,woff2,webmanifest}'],
        // Keep API + Supabase signed URLs out of the SW cache.
        navigateFallbackDenylist: [/^\/api\//],
        // Public catalog photos have stable URLs + 30-day cache headers, so
        // CacheFirst across visits is safe. Scoped to /object/public/ only —
        // signed URLs (/object/sign/) rotate and must never be cached.
        runtimeCaching: [
          {
            // Hashed JS chunks: serve from cache, refresh in the background.
            // Cached only as they are actually used, so a public visitor never
            // pays for admin-only code.
            urlPattern: /\/assets\/.*\.js$/,
            handler: 'StaleWhileRevalidate',
            options: {
              cacheName: 'rentech-js',
              expiration: { maxEntries: 120, maxAgeSeconds: 30 * 24 * 60 * 60 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
          {
            // Public catalog photos on either provider (Cloudflare R2 public
            // bucket or Supabase /object/public/). Signed URLs — R2 presigned
            // (X-Amz-Signature) or Supabase /object/sign/ — rotate and are
            // excluded. Function must stay closure-free (workbox serializes it).
            urlPattern: ({ request, url }) =>
              request.destination === 'image' &&
              url.origin !== self.location.origin &&
              !url.searchParams.has('X-Amz-Signature') &&
              !url.pathname.includes('/object/sign/') &&
              (url.hostname.endsWith('.r2.dev') ||
                url.pathname.includes('/storage/v1/object/public/') ||
                /^(img|images|cdn|media)\./.test(url.hostname)),
            handler: 'CacheFirst',
            options: {
              cacheName: 'rentech-public-images',
              expiration: { maxEntries: 300, maxAgeSeconds: 30 * 24 * 60 * 60 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
    }),
    cspPlugin(),
  ],
  resolve: { dedupe: ['react', 'react-dom'] },
  build: {
    sourcemap: false,
    rollupOptions: {
      output: {
        // Pure hashes — hides component names like DashboardView-xxx.js
        // from Network tab. Content is still readable (browser must run it),
        // this only obscures filenames.
        entryFileNames: 'assets/[hash].js',
        chunkFileNames: 'assets/[hash].js',
        assetFileNames: 'assets/[hash].[ext]',
        manualChunks(id) {
          if (!id.includes('node_modules')) return;
          // Only React is pinned to a shared chunk. Everything else is left
          // to Rollup's natural splitting so libraries used exclusively by
          // lazy screens (recharts, jspdf, qrcode, framer-motion, markdown,
          // scanner) stay in those lazy chunks.
          //
          // Do NOT add a catch-all `vendor` chunk here: the entry imports one
          // module from it and the browser then downloads every node_module
          // bundled into it — including admin-only charts and PDF code. That
          // bug added ~340 KB gzipped to the public landing page.
          if (/[\\/]node_modules[\\/](react|react-dom|scheduler)[\\/]/.test(id)) return 'react-vendor';
        },
      },
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
})
