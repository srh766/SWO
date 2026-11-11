import { defineStore } from 'pinia'
import { onScopeDispose, reactive } from 'vue'
import { api, ApiError } from '../api'
import { stream } from '../sse'
import type { StreamEvent } from '../sse'
import type { AgentAction, Chat, Feedback, Message, Page, Reference, ToolResult } from '../types'
import { errorText, notifyError } from '../utils'

export type ChatType = 'KNOWLEDGE' | 'AGENT'
interface ChatList {
  records: Chat[]
  page: number
  total: number
  loading: boolean
  error: string
}
interface Conversation {
  chat: Chat | null
  messages: Message[]
  page: number
  total: number
  loaded: boolean
  loading: boolean
  loadingMore: boolean
  deleting: boolean
  stopping: boolean
  error: string
  historyError: string
  notice: string
  streaming: boolean
}
interface ActionState {
  data: AgentAction | null
  loading: boolean
  busy: boolean
  error: string
  requestId: string
}
interface Generation {
  controller: AbortController
  answer: Message
  question: Message
  messageId: string | null
  terminal: boolean
}
const pageSize = 20
const activeStatus = (status?: string) => status === 'GENERATING' || status === 'PENDING'
const segment = encodeURIComponent
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object'
const emptyList = (): ChatList => ({ records: [], page: 1, total: 0, loading: false, error: '' })
const ordered = (messages: Message[]) => messages.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || (a.role === b.role ? 0 : a.role === 'USER' ? -1 : 1))

