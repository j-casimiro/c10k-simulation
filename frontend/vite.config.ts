import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/metrics': {
        target: 'http://localhost:9000',
        changeOrigin: true,
        timeout: 0,
        proxyTimeout: 0,
        configure: (proxy) => {
          proxy.on('error', (err, _req, res) => {
            console.error('Vite Proxy Error (/metrics):', err.message);
            if (!res.headersSent) {
              res.writeHead(502, { 'Content-Type': 'text/plain' });
            }
            res.end('Proxy error: ' + err.message);
          });
        }
      },
      '/api': {
        target: 'http://localhost:9000',
        changeOrigin: true,
        configure: (proxy) => {
          proxy.on('error', (err, _req, res) => {
            console.error('Vite Proxy Error (/api):', err.message);
            if (!res.headersSent) {
              res.writeHead(502, { 'Content-Type': 'text/plain' });
            }
            res.end('Proxy error: ' + err.message);
          });
        }
      },
    },
  },
})
