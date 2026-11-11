import { ElMessage } from 'element-plus'
import DOMPurify from 'dompurify'
import { Marked } from 'marked'
const renderer = new Marked({ renderer: { html: () => '', image: () => '' } })
export const labels: Record<string, string> = {
  PENDING: '待处理', PROCESSING: '处理中', RESOLVED: '已解决', CLOSED: '已关闭',
  LOW: '低', MEDIUM: '普通', HIGH: '高', URGENT: '紧急', DRAFT: '草稿', PENDING_REVIEW: '待审核', PUBLISHED: '已发布',
  PUBLIC: '全员可见', DEPARTMENT: '本部门', ENABLED: '启用', DISABLED: '停用', NOT_INDEXED: '未建立索引', SUCCESS: '成功', FAILED: '失败',
  KNOWLEDGE: '知识问答', AGENT: '业务助手', GENERATING: '生成中', COMPLETED: '已完成', STOPPED: '已停止', INTERRUPTED: '已中断',
  EXECUTING: '执行中', EXECUTED: '已创建', CANCELLED: '已取消', EXPIRED: '已过期', RUNNING: '执行中',
  EMPLOYEE: '员工', HANDLER: '处理人员', ADMIN: '管理员', ARTICLE: '知识文章', DOCUMENT: '知识文档', TICKET: '工单',
  KNOWLEDGE_CHAT: '知识问答', TICKET_SUGGESTIONS: '分类建议', TICKET_SUMMARY: '工单摘要', TICKET_DRAFT: '回复草稿', SIMILAR_SEARCH: '相似推荐', INDEX: '知识索引'
}
export function statusLabel(value: string | null | undefined) { return value ? labels[value] || value : '—' }
export function formatDate(value: string | null | undefined) { return value ? new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value)) : '—' }
export function errorText(error: unknown) { return error instanceof Error ? error.message : '操作失败，请重试' }
export function notifyError(error: unknown) { ElMessage.error(errorText(error)) }
export function markdown(text: string) { return DOMPurify.sanitize(renderer.parse(text, { async: false }) as string, { FORBID_TAGS: ['style', 'iframe', 'form'], FORBID_ATTR: ['style'] }) }
export function percent(value: number | null | undefined) { return value == null ? '未知' : `${(value * 100).toFixed(1)}%` }
export function duration(seconds: number | null | undefined) { return seconds == null ? '暂无数据' : seconds < 3600 ? `${Math.round(seconds / 60)} 分钟` : `${(seconds / 3600).toFixed(1)} 小时` }
