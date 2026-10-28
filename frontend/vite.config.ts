import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // 显式绑 IPv4：Vite 默认绑 localhost，在 Node 24 上可能只监听 [::1]，
    // 导致浏览器用 127.0.0.1 打不开
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    // 前端所有 /api 请求转发到后端，开发期不用处理 CORS
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:8000',
        changeOrigin: true,
      },
    },
  },
})
