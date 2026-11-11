import { defineConfig, loadEnv } from 'vite'
import vue from '@vitejs/plugin-vue'
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return {
    plugins: [vue()],
    server: {
      proxy: {
        '/api': { target: env.API_TARGET || 'http://127.0.0.1:8080', changeOrigin: true }
      }
    },
    build: {
      rollupOptions: {
        output: {
          manualChunks: {
            'element-plus': ['element-plus'],
            'vue-core': ['vue', 'vue-router', 'pinia'],
            content: ['marked', 'dompurify'],
            http: ['axios']
          }
        }
      }
    }
  }
})
