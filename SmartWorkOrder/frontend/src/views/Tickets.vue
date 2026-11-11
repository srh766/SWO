<script setup lang="ts">
import { computed, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import type { FormInstance, FormRules } from 'element-plus'
import { Plus, Search, Refresh, ArrowLeft, MagicStick, ChatLineRound, Clock, Document } from '@element-plus/icons-vue'
import { api, ApiError } from '../api'
import { useAuth } from '../stores/auth'
import { formatDate, statusLabel, errorText, notifyError } from '../utils'
import type { Ticket, Category, Page, Comment, TicketLog, User, Department, Recommendation } from '../types'
const route = useRoute(), router = useRouter(), auth = useAuth()
const creating = computed(() => route.path === '/tickets/new')
const ticketId = computed(() => typeof route.params.id === 'string' ? route.params.id : '')
const detail = computed(() => !!ticketId.value)
const workbench = computed(() => route.path === '/workbench')
const busy = ref(false), loading = ref(false), error = ref(''), total = ref(0)
const categories = ref<Category[]>([]), records = ref<Ticket[]>([]), ticket = ref<Ticket | null>(null)
const comments = ref<Comment[]>([]), logs = ref<TicketLog[]>([]), commentPage = ref(1), commentTotal = ref(0), activity = ref('comments'), comment = ref('')
const filters = reactive({ keyword: '', status: '', categoryId: '', view: 'mine', page: 1, pageSize: 10 })
const dates = ref<[string, string] | null>(null)
const formRef = ref<FormInstance>(), createId = ref(crypto.randomUUID())
const form = reactive({ title: '', description: '', categoryId: '', priority: 'MEDIUM' })
const rules: FormRules = { title: [{ required: true, message: '请输入工单标题', trigger: 'blur' }, { max: 200, message: '标题不能超过 200 个字符' }], description: [{ required: true, message: '请描述问题和已尝试的处理方法', trigger: 'blur' }, { max: 20000, message: '描述不能超过 20000 个字符' }], categoryId: [{ required: true, message: '请选择问题分类', trigger: 'change' }], priority: [{ required: true, message: '请选择优先级' }] }
const aiBusy = ref(''), aiError = ref(''), suggestion = ref<{ categoryId: string; priority: string; reason: string } | null>(null), recommendations = ref<{ knowledge: Recommendation[]; tickets: Recommendation[] } | null>(null), aiSummary = ref(''), draft = ref(''), intent = ref('说明当前进展，并引导用户验证问题是否解决')
const dialog = ref(''), actionText = ref(''), actionScope = ref('PUBLIC'), actionTitle = ref(''), actionError = ref(''), conflict = ref(false), knowledgeId = ref(crypto.randomUUID())
const departments = ref<Department[]>([]), assignees = ref<User[]>([]), departmentId = ref(''), assigneeId = ref(''), assigneeLoading = ref(false)
let loadEpoch = 0
const mine = computed(() => ticket.value?.requester.id === auth.user?.id)
const canHandle = computed(() => !!ticket.value && (auth.admin || (auth.handler && ticket.value.assignee?.id === auth.user?.id)))
const canClaim = computed(() => !!ticket.value && auth.handler && ticket.value.status === 'PENDING' && !ticket.value.assignee && ticket.value.department.id === auth.user?.department?.id)
const canComment = computed(() => !!ticket.value && ticket.value.status !== 'CLOSED' && (mine.value || canHandle.value))
const canKnowledge = computed(() => !!ticket.value && canHandle.value && ['RESOLVED', 'CLOSED'].includes(ticket.value.status))
const viewOptions = computed(() => [{ value: 'mine', label: '我提交的' }, ...(auth.maintainer ? [{ value: 'pending', label: '部门待处理' }, { value: 'assigned', label: '我负责的' }] : []), ...(auth.admin ? [{ value: 'all', label: '全部工单' }] : [])])
const dialogTitle = computed(() => ({ assign: '分配或转派', resolve: '提交解决方案', reopen: '重新打开工单', delete: '删除已关闭工单', knowledge: '整理为知识草稿' }[dialog.value] || '工单操作'))
function params() { return { ...filters, keyword: filters.keyword || undefined, status: filters.status || undefined, categoryId: filters.categoryId || undefined, startAt: dates.value?.[0], endAt: dates.value?.[1] } }
async function load() {
  const epoch = ++loadEpoch; loading.value = true; error.value = ''
  try {
    if (detail.value) {
      const currentId = ticketId.value
      const [t, c, l] = await Promise.all([api<Ticket>('GET', `/api/tickets/${currentId}`), api<Page<Comment>>('GET', `/api/tickets/${currentId}/comments`, undefined, { page: 1, pageSize: 20 }), api<TicketLog[]>('GET', `/api/tickets/${currentId}/logs`)])
      if (epoch !== loadEpoch) return
      ticket.value = t; comments.value = c.records; commentTotal.value = c.total; commentPage.value = 1; logs.value = l
    } else if (!creating.value) {
      const response = await api<Page<Ticket>>('GET', '/api/tickets', undefined, params())
      if (epoch !== loadEpoch) return
      records.value = response.records; total.value = response.total
    }
  } catch (e) { if (epoch === loadEpoch) error.value = errorText(e) } finally { if (epoch === loadEpoch) loading.value = false }
}
async function loadCategories() { try { categories.value = await api<Category[]>('GET', '/api/ticket-categories') } catch (e) { notifyError(e) } }
function search() { filters.page = 1; void syncList() }
async function syncList() {
  await router.replace({ path: route.path, query: { view: filters.view, ...(filters.keyword ? { keyword: filters.keyword } : {}), ...(filters.status ? { status: filters.status } : {}), ...(filters.categoryId ? { categoryId: filters.categoryId } : {}), page: String(filters.page), ...(dates.value ? { startAt: dates.value[0], endAt: dates.value[1] } : {}) } })
}
async function create() {
  if (!await formRef.value?.validate().catch(() => false)) return
  busy.value = true
  try { const result = await api<{ id: string }>('POST', '/api/tickets', { ...form, requestId: createId.value }); createId.value = crypto.randomUUID(); ElMessage.success('工单已创建'); await router.push(`/tickets/${result.id}`) } catch (e) { notifyError(e) } finally { busy.value = false }
}
async function aiCreate(kind: string) {
  if (!form.title.trim() || !form.description.trim()) { ElMessage.warning('请先填写标题和问题描述'); return }
  aiBusy.value = kind; aiError.value = ''
  try {
    if (kind === 'suggestions') suggestion.value = await api('POST', '/api/tickets/ai-suggestions', { title: form.title, description: form.description })
    else recommendations.value = await api('POST', '/api/tickets/similar', { title: form.title, description: form.description })
  } catch (e) { aiError.value = errorText(e) } finally { aiBusy.value = '' }
}
function adopt() {
  if (!suggestion.value) return
  if (!categories.value.some(c => c.id === suggestion.value!.categoryId && c.status === 'ENABLED') || !['LOW', 'MEDIUM', 'HIGH', 'URGENT'].includes(suggestion.value.priority)) { ElMessage.warning('建议已失效，请手动选择分类与优先级'); return }
  form.categoryId = suggestion.value.categoryId; form.priority = suggestion.value.priority; ElMessage.success('已采用建议，你仍可修改')
}
function recommendationPath(r: Recommendation) { return r.type === 'TICKET' ? `/tickets/${r.id}` : `/knowledge/${r.type === 'ARTICLE' ? 'articles' : 'documents'}/${r.id}` }
async function quickAction(action: string) {
  if (!ticket.value) return
  try { if (action === 'close') await ElMessageBox.confirm('确认问题已解决后，工单将关闭且不可继续评论。', '确认关闭', { confirmButtonText: '确认关闭', cancelButtonText: '取消', type: 'warning' }) } catch { return }
  busy.value = true
  try { await api('POST', `/api/tickets/${ticketId.value}/${action}`, { version: ticket.value.version }); ElMessage.success(action === 'claim' ? '已领取工单' : '工单已关闭'); await load() } catch (e) { notifyError(e); if (e instanceof ApiError && e.status === 409) await load() } finally { busy.value = false }
}
async function openAction(action: string) {
  dialog.value = action; actionText.value = action === 'knowledge' ? `${ticket.value?.description || ''}\n\n解决方案\n${ticket.value?.solution || ''}` : ''; actionTitle.value = ticket.value?.title || ''; actionError.value = ''; conflict.value = false; knowledgeId.value = crypto.randomUUID(); departmentId.value = ''; assigneeId.value = ''
  if (action === 'assign') try { departments.value = (await api<Department[]>('GET', '/api/departments', undefined, { status: 'ENABLED' })).filter(d => d.status === 'ENABLED') } catch (e) { actionError.value = errorText(e) }
}
async function selectDepartment() {
  assigneeId.value = ''; assignees.value = []; if (!departmentId.value) return
  assigneeLoading.value = true
  try {
    const all: User[] = []; let page = 1
    while (true) { const result = await api<Page<User>>('GET', '/api/users', undefined, { departmentId: departmentId.value, status: 'ENABLED', page, pageSize: 100 }); all.push(...result.records); if (all.length >= result.total || !result.records.length) break; page++ }
    assignees.value = all.filter(u => u.department?.id === departmentId.value && u.status === 'ENABLED' && u.roles.some(r => r.code === 'HANDLER'))
  } catch (e) { actionError.value = errorText(e) } finally { assigneeLoading.value = false }
}
async function submitAction() {
  if (!ticket.value) return
  if (dialog.value === 'assign' && (!departmentId.value || !assigneeId.value)) { actionError.value = '请选择目标部门和处理人员'; return }
  if (!actionText.value.trim() || (dialog.value === 'knowledge' && !actionTitle.value.trim())) { actionError.value = '请填写完整内容'; return }
  busy.value = true; actionError.value = ''
  try {
    const version = ticket.value.version, action = dialog.value
    if (action === 'knowledge') {
      const result = await api<{ articleId: string }>('POST', `/api/tickets/${ticketId.value}/knowledge-draft`, { title: actionTitle.value, content: actionText.value, scope: actionScope.value, requestId: knowledgeId.value }); dialog.value = ''; ElMessage.success('知识草稿已创建，审核发布后才可阅读'); await router.push(`/knowledge/articles/${result.articleId}`)
    } else {
      const payload = action === 'assign' ? { departmentId: departmentId.value, assigneeId: assigneeId.value, reason: actionText.value, version } : action === 'resolve' ? { solution: actionText.value, version } : { reason: actionText.value, version }
      await api(action === 'delete' ? 'DELETE' : 'POST', action === 'delete' ? `/api/tickets/${ticketId.value}` : `/api/tickets/${ticketId.value}/${action}`, payload)
      dialog.value = ''; ElMessage.success('操作已完成'); if (action === 'delete') await router.push('/tickets'); else await load()
    }
  } catch (e) { actionError.value = errorText(e); conflict.value = e instanceof ApiError && e.status === 409 } finally { busy.value = false }
}
async function refreshVersion() { await load(); conflict.value = false; actionError.value = '已刷新最新状态，请核对后重新提交。填写内容已保留。' }
async function postComment() {
  if (!comment.value.trim()) return
  busy.value = true
  try { await api('POST', `/api/tickets/${ticketId.value}/comments`, { content: comment.value }); comment.value = ''; ElMessage.success('评论已发送'); await load() } catch (e) { notifyError(e) } finally { busy.value = false }
}
async function moreComments() { try { const result = await api<Page<Comment>>('GET', `/api/tickets/${ticketId.value}/comments`, undefined, { page: commentPage.value + 1, pageSize: 20 }); comments.value.push(...result.records); commentPage.value++ } catch (e) { notifyError(e) } }
async function aiDetail(kind: string) {
  aiBusy.value = kind; aiError.value = ''
  try { if (kind === 'summary') aiSummary.value = (await api<{ summary: string }>('POST', `/api/tickets/${ticketId.value}/ai-summary`, {})).summary; else draft.value = (await api<{ draft: string }>('POST', `/api/tickets/${ticketId.value}/ai-draft`, { intent: intent.value })).draft } catch (e) { aiError.value = errorText(e) } finally { aiBusy.value = '' }
}
watch(() => route.fullPath, () => {
  suggestion.value = null; recommendations.value = null; aiSummary.value = ''; draft.value = ''; aiError.value = ''; ticket.value = null
  const allowed = viewOptions.value.map(v => v.value)
  const defaultView = workbench.value && auth.maintainer ? (auth.admin ? 'all' : 'pending') : 'mine'
  filters.view = typeof route.query.view === 'string' && allowed.includes(route.query.view) ? route.query.view : defaultView
  filters.keyword = String(route.query.keyword || ''); filters.status = String(route.query.status || ''); filters.categoryId = String(route.query.categoryId || ''); filters.page = Math.max(1, Number(route.query.page) || 1)
  dates.value = typeof route.query.startAt === 'string' && typeof route.query.endAt === 'string' ? [route.query.startAt, route.query.endAt] : null
  void load(); void loadCategories()
}, { immediate: true })
</script>
<template>
  <div class="page">
    <div class="page-header"><div><el-button v-if="creating || detail" text :icon="ArrowLeft" @click="router.push('/tickets')">返回工单</el-button><h1>{{ creating ? '创建工单' : detail ? '工单详情' : workbench ? `你好，${auth.user?.name}` : '工单' }}</h1><p class="subtitle">{{ creating ? '清楚描述问题，让合适的同事更快为你提供帮助。' : detail ? '让处理过程清晰可追踪。' : workbench ? '从待办开始，让每个问题都有进展。' : '跟进服务请求，记录每一次协作与解决。' }}</p></div><RouterLink v-if="!creating" to="/tickets/new"><el-button type="primary" :icon="Plus">创建工单</el-button></RouterLink></div>
    <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon><template #default><el-button text @click="load">重新加载</el-button></template></el-alert>
    <template v-if="creating"><div class="detail-grid create-grid"><section class="surface"><el-form ref="formRef" :model="form" :rules="rules" label-position="top" @submit.prevent="create"><el-form-item label="工单标题" prop="title"><el-input v-model="form.title" maxlength="200" show-word-limit placeholder="用一句话说明你遇到的问题"/></el-form-item><el-form-item label="问题描述" prop="description"><el-input v-model="form.description" type="textarea" :rows="9" maxlength="20000" show-word-limit placeholder="发生了什么？影响哪些工作？你已经尝试过哪些方法？"/></el-form-item><div class="form-columns"><el-form-item label="问题分类" prop="categoryId"><el-select v-model="form.categoryId" placeholder="请选择分类"><el-option v-for="c in categories.filter(c => c.status === 'ENABLED')" :key="c.id" :label="c.name" :value="c.id"/></el-select></el-form-item><el-form-item label="优先级" prop="priority"><el-select v-model="form.priority"><el-option v-for="p in ['LOW','MEDIUM','HIGH','URGENT']" :key="p" :label="statusLabel(p)" :value="p"/></el-select></el-form-item></div><hr class="section-rule"><div class="actions"><el-button type="primary" native-type="submit" :loading="busy">提交工单</el-button><el-button @click="router.push('/tickets')">取消</el-button><span class="form-help">提交后可在详情补充评论。</span></div></el-form></section><aside class="stack"><section class="surface ai-panel"><h2><el-icon><MagicStick/></el-icon> 提单助手</h2><p class="muted">建议仅供参考，由你决定是否采用。</p><el-button :loading="aiBusy === 'suggestions'" :disabled="!!aiBusy" @click="aiCreate('suggestions')">建议分类与优先级</el-button><div v-if="suggestion" class="hint suggestion"><div>{{ categories.find(c=>c.id===suggestion?.categoryId)?.name || '分类不可用' }} · {{ statusLabel(suggestion.priority) }}优先级</div><p>{{ suggestion.reason }}</p><el-button text type="primary" @click="adopt">采用建议</el-button></div><hr class="section-rule"><h3>也许已有答案</h3><p class="muted">在提交前查找可访问的知识和相似工单。</p><el-button :loading="aiBusy === 'similar'" :disabled="!!aiBusy" @click="aiCreate('similar')">查找相似内容</el-button><template v-if="recommendations"><p v-if="!recommendations.knowledge.length && !recommendations.tickets.length" class="muted">没有找到相似内容，可继续提交工单。</p><RouterLink v-for="r in [...recommendations.knowledge,...recommendations.tickets]" :key="r.type+r.id" :to="recommendationPath(r)" class="recommendation"><span class="muted">{{ statusLabel(r.type) }}</span><strong>{{ r.title }}</strong><small>{{ r.reason }}</small></RouterLink></template></section><el-alert v-if="aiError" :title="aiError" description="你仍可正常填写并提交工单。" type="warning" :closable="false"/><div class="hint">请勿在问题描述中填写密码、验证码或其他敏感凭据。</div></aside></div></template>
    <section v-else-if="!detail" class="surface list-surface" v-loading="loading"><el-tabs v-model="filters.view" @tab-change="search"><el-tab-pane v-for="v in viewOptions" :key="v.value" :label="v.label" :name="v.value"/></el-tabs><div class="toolbar"><el-input v-model="filters.keyword" :prefix-icon="Search" placeholder="搜索工单标题或编号" clearable @keyup.enter="search" @clear="search"/><el-select v-model="filters.status" placeholder="所有状态" clearable @change="search"><el-option v-for="s in ['PENDING','PROCESSING','RESOLVED','CLOSED']" :key="s" :label="statusLabel(s)" :value="s"/></el-select><el-select v-model="filters.categoryId" placeholder="所有分类" clearable @change="search"><el-option v-for="c in categories" :key="c.id" :label="c.name" :value="c.id"/></el-select><el-date-picker v-model="dates" type="datetimerange" value-format="YYYY-MM-DDTHH:mm:ssZ" start-placeholder="创建开始" end-placeholder="创建结束" @change="search"/><el-button :icon="Refresh" aria-label="刷新工单" @click="load"/></div><div class="count-line">共 {{ total }} 个工单</div><el-table :data="records" style="width:100%" empty-text="暂无工单，创建工单后可在这里跟进。"><el-table-column label="工单" min-width="280"><template #default="{row}"><div class="ticket-no">{{ row.number }}</div><RouterLink class="ticket-link" :to="`/tickets/${row.id}`">{{ row.title }}</RouterLink></template></el-table-column><el-table-column label="状态" width="112"><template #default="{row}"><span class="status" :class="row.status">{{ statusLabel(row.status) }}</span></template></el-table-column><el-table-column label="优先级" width="90"><template #default="{row}"><span class="priority-dot" :class="row.priority"/>{{ statusLabel(row.priority) }}</template></el-table-column><el-table-column label="分类" min-width="110" prop="category.name"/><el-table-column label="处理人" width="105"><template #default="{row}">{{ row.assignee?.name || '待领取' }}</template></el-table-column><el-table-column label="更新时间" width="140"><template #default="{row}">{{ formatDate(row.updatedAt) }}</template></el-table-column></el-table><el-pagination v-model:current-page="filters.page" :page-size="filters.pageSize" :total="total" layout="prev,pager,next" @current-change="syncList"/></section>
    <div v-else v-loading="loading"><template v-if="ticket"><section class="surface ticket-heading"><div><div class="ticket-no">{{ ticket.number }}<span class="status" :class="ticket.status">{{ statusLabel(ticket.status) }}</span></div><h2>{{ ticket.title }}</h2><p class="muted">{{ ticket.requester.name }} 提交于 {{ formatDate(ticket.createdAt) }}</p></div><div class="actions"><el-button v-if="canClaim" type="primary" :loading="busy" @click="quickAction('claim')">领取工单</el-button><el-button v-if="auth.admin && ['PENDING','PROCESSING'].includes(ticket.status)" @click="openAction('assign')">分配 / 转派</el-button><el-button v-if="canHandle && ticket.status === 'PROCESSING'" type="primary" @click="openAction('resolve')">标记已解决</el-button><el-button v-if="mine && ticket.status === 'RESOLVED'" type="primary" :loading="busy" @click="quickAction('close')">确认关闭</el-button><el-button v-if="mine && ticket.status === 'RESOLVED'" @click="openAction('reopen')">仍未解决</el-button><el-button v-if="auth.admin && ticket.status === 'CLOSED'" type="danger" plain @click="openAction('delete')">删除工单</el-button><el-button :icon="Refresh" text @click="load">刷新</el-button></div></section><div class="detail-grid"><div class="stack"><section class="surface"><h2>问题描述</h2><p class="ticket-content">{{ ticket.description }}</p><template v-if="ticket.solution"><hr class="section-rule"><h2 class="solution-title">解决方案</h2><p class="ticket-content">{{ ticket.solution }}</p><p class="muted">解决于 {{ formatDate(ticket.resolvedAt) }}</p></template></section><section class="surface"><el-tabs v-model="activity"><el-tab-pane name="comments"><template #label><el-icon><ChatLineRound/></el-icon> 沟通记录</template></el-tab-pane><el-tab-pane name="logs"><template #label><el-icon><Clock/></el-icon> 操作历史</template></el-tab-pane></el-tabs><template v-if="activity === 'comments'"><div v-if="!comments.length" class="empty">暂无沟通记录，可在下方补充信息。</div><article v-for="c in comments" :key="c.id" class="comment-item"><span class="avatar">{{ c.author.name.slice(0,1) }}</span><div><div class="row"><strong>{{ c.author.name }}</strong><time>{{ formatDate(c.createdAt) }}</time></div><p class="ticket-content">{{ c.content }}</p></div></article><el-button v-if="comments.length < commentTotal" text @click="moreComments">加载更多评论</el-button><div v-if="canComment" class="comment-composer"><el-input v-model="comment" type="textarea" :rows="3" placeholder="补充问题信息，或与同事沟通处理进展" maxlength="10000"/><div class="actions"><el-button type="primary" :loading="busy" :disabled="!comment.trim()" @click="postComment">发送评论</el-button></div></div><p v-else class="hint">{{ ticket.status === 'CLOSED' ? '工单已关闭，沟通记录仅供查阅。' : '你可查看此工单，当前没有评论权限。' }}</p></template><div v-else><div v-for="l in logs" :key="l.id" class="log-item"><span class="log-dot"/><div><strong>{{ l.operator.name }}</strong> {{ l.description }}<p v-if="l.reason" class="muted">{{ l.reason }}</p><time>{{ formatDate(l.createdAt) }}</time></div></div><div v-if="!logs.length" class="empty">暂无操作记录</div></div></section></div><aside class="stack"><section class="surface"><h2>工单属性</h2><dl class="key-value"><dt>优先级</dt><dd><span class="priority-dot" :class="ticket.priority"/>{{ statusLabel(ticket.priority) }}</dd><dt>问题分类</dt><dd>{{ ticket.category.name }}</dd><dt>处理部门</dt><dd>{{ ticket.department.name }}</dd><dt>处理人员</dt><dd>{{ ticket.assignee?.name || '尚未领取' }}</dd><dt>提交人</dt><dd>{{ ticket.requester.name }}</dd><dt>更新时间</dt><dd>{{ formatDate(ticket.updatedAt) }}</dd></dl></section><section v-if="canHandle" class="surface ai-panel"><h2><el-icon><MagicStick/></el-icon> 处理助手</h2><p class="muted">协助梳理信息，内容由你审核。</p><el-button :loading="aiBusy === 'summary'" :disabled="!!aiBusy" @click="aiDetail('summary')">生成工单摘要</el-button><p v-if="aiSummary" class="hint ticket-content">{{ aiSummary }}</p><template v-if="canComment"><hr class="section-rule"><el-input v-model="intent" placeholder="回复意图"/><el-button class="draft-button" :loading="aiBusy === 'draft'" :disabled="!!aiBusy" @click="aiDetail('draft')">生成回复草稿</el-button><template v-if="draft"><el-input v-model="draft" type="textarea" :rows="6"/><el-button text type="primary" @click="comment = draft">放入评论框</el-button></template></template><el-alert v-if="aiError" :title="aiError" type="warning" :closable="false"/></section><section v-if="canKnowledge" class="surface"><h2><el-icon><Document/></el-icon> 让经验可以复用</h2><p class="muted">将已解决的问题整理为知识，审核后供同事查阅。</p><el-button @click="openAction('knowledge')">转为知识草稿</el-button></section></aside></div></template></div>
    <el-dialog :model-value="!!dialog" @close="dialog = ''" :title="dialogTitle" width="600px" :before-close="() => { if (!busy) dialog = '' }"><el-alert v-if="actionError" :title="actionError" type="warning" :closable="false"><template #default><el-button v-if="conflict" text @click="refreshVersion">刷新最新状态并保留输入</el-button></template></el-alert><el-form label-position="top" @submit.prevent="submitAction"><template v-if="dialog === 'assign'"><el-form-item label="目标部门" required><el-select v-model="departmentId" @change="selectDepartment"><el-option v-for="d in departments" :key="d.id" :label="d.name" :value="d.id"/></el-select></el-form-item><el-form-item label="处理人员" required><el-select v-model="assigneeId" :disabled="!departmentId" :loading="assigneeLoading" no-data-text="该部门暂无可用处理人员"><el-option v-for="u in assignees" :key="u.id" :label="u.name" :value="u.id"/></el-select></el-form-item></template><template v-if="dialog === 'knowledge'"><el-form-item label="知识标题" required><el-input v-model="actionTitle" maxlength="200"/></el-form-item><el-form-item label="可见范围"><el-radio-group v-model="actionScope"><el-radio value="PUBLIC">全员可见</el-radio><el-radio value="DEPARTMENT">本部门</el-radio></el-radio-group></el-form-item><p class="hint">草稿不会立即公开，需提交审核后发布。源工单仍按原权限访问。</p></template><el-form-item :label="dialog === 'resolve' ? '解决方案' : dialog === 'knowledge' ? '整理正文' : '操作原因'" required><el-input v-model="actionText" type="textarea" :rows="7" maxlength="20000"/></el-form-item><p v-if="dialog === 'delete'" class="muted">删除后工单从列表隐藏，业务记录与审计日志由服务端保留。</p></el-form><template #footer><el-button :disabled="busy" @click="dialog = ''">取消</el-button><el-button :type="dialog === 'delete' ? 'danger' : 'primary'" :loading="busy" :disabled="conflict" @click="submitAction">{{ dialog === 'knowledge' ? '创建知识草稿' : dialog === 'delete' ? '确认删除' : '确认提交' }}</el-button></template></el-dialog>
  </div>
</template>
<style scoped>
.form-columns{display:grid;grid-template-columns:1fr 1fr;gap:20px}.form-columns .el-select{width:100%}.create-grid{grid-template-columns:minmax(0,1fr) 320px}.ai-panel h2{font-size:16px;display:flex;align-items:center;gap:7px}.ai-panel>.el-button{font-size:12px}.suggestion{margin-top:15px}.suggestion p{margin:8px 0 0}.recommendation{display:block;padding:14px 0;border-top:1px solid #edf0f4;margin-top:12px}.recommendation strong,.recommendation small{display:block;line-height:1.7}.recommendation strong{font-size:13px;margin:5px 0}.recommendation small{font-size:11px;color:#8492a2}.ticket-heading{display:flex;justify-content:space-between;align-items:center;gap:20px;margin-bottom:22px;padding:26px}.ticket-heading h2{font-size:22px;margin:14px 0 12px}.ticket-heading p{margin-bottom:0}.ticket-heading .status{margin-left:12px}.ticket-content{white-space:pre-wrap;overflow-wrap:anywhere;font-size:14px;line-height:1.9;color:#52667a;margin-bottom:0}.solution-title{color:#277f69}.comment-item{display:flex;gap:13px;padding:20px 0;border-bottom:1px solid #edf1f5;font-size:13px}.comment-item>div{flex:1;min-width:0}.comment-item strong{font-size:12px}.comment-item time,.log-item time{font-size:11px;color:#9aa6b3}.comment-item .ticket-content{font-size:13px;margin-top:8px}.comment-composer{margin-top:22px}.comment-composer .actions{justify-content:flex-end;margin-top:12px}.log-item{display:flex;gap:15px;padding:16px 0;font-size:13px}.log-item time{display:block;margin-top:7px}.log-item p{margin:6px 0}.log-dot{width:8px;height:8px;border-radius:50%;background:#97b9c1;margin-top:6px;flex-shrink:0}.draft-button{margin:12px 0}.ai-panel .el-alert{margin-top:16px}@media(max-width:1000px){.create-grid{grid-template-columns:1fr}.ticket-heading{flex-direction:column;align-items:flex-start}}@media(max-width:600px){.form-columns{grid-template-columns:1fr;gap:0}.ticket-heading h2{font-size:19px}}
</style>
