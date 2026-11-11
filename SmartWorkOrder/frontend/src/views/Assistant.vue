<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, reactive, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, EditPen, Delete, Refresh, Promotion, ChatDotRound, Reading, Tickets, CircleCheck, VideoPause } from '@element-plus/icons-vue'
import DOMPurify from 'dompurify'
import { Marked } from 'marked'
import { api, ApiError, download } from '../api'
import { useChats } from '../stores/chats'
import type { ChatType } from '../stores/chats'
import type { AgentAction, Article, Chat, DocumentInfo, Feedback, Message, Recommendation, Reference } from '../types'
import { errorText, formatDate, notifyError, statusLabel } from '../utils'

const route = useRoute()
const router = useRouter()
const chats = useChats()
const kind = computed<ChatType>(() => route.params.kind === 'agent' ? 'AGENT' : 'KNOWLEDGE')
const chatId = computed(() => typeof route.params.chatId === 'string' ? route.params.chatId : '')
const title = computed(() => kind.value === 'AGENT' ? '业务助手' : '知识问答')
const list = computed(() => chats.lists[kind.value])
const conversation = computed(() => chatId.value ? chats.conversations[chatId.value] : undefined)
const messages = computed(() => conversation.value?.messages || [])
const generating = computed(() => !!chatId.value && chats.isGenerating(chatId.value))
const matching = computed(() => !conversation.value?.chat || conversation.value.chat.type === kind.value)
const drafts = reactive<Record<string, string>>({})
const draftKey = computed(() => `${kind.value}:${chatId.value || 'new'}`)
const feedbackOpen = ref(false)
const feedbackChatId = ref('')
const feedbackMessageId = ref('')
const feedback = reactive({ satisfaction: '', resolved: '', reason: '' })
const question = computed({ get: () => drafts[draftKey.value] || '', set: value => { drafts[draftKey.value] = value } })
const sending = ref(false)
const creating = ref(false)
const chatBusy = reactive<Record<string, boolean>>({})
const sourceBusy = reactive<Record<string, boolean>>({})
const sourceErrors = reactive<Record<string, string>>({})
const transcript = ref<HTMLElement>()
const stickToBottom = ref(true)
const loadingEarlier = ref(false)
const now = ref(Date.now())
let alive = true
let session = 0
const clock = window.setInterval(() => { now.value = Date.now() }, 1000)
const canSend = computed(() => !!question.value.trim() && question.value.trim().length <= 8000 && !sending.value && !creating.value && !generating.value && matching.value && (!chatId.value || (!!conversation.value?.loaded && !conversation.value.loading && !conversation.value.loadingMore && !conversation.value.stopping && !conversation.value.deleting && !conversation.value.error && !conversation.value.historyError)))
const stopReady = computed(() => {
  const state = conversation.value
  return !!state && (state.chat?.generation?.messageId || state.messages.some(message => message.role === 'ASSISTANT' && ['GENERATING', 'PENDING'].includes(message.status) && !message.id.startsWith('local-')))
})
const hasEarlier = computed(() => !!conversation.value && conversation.value.page * 20 < conversation.value.total)
const toolNames: Record<string, string> = { search_tickets: '查询工单', search_knowledge: '检索知识', prepare_ticket: '准备工单草稿' }
const actionLabels: Record<string, string> = { PENDING: '待确认', EXECUTING: '正在创建', EXECUTED: '已创建工单', CANCELLED: '已取消', EXPIRED: '已过期', FAILED: '创建失败' }

