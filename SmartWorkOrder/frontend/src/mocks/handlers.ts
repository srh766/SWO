import { http, HttpResponse, delay } from 'msw'
import * as db from './data'
import type { User, Ticket, Article, DocumentInfo, Message, AgentAction, Recommendation, Feedback } from '../types'
type Body = Record<string, unknown>
class Failure extends Error { constructor(public status: number, message: string) { super(message) } }
function check(ok: unknown, status = 400, message = '请求参数无效'): asserts ok { if (!ok) throw new Failure(status, message) }
const has = (u: User, role: string) => u.roles.some(r => r.code === role)
const admin = (u: User) => has(u, 'ADMIN')
const maintainer = (u: User) => admin(u) || has(u, 'HANDLER')
const person = (u: { id: string; name: string }) => ({ id: u.id, name: u.name })
const exists = <T extends { id: string }>(items: T[], id: string): T => { const value = items.find(x => x.id === id && !db.deleted.has(id)); check(value, 404, '内容不存在或已不可用'); return value }
function version(value: { version: number }, b: Body) { check(Number(b.version) === value.version, 409, '数据已被更新，请刷新后核对并重试') }
function text(b: Body, key: string, max = 20000) { check(typeof b[key] === 'string' && (b[key] as string).trim() && (b[key] as string).length <= max, 400, `请正确填写 ${key}`); return (b[key] as string).trim() }
function enabledDepartment(id: unknown) { const d = exists(db.departments, String(id)); check(d.status === 'ENABLED', 409, '目标部门已停用'); return d }
function invalidate(uid: string) { for (const [key, value] of db.sessions) if (value === uid) db.sessions.delete(key) }
function writableUser(u: User) { check(!db.tickets.some(t => !db.deleted.has(t.id) && t.assignee?.id === u.id && ['PENDING', 'PROCESSING'].includes(t.status)), 409, '该用户仍有未完成指派，请先转派工单') }
function lastAdmin(u: User) { check(!admin(u) || db.users.some(x => x.id !== u.id && x.status === 'ENABLED' && admin(x)), 409, '不能移除最后一个可用管理员') }
function canSeeTicket(u: User, t: Ticket) { return admin(u) || t.requester.id === u.id || (has(u, 'HANDLER') && (t.department.id === u.department?.id || t.assignee?.id === u.id)) }
function canHandle(u: User, t: Ticket) { return admin(u) || (has(u, 'HANDLER') && t.assignee?.id === u.id) }
function ticket(u: User, id: string) { const t = exists(db.tickets, id); check(canSeeTicket(u, t), 403, '你没有访问此工单的权限'); return t }
function canMaintain(u: User, k: Article | DocumentInfo) { return admin(u) || (has(u, 'HANDLER') && u.department?.id === k.department.id) }
function canRead(u: User, k: Article | DocumentInfo) { return canMaintain(u, k) || (k.status === 'PUBLISHED' && (k.scope === 'PUBLIC' || k.department.id === u.department?.id)) }
function scope(b: Body) { check(['PUBLIC', 'DEPARTMENT'].includes(String(b.scope)), 400, '请选择合法可见范围'); return String(b.scope) }
function page<T>(items: T[], q: URLSearchParams) { const p = Math.max(1, Number(q.get('page')) || 1), size = Math.min(100, Math.max(1, Number(q.get('pageSize')) || 20)); return { records: items.slice((p - 1) * size, p * size), total: items.length, page: p, pageSize: size } }
function dateFilter<T extends { createdAt: string }>(items: T[], q: URLSearchParams) { return items.filter(x => (!q.get('startAt') || x.createdAt >= q.get('startAt')!) && (!q.get('endAt') || x.createdAt < q.get('endAt')!)) }
function ok(data: unknown = null, status = 200) { return HttpResponse.json({ code: 0, message: '操作成功', data }, { status }) }
function log(t: Ticket, u: User, action: string, description: string, from: string | null, reason: string | null = null) { (db.logs[t.id] ||= []).push({ id: db.id(), action, operator: person(u), createdAt: db.now(), fromStatus: from, toStatus: t.status, reason, description }); t.updatedAt = db.now() }
function requestKey(u: User, path: string, b: Body) { return `${u.id}:${path}:${text(b, 'requestId', 100)}` }
function createTicket(u: User, b: Body) {
  const category = exists(db.categories, String(b.categoryId)); check(category.status === 'ENABLED' && category.defaultDepartment, 409, '分类已停用或未配置处理部门')
  const department = enabledDepartment(category.defaultDepartment.id)
  check(['LOW', 'MEDIUM', 'HIGH', 'URGENT'].includes(String(b.priority)), 400, '优先级无效')
  const t: Ticket = { id: db.id(), number: `TK-${new Date().getFullYear()}-${String(db.tickets.length + 1).padStart(5, '0')}`, title: text(b, 'title', 200), description: text(b, 'description'), category: person(category), priority: String(b.priority), status: 'PENDING', requester: person(u), department: person(department), assignee: null, createdAt: db.now(), updatedAt: db.now(), version: 1, solution: null, resolvedAt: null, closedAt: null }
  db.tickets.unshift(t); log(t, u, 'CREATE', '创建了工单', null); return t
}
function recommendations(u: User, query: string): { knowledge: Recommendation[]; tickets: Recommendation[] } {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  const matches = (title: string) => words.some(w => title.toLowerCase().includes(w) || [...w].filter(c => /[一-龥]/.test(c) && title.includes(c)).length >= 2)
  return {
    knowledge: db.articles.filter(k => !db.deleted.has(k.id) && k.status === 'PUBLISHED' && canRead(u, k) && matches(k.title)).slice(0, 4).map(k => ({ type: 'ARTICLE', id: k.id, title: k.title, excerpt: k.content.slice(0, 150), reason: '与当前问题相关的已发布知识' })),
    tickets: db.tickets.filter(t => !db.deleted.has(t.id) && canSeeTicket(u, t) && matches(t.title)).slice(0, 4).map(t => ({ type: 'TICKET', id: t.id, title: t.title, excerpt: t.description.slice(0, 150), reason: '你有权访问的相似工单' }))
  }
}
async function upload(request: Request) {
  const form = await request.formData(), file = form.get('file')
  check(file instanceof File && /\.(txt|md|markdown)$/i.test(file.name) && file.size > 0 && file.size <= 10 * 1024 * 1024, 400, '请选择 10 MiB 以内的 TXT 或 Markdown 文件')
  const raw = new Uint8Array(await file.arrayBuffer())
  try { const content = new TextDecoder('utf-8', { fatal: true }).decode(raw); check(!content.includes('\0'), 400, '文件必须为有效文本') } catch { throw new Failure(400, '文件必须为 UTF-8 文本，不能上传二进制文件') }
  return { b: Object.fromEntries(form.entries()) as Body, file }
}
function chat(u: User, id: string) { const c = exists(db.chats, id); check(c.ownerId === u.id, 403, '无法访问他人的会话'); return c }
function action(u: User, id: string) { const a = exists(db.actions, id); check(a.ownerId === u.id, 403, '无法访问此操作'); chat(u, a.chatId); if (a.status === 'PENDING' && Date.parse(a.expiresAt) <= Date.now()) a.status = 'EXPIRED'; return a }
const generations = new Map<string, AbortController>()
const messageRequests = new Map<string, string>()
function safeHistory(u: User, m: Message): Message {
  const references = m.references.map(r => { const k = r.type === 'ARTICLE' ? db.articles.find(x => x.id === r.sourceId) : db.documents.find(x => x.id === r.sourceId); const available = !!k && !db.deleted.has(k.id) && k.status === 'PUBLISHED' && k.version === r.contentVersion && canRead(u, k); return { ...r, available, excerpt: available ? r.excerpt : null } })
  const denied = references.some(r => !r.available)
  return { ...m, references, content: denied ? '原回答引用的知识已撤回、更新或不再可见，正文暂不可用，请重新提问。' : m.content, toolResults: m.toolResults.map(tool => ({ ...tool, results: tool.results.filter(r => r.type === 'TICKET' ? db.tickets.some(t => t.id === r.id && !db.deleted.has(t.id) && canSeeTicket(u, t)) : [...db.articles, ...db.documents].some(k => k.id === r.id && !db.deleted.has(k.id) && k.status === 'PUBLISHED' && canRead(u, k))) })) }
}
function generate(u: User, c: ReturnType<typeof chat>, b: Body, agent: boolean) {
  check(c.type === (agent ? 'AGENT' : 'KNOWLEDGE'), 400, '会话类型不匹配')
  const key = requestKey(u, `generate:${c.id}`, b), oldId = messageRequests.get(key)
  if (oldId) {
    const saved = db.messages[c.id]?.find(m => m.id === oldId); check(saved, 404)
    check(!['PENDING', 'GENERATING'].includes(saved.status), 409, '原请求仍在生成，请等待或刷新历史')
    return new HttpResponse(`event: meta\ndata: ${JSON.stringify({ chatId: c.id, messageId: saved.id, status: saved.status })}\n\nevent: delta\ndata: ${JSON.stringify({ text: safeHistory(u, saved).content })}\n\nevent: references\ndata: ${JSON.stringify({ items: safeHistory(u, saved).references })}\n\nevent: done\ndata: ${JSON.stringify({ messageId: saved.id, status: saved.status })}\n\n`, { headers: { 'Content-Type': 'text/event-stream' } })
  }
  check(!c.generation || c.generation.status !== 'GENERATING', 409, '该会话已有回答正在生成')
  const question = text(b, 'question'), started = Date.now()
  const userMessage: Message = { id: db.id(), chatId: c.id, role: 'USER', content: question, status: 'COMPLETED', references: [], toolResults: [], actionIds: [], feedback: null, createdAt: db.now() }
  const answer: Message = { ...userMessage, id: db.id(), role: 'ASSISTANT', content: '', status: 'GENERATING', references: [], toolResults: [], actionIds: [] }
  ;(db.messages[c.id] ||= []).push(userMessage, answer); c.generation = { messageId: answer.id, status: 'GENERATING' }; c.updatedAt = db.now(); messageRequests.set(key, answer.id)
  const control = new AbortController(); generations.set(answer.id, control)
  const source = recommendations(u, question)
  const knowledge = source.knowledge.map(r => exists(db.articles, r.id)).filter(k => db.indexes[k.id]?.status === 'SUCCESS' && db.indexes[k.id]?.contentVersion === k.version)
  let result = knowledge.length ? `以下为演示回答，实际环境将由知识检索服务生成。\n\n${knowledge[0]!.content}\n\n如果上述步骤仍无法解决，请创建工单并补充具体提示。` : '这是演示回答。当前没有找到可用且已建立索引的授权知识，无法据此给出确定结论。你可以换一种描述，或创建工单寻求同事协助。'
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const encoder = new TextEncoder()
      const send = (event: string, data: unknown) => controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`))
      try {
        send('meta', { chatId: c.id, messageId: answer.id, status: 'GENERATING' })
        if (agent) {
          const prepare = /创建|提单|提交.*工单|帮.*工单/.test(question)
          const tool = { id: db.id(), name: prepare ? 'prepare_ticket' : /工单/.test(question) ? 'search_tickets' : 'search_knowledge', status: 'RUNNING', summary: '正在查询当前身份可用的业务信息', results: [] as Recommendation[] }
          send('tool', tool); await delay(250)
          if (!control.signal.aborted && prepare) {
            const category = db.categories.find(k => k.status === 'ENABLED' && k.defaultDepartment && db.departments.some(d => d.id === k.defaultDepartment!.id && d.status === 'ENABLED'))
            check(category, 409, '没有可用分类，请联系管理员')
            const a: AgentAction & { ownerId: string } = { id: db.id(), chatId: c.id, ownerId: u.id, type: 'CREATE_TICKET', parameters: { title: question.slice(0, 200), description: question, categoryId: category.id, categoryName: category.name, priority: 'MEDIUM' }, status: 'PENDING', expiresAt: new Date(Date.now() + 15 * 60000).toISOString(), ticket: null, errorSummary: null }
            db.actions.push(a); answer.actionIds.push(a.id); send('action', { actionId: a.id }); result = '已准备好工单草稿。请核对下方参数，点击“确认创建”后才会提交。需要修改时，请取消本次操作后重新描述。'
          } else if (!prepare) { tool.results = /工单/.test(question) ? source.tickets : source.knowledge; result = tool.results.length ? '已查询到你当前有权访问的内容，请查看工具结果中的链接。此结果来自演示数据。' : '没有查到符合描述的授权内容。你可以补充关键词后再试。' }
          tool.status = 'COMPLETED'; tool.summary = prepare ? '已整理待确认参数，尚未创建工单' : `找到 ${tool.results.length} 条可访问结果`; answer.toolResults.push(tool); send('tool', tool)
        }
        answer.references = agent ? [] : knowledge.map(k => ({ id: db.id(), type: 'ARTICLE', sourceId: k.id, title: k.title, contentVersion: k.version, excerpt: k.content.slice(0, 150), available: true }))
        for (let i = 0; i < result.length; i += 9) {
          if (control.signal.aborted) break
          const current = db.users.find(x => x.id === u.id); check(current?.status === 'ENABLED', 401, '账号已失效')
          const chunk = result.slice(i, i + 9); answer.content += chunk; send('delta', { text: chunk }); await delay(35)
        }
        answer.status = control.signal.aborted ? 'STOPPED' : 'COMPLETED'; c.generation = null
        send('references', { items: safeHistory(u, answer).references }); send('done', { messageId: answer.id, status: answer.status, durationMs: Date.now() - started })
        db.calls.unshift({ id: db.id(), capability: agent ? 'AGENT' : 'KNOWLEDGE_CHAT', chatId: c.id, ticketId: null, model: '演示服务', durationMs: Date.now() - started, inputTokens: null, outputTokens: null, result: 'SUCCESS', errorSummary: null, createdAt: db.now() })
        controller.close()
      } catch (error) { answer.status = 'FAILED'; c.generation = null; try { send('error', { messageId: answer.id, code: 'DEMO_ERROR', message: error instanceof Error ? error.message : '生成失败', retryable: true }); controller.close() } catch { /* Stream already disconnected. */ } }
      finally { generations.delete(answer.id) }
    },
    cancel() { control.abort(); answer.status = 'INTERRUPTED'; c.generation = null }
  })
  return new HttpResponse(stream, { headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache' } })
}
async function dispatch(request: Request) {
  const url = new URL(request.url), q = url.searchParams, path = url.pathname, method = request.method
  let b: Body = {}
  if (!['GET', 'HEAD'].includes(method) && request.headers.get('content-type')?.includes('application/json')) {
    const raw = await request.text()
    if (raw) {
      try { b = JSON.parse(raw) as Body } catch { throw new Failure(400, '请求正文不是有效的 JSON') }
    }
  }
  if (path === '/api/auth/login' && method === 'POST') {
    const u = db.users.find(x => x.username === b.username); check(u && db.passwords[u.id] === b.password, 401, '用户名或密码错误'); check(u.status === 'ENABLED', 403, '账号已停用'); const token = db.id(); db.sessions.set(token, u.id); return ok({ accessToken: token, tokenType: 'Bearer', expiresAt: new Date(Date.now() + 3600000).toISOString(), user: u })
  }
  const token = request.headers.get('authorization')?.replace(/^Bearer /, '') || '', uid = db.sessions.get(token), u = db.users.find(x => x.id === uid)
  check(u && u.status === 'ENABLED', 401, '登录已失效，请重新登录')
  if (path === '/api/auth/me' && method === 'GET') return ok(u)
  if (path === '/api/auth/logout' && method === 'POST') { db.sessions.delete(token); for (const c of db.chats.filter(c => c.ownerId === u.id)) if (c.generation) generations.get(c.generation.messageId)?.abort(); return ok() }
  if (path === '/api/auth/password' && method === 'PUT') { check(db.passwords[u.id] === b.oldPassword, 400, '当前密码错误'); check(text(b, 'newPassword', 72).length >= 8, 400, '新密码至少8位'); db.passwords[u.id] = String(b.newPassword); invalidate(u.id); return ok() }
  if (path.startsWith('/api/users') || path.startsWith('/api/departments') || path === '/api/roles' || (path.startsWith('/api/ticket-categories') && method !== 'GET')) check(admin(u), 403, '仅管理员可执行此操作')
  if (path === '/api/roles' && method === 'GET') return ok(db.roles)
  const org = /^\/api\/(users|departments|ticket-categories)(?:\/([^/]+))?(?:\/(status|roles|password))?$/.exec(path)
  if (org) {
    const kind = org[1], rid = org[2], operation = org[3]
    if (kind === 'users') {
      if (!rid && method === 'GET') return ok(page(db.users.filter(x => (!q.get('username') || x.username.includes(q.get('username')!)) && (!q.get('name') || x.name.includes(q.get('name')!)) && (!q.get('departmentId') || x.department?.id === q.get('departmentId')) && (!q.get('roleId') || x.roles.some(r => r.id === q.get('roleId'))) && (!q.get('status') || x.status === q.get('status'))), q))
      if (!rid && method === 'POST') {
        const username = text(b, 'username', 100); check(!db.users.some(x => x.username === username), 409, '用户名已存在'); const department = enabledDepartment(b.departmentId), selected = db.roles.filter(r => (b.roleIds as string[] | undefined)?.includes(r.id)); check(selected.length && selected.length === (b.roleIds as string[]).length, 400, '请选择合法角色'); check(text(b, 'password', 72).length >= 8, 400, '密码至少8位')
        const value: User = { id: db.id(), username, name: text(b, 'name', 100), department, roles: selected, status: 'ENABLED', version: 1, permissions: [...new Set(selected.flatMap(r => r.permissions))] }; db.users.push(value); db.passwords[value.id] = String(b.password); return ok(value, 201)
      }
      const value = exists(db.users, rid || '')
      if (!operation && method === 'GET') return ok(value)
      if (operation === 'password' && method === 'PUT') { check(text(b, 'newPassword', 72).length >= 8, 400, '密码至少8位'); db.passwords[value.id] = String(b.newPassword); invalidate(value.id); return ok() }
      version(value, b)
      if (!operation && method === 'PATCH') { if (value.department?.id !== b.departmentId) writableUser(value); value.department = enabledDepartment(b.departmentId); value.name = text(b, 'name', 100) }
      else if (operation === 'status' && method === 'PUT') { check(['ENABLED', 'DISABLED'].includes(String(b.status))); if (b.status === 'DISABLED') { lastAdmin(value); writableUser(value) } value.status = String(b.status); invalidate(value.id) }
      else if (operation === 'roles' && method === 'PUT') { const selected = db.roles.filter(r => (b.roleIds as string[] | undefined)?.includes(r.id)); check(selected.length && selected.length === (b.roleIds as string[]).length); if (!selected.some(r => r.code === 'ADMIN')) lastAdmin(value); writableUser(value); value.roles = selected; value.permissions = [...new Set(selected.flatMap(r => r.permissions))]; invalidate(value.id) }
      else throw new Failure(404, '接口不存在')
      value.version++; return ok(value)
    }
    if (kind === 'departments') {
      if (!rid && method === 'GET') return ok(db.departments.filter(x => (!q.get('name') || x.name.includes(q.get('name')!)) && (!q.get('status') || x.status === q.get('status'))))
      if (!rid && method === 'POST') { const code = text(b, 'code', 100); check(!db.departments.some(x => x.code === code), 409, '部门编码已存在'); const value = { id: db.id(), name: text(b, 'name', 100), code, status: 'ENABLED', version: 1 }; db.departments.push(value); return ok(value, 201) }
      const value = exists(db.departments, rid || ''); version(value, b)
      if (!operation && method === 'PATCH') value.name = text(b, 'name', 100)
      else if (operation === 'status' && method === 'PUT') { check(['ENABLED', 'DISABLED'].includes(String(b.status))); if (b.status === 'DISABLED') check(!db.users.some(x => x.status === 'ENABLED' && x.department?.id === value.id) && !db.categories.some(x => x.status === 'ENABLED' && x.defaultDepartment?.id === value.id) && !db.tickets.some(x => !db.deleted.has(x.id) && x.department?.id === value.id && ['PENDING', 'PROCESSING'].includes(x.status)), 409, '部门存在启用用户、分类或未完成工单，不能停用'); value.status = String(b.status) }
      else throw new Failure(404, '接口不存在')
      value.version++; return ok(value)
    }
    if (!rid && method === 'GET') return ok(db.categories.filter(x => (admin(u) || x.status === 'ENABLED') && (!q.get('name') || x.name.includes(q.get('name')!)) && (!q.get('status') || x.status === q.get('status'))).map(x => { if (admin(u)) return x; const { defaultDepartment, ...visible } = x; return visible }))
    if (!rid && method === 'POST') { const code = text(b, 'code', 100); check(!db.categories.some(x => x.code === code), 409, '分类编码已存在'); const value = { id: db.id(), name: text(b, 'name', 100), code, description: String(b.description || ''), defaultDepartment: person(enabledDepartment(b.defaultDepartmentId)), status: 'ENABLED', version: 1 }; db.categories.push(value); return ok(value, 201) }
    const value = exists(db.categories, rid || ''); version(value, b)
    if (!operation && method === 'PATCH') { value.name = text(b, 'name', 100); value.description = String(b.description || ''); value.defaultDepartment = person(enabledDepartment(b.defaultDepartmentId)) }
    else if (operation === 'status' && method === 'PUT') { check(['ENABLED', 'DISABLED'].includes(String(b.status))); if (b.status === 'ENABLED') enabledDepartment(value.defaultDepartment?.id); value.status = String(b.status) }
    else throw new Failure(404, '接口不存在')
    value.version++; return ok(value)
  }
  if (path === '/api/tickets/ai-suggestions' && method === 'POST') { text(b, 'title'); text(b, 'description'); const c = db.categories.find(x => x.status === 'ENABLED'); check(c, 409, '没有可用分类'); return ok({ categoryId: c.id, priority: 'MEDIUM', reason: '演示建议：优先从常规服务处理，你可以自行调整。' }) }
  if (path === '/api/tickets/similar' && method === 'POST') return ok(recommendations(u, `${text(b, 'title')} ${text(b, 'description')}`))
  if (path === '/api/tickets' && method === 'GET') {
    const view = q.get('view') || 'mine'; check(view !== 'all' || admin(u), 403, '无权查看全部工单')
    let values = db.tickets.filter(t => !db.deleted.has(t.id) && canSeeTicket(u, t))
    if (view === 'mine') values = values.filter(t => t.requester.id === u.id)
    if (view === 'pending') { check(maintainer(u), 403); values = values.filter(t => t.status === 'PENDING' && (admin(u) || t.department.id === u.department?.id)) }
    if (view === 'assigned') { check(maintainer(u), 403); values = values.filter(t => t.assignee?.id === u.id) }
    values = dateFilter(values, q).filter(t => (!q.get('keyword') || `${t.title} ${t.number}`.includes(q.get('keyword')!)) && (!q.get('status') || t.status === q.get('status')) && (!q.get('categoryId') || t.category.id === q.get('categoryId')))
    return ok(page(values.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), q))
  }
  if (path === '/api/tickets' && method === 'POST') { const key = requestKey(u, path, b); if (db.requests.has(key)) return ok(db.requests.get(key), 201); const t = createTicket(u, b), result = { id: t.id, number: t.number, status: t.status, version: t.version }; db.requests.set(key, result); return ok(result, 201) }
  const tm = /^\/api\/tickets\/([^/]+)(?:\/(claim|assign|resolve|close|reopen|comments|logs|knowledge-draft|ai-summary|ai-draft))?$/.exec(path)
  if (tm) {
    const t = ticket(u, tm[1]!), operation = tm[2]
    if (!operation && method === 'GET') return ok(t)
    if (operation === 'comments' && method === 'GET') return ok(page(db.comments[t.id] || [], q))
    if (operation === 'logs' && method === 'GET') return ok(db.logs[t.id] || [])
    if (operation === 'comments' && method === 'POST') { check(t.status !== 'CLOSED' && (canHandle(u, t) || t.requester.id === u.id), 403, '当前不能评论此工单'); const value = { id: db.id(), author: person(u), content: text(b, 'content', 10000), createdAt: db.now() }; (db.comments[t.id] ||= []).push(value); return ok(value, 201) }
    if (operation === 'ai-summary' || operation === 'ai-draft') { check(method === 'POST' && canHandle(u, t), 403); return ok(operation === 'ai-summary' ? { summary: `演示摘要：${t.title}。${t.description}。当前状态：${t.status}。` } : { draft: `关于“${t.title}”，我们已收到你的反馈，正在核对相关配置。请补充发生时间和完整错误提示，帮助进一步定位。（演示草稿，请编辑后发送）` }) }
    if (operation === 'knowledge-draft' && method === 'POST') { check(canHandle(u, t) && ['RESOLVED', 'CLOSED'].includes(t.status), 403, '仅已解决或关闭的工单可沉淀知识'); const key = requestKey(u, path, b); if (db.requests.has(key)) return ok(db.requests.get(key), 201); const value: Article = { id: db.id(), title: text(b, 'title', 200), content: text(b, 'content'), scope: scope(b), department: person(enabledDepartment(u.department?.id)), status: 'DRAFT', author: person(u), createdAt: db.now(), updatedAt: db.now(), publishedAt: null, version: 1, sourceTicket: { id: t.id, number: t.number }, review: null }; db.articles.push(value); const result = { articleId: value.id }; db.requests.set(key, result); log(t, u, 'KNOWLEDGE_DRAFT', '整理为知识草稿', t.status); return ok(result, 201) }
    version(t, b); const before = t.status
    if (!operation && method === 'DELETE') { check(admin(u) && t.status === 'CLOSED', 403, '仅管理员可删除已关闭工单'); const reason = text(b, 'reason'); db.deleted.add(t.id); log(t, u, 'DELETE', '删除了工单', before, reason); return ok() }
    check(method === 'POST', 404)
    if (operation === 'claim') { check(has(u, 'HANDLER') && t.department.id === u.department?.id, 403); check(t.status === 'PENDING' && !t.assignee, 409, '该工单已被领取或状态已改变'); t.assignee = person(u); t.status = 'PROCESSING' }
    else if (operation === 'assign') { check(admin(u), 403); check(['PENDING', 'PROCESSING'].includes(t.status), 409); const d = enabledDepartment(b.departmentId), assigned = exists(db.users, String(b.assigneeId)); check(assigned.status === 'ENABLED' && has(assigned, 'HANDLER') && assigned.department?.id === d.id, 400, '处理人员不属于目标部门或已停用'); text(b, 'reason'); t.department = person(d); t.assignee = person(assigned); t.status = 'PROCESSING' }
    else if (operation === 'resolve') { check(canHandle(u, t), 403); check(t.status === 'PROCESSING', 409); t.solution = text(b, 'solution'); t.status = 'RESOLVED'; t.resolvedAt = db.now() }
    else if (operation === 'close' || operation === 'reopen') { check(t.requester.id === u.id, 403, '仅提交人可确认或重新打开'); check(t.status === 'RESOLVED', 409); if (operation === 'close') { t.status = 'CLOSED'; t.closedAt = db.now() } else { text(b, 'reason'); t.status = 'PENDING'; t.assignee = null } }
    else throw new Failure(404, '接口不存在')
    t.version++; log(t, u, operation!.toUpperCase(), ({ claim: '领取了工单', assign: '调整了工单指派', resolve: '提交了解决方案', close: '确认关闭工单', reopen: '重新打开工单' } as Record<string, string>)[operation!]!, before, typeof b.reason === 'string' ? b.reason : null); return ok(t)
  }
  const km = /^\/api\/knowledge\/(articles|documents)(?:\/([^/]+))?(?:\/(file|submit|approve|reject|withdraw|index-status|reindex))?$/.exec(path)
  if (km) {
    const isArticle = km[1] === 'articles', rid = km[2], op = km[3], list = isArticle ? db.articles : db.documents
    if (!rid && method === 'GET') { const values = list.filter(k => !db.deleted.has(k.id) && canRead(u, k) && (!q.get('status') || k.status === q.get('status')) && (!q.get('keyword') || k.title.includes(q.get('keyword')!)) && (!q.get('fileName') || `${k.title} ${'fileName' in k ? k.fileName : ''}`.includes(q.get('fileName')!)) && (!q.get('indexStatus') || (db.indexes[k.id]?.status || 'NOT_INDEXED') === q.get('indexStatus'))); return ok(page(values.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), q)) }
    if (!rid && method === 'POST') {
      check(maintainer(u), 403)
      let file: File | undefined
      if (!isArticle) { const uploaded = await upload(request); b = uploaded.b; file = uploaded.file }
      const common = { id: db.id(), title: text(b, 'title', 200), scope: scope(b), department: person(enabledDepartment(u.department?.id)), status: 'DRAFT', author: person(u), createdAt: db.now(), updatedAt: db.now(), publishedAt: null, version: 1, review: null }
      if (isArticle) { const value: Article = { ...common, content: text(b, 'content'), sourceTicket: null }; db.articles.push(value); return ok(value, 201) }
      const value: DocumentInfo = { ...common, fileName: file!.name, format: /\.txt$/i.test(file!.name) ? 'TXT' : 'MARKDOWN', sizeBytes: file!.size }; db.documents.push(value); db.files[value.id] = file!; return ok(value, 201)
    }
    const value = exists<Article | DocumentInfo>(list, rid || ''); check(canRead(u, value), 403, '你没有访问此知识的权限')
    if (!op && method === 'GET') return ok(value)
    if (op === 'file' && method === 'GET' && !isArticle) return new HttpResponse(db.files[value.id], { headers: { 'Content-Type': 'text/plain;charset=utf-8', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent((value as DocumentInfo).fileName)}` } })
    check(canMaintain(u, value), 403, '只有知识维护者可执行此操作')
    if (op === 'index-status' && method === 'GET') return ok(db.indexes[value.id] || { contentVersion: value.version, status: 'NOT_INDEXED', taskId: null, retryCount: 0, errorSummary: null, updatedAt: null })
    if (op === 'reindex' && method === 'POST') { check(value.status === 'PUBLISHED' && Number(b.contentVersion) === value.version, 409, '内容未发布或版本已改变'); scheduleIndex(value); return ok({ taskId: db.indexes[value.id]!.taskId, status: db.indexes[value.id]!.status }, 202) }
    let file: File | undefined
    if (op === 'file' && method === 'PUT' && !isArticle) { const uploaded = await upload(request); b = uploaded.b; file = uploaded.file }
    version(value, b)
    if ((!op && method === 'PATCH') || (op === 'file' && method === 'PUT')) {
      check(value.status === 'DRAFT', 409, '请先撤回为草稿后编辑')
      if (file) { const d = value as DocumentInfo; d.fileName = file.name; d.sizeBytes = file.size; d.format = /\.txt$/i.test(file.name) ? 'TXT' : 'MARKDOWN'; db.files[d.id] = file }
      else { value.title = text(b, 'title', 200); value.scope = scope(b); if (isArticle) (value as Article).content = text(b, 'content') }
    } else if (!op && method === 'DELETE') { check(value.status === 'DRAFT', 409, '仅草稿可删除'); db.deleted.add(value.id); delete db.indexes[value.id]; return ok() }
    else if (op === 'submit' && method === 'POST') { check(value.status === 'DRAFT', 409); value.status = 'PENDING_REVIEW' }
    else if ((op === 'approve' || op === 'reject') && method === 'POST') { check(admin(u), 403); check(value.status === 'PENDING_REVIEW', 409); const comment = op === 'reject' ? text(b, 'reason') : String(b.comment || ''); value.review = { reviewer: person(u), comment, reviewedAt: db.now() }; value.status = op === 'approve' ? 'PUBLISHED' : 'DRAFT'; value.publishedAt = op === 'approve' ? db.now() : null }
    else if (op === 'withdraw' && method === 'POST') { check(['PENDING_REVIEW', 'PUBLISHED'].includes(value.status), 409); text(b, 'reason'); value.status = 'DRAFT'; value.publishedAt = null; delete db.indexes[value.id] }
    else throw new Failure(404, '接口不存在')
    value.version++; value.updatedAt = db.now(); if (op === 'approve') scheduleIndex(value); return ok(value)
  }
  if (path === '/api/chats' && method === 'GET') return ok(page(db.chats.filter(c => c.ownerId === u.id && !db.deleted.has(c.id) && (!q.get('type') || c.type === q.get('type'))).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)), q))
  if (path === '/api/chats' && method === 'POST') { check(['KNOWLEDGE', 'AGENT'].includes(String(b.type))); const c = { id: db.id(), title: text(b, 'title', 200), type: String(b.type), version: 1, createdAt: db.now(), updatedAt: db.now(), generation: null, ownerId: u.id }; db.chats.push(c); return ok(c, 201) }
  const cm = /^\/api\/chats\/([^/]+)(?:\/messages(?:\/([^/]+)\/stop)?)?$/.exec(path)
  if (cm) {
    const c = chat(u, cm[1]!)
    if (cm[2] && method === 'POST') { const m = exists(db.messages[c.id] || [], cm[2]); if (m.status === 'GENERATING') { generations.get(m.id)?.abort(); m.status = 'STOPPED'; c.generation = null } return ok({ messageId: m.id, status: m.status }) }
    if (path.endsWith('/messages')) { if (method === 'GET') return ok(page([...(db.messages[c.id] || [])].reverse().map(m => safeHistory(u, m)), q)); if (method === 'POST') return generate(u, c, b, false) }
    if (method === 'GET') return ok(c)
    if (method === 'PATCH') { version(c, b); c.title = text(b, 'title', 200); c.version++; return ok(c) }
    if (method === 'DELETE') { if (c.generation) generations.get(c.generation.messageId)?.abort(); db.deleted.add(c.id); db.actions.filter(a => a.chatId === c.id && a.status === 'PENDING').forEach(a => { a.status = 'CANCELLED' }); return ok() }
  }
  if (path === '/api/agent/messages' && method === 'POST') return generate(u, chat(u, String(b.chatId)), b, true)
  const am = /^\/api\/agent\/actions\/([^/]+)(?:\/(confirm|cancel))?$/.exec(path)
  if (am) {
    const a = action(u, am[1]!)
    if (!am[2] && method === 'GET') return ok(a)
    check(method === 'POST', 404)
    if (am[2] === 'cancel') { check(a.status !== 'EXECUTED', 409, '操作已经执行，不能取消'); if (a.status === 'PENDING') a.status = 'CANCELLED'; return ok(a) }
    text(b, 'requestId', 100); if (a.status === 'EXECUTED') return ok(a)
    check(a.status === 'PENDING', 409, '操作已过期、取消或不可执行')
    const t = createTicket(u, a.parameters); a.status = 'EXECUTED'; a.ticket = { id: t.id, number: t.number }; return ok(a)
  }
  const fm = /^\/api\/messages\/([^/]+)\/feedback$/.exec(path)
  if (fm && method === 'POST') { const m = Object.values(db.messages).flat().find(m => m.id === fm[1]); check(m, 404); chat(u, m.chatId); check(m.role === 'ASSISTANT' && m.status === 'COMPLETED', 409, '仅完整回答可反馈'); check(b.resolved === null || typeof b.resolved === 'boolean'); check(b.satisfaction === null || ['SATISFIED', 'DISSATISFIED'].includes(String(b.satisfaction))); m.feedback = { satisfaction: b.satisfaction as string | null, resolved: b.resolved as boolean | null, reason: typeof b.reason === 'string' ? b.reason : null } as Feedback; return ok(m.feedback) }
  if (path === '/api/stats/tickets' && method === 'GET') { const values = dateFilter(db.tickets.filter(t => !db.deleted.has(t.id) && canSeeTicket(u, t)), q), done = values.filter(t => ['RESOLVED', 'CLOSED'].includes(t.status) && t.resolvedAt); return ok({ total: values.length, statusDistribution: ['PENDING', 'PROCESSING', 'RESOLVED', 'CLOSED'].map(status => ({ status, count: values.filter(t => t.status === status).length })), categoryDistribution: db.categories.map(c => ({ categoryId: c.id, categoryName: c.name, count: values.filter(t => t.category.id === c.id).length })), averageResolutionSeconds: done.length ? done.reduce((sum, t) => sum + (Date.parse(t.resolvedAt!) - Date.parse(t.createdAt)) / 1000, 0) / done.length : null }) }
  if ((path === '/api/stats/ai' || path === '/api/ai/calls') && method === 'GET') {
    check(admin(u), 403); const values = dateFilter(db.calls, q).filter(c => (!q.get('capability') || c.capability === q.get('capability')) && (!q.get('result') || c.result === q.get('result')))
    if (path === '/api/ai/calls') return ok(page(values, q))
    const allAnswers = dateFilter(Object.values(db.messages).flat().filter(m => m.role === 'ASSISTANT' && m.status === 'COMPLETED'), q), feedback = allAnswers.filter(m => m.feedback), explicit = feedback.filter(m => m.feedback?.resolved !== null), resolved = explicit.filter(m => m.feedback?.resolved), success = values.filter(c => c.result === 'SUCCESS').length
    return ok({ callCount: values.length, successCount: success, successRate: values.length ? success / values.length : null, averageDurationMs: values.length ? values.reduce((sum, c) => sum + c.durationMs, 0) / values.length : null, knownInputTokens: values.some(c => c.inputTokens !== null) ? values.reduce((sum, c) => sum + (c.inputTokens || 0), 0) : null, knownOutputTokens: values.some(c => c.outputTokens !== null) ? values.reduce((sum, c) => sum + (c.outputTokens || 0), 0) : null, unknownUsageCallCount: values.filter(c => c.inputTokens === null || c.outputTokens === null).length, cacheHits: 0, cacheEligibleRequests: values.length, cacheHitRate: values.length ? 0 : null, feedbackCount: feedback.length, answerCount: allAnswers.length, resolvedFeedbackCount: resolved.length, unresolvedFeedbackCount: explicit.length - resolved.length, selfServiceResolutionRate: explicit.length ? resolved.length / explicit.length : null, feedbackCoverageRate: allAnswers.length ? feedback.length / allAnswers.length : null })
  }
  throw new Failure(404, `未定义的演示接口：${method} ${path}`)
}
function scheduleIndex(value: Article | DocumentInfo) {
  const previous = db.indexes[value.id]
  if (previous?.contentVersion === value.version && ['PENDING', 'PROCESSING'].includes(previous.status)) return
  const taskId = db.id(), contentVersion = value.version
  db.indexes[value.id] = { taskId, contentVersion, status: 'PENDING', retryCount: previous ? previous.retryCount + 1 : 0, errorSummary: null, updatedAt: db.now() }
  setTimeout(() => { const state = db.indexes[value.id]; if (state?.taskId === taskId && value.status === 'PUBLISHED' && value.version === contentVersion) { state.status = 'PROCESSING'; state.updatedAt = db.now() } }, 500)
  setTimeout(() => { const state = db.indexes[value.id]; if (state?.taskId === taskId && value.status === 'PUBLISHED' && value.version === contentVersion && !db.deleted.has(value.id)) { state.status = 'SUCCESS'; state.updatedAt = db.now() } }, 1800)
}
export const handlers = [http.all('/api/*', async ({ request }) => { await delay(180); try { return await dispatch(request) } catch (error) { const failure = error instanceof Failure ? error : new Failure(500, error instanceof Error ? error.message : '演示操作失败'); return HttpResponse.json({ code: failure.status, message: failure.message, data: null }, { status: failure.status }) } })]
