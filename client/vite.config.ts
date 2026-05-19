import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { VitePWA } from 'vite-plugin-pwa';

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg'],
      manifest: {
        name: 'Makuta Accounts Module',
        short_name: 'Makuta',
        description: 'Invoice & Payment Portal for Makuta Developers',
        theme_color: '#1a3c5e',
        background_color: '#f8fafc',
        display: 'standalone',
        orientation: 'portrait',
        scope: '/',
        start_url: '/',
        icons: [
          { src: '/pwa-192x192.svg', sizes: '192x192', type: 'image/svg+xml' },
          { src: '/pwa-512x512.svg', sizes: '512x512', type: 'image/svg+xml' },
          { src: '/pwa-512x512.svg', sizes: '512x512', type: 'image/svg+xml', purpose: 'any maskable' },
        ],
      },
      workbox: {
        globPatterns: ['**/*.{js,css,html,ico,png,svg,woff2}'],
        // All /api/* traffic goes straight to the network. Caching mutable
        // resources (invoices, payments, vendors, cashflow, aging) under
        // NetworkFirst caused stale reads to surface after edits whenever
        // the post-mutation refetch hit a transient network blip — the SW
        // would fall back to the pre-edit cache, leaving the UI showing
        // old values until the next successful fetch.
        runtimeCaching: [
          {
            urlPattern: /^https?:\/\/.*\/api\//,
            handler: 'NetworkOnly',
          },
        ],
      },
    }),
  ],
  server: {
    port: 3000,
    host: true,
    proxy: {
      '/api': 'http://localhost:4200',
    },
  },
});
