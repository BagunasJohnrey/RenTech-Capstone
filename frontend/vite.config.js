import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

// H3 (security): inject a strict Content-Security-Policy meta into the BUILT
// index.html only. Dev mode intentionally keeps no CSP meta because Vite's HMR
// inline scripts would be blocked. The API already sends its own helmet CSP.
function cspPlugin() {
  const CSP = [
    "default-src 'self'",
    "script-src 'self' 'unsafe-inline' https://cdn.paymongo.com",
    "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data: https://fonts.gstatic.com",
    "connect-src 'self' https://*.supabase.co https://*.paymongo.com https://*.onrender.com https://*.vercel.app wss://localhost:* https://www.google.com",
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
        // Signed-URL images expire, so don't try to precache them; cache only
        // the app shell + static assets and let runtime requests go to network.
        globPatterns: ['**/*.{js,css,html,svg,png,ico}'],
        globIgnores: ['RenTech.png'], // 6.65MB hero/logo — served on demand, never precached
        // Keep API + Supabase signed URLs out of the SW cache.
        navigateFallbackDenylist: [/^\/api\//],
      },
    }),
    cspPlugin(),
  ],
  resolve: { dedupe: ['react', 'react-dom'] },
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('react-dom') || id.includes('/react/') || id.includes('scheduler')) return 'react-vendor';
            if (id.includes('recharts') || id.includes('d3-') || id.includes('victory')) return 'charts-vendor';
            if (id.includes('lucide-react')) return 'icons-vendor';
            // Heavy screen-specific libs — they are only reached via lazy chunks
            // above, so splitting them out of the shared `vendor` keeps them off
            // the boot path even if Rollup would otherwise hoist them.
            if (id.includes('html5-qrcode')) return 'scanner-vendor';
            if (id.includes('framer-motion')) return 'motion-vendor';
            if (id.includes('react-markdown') || id.includes('remark') ||
                id.includes('rehype') || id.includes('mdast') || id.includes('micromark') ||
                id.includes('unist') || id.includes('vfile') || id.includes('hast') ||
                id.includes('devlop') || id.includes('zwitch') || id.includes('unified') ||
                id.includes('bail') || id.includes('comma-separated') || id.includes('decode-named') ||
                id.includes('character-') || id.includes('ccount') || id.includes('trim-lines') ||
                id.includes('space-separated') || id.includes('html-url-') || id.includes('property-information')) return 'markdown-vendor';
            if (id.includes('/qrcode')) return 'qrcode-vendor';
            if (id.includes('jspdf') || id.includes('fflate') || id.includes('canvg') ||
                id.includes('dompurify') || id.includes('html2canvas') || id.includes('rgbcolor') ||
                id.includes('svg-pathdata') || id.includes('text-segmentation') || id.includes('performance-now') ||
                id.includes('rafc') || id.includes('css-line-break') || id.includes('utor') || id.includes('base64')) return 'pdf-vendor';
            return 'vendor';
          }
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