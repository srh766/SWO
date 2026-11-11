import axios from 'axios'
import type { AxiosError } from 'axios'

export const demo = import.meta.env.VITE_DEMO === 'true'
let token = ''
export function setToken(value: string) { token = value }
export function getToken() { return token }
export class ApiError extends Error {
  constructor(message: string, public status: number, public errors: { field: string; message: string }[] = []) { super(message) }
}
const client = axios.create({ timeout: 30000 })
client.interceptors.request.use(config => {
  if (token) config.headers.Authorization = `Bearer ${token}`
  return config
})
client.interceptors.response.use(response => response, async (error: AxiosError<{ message?: string; errors?: { field: string; message: string }[] }>) => {
  const status = error.response?.status || 0
  if (status === 401 && error.config?.url !== '/api/auth/login') window.dispatchEvent(new Event('auth-expired'))
  let problem = error.response?.data
  if (problem instanceof Blob) {
    try { problem = JSON.parse(await problem.text()) as typeof problem } catch { problem = undefined }
  }
  const retryAfter = error.response?.headers['retry-after']
  const base = problem?.message || (status === 403 ? '你没有访问此内容的权限' : status === 404 ? '内容不存在或已不可用' : status === 409 ? '数据已被更新，请刷新后重试' : status === 429 ? '请求过于频繁，请稍后重试' : '无法连接服务，请检查网络或稍后重试')
  const message = status === 429 && retryAfter ? `${base}（建议 ${retryAfter} 秒后重试）` : base
  return Promise.reject(new ApiError(message, status, problem?.errors))
})
export async function api<T>(method: string, path: string, data?: unknown, params?: object): Promise<T> {
  const response = await client.request<{ code: number; message: string; data: T }>({ method, url: path, data, params })
  if (response.data.code !== 0) throw new ApiError(response.data.message || '操作未完成', response.status)
  return response.data.data
}
export async function download(path: string, name: string) {
  const response = await client.get<Blob>(path, { responseType: 'blob' })
  const url = URL.createObjectURL(response.data)
  const anchor = document.createElement('a')
  anchor.href = url; anchor.download = name; anchor.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
