import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import { api, setToken } from '../api'
import type { User } from '../types'
export const useAuth = defineStore('auth', () => {
  const user = ref<User | null>(null)
  const admin = computed(() => !!user.value?.roles.some(role => role.code === 'ADMIN'))
  const handler = computed(() => !!user.value?.roles.some(role => role.code === 'HANDLER'))
  const maintainer = computed(() => admin.value || handler.value)
  function clear() { setToken(''); user.value = null; window.dispatchEvent(new Event('session-cleared')) }
  async function login(username: string, password: string) {
    const result = await api<{ accessToken: string }>('POST', '/api/auth/login', { username, password })
    setToken(result.accessToken)
    try { user.value = await api<User>('GET', '/api/auth/me') } catch (error) { clear(); throw error }
  }
  async function logout() { await api('POST', '/api/auth/logout'); clear() }
  return { user, admin, handler, maintainer, login, logout, clear }
})