export const useChats = defineStore('chats', () => {
  const lists = reactive<Record<ChatType, ChatList>>({ KNOWLEDGE: emptyList(), AGENT: emptyList() })
  const conversations = reactive<Record<string, Conversation>>({})
  const actions = reactive<Record<string, ActionState>>({})
  const feedbackBusy = reactive<Record<string, boolean>>({})
  const generations = new Map<string, Generation>()
  const unsettled = new Map<string, { question: Message; answer: Message }>()
  const historyRequests = new Map<string, number>()
  const listRequests: Record<ChatType, number> = { KNOWLEDGE: 0, AGENT: 0 }
  let session = 0

  function conversation(id: string): Conversation {
    if (!conversations[id]) conversations[id] = {
      chat: null, messages: [], page: 0, total: 0, loaded: false, loading: false,
      loadingMore: false, deleting: false, stopping: false, error: '', historyError: '', notice: '', streaming: false,
    }
    return conversations[id]!
  }
  function current(id: string, state: Conversation, token: number) {
    return token === session && conversations[id] === state
  }
  function updateChat(chat: Chat) {
    conversation(chat.id).chat = chat
    for (const list of Object.values(lists)) {
      const index = list.records.findIndex(item => item.id === chat.id)
      if (index >= 0) list.records[index] = chat
    }
  }
  function isGenerating(id: string) {
    const state = conversations[id]
    return !!state && (state.streaming || activeStatus(state.chat?.generation?.status) || state.messages.some(message => activeStatus(message.status) && message.role === 'ASSISTANT'))
  }
  async function loadList(type: ChatType, page = lists[type].page) {
    const list = lists[type]
    const request = ++listRequests[type]
    const token = session
    list.loading = true
    list.error = ''
    try {
      const result = await api<Page<Chat>>('GET', '/api/chats', undefined, { type, page, pageSize })
      if (token !== session || request !== listRequests[type]) return
      list.records = result.records
      list.page = result.page
      list.total = result.total
    } catch (error) {
      if (token === session && request === listRequests[type]) list.error = errorText(error)
    } finally {
      if (token === session && request === listRequests[type]) list.loading = false
    }
  }
  async function createChat(type: ChatType, title: string) {
    const token = session
    const chat = await api<Chat>('POST', '/api/chats', { title, type })
    if (token !== session) return null
    updateChat(chat)
    void loadList(type, 1)
    return chat
  }
  async function renameChat(chat: Chat, title: string) {
    const token = session
    const result = await api<Chat>('PATCH', `/api/chats/${segment(chat.id)}`, { title, version: chat.version })
    if (token !== session) return
    updateChat(result)
  }
  async function deleteChat(chat: Chat) {
    const state = conversation(chat.id)
    if (state.deleting) return false
    const token = session
    state.deleting = true
    try {
      await api<null>('DELETE', `/api/chats/${segment(chat.id)}`)
      if (!current(chat.id, state, token)) return false
      generations.get(chat.id)?.controller.abort()
      generations.delete(chat.id)
      unsettled.delete(chat.id)
      historyRequests.delete(chat.id)
      for (const [id, action] of Object.entries(actions)) {
        if (action.data?.chatId === chat.id) delete actions[id]
      }
      delete conversations[chat.id]
      const type: ChatType = chat.type === 'AGENT' ? 'AGENT' : 'KNOWLEDGE'
      const list = lists[type]
      await loadList(type, list.records.length === 1 && list.page > 1 ? list.page - 1 : list.page)
      return true
    } finally {
      if (current(chat.id, state, token)) state.deleting = false
    }
  }
  async function loadAction(id: string, chatId: string) {
    if (!actions[id]) actions[id] = { data: null, loading: false, busy: false, error: '', requestId: '' }
    const state = actions[id]!
    if (state.loading) return
    const token = session
    state.loading = true
    state.error = ''
    try {
      const result = await api<AgentAction>('GET', `/api/agent/actions/${segment(id)}`)
      if (token !== session || actions[id] !== state || !conversations[chatId]) return
      if (result.chatId !== chatId || result.id !== id) throw new Error('待确认操作与当前会话不匹配')
      state.data = result
    } catch (error) {
      if (token === session && actions[id] === state) state.error = errorText(error)
    } finally {
      if (token === session && actions[id] === state) state.loading = false
    }
  }
  function hydrateActions(messages: Message[], chatId: string) {
    for (const id of new Set(messages.flatMap(message => message.actionIds))) void loadAction(id, chatId)
  }
  async function loadHistory(id: string, type: ChatType, more = false) {
    const state = conversation(id)
    if (state.loading || state.loadingMore || state.deleting || state.streaming) return
    const token = session
    const request = (historyRequests.get(id) || 0) + 1
    historyRequests.set(id, request)
    const page = more ? state.page + 1 : 1
    if (more) state.loadingMore = true
    else state.loading = true
    state.error = ''
    state.historyError = ''
    try {
      const [chat, result] = await Promise.all([
        api<Chat>('GET', `/api/chats/${segment(id)}`),
        api<Page<Message>>('GET', `/api/chats/${segment(id)}/messages`, undefined, { page, pageSize }),
      ])
      if (!current(id, state, token) || historyRequests.get(id) !== request) return
      if (chat.type !== type) throw new Error('此会话属于另一种助手，请从对应助手入口打开')
      updateChat(chat)
      const merged = new Map<string, Message>()
      if (more) for (const message of state.messages) merged.set(message.id, message)
      for (const message of result.records) merged.set(message.id, message)
      const pending = unsettled.get(id)
      if (pending) {
        const savedAnswer = merged.get(pending.answer.id)
        const savedQuestion = result.records.find(message => message.role === 'USER' && message.content === pending.question.content && Math.abs(Date.parse(message.createdAt) - Date.parse(pending.question.createdAt)) < 120000)
        if (savedQuestion) merged.delete(pending.question.id)
        else if (!savedAnswer) merged.set(pending.question.id, pending.question)
        if (!savedAnswer) merged.set(pending.answer.id, pending.answer)
        else {
          unsettled.delete(id)
          if (!activeStatus(savedAnswer.status)) state.notice = ''
        }
      }
      state.messages = ordered([...merged.values()])
      state.page = result.page
      state.total = result.total
      state.loaded = true
      hydrateActions(result.records, id)
    } catch (error) {
      if (!current(id, state, token)) return
      if (state.loaded) state.historyError = errorText(error)
      else state.error = errorText(error)
    } finally {
      if (current(id, state, token) && historyRequests.get(id) === request) {
        state.loading = false
        state.loadingMore = false
      }
    }
  }
  async function openChat(id: string, type: ChatType) {
    const state = conversation(id)
    if (!state.streaming) await loadHistory(id, type)
  }
  function newMessage(id: string, role: string, content: string): Message {
    return {
      id: `local-${crypto.randomUUID()}`, chatId: id, role, content,
      status: role === 'USER' ? 'COMPLETED' : 'PENDING', references: [], toolResults: [], actionIds: [], feedback: null,
      createdAt: new Date().toISOString(),
    }
  }
  function handleEvent(id: string, state: Conversation, generation: Generation, event: StreamEvent) {
    if (generation.terminal) return
    const data = event.data
    if (!['meta', 'delta', 'references', 'tool', 'action', 'done', 'error'].includes(event.event)) return
    if (!object(data)) throw new Error('生成服务返回了无效事件，请刷新历史确认')
    const answer = generation.answer
    switch (event.event) {
      case 'meta':
        if (data.chatId !== id || typeof data.messageId !== 'string' || !data.messageId || (generation.messageId && generation.messageId !== data.messageId)) throw new Error('生成服务返回的会话信息无效')
        generation.messageId = data.messageId
        answer.id = data.messageId
        answer.status = 'GENERATING'
        if (state.chat) state.chat.generation = { messageId: answer.id, status: 'GENERATING' }
        break
      case 'delta':
        if (typeof data.text !== 'string') throw new Error('回答内容格式无效')
        answer.content += data.text
        break
      case 'references':
        if (!Array.isArray(data.items)) throw new Error('引用来源格式无效')
        answer.references = data.items as Reference[]
        break
      case 'tool': {
        if (typeof data.id !== 'string' || !Array.isArray(data.results)) throw new Error('工具结果格式无效')
        const tool = data as unknown as ToolResult
        const index = answer.toolResults.findIndex(item => item.id === tool.id)
        if (index < 0) answer.toolResults.push(tool)
        else answer.toolResults[index] = tool
        break
      }
      case 'action':
        if (typeof data.actionId !== 'string' || !data.actionId) throw new Error('待确认操作格式无效')
        if (!answer.actionIds.includes(data.actionId)) answer.actionIds.push(data.actionId)
        void loadAction(data.actionId, id)
        break
      case 'done':
        if (typeof data.messageId !== 'string' || !data.messageId || (generation.messageId && data.messageId !== generation.messageId) || !['COMPLETED', 'STOPPED'].includes(String(data.status))) throw new Error('回答结束状态无效')
        answer.id = data.messageId
        answer.status = String(data.status)
        generation.terminal = true
        if (state.chat) state.chat.generation = null
        generation.controller.abort()
        break
      case 'error':
        if (typeof data.messageId === 'string') answer.id = data.messageId
        answer.status = 'FAILED'
        state.notice = typeof data.message === 'string' ? data.message : '生成失败，请刷新历史后重试'
        generation.terminal = true
        if (state.chat) state.chat.generation = null
        generation.controller.abort()
        break
    }
  }
  async function runGeneration(id: string, type: ChatType, state: Conversation, generation: Generation, question: string, requestId: string) {
    const token = session
    try {
      await stream(type === 'AGENT' ? '/api/agent/messages' : `/api/chats/${segment(id)}/messages`,
        type === 'AGENT' ? { chatId: id, question, requestId } : { question, requestId },
        generation.controller.signal, event => {
          if (current(id, state, token) && generations.get(id) === generation) handleEvent(id, state, generation, event)
        })
    } catch (error) {
      if (!current(id, state, token) || generations.get(id) !== generation) return
      if (!generation.terminal) {
        const rejected = error instanceof ApiError && error.status >= 400 && error.status < 500
        generation.answer.status = rejected ? 'FAILED' : 'INTERRUPTED'
        if (rejected && state.chat) state.chat.generation = null
        state.notice = `${errorText(error)}。请核对历史记录后继续，不会自动重新生成。`
        generation.controller.abort()
      }
    } finally {
      if (current(id, state, token) && generations.get(id) === generation) {
        unsettled.set(id, { question: generation.question, answer: generation.answer })
        generations.delete(id)
        state.streaming = false
        await loadHistory(id, type)
        if (token === session) void loadList(type)
      }
    }
  }
  function send(id: string, type: ChatType, question: string) {
    const state = conversation(id)
    if (!question.trim() || !state.loaded || !state.chat || state.chat.type !== type || state.loading || state.loadingMore || state.stopping || state.deleting || isGenerating(id)) return false
    unsettled.delete(id)
    const userMessage = newMessage(id, 'USER', question.trim())
    const answerMessage = newMessage(id, 'ASSISTANT', '')
    state.messages.push(userMessage, answerMessage)
    // Retrieve Vue's reactive proxies, so incoming events immediately update the mounted view.
    const generation: Generation = {
      controller: new AbortController(), question: state.messages[state.messages.length - 2]!,
      answer: state.messages[state.messages.length - 1]!, messageId: null, terminal: false,
    }
    generations.set(id, generation)
    state.streaming = true
    state.notice = ''
    state.historyError = ''
    void runGeneration(id, type, state, generation, question.trim(), crypto.randomUUID())
    return true
  }
  async function stop(id: string) {
    const state = conversation(id)
    const generation = generations.get(id)
    const messageId = generation ? generation.messageId : state.chat?.generation?.messageId || [...state.messages].reverse().find(message => message.role === 'ASSISTANT' && activeStatus(message.status))?.id
    if (!messageId || state.stopping) return
    const token = session
    state.stopping = true
    try {
      const result = await api<{ messageId: string; status: string }>('POST', `/api/chats/${segment(id)}/messages/${segment(messageId)}/stop`)
      if (!current(id, state, token)) return
      if (generation) {
        generation.terminal = true
        generation.answer.status = result.status
        generation.controller.abort()
      }
      const message = state.messages.find(item => item.id === result.messageId)
      if (message) message.status = result.status
      if (state.chat) state.chat.generation = null
      if (!generation && state.chat) await loadHistory(id, state.chat.type as ChatType)
    } catch (error) {
      if (current(id, state, token)) notifyError(error)
    } finally {
      if (current(id, state, token)) state.stopping = false
    }
  }
  async function act(id: string, operation: 'confirm' | 'cancel') {
    const state = actions[id]
    const action = state?.data
    if (!state || !action || state.loading || state.busy || action.status !== 'PENDING') return
    if (operation === 'confirm' && (Date.parse(action.expiresAt) <= Date.now() || !Number.isFinite(Date.parse(action.expiresAt)))) {
      state.error = '此操作已过期，请重新描述需求生成工单草稿'
      return
    }
    const token = session
    state.busy = true
    state.error = ''
    if (operation === 'confirm' && !state.requestId) state.requestId = crypto.randomUUID()
    try {
      const result = await api<AgentAction>('POST', `/api/agent/actions/${segment(id)}/${operation}`, operation === 'confirm' ? { requestId: state.requestId } : undefined)
      if (token === session && actions[id] === state) {
        if (result.chatId !== action.chatId || result.id !== id) throw new Error('操作结果与当前会话不匹配，请刷新状态')
        state.data = result
      }
    } catch (error) {
      if (token === session && actions[id] === state) {
        notifyError(error)
        await loadAction(id, action.chatId)
        if (token === session && actions[id] === state) state.error = errorText(error)
      }
    } finally {
      if (token === session && actions[id] === state) state.busy = false
    }
  }
  async function saveFeedback(chatId: string, messageId: string, feedback: Feedback) {
    if (feedbackBusy[messageId]) return false
    const state = conversations[chatId]
    if (!state) return false
    const token = session
    feedbackBusy[messageId] = true
    try {
      const result = await api<Feedback>('POST', `/api/messages/${segment(messageId)}/feedback`, feedback)
      if (!current(chatId, state, token)) return false
      const message = state.messages.find(item => item.id === messageId)
      if (message) message.feedback = result
      return true
    } catch (error) {
      if (current(chatId, state, token)) notifyError(error)
      return false
    } finally {
      if (token === session) delete feedbackBusy[messageId]
    }
  }
  function clear() {
    session++
    for (const generation of generations.values()) generation.controller.abort()
    generations.clear()
    unsettled.clear()
    historyRequests.clear()
    listRequests.KNOWLEDGE++
    listRequests.AGENT++
    for (const id of Object.keys(conversations)) delete conversations[id]
    for (const id of Object.keys(actions)) delete actions[id]
    for (const id of Object.keys(feedbackBusy)) delete feedbackBusy[id]
    Object.assign(lists.KNOWLEDGE, emptyList())
    Object.assign(lists.AGENT, emptyList())
  }
  window.addEventListener('session-cleared', clear)
  onScopeDispose(() => { window.removeEventListener('session-cleared', clear); clear() })
  return { lists, conversations, actions, feedbackBusy, conversation, isGenerating, loadList, createChat, renameChat, deleteChat, openChat, loadHistory, send, stop, loadAction, act, saveFeedback }
})