const escape = (text: string) => text.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!)
const renderer = new Marked({
  breaks: true,
  renderer: {
    html: () => '',
    image: ({ text }) => escape(text),
    link({ href, tokens }) {
      const text = this.parser.parseInline(tokens)
      if (!/^https?:\/\//i.test(href)) return text
      try {
        const url = new URL(href)
        if (url.username || url.password) return text
        return `<a href="${escape(url.href)}" target="_blank" rel="noopener noreferrer">${text}</a>`
      } catch { return text }
    },
  },
})
function renderAnswer(text: string) {
  return DOMPurify.sanitize(renderer.parse(text, { async: false }) as string, {
    ALLOWED_TAGS: ['p', 'br', 'strong', 'em', 'del', 'blockquote', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'pre', 'code', 'hr', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'a'],
    ALLOWED_ATTR: ['href', 'target', 'rel', 'start'],
  })
}
function chatPath(type: ChatType, id = '') { return `/assistant/${type === 'AGENT' ? 'agent' : 'knowledge'}${id ? `/${encodeURIComponent(id)}` : ''}` }
function actionStatus(action: AgentAction) {
  return action.status === 'PENDING' && (!Number.isFinite(Date.parse(action.expiresAt)) || Date.parse(action.expiresAt) <= now.value) ? 'EXPIRED' : action.status
}
function remaining(action: AgentAction) {
  const seconds = Math.max(0, Math.ceil((Date.parse(action.expiresAt) - now.value) / 1000))
  return Number.isFinite(seconds) ? `${Math.floor(seconds / 60)} 分 ${seconds % 60} 秒后过期` : '有效期不可用，请刷新状态'
}
function messageLabel(message: Message) { return message.status === 'PENDING' ? '正在连接' : statusLabel(message.status) }
function shortDate(value: string) { return Number.isFinite(Date.parse(value)) ? formatDate(value) : '时间未知' }
function onScroll() {
  const element = transcript.value
  if (element) stickToBottom.value = element.scrollHeight - element.scrollTop - element.clientHeight < 96
}
async function scrollBottom() {
  await nextTick()
  if (transcript.value) transcript.value.scrollTop = transcript.value.scrollHeight
}
watch([kind, chatId], ([type, id], previous) => {
  feedbackOpen.value = false
  stickToBottom.value = true
  if (!previous || type !== previous[0]) void chats.loadList(type)
  if (id) void chats.openChat(id, type).then(() => { if (id === chatId.value) void scrollBottom() })
}, { immediate: true })
watch(() => [messages.value.length, messages.value.at(-1)?.content, messages.value.at(-1)?.status, messages.value.at(-1)?.toolResults.length, messages.value.at(-1)?.actionIds.length], () => {
  if (stickToBottom.value && !loadingEarlier.value) void scrollBottom()
})
async function moreHistory() {
  if (!chatId.value || !conversation.value || loadingEarlier.value || generating.value) return
  const element = transcript.value
  const height = element?.scrollHeight || 0
  const top = element?.scrollTop || 0
  const id = chatId.value
  loadingEarlier.value = true
  await chats.loadHistory(id, kind.value, true)
  await nextTick()
  if (id === chatId.value && element) element.scrollTop = top + element.scrollHeight - height
  loadingEarlier.value = false
}
async function refreshHistory() {
  if (chatId.value) await chats.loadHistory(chatId.value, kind.value)
}
async function create() {
  if (creating.value) return
  const type = kind.value
  const path = route.fullPath
  const token = session
  creating.value = true
  try {
    const chat = await chats.createChat(type, type === 'AGENT' ? '新的业务会话' : '新的知识问答')
    if (chat && alive && token === session && route.fullPath === path) await router.push(chatPath(type, chat.id))
  } catch (error) { if (alive && token === session) notifyError(error) }
  finally { if (token === session) creating.value = false }
}
async function rename(chat: Chat) {
  if (chatBusy[chat.id]) return
  const token = session
  try {
    const result = await ElMessageBox.prompt('为会话设置一个便于查找的标题', '重命名会话', {
      inputValue: chat.title, confirmButtonText: '保存', cancelButtonText: '取消',
      inputValidator: value => !!value?.trim() && value.trim().length <= 80 || '请输入 1–80 个字符',
      closeOnClickModal: false,
    })
    if (token !== session || !alive) return
    chatBusy[chat.id] = true
    await chats.renameChat(chat, result.value.trim())
  } catch (error) { if (error !== 'cancel' && error !== 'close' && token === session) notifyError(error) }
  finally { if (token === session) delete chatBusy[chat.id] }
}
async function remove(chat: Chat) {
  if (chatBusy[chat.id]) return
  const token = session
  try {
    await ElMessageBox.confirm(`删除“${chat.title}”及其消息？进行中的回答会停止，未执行的确认操作会失效。`, '删除会话', { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消', closeOnClickModal: false })
    if (token !== session || !alive) return
    chatBusy[chat.id] = true
    if (await chats.deleteChat(chat)) {
      delete drafts[`${chat.type}:${chat.id}`]
      if (chatId.value === chat.id) await router.replace(chatPath(kind.value))
    }
  } catch (error) { if (error !== 'cancel' && error !== 'close' && token === session) notifyError(error) }
  finally { if (token === session) delete chatBusy[chat.id] }
}
async function send() {
  if (!canSend.value) return
  const type = kind.value
  let id = chatId.value
  const text = question.value.trim()
  const key = draftKey.value
  const path = route.fullPath
  const token = session
  sending.value = true
  try {
    if (!id) {
      const chat = await chats.createChat(type, text.length > 30 ? `${text.slice(0, 30)}…` : text)
      if (!chat || token !== session || !alive) return
      id = chat.id
      await chats.loadHistory(id, type)
    }
    if (!alive || token !== session) return
    if (chats.send(id, type, text)) {
      drafts[key] = ''
      stickToBottom.value = true
      if (route.fullPath === path && chatId.value !== id) await router.push(chatPath(type, id))
      await scrollBottom()
    } else ElMessage.warning('会话正在更新或生成中，请核对历史后再发送')
  } catch (error) { if (token === session && alive) notifyError(error) }
  finally { if (token === session) sending.value = false }
}
function onInputKey(event: KeyboardEvent) {
  if (event.key === 'Enter' && (event.ctrlKey || event.metaKey) && !event.isComposing) { event.preventDefault(); void send() }
}
function invalidateSource(type: Reference['type'], id: string) {
  for (const state of Object.values(chats.conversations)) for (const message of state.messages) {
    for (const reference of message.references) if (reference.type === type && reference.sourceId === id) { reference.available = false; reference.excerpt = null }
    for (const tool of message.toolResults) tool.results = tool.results.filter(item => item.type !== type || item.id !== id)
  }
}
async function openSource(source: { type: Reference['type']; sourceId: string; available?: boolean }) {
  if (source.available === false) return
  const key = `${source.type}:${source.sourceId}`
  if (sourceBusy[key]) return
  const token = session
  const path = route.fullPath
  sourceBusy[key] = true
  sourceErrors[key] = ''
  try {
    const id = encodeURIComponent(source.sourceId)
    if (source.type === 'ARTICLE') {
      await api<Article>('GET', `/api/knowledge/articles/${id}`)
      if (alive && token === session && route.fullPath === path) await router.push(`/knowledge/articles/${id}`)
    } else {
      const document = await api<DocumentInfo>('GET', `/api/knowledge/documents/${id}`)
      if (alive && token === session) await download(`/api/knowledge/documents/${id}/file`, document.fileName)
    }
  } catch (error) {
    if (alive && token === session) {
      sourceErrors[key] = errorText(error)
      if (error instanceof ApiError && [403, 404].includes(error.status)) invalidateSource(source.type, source.sourceId)
      notifyError(error)
    }
  } finally { if (token === session) delete sourceBusy[key] }
}
function openResult(result: Recommendation) {
  if (result.type === 'TICKET') void router.push(`/tickets/${encodeURIComponent(result.id)}`)
  else void openSource({ type: result.type, sourceId: result.id })
}
function canFeedback(message: Message) { return message.role === 'ASSISTANT' && !message.id.startsWith('local-') && ['COMPLETED', 'STOPPED'].includes(message.status) }
function editFeedback(message: Message) {
  feedbackChatId.value = message.chatId
  feedbackMessageId.value = message.id
  feedback.satisfaction = message.feedback?.satisfaction || ''
  feedback.resolved = message.feedback?.resolved == null ? '' : message.feedback.resolved ? 'yes' : 'no'
  feedback.reason = message.feedback?.reason || ''
  feedbackOpen.value = true
}
async function submitFeedback() {
  const token = session
  const body: Feedback = { satisfaction: feedback.satisfaction || null, resolved: feedback.resolved === '' ? null : feedback.resolved === 'yes', reason: feedback.reason.trim() || null }
  if (await chats.saveFeedback(feedbackChatId.value, feedbackMessageId.value, body)) {
    if (alive && token === session) { feedbackOpen.value = false; ElMessage.success('反馈已保存') }
  }
}
function feedbackSummary(value: Feedback) {
  return [value.satisfaction === 'SATISFIED' ? '满意' : value.satisfaction === 'DISSATISFIED' ? '不满意' : '', value.resolved === true ? '已解决' : value.resolved === false ? '未解决' : ''].filter(Boolean).join(' / ') || '已反馈'
}
function clearLocal() {
  session++
  feedbackOpen.value = false
  sending.value = false
  creating.value = false
  for (const record of [drafts, chatBusy, sourceBusy, sourceErrors]) for (const key of Object.keys(record)) delete record[key]
  feedback.satisfaction = ''; feedback.resolved = ''; feedback.reason = ''
  feedbackChatId.value = ''; feedbackMessageId.value = ''
}
window.addEventListener('session-cleared', clearLocal)
onBeforeUnmount(() => {
  alive = false
  window.clearInterval(clock)
  window.removeEventListener('session-cleared', clearLocal)
})
</script>

<template>
  <div class="page assistant-page">
    <header class="page-header">
      <div><h1>{{ title }}</h1><p class="subtitle">{{ kind === 'AGENT' ? '查找知识、跟进工单，确认后再创建。' : '从企业知识中寻找答案，并核对引用来源。' }}</p></div>
      <nav class="actions assistant-tabs" aria-label="助手类型">
        <RouterLink :to="chatPath('KNOWLEDGE')" :class="{ selected: kind === 'KNOWLEDGE' }"><el-icon><Reading /></el-icon>知识问答</RouterLink>
        <RouterLink :to="chatPath('AGENT')" :class="{ selected: kind === 'AGENT' }"><el-icon><Tickets /></el-icon>业务助手</RouterLink>
      </nav>
    </header>

    <div class="assistant-layout">
      <aside class="surface chat-sidebar" aria-label="会话列表">
        <div class="toolbar list-toolbar"><h2>会话记录</h2><el-button text :icon="Refresh" :loading="list.loading" aria-label="刷新会话列表" @click="chats.loadList(kind)" /></div>
        <el-button class="new-chat" type="primary" plain :icon="Plus" :loading="creating" @click="create">新建会话</el-button>
        <el-alert v-if="list.error" :title="list.error" type="error" :closable="false"><el-button link type="primary" @click="chats.loadList(kind)">重试</el-button></el-alert>
        <div v-if="list.loading && !list.records.length" class="list-placeholder" role="status">正在加载会话…</div>
        <div v-else-if="!list.records.length && !list.error" class="list-placeholder"><el-icon><ChatDotRound /></el-icon><p>还没有会话</p><span class="muted">新建会话，或直接发送问题。</span></div>
        <ul v-if="list.records.length" class="chat-list" :aria-busy="list.loading">
          <li v-for="chat in list.records" :key="chat.id" class="chat-item" :class="{ active: chatId === chat.id }">
            <RouterLink class="chat-select" :to="chatPath(kind, chat.id)" :aria-current="chatId === chat.id ? 'page' : undefined"><span class="chat-title">{{ chat.title }}</span><span class="chat-date">{{ chats.isGenerating(chat.id) || ['PENDING', 'GENERATING'].includes(chat.generation?.status || '') ? '正在生成回答' : shortDate(chat.updatedAt) }}</span></RouterLink>
            <div class="chat-operations"><el-button text size="small" :icon="EditPen" :disabled="chatBusy[chat.id]" :aria-label="`重命名会话：${chat.title}`" @click="rename(chat)" /><el-button text size="small" :icon="Delete" :loading="chatBusy[chat.id]" :aria-label="`删除会话：${chat.title}`" @click="remove(chat)" /></div>
          </li>
        </ul>
        <el-pagination v-if="list.total > 20" small layout="prev, pager, next" :pager-count="3" :total="list.total" :page-size="20" :current-page="list.page" :disabled="list.loading" @current-change="(page: number) => chats.loadList(kind, page)" />
      </aside>

      <section class="surface conversation-panel" :aria-label="title">
        <header class="conversation-header row">
          <div class="conversation-heading"><h2>{{ conversation?.chat?.title || '开始新的会话' }}</h2><span class="muted">{{ generating ? (conversation?.streaming ? '回答生成中，切换页面后仍会继续' : '服务端仍在生成，可刷新历史确认进度') : kind === 'AGENT' ? '创建工单前，请核对待确认卡片' : '答案仅供参考，请结合来源核对' }}</span></div>
          <div class="actions"><el-button v-if="chatId" text :icon="Refresh" :loading="conversation?.loading" :disabled="generating || conversation?.loadingMore" @click="refreshHistory">刷新历史</el-button><el-button v-if="conversation?.chat" text :icon="EditPen" :disabled="chatBusy[chatId]" aria-label="重命名当前会话" @click="rename(conversation.chat)" /></div>
        </header>

        <div v-if="conversation?.error || !matching" class="conversation-error stack" role="alert"><el-alert :title="conversation?.error || '此会话属于另一种助手，请从对应助手入口打开'" type="error" :closable="false" /><div class="actions"><el-button :loading="conversation?.loading" @click="refreshHistory">重试</el-button><RouterLink v-if="!matching && conversation?.chat" :to="chatPath(conversation.chat.type === 'AGENT' ? 'AGENT' : 'KNOWLEDGE', chatId)">打开对应助手</RouterLink></div></div>
        <template v-else>
          <div v-if="conversation?.notice" class="conversation-notice"><el-alert :title="conversation.notice" type="warning" :closable="false"><el-button link type="primary" :disabled="generating" @click="refreshHistory">恢复服务端历史</el-button></el-alert></div>
          <div v-if="conversation?.historyError" class="conversation-notice"><el-alert :title="conversation.historyError" type="error" :closable="false"><el-button link type="primary" :disabled="generating" @click="refreshHistory">重新加载历史</el-button></el-alert></div>
          <div ref="transcript" class="transcript" :aria-busy="conversation?.loading" @scroll="onScroll">
            <div v-if="conversation?.loading && !conversation.loaded" class="history-loading" role="status"><el-skeleton :rows="5" animated /><span class="muted">正在加载会话历史…</span></div>
            <div v-else-if="!messages.length" class="conversation-empty">
              <span class="assistant-mark"><el-icon><component :is="kind === 'AGENT' ? Tickets : Reading" /></el-icon></span>
              <h2>{{ kind === 'AGENT' ? '从一个具体问题开始' : '你想了解什么？' }}</h2>
              <p class="muted">{{ kind === 'AGENT' ? '描述遇到的问题，我会查询可用知识与工单。需要创建工单时，由你核对并确认。' : '描述现象、报错信息和已经尝试的步骤，便于找到相关知识。请勿发送密码或验证码。' }}</p>
              <div class="suggestions"><button v-for="example in (kind === 'AGENT' ? ['查询我当前的待处理工单', '办公网络无法连接，请帮我准备工单'] : ['办公 VPN 无法连接时如何排查？', '如何申请数据平台访问权限？'])" :key="example" type="button" @click="question = example">{{ example }}</button></div>
            </div>
            <template v-else>
              <div v-if="hasEarlier" class="history-more"><el-button text :loading="conversation?.loadingMore" :disabled="generating || conversation?.loading" @click="moreHistory">加载更早的消息</el-button><span v-if="generating" class="muted">回答结束后可加载</span></div>
              <article v-for="message in messages" :key="message.id" class="message" :class="{ 'user-message': message.role === 'USER' }">
                <header class="message-header row"><span class="message-avatar">{{ message.role === 'USER' ? '我' : kind === 'AGENT' ? '助' : '知' }}</span><strong>{{ message.role === 'USER' ? '你' : title }}</strong><time class="muted" :datetime="message.createdAt">{{ shortDate(message.createdAt) }}</time><span v-if="message.role !== 'USER'" class="message-status" :class="message.status">{{ messageLabel(message) }}</span></header>
                <div class="message-body">
                  <div v-if="message.role === 'USER'" class="user-content">{{ message.content }}</div>
                  <div v-else-if="message.content" class="prose answer-content" v-html="renderAnswer(message.content)" />
                  <p v-else class="muted message-placeholder">{{ ['PENDING', 'GENERATING'].includes(message.status) ? '正在整理回答…' : message.status === 'STOPPED' ? '本次回答已停止。' : message.status === 'INTERRUPTED' ? '连接已中断，请刷新历史确认回答。' : message.status === 'FAILED' ? '本次回答未能生成，请核对历史后重试。' : '本次没有返回文本回答。' }}</p>

                  <details v-for="tool in message.toolResults" :key="tool.id" class="tool-result" :open="tool.status === 'RUNNING' || tool.status === 'FAILED'">
                    <summary><span>{{ toolNames[tool.name] || '工具调用' }}</span><span class="status" :class="tool.status">{{ statusLabel(tool.status) }}</span></summary>
                    <p v-if="tool.summary">{{ tool.summary }}</p>
                    <ul v-if="tool.results.length" class="tool-links"><li v-for="result in tool.results" :key="`${result.type}:${result.id}`"><el-button link type="primary" @click="openResult(result)">{{ result.title }}</el-button><p v-if="result.excerpt" class="muted">{{ result.excerpt }}</p><span v-if="result.reason" class="muted">{{ result.reason }}</span></li></ul>
                    <p v-else-if="tool.status === 'COMPLETED'" class="muted">没有可展示的结果。</p>
                  </details>

                  <section v-for="id in message.actionIds" :key="id" class="action-card" :aria-busy="chats.actions[id]?.loading || chats.actions[id]?.busy">
                    <header class="row action-header"><el-icon><Tickets /></el-icon><strong>工单创建确认</strong><span v-if="chats.actions[id]?.data" class="status" :class="actionStatus(chats.actions[id]!.data!)">{{ actionLabels[actionStatus(chats.actions[id]!.data!)] || statusLabel(chats.actions[id]!.data!.status) }}</span></header>
                    <p v-if="chats.actions[id]?.loading && !chats.actions[id]?.data" class="muted" role="status">正在获取可确认的工单内容…</p>
                    <template v-if="chats.actions[id]?.data">
                      <dl class="action-parameters"><dt>标题</dt><dd>{{ chats.actions[id]!.data!.parameters.title }}</dd><dt>问题描述</dt><dd class="action-description">{{ chats.actions[id]!.data!.parameters.description }}</dd><dt>分类</dt><dd>{{ chats.actions[id]!.data!.parameters.categoryName }}</dd><dt>优先级</dt><dd>{{ statusLabel(chats.actions[id]!.data!.parameters.priority) }}</dd></dl>
                      <p v-if="actionStatus(chats.actions[id]!.data!) === 'PENDING'" class="muted">{{ remaining(chats.actions[id]!.data!) }}。需要修改时，请先取消，再描述新的需求。</p>
                      <p v-if="actionStatus(chats.actions[id]!.data!) === 'EXPIRED'" class="muted">此操作已过期，请重新描述需求生成新的工单草稿。</p>
                      <p v-if="chats.actions[id]!.data!.status === 'CANCELLED'" class="muted">此操作已取消，可以继续描述新的需求。</p>
                      <p v-if="chats.actions[id]!.data!.status === 'EXECUTING'" class="muted">正在创建工单，请刷新状态查看结果。</p>
                      <p v-if="chats.actions[id]!.data!.errorSummary" class="action-error">{{ chats.actions[id]!.data!.errorSummary }}</p>
                      <div class="actions">
                        <template v-if="chats.actions[id]!.data!.type === 'CREATE_TICKET' && actionStatus(chats.actions[id]!.data!) === 'PENDING'"><el-button type="primary" :loading="chats.actions[id]?.busy" :disabled="chats.actions[id]?.loading || conversation?.deleting" @click="chats.act(id, 'confirm')">确认创建工单</el-button><el-button :disabled="chats.actions[id]?.busy || chats.actions[id]?.loading" @click="chats.act(id, 'cancel')">取消</el-button></template>
                        <RouterLink v-if="chats.actions[id]!.data!.ticket" class="ticket-result" :to="`/tickets/${encodeURIComponent(chats.actions[id]!.data!.ticket!.id)}`"><el-icon><CircleCheck /></el-icon>查看工单 {{ chats.actions[id]!.data!.ticket!.number }}</RouterLink>
                      </div>
                    </template>
                    <p v-if="chats.actions[id]?.error" class="action-error" role="alert">{{ chats.actions[id]?.error }}</p>
                    <el-button text type="primary" :loading="chats.actions[id]?.loading" :disabled="chats.actions[id]?.busy" @click="chats.loadAction(id, message.chatId)">刷新操作状态</el-button>
                  </section>

                  <section v-if="message.references.length" class="references" aria-label="引用来源"><h3><el-icon><Reading /></el-icon>引用来源 <span class="muted">{{ message.references.length }}</span></h3><ol><li v-for="reference in message.references" :key="reference.id"><div class="row reference-title"><el-button link type="primary" :disabled="!reference.available" :loading="sourceBusy[`${reference.type}:${reference.sourceId}`]" @click="openSource(reference)">{{ reference.title }}</el-button><span class="muted">{{ reference.available ? (reference.type === 'DOCUMENT' ? '下载文档' : '阅读文章') : '来源已失效或无权访问' }}</span><span v-if="reference.available" class="muted">v{{ reference.contentVersion }}</span></div><p v-if="reference.available && reference.excerpt" class="reference-excerpt">{{ reference.excerpt }}</p><p v-if="sourceErrors[`${reference.type}:${reference.sourceId}`]" class="action-error">{{ sourceErrors[`${reference.type}:${reference.sourceId}`] }}</p></li></ol></section>
                  <div v-if="canFeedback(message)" class="message-feedback actions"><el-button text size="small" @click="editFeedback(message)">{{ message.feedback ? '修改反馈' : '评价回答' }}</el-button><span v-if="message.feedback" class="muted">{{ feedbackSummary(message.feedback) }}</span></div>
                </div>
              </article>
            </template>
          </div>
        </template>

        <form class="composer" @submit.prevent="send">
          <label for="assistant-question" class="composer-label">{{ kind === 'AGENT' ? '描述问题或告诉我你需要的帮助' : '输入你的问题' }}</label>
          <el-input id="assistant-question" v-model="question" type="textarea" :rows="3" resize="none" :maxlength="8000" :disabled="sending || creating || !matching || !!conversation?.deleting" :placeholder="kind === 'AGENT' ? '例如：VPN 连不上，已经重启客户端，仍然提示连接超时…' : '例如：VPN 提示无访问权限，需要如何申请？'" @keydown="onInputKey" />
          <div class="composer-footer row"><span class="muted">Ctrl / ⌘ + Enter 发送 · 请勿提供密码或验证码</span><div class="actions"><span v-if="question.length > 7600" class="muted">{{ question.length }} / 8000</span><el-button v-if="generating" :icon="VideoPause" :loading="conversation?.stopping" :disabled="!stopReady" @click="chats.stop(chatId)">{{ stopReady ? '停止生成' : '等待连接后可停止' }}</el-button><el-button v-else type="primary" :icon="Promotion" native-type="submit" :loading="sending" :disabled="!canSend">发送</el-button></div></div>
        </form>
      </section>
    </div>

    <el-dialog v-model="feedbackOpen" title="评价这次回答" width="460px" :close-on-click-modal="false" :close-on-press-escape="!chats.feedbackBusy[feedbackMessageId]" :show-close="!chats.feedbackBusy[feedbackMessageId]">
      <el-form label-position="top" @submit.prevent="submitFeedback">
        <el-form-item label="对回答是否满意"><el-select v-model="feedback.satisfaction" placeholder="暂不评价" clearable :disabled="chats.feedbackBusy[feedbackMessageId]"><el-option label="满意" value="SATISFIED" /><el-option label="不满意" value="DISSATISFIED" /></el-select></el-form-item>
        <el-form-item label="问题是否已解决"><el-radio-group v-model="feedback.resolved" :disabled="chats.feedbackBusy[feedbackMessageId]"><el-radio value="">暂不确定</el-radio><el-radio value="yes">已解决</el-radio><el-radio value="no">未解决</el-radio></el-radio-group></el-form-item>
        <el-form-item label="补充原因（选填）"><el-input v-model="feedback.reason" type="textarea" :rows="3" :maxlength="1000" show-word-limit :disabled="chats.feedbackBusy[feedbackMessageId]" placeholder="哪些内容有帮助，或还需要补充什么？" /></el-form-item>
      </el-form>
      <template #footer><el-button :disabled="chats.feedbackBusy[feedbackMessageId]" @click="feedbackOpen = false">取消</el-button><el-button type="primary" :loading="chats.feedbackBusy[feedbackMessageId]" @click="submitFeedback">保存反馈</el-button></template>
    </el-dialog>
  </div>
</template>

<style scoped>
.assistant-page{--assistant-accent:#087f8c;--assistant-border:#e3e9ef;--assistant-soft:#f4f8f9}
.assistant-tabs{gap:4px;border:1px solid var(--assistant-border);border-radius:8px;background:white;padding:4px;flex-shrink:0}
.assistant-tabs a{display:flex;align-items:center;gap:7px;padding:8px 12px;border-radius:5px;font-size:13px;color:#607184;white-space:nowrap}
.assistant-tabs a.selected{background:#e8f3f4;color:var(--assistant-accent);font-weight:600}
.assistant-layout{display:grid;grid-template-columns:250px minmax(0,1fr);gap:20px;align-items:start}
.chat-sidebar{padding:18px 12px;min-width:0;position:sticky;top:20px}
.list-toolbar{justify-content:space-between;margin:0 0 10px;padding:0 6px;flex-wrap:nowrap}
.list-toolbar h2{font-size:14px;margin:0}.new-chat{width:100%;margin-bottom:16px}
.chat-list{list-style:none;padding:0;margin:0;max-height:calc(100vh - 360px);min-height:180px;overflow:auto}
.chat-item{border-radius:7px;position:relative;margin-bottom:5px;border:1px solid transparent}
.chat-item:hover{background:#f6f9fa}.chat-item.active{background:#edf6f6;border-color:#d3e8e9}
.chat-select{display:block;padding:12px 9px 11px;color:#33485c;min-width:0;padding-right:57px}
.chat-title{display:block;font-size:13px;line-height:1.6;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.chat-date{display:block;font-size:11px;color:#82909e;margin-top:5px}.active .chat-title{color:#087f8c;font-weight:600}
.chat-operations{position:absolute;right:3px;top:9px;display:flex;align-items:center;gap:0}
.chat-operations .el-button{padding:4px;width:25px;color:#778899}
.list-placeholder{text-align:center;padding:36px 3px;color:#7b8b99;font-size:13px}.list-placeholder>.el-icon{font-size:27px;color:#9ab3b9}.list-placeholder p{margin:14px 0 4px}
.chat-sidebar :deep(.el-pagination){justify-content:center;margin-top:16px}
.conversation-panel{padding:0;overflow:hidden;display:flex;flex-direction:column;min-width:0;height:calc(100dvh - 245px);min-height:620px;max-height:1100px}
.conversation-header{border-bottom:1px solid var(--assistant-border);padding:18px 22px;justify-content:space-between;align-items:flex-start;flex-shrink:0;gap:10px}
.conversation-heading{min-width:0}.conversation-heading h2{font-size:16px;line-height:1.5;margin:0 0 5px;overflow-wrap:anywhere}.conversation-heading>.muted{font-size:12px}
.conversation-header>.actions{flex-shrink:0;gap:3px}.conversation-header .el-button{padding-left:5px;padding-right:5px}
.conversation-notice{padding:12px 20px 0;flex-shrink:0}.conversation-notice :deep(.el-alert){margin-bottom:0;max-height:120px;overflow:auto}
.conversation-error{padding:25px;flex:1;justify-content:center;align-items:flex-start}.conversation-error .el-alert{margin:0}
.transcript{overflow-y:auto;overflow-x:hidden;flex:1;min-height:170px;padding:25px 28px 12px;scrollbar-gutter:stable;overscroll-behavior:contain}
.history-loading{display:flex;flex-direction:column;gap:22px;padding:20px 0}.history-more{text-align:center;margin:-10px 0 20px}.history-more>.muted{display:block;font-size:12px}
.conversation-empty{min-height:100%;display:flex;align-items:center;justify-content:center;flex-direction:column;text-align:center;padding:32px 5px}
.assistant-mark{width:52px;height:52px;display:grid;place-items:center;background:#e8f3f4;color:#087f8c;border-radius:14px 14px 4px 14px;font-size:25px;margin-bottom:21px}
.conversation-empty h2{font-size:21px;margin-bottom:10px}.conversation-empty>p{max-width:440px;line-height:1.9;font-size:13px}
.suggestions{display:flex;gap:9px;flex-wrap:wrap;justify-content:center;margin-top:12px}.suggestions button{background:white;border:1px solid #dce7eb;border-radius:7px;color:#506c7c;font-size:12px;padding:10px 13px;line-height:1.6}.suggestions button:hover{border-color:#71aeb5;background:#f5fafb}
.message{padding:0 0 28px;margin-bottom:26px;border-bottom:1px solid #edf1f4}.message:last-child{margin-bottom:0;border-bottom:none}.message-header{gap:9px;margin-bottom:12px;flex-wrap:wrap}.message-header strong{font-size:13px;font-weight:600}.message-header time{font-size:11px}.message-avatar{width:27px;height:27px;display:grid;place-items:center;border-radius:7px;background:#e7f2f2;color:#087f8c;font-size:12px;font-weight:600}.user-message .message-avatar{background:#edf1f5;color:#66788c}
.message-status{font-size:11px;color:#8694a2;margin-left:auto}.message-status.GENERATING{color:#087f8c}.message-status.INTERRUPTED,.message-status.FAILED{color:#b06c35}.message-body{padding-left:36px;min-width:0}.user-content{white-space:pre-wrap;font-size:14px;line-height:1.85;background:#f5f8fa;border-radius:3px 9px 9px 9px;padding:13px 16px;overflow-wrap:anywhere}.answer-content{max-width:none;font-size:14px}.answer-content :deep(> :last-child){margin-bottom:0}.answer-content :deep(h1){font-size:22px}.answer-content :deep(a){text-decoration:underline;text-underline-offset:3px}.answer-content :deep(blockquote){border-left:3px solid #b4d4d8;margin:16px 0;padding:4px 14px;color:#607485}.answer-content :deep(table){display:block;overflow:auto}.answer-content :deep(pre){max-width:100%}.message-placeholder{font-size:13px;line-height:1.8}
.tool-result{margin-top:16px;background:#f7f9fb;border-radius:6px;padding:12px 14px;font-size:13px}.tool-result summary{display:flex;align-items:center;justify-content:space-between;gap:10px;cursor:pointer;list-style:revert}.tool-result summary::before{content:'›';font-size:17px;color:#7c909b}.tool-result[open] summary::before{transform:rotate(90deg)}.tool-result summary>span:first-child{flex:1}.tool-result p{font-size:13px;line-height:1.75;margin:12px 0 0;white-space:pre-wrap;overflow-wrap:anywhere}.tool-links{list-style:none;margin:12px 0 0;padding:0}.tool-links li{padding:8px 0}.tool-links li+li{border-top:1px solid #e5ebef}.tool-links .el-button{white-space:normal;text-align:left;height:auto;line-height:1.7}.tool-links p{margin-top:4px}
.action-card{margin-top:20px;border:1px solid #c4dddf;border-top:3px solid #529ca2;border-radius:7px;padding:17px 18px;background:#fcfefe}.action-header{margin-bottom:17px;color:#2d5b65;font-size:13px}.action-header .status{margin-left:auto}.action-parameters{display:grid;grid-template-columns:64px minmax(0,1fr);gap:12px 15px;font-size:13px;line-height:1.8;margin:0 0 17px}.action-parameters dt{color:#7e8e9d}.action-parameters dd{margin:0;overflow-wrap:anywhere}.action-description{white-space:pre-wrap;max-height:260px;overflow:auto}.action-card>p{font-size:12px;line-height:1.8}.action-error{color:#b45145;font-size:12px;line-height:1.8;overflow-wrap:anywhere;margin:10px 0}.action-card>.el-button{font-size:12px;margin-top:8px;padding:5px 0;height:auto}.ticket-result{display:inline-flex;align-items:center;gap:6px;font-size:13px;font-weight:600;overflow-wrap:anywhere}.status.EXECUTED{background:#e7f5ed;color:#287751}.status.EXPIRED,.status.CANCELLED{background:#edf0f3;color:#768593}
.references{margin-top:22px;border-top:1px dashed #dbe4e9;padding-top:15px}.references h3{display:flex;align-items:center;gap:7px;font-size:12px;color:#617c89;margin-bottom:8px}.references h3 .muted{font-size:11px}.references ol{padding-left:18px;margin:0;color:#8b9ba9;font-size:12px}.references li{padding:5px 0}.reference-title{align-items:baseline;gap:7px;flex-wrap:wrap}.reference-title .el-button{white-space:normal;text-align:left;height:auto;line-height:1.8;overflow-wrap:anywhere}.reference-title .muted{font-size:11px}.reference-excerpt{color:#7b8b98;font-size:12px;line-height:1.8;margin:4px 0 0;white-space:pre-wrap;overflow-wrap:anywhere}.message-feedback{margin-top:15px;gap:8px}.message-feedback .el-button{padding:3px 0;height:auto;font-size:12px;color:#738998}.message-feedback .muted{font-size:11px}
.composer{border-top:1px solid var(--assistant-border);padding:16px 22px 18px;flex-shrink:0;background:white}.composer-label{display:block;font-size:12px;color:#637d89;margin-bottom:9px}.composer :deep(.el-textarea__inner){line-height:1.8;background:#fbfcfd;font-size:13px;box-shadow:0 0 0 1px #dde6eb inset;padding:10px 13px}.composer :deep(.el-textarea__inner:focus){box-shadow:0 0 0 1px #087f8c inset}.composer-footer{justify-content:space-between;align-items:center;margin-top:12px;gap:10px}.composer-footer>.muted{font-size:11px}.composer-footer>.actions{flex-shrink:0}.composer-footer .el-button{font-size:12px}
@media(min-width:1600px){.assistant-layout{grid-template-columns:270px minmax(0,1fr)}.transcript{padding-left:38px;padding-right:38px}}
@media(max-width:1150px){.assistant-layout{grid-template-columns:215px minmax(0,1fr);gap:14px}.transcript{padding:22px 18px 10px}.conversation-header{padding:16px}.composer{padding:14px 16px}.composer-footer{flex-wrap:wrap}.composer-footer>.actions{margin-left:auto}.conversation-header>.actions .el-button{font-size:12px}}
@media(max-width:800px){.assistant-page>.page-header{flex-wrap:wrap;gap:13px}.assistant-layout{grid-template-columns:1fr;gap:14px}.chat-sidebar{position:static;padding:12px;display:flex;flex-wrap:wrap;align-items:center;gap:8px}.list-toolbar{padding:0;flex:1;margin:0}.new-chat{width:auto;margin:0}.chat-list{width:100%;display:flex;gap:7px;max-height:145px;min-height:0;overflow:auto;margin-top:4px}.chat-item{min-width:185px;max-width:240px;flex-shrink:0;margin:0}.list-placeholder{padding:10px 0;width:100%}.list-placeholder>.el-icon{display:none}.list-placeholder p{margin:0}.list-placeholder>.muted{display:none}.chat-sidebar :deep(.el-alert){width:100%;margin-bottom:0}.chat-sidebar :deep(.el-pagination){width:100%;margin-top:0}.conversation-panel{height:76dvh;min-height:560px;max-height:none}.assistant-tabs a{padding:7px 10px}.conversation-empty{padding:22px 0}.conversation-header{gap:6px}.conversation-heading>.muted{font-size:11px}}
@media(max-width:480px){.transcript{padding:20px 12px 8px}.message-body{padding-left:0}.message-header time{font-size:10px}.message-status{font-size:10px}.message{padding-bottom:20px;margin-bottom:20px}.action-card{padding:14px 12px}.action-parameters{grid-template-columns:54px minmax(0,1fr);gap:9px}.action-header{gap:6px}.action-header .status{font-size:10px}.composer{padding:12px}.composer-footer>.muted{max-width:160px;line-height:1.7}.conversation-header{padding:13px 12px}.conversation-header>.actions{flex-wrap:nowrap}.conversation-header>.actions .el-button{padding:3px;min-height:28px}.conversation-heading h2{font-size:14px}.conversation-notice{padding:10px 12px 0}.assistant-mark{width:44px;height:44px;font-size:21px}.conversation-empty h2{font-size:19px}.suggestions{flex-direction:column;width:100%}.suggestions button{text-align:left}.references ol{padding-left:16px}}
</style>
