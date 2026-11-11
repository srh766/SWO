import { ApiError, getToken } from './api'
export interface StreamEvent { event: string; data: unknown }
export class EventParser {
  private buffer = ''
  push(text: string): StreamEvent[] {
    this.buffer += text
    const result: StreamEvent[] = []
    let match: RegExpExecArray | null
    while ((match = /\r?\n\r?\n/.exec(this.buffer))) {
      const block = this.buffer.slice(0, match.index)
      this.buffer = this.buffer.slice(match.index + match[0].length)
      let event = 'message'
      const data: string[] = []
      for (const line of block.split(/\r?\n/)) {
        if (line.startsWith('event:')) event = line.slice(6).trim()
        if (line.startsWith('data:')) data.push(line.slice(5).replace(/^ /, ''))
      }
      if (data.length) result.push({ event, data: JSON.parse(data.join('\n')) as unknown })
    }
    return result
  }
}
export async function stream(path: string, body: unknown, signal: AbortSignal, onEvent: (event: StreamEvent) => void) {
  const response = await fetch(path, { method: 'POST', headers: { Authorization: `Bearer ${getToken()}`, 'Content-Type': 'application/json', Accept: 'text/event-stream' }, body: JSON.stringify(body), signal })
  if (!response.ok) {
    if (response.status === 401) window.dispatchEvent(new Event('auth-expired'))
    const problem = await response.json().catch(() => ({ message: '无法连接生成服务' })) as { message?: string }
    const retryAfter = response.headers.get('retry-after')
    const message = `${problem.message || '请求失败'}${response.status === 429 && retryAfter ? `（建议 ${retryAfter} 秒后重试）` : ''}`
    throw new ApiError(message, response.status)
  }
  if (!response.headers.get('content-type')?.includes('text/event-stream') || !response.body) throw new Error('服务未返回有效的事件流')
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  const parser = new EventParser()
  let terminated = false
  try {
    while (true) {
      const { value, done } = await reader.read()
      for (const event of parser.push(done ? decoder.decode() : decoder.decode(value, { stream: true }))) {
        onEvent(event)
        if (event.event === 'done' || event.event === 'error') terminated = true
      }
      if (done) break
    }
    if (!terminated) throw new Error('连接已中断，回答可能尚未完成，请刷新历史确认')
  } finally { reader.releaseLock() }
}
