import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
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