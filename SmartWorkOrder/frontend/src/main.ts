import { createApp } from 'vue'
import { createPinia } from 'pinia'
import ElementPlus from 'element-plus'
import zhCn from 'element-plus/es/locale/lang/zh-cn'
import 'element-plus/dist/index.css'
import './style.css'
import App from './App.vue'
import { router } from './router'
import { demo } from './api'
async function main() {
  if (demo) {
    const { worker } = await import('./mocks/browser')
    await worker.start({
      onUnhandledRequest(request, print) {
        if (new URL(request.url).pathname.startsWith('/api/')) print.error()
      },
      quiet: true
    })
  }
  const app = createApp(App).use(createPinia()).use(router).use(ElementPlus, { locale: zhCn })
  await router.isReady()
  app.mount('#app')
}
main().catch(error => {
  document.getElementById('app')!.textContent = `应用启动失败：${error instanceof Error ? error.message : '未知错误'}。请刷新页面重试。`
})
