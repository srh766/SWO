import { createRouter, createWebHistory } from 'vue-router'
import { useAuth } from './stores/auth'
export const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', redirect: '/workbench' },
    { path: '/login', component: () => import('./views/Login.vue'), meta: { title: '登录' } },
    ...['/workbench', '/tickets', '/tickets/new', '/tickets/:id'].map(path => ({ path, component: () => import('./views/Tickets.vue'), meta: { title: path === '/workbench' ? '工作台' : path === '/tickets/new' ? '创建工单' : '工单' } })),
    ...['/knowledge', '/knowledge/articles/new', '/knowledge/articles/:id/edit', '/knowledge/articles/:id', '/knowledge/documents/new', '/knowledge/documents/:id', '/knowledge/reviews'].map(path => ({ path, component: () => import('./views/Knowledge.vue'), meta: { title: path === '/knowledge/reviews' ? '知识审核' : '知识库', admin: path === '/knowledge/reviews', maintain: path.includes('/new') || path.endsWith('/edit') } })),
    { path: '/assistant/:kind(knowledge|agent)/:chatId?', component: () => import('./views/Assistant.vue'), meta: { title: '智能助手' } },
    ...['/admin/users', '/admin/departments', '/admin/roles', '/admin/categories'].map(path => ({ path, component: () => import('./views/System.vue'), meta: { title: { '/admin/users': '用户管理', '/admin/departments': '部门管理', '/admin/roles': '角色权限', '/admin/categories': '工单分类' }[path], admin: true } })),
    ...['/stats/tickets', '/stats/ai'].map(path => ({ path, component: () => import('./views/Stats.vue'), meta: { title: path === '/stats/ai' ? 'AI 使用统计' : '工单统计', admin: path === '/stats/ai' } })),
    { path: '/account', component: () => import('./views/Account.vue'), meta: { title: '个人账号' } },
    { path: '/403', component: () => import('./views/NotFound.vue'), meta: { title: '无访问权限' } },
    { path: '/:pathMatch(.*)*', component: () => import('./views/NotFound.vue'), meta: { title: '页面不存在' } }
  ],
  scrollBehavior: () => ({ top: 0 })
})
router.beforeEach(to => {
  const auth = useAuth()
  if (to.path !== '/login' && !auth.user) return { path: '/login', query: { redirect: to.fullPath } }
  if (to.path === '/login' && auth.user) return '/workbench'
  if ((to.meta.admin && !auth.admin) || (to.meta.maintain && !auth.maintainer)) return '/403'
  document.title = `${to.meta.title || '工作空间'} · 知序`
})
