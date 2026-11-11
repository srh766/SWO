<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Briefcase, Tickets, Reading, ChatDotRound, MagicStick, DataAnalysis, User, OfficeBuilding, Key, CollectionTag, Fold, ArrowDown, Plus, Switch, CircleCheck } from '@element-plus/icons-vue'
import { useAuth } from './stores/auth'
import { demo } from './api'
import { notifyError } from './utils'
const auth = useAuth()
const route = useRoute()
const router = useRouter()
const mobileNav = ref(false)
const switching = ref(false)
const sections = computed(() => [
  { label: '服务空间', items: [{ path: '/workbench', label: '工作台', icon: Briefcase }, { path: '/tickets', label: '工单', icon: Tickets }, { path: '/knowledge', label: '知识库', icon: Reading }] },
  { label: '智能协作', items: [{ path: '/assistant/knowledge', label: '知识问答', icon: ChatDotRound }, { path: '/assistant/agent', label: '业务助手', icon: MagicStick }] },
  { label: '数据与洞察', items: [{ path: '/stats/tickets', label: '工单统计', icon: DataAnalysis }, ...(auth.admin ? [{ path: '/stats/ai', label: 'AI 使用统计', icon: DataAnalysis }] : [])] },
  ...(auth.admin ? [{ label: '管理', items: [{ path: '/knowledge/reviews', label: '知识审核', icon: CircleCheck }, { path: '/admin/users', label: '用户管理', icon: User }, { path: '/admin/departments', label: '部门管理', icon: OfficeBuilding }, { path: '/admin/roles', label: '角色权限', icon: Key }, { path: '/admin/categories', label: '工单分类', icon: CollectionTag }] }] : [])
])
function active(path: string) {
  if (path === '/knowledge') return route.path.startsWith('/knowledge') && route.path !== '/knowledge/reviews'
  if (path === '/tickets') return route.path.startsWith('/tickets')
  return route.path === path || route.path.startsWith(`${path}/`)
}
async function logout() { try { await auth.logout(); await router.push('/login') } catch (error) { notifyError(error) } }
async function switchRole(username: string) {
  if (username === 'reset') { window.location.assign('/login'); return }
  switching.value = true
  try { await auth.logout(); await auth.login(username, 'Demo123!'); await router.push('/workbench') } catch (error) { notifyError(error); await router.push('/login') } finally { switching.value = false }
}
window.addEventListener('auth-expired', () => { auth.clear(); void router.replace('/login') })
router.afterEach(() => { mobileNav.value = false })
</script>
<template>
  <RouterView v-if="route.path === '/login'" />
  <div v-else class="workspace">
    <button v-if="mobileNav" class="nav-backdrop" aria-label="关闭导航" @click="mobileNav = false" />
    <aside class="sidebar" :class="{ open: mobileNav }">
      <RouterLink to="/workbench" class="brand"><span class="brand-symbol">知</span><span>知序<span class="brand-caption">企业服务工作空间</span></span></RouterLink>
      <nav aria-label="主导航"><section v-for="section in sections" :key="section.label" class="nav-section"><div class="nav-label">{{ section.label }}</div><RouterLink v-for="item in section.items" :key="item.path" :to="item.path" class="nav-link" :class="{ active: active(item.path) }"><el-icon><component :is="item.icon" /></el-icon>{{ item.label }}</RouterLink></section></nav>
      <div class="sidebar-bottom"><span class="online-dot" />{{ demo ? '演示工作空间' : '企业工作空间' }}<span class="muted">v1.0</span></div>
    </aside>
    <div class="workspace-body">
      <header class="topbar"><div class="row topbar-location"><el-button class="nav-toggle" text :icon="Fold" aria-label="展开导航" @click="mobileNav = !mobileNav"/><span class="muted">工作空间</span><span class="breadcrumb-slash">/</span><span>{{ route.meta.title }}</span></div><div class="row"><el-tag v-if="demo" size="small" type="warning" effect="plain">演示数据</el-tag><el-dropdown v-if="demo" @command="switchRole"><el-button text :loading="switching" :icon="Switch">切换身份</el-button><template #dropdown><el-dropdown-menu><el-dropdown-item command="employee">员工 · 林晓</el-dropdown-item><el-dropdown-item command="handler">处理人员 · 陈嘉</el-dropdown-item><el-dropdown-item command="admin">管理员 · 周宁</el-dropdown-item><el-dropdown-item command="reset" divided>重置演示数据并退出</el-dropdown-item></el-dropdown-menu></template></el-dropdown><el-dropdown @command="(command: string) => command === 'logout' ? logout() : router.push('/account')"><button class="user-menu"><span class="avatar">{{ auth.user?.name.slice(0, 1) }}</span><span class="user-name">{{ auth.user?.name }}</span><el-icon><ArrowDown/></el-icon></button><template #dropdown><el-dropdown-menu><el-dropdown-item command="account">个人账号</el-dropdown-item><el-dropdown-item command="logout" divided>退出登录</el-dropdown-item></el-dropdown-menu></template></el-dropdown></div></header>
      <main class="main-content"><RouterView :key="auth.user?.id" /></main>
      <footer class="workspace-footer"><span>让每一个问题，都有清晰的回应。</span><RouterLink to="/tickets/new"><el-icon><Plus/></el-icon>创建工单</RouterLink></footer>
    </div>
  </div>
</template>
