import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';

// In the browser (development only) RouterOS calls go through this proxy because
// the router does not send CORS headers. The Android app talks to the router
// directly through the native RouterLink plugin and never uses this proxy.
const routerTarget = process.env.ROUTER_URL ?? 'http://127.0.0.1:8729';

/**
 * Strict Content-Security-Policy for the packaged app. The UI never loads
 * remote code or talks to the network from the WebView (router traffic goes
 * through the native plugin), so everything except the app itself is blocked.
 * Not applied in dev because Vite's hot reload needs inline scripts.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  "connect-src 'self'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

function cspPlugin(): Plugin {
  return {
    name: 'antinet-csp',
    apply: 'build',
    transformIndexHtml: (html) => html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`),
  };
}

export default defineConfig({
  plugins: [react(), cspPlugin()],
  base: './',
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: {
      '/rest': { target: routerTarget, changeOrigin: true, secure: false },
    },
  },
  build: {
    outDir: 'dist',
    sourcemap: false,
    target: 'es2022',
  },
});
