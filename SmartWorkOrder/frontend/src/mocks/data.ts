import type { Article, Category, Department, DocumentInfo, Role, Ticket, User, Comment, TicketLog, Chat, Message, AgentAction, IndexStatus, AiCall } from '../types'
export const now = () => new Date().toISOString()
export const id = () => crypto.randomUUID()
const ago = (hours: number) => new Date(Date.now() - hours * 3600000).toISOString()
export const departments: Department[] = [
  { id: 'dep-it', name: '信息技术部', code: 'IT', status: 'ENABLED', version: 1 },
  { id: 'dep-ops', name: '运营部', code: 'OPS', status: 'ENABLED', version: 1 },
  { id: 'dep-hr', name: '人力资源部', code: 'HR', status: 'ENABLED', version: 1 }
]
export const roles: Role[] = [
  { id: 'employee', code: 'EMPLOYEE', name: '员工', description: '提交与跟进本人工单，查阅授权知识，使用智能助手', permissions: ['ticket:create', 'ticket:read', 'knowledge:read', 'chat:use'] },
  { id: 'handler', code: 'HANDLER', name: '处理人员', description: '处理本部门及指派工单，维护本部门知识', permissions: ['ticket:create', 'ticket:read', 'ticket:handle', 'knowledge:read', 'knowledge:maintain', 'chat:use'] },
  { id: 'admin', code: 'ADMIN', name: '管理员', description: '管理组织、指派工单、审核知识、查阅全局统计', permissions: ['ticket:create', 'ticket:read', 'ticket:handle', 'ticket:assign', 'ticket:delete', 'knowledge:read', 'knowledge:maintain', 'knowledge:review', 'user:manage', 'system:manage', 'stats:ai', 'chat:use'] }
]
export const users: User[] = [
  { id: 'u-employee', username: 'employee', name: '林晓', department: departments[1]!, roles: [roles[0]!], status: 'ENABLED', version: 1, permissions: roles[0]!.permissions },
  { id: 'u-handler', username: 'handler', name: '陈嘉', department: departments[0]!, roles: [roles[1]!], status: 'ENABLED', version: 1, permissions: roles[1]!.permissions },
  { id: 'u-admin', username: 'admin', name: '周宁', department: departments[0]!, roles: [roles[2]!], status: 'ENABLED', version: 1, permissions: roles[2]!.permissions },
  { id: 'u-other', username: 'employee2', name: '许言', department: departments[2]!, roles: [roles[0]!], status: 'ENABLED', version: 1, permissions: roles[0]!.permissions }
]
export const passwords: Record<string, string> = Object.fromEntries(users.map(u => [u.id, 'Demo123!']))
export const sessions = new Map<string, string>()
export const categories: Category[] = [
  { id: 'c-it', name: '账号与权限', code: 'ACCOUNT', description: '账号登录、系统访问及权限申请', defaultDepartment: departments[0]!, status: 'ENABLED', version: 1 },
  { id: 'c-device', name: '设备与网络', code: 'DEVICE', description: '办公设备、网络连接与软件问题', defaultDepartment: departments[0]!, status: 'ENABLED', version: 1 },
  { id: 'c-hr', name: '人事服务', code: 'HR_SERVICE', description: '人事流程与相关证明', defaultDepartment: departments[2]!, status: 'ENABLED', version: 1 }
]
const titles = ['数据平台访问权限申请', '会议室投屏连接不稳定', '办公网络无法连接 VPN', '新员工邮箱开通流程咨询', '协作平台登录异常', '打印机驱动安装协助', '数据报表导出权限调整']
export const tickets: Ticket[] = titles.map((title, i) => ({
  id: `t-${i + 1}`, number: `TK-202611-${String(i + 1).padStart(4, '0')}`, title,
  description: ['需要访问运营数据平台的日报模块，用于本周业务复盘。当前提示没有访问权限，请协助确认申请流程。', '使用会议室无线投屏时画面反复断开，已尝试重新连接，问题仍然存在。', '连接办公 VPN 后无法打开内部系统，提示连接超时。请协助排查。'][i % 3]!,
  category: categories[i % 2]!, priority: ['HIGH', 'MEDIUM', 'HIGH', 'LOW', 'MEDIUM', 'MEDIUM', 'LOW'][i]!, status: ['PENDING', 'PROCESSING', 'RESOLVED', 'CLOSED', 'PENDING', 'PROCESSING', 'CLOSED'][i]!,
  requester: users[i === 6 ? 3 : 0]!, department: departments[0]!, assignee: i === 0 || i === 4 ? null : users[1]!,
  createdAt: ago(48 + i * 5), updatedAt: ago(i + 1), version: 1,
  solution: i === 2 || i === 3 || i === 6 ? '已检查相关配置并完成修复，请重新登录验证。如仍有问题，可在确认关闭前补充说明。' : null,
  resolvedAt: i === 2 || i === 3 || i === 6 ? ago(5 + i) : null, closedAt: i === 3 || i === 6 ? ago(2 + i) : null
}))
export const comments: Record<string, Comment[]> = { 't-2': [{ id: 'comment-1', content: '已收到，我会在今天下午检查会议室接收器与网络配置。', author: users[1]!, createdAt: ago(3) }] }
export const logs: Record<string, TicketLog[]> = Object.fromEntries(tickets.map(t => [t.id, [{ id: id(), action: 'CREATE', operator: t.requester, createdAt: t.createdAt, fromStatus: null, toStatus: 'PENDING', reason: null, description: '创建了工单' }]]))
export const articles: Article[] = [
  { id: 'a-1', title: '办公 VPN 连接与常见问题', content: '## 连接前的检查\n\n确认设备已接入互联网，并使用公司分配的账号登录。\n\n## 无法连接时\n\n1. 检查客户端是否为公司提供的版本。\n2. 退出客户端后重新登录。\n3. 如提示账号无权限，请提交“账号与权限”工单。\n\n请不要向任何人提供密码或验证码。', scope: 'PUBLIC', department: departments[0]!, status: 'PUBLISHED', author: users[1]!, createdAt: ago(150), updatedAt: ago(24), publishedAt: ago(24), version: 2, sourceTicket: null, review: { reviewer: users[2]!, comment: '内容已核对', reviewedAt: ago(24) } },
  { id: 'a-2', title: '数据平台权限申请指南', content: '## 申请前准备\n\n说明需要访问的数据范围、使用目的和预计时长。\n\n## 提交申请\n\n创建“账号与权限”工单，填写具体模块和业务用途。处理人员会根据授权流程核对申请。', scope: 'PUBLIC', department: departments[0]!, status: 'PUBLISHED', author: users[1]!, createdAt: ago(90), updatedAt: ago(18), publishedAt: ago(18), version: 2, sourceTicket: { id: 't-3', number: tickets[2]!.number }, review: null },
  { id: 'a-3', title: '会议室无线投屏排查清单', content: '## 排查步骤\n\n确认终端与接收器处于同一网络，然后重新启动投屏应用。\n\n仍然异常时记录会议室名称、终端型号和发生时间。', scope: 'DEPARTMENT', department: departments[0]!, status: 'PENDING_REVIEW', author: users[1]!, createdAt: ago(12), updatedAt: ago(2), publishedAt: null, version: 1, sourceTicket: null, review: null }
]
export const documents: DocumentInfo[] = [{ id: 'd-1', title: '办公设备使用指引', fileName: '办公设备使用指引.md', format: 'MARKDOWN', sizeBytes: 180, scope: 'PUBLIC', department: departments[0]!, status: 'PUBLISHED', author: users[1]!, createdAt: ago(80), updatedAt: ago(20), publishedAt: ago(20), version: 1, review: null }]
export const files: Record<string, Blob> = { 'd-1': new Blob(['# 办公设备使用指引\n\n遇到设备问题时，请记录设备编号、故障现象和发生时间，再提交设备与网络工单。'], { type: 'text/markdown;charset=utf-8' }) }
export const indexes: Record<string, IndexStatus> = { 'a-1': { contentVersion: 2, status: 'SUCCESS', taskId: 'job-1', retryCount: 0, errorSummary: null, updatedAt: ago(23) } }
export const chats: (Chat & { ownerId: string })[] = []
export const messages: Record<string, Message[]> = {}
export const actions: (AgentAction & { ownerId: string })[] = []
export const calls: AiCall[] = []
export const requests = new Map<string, unknown>()
export const deleted = new Set<string>()
