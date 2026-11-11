import { describe, expect, it } from 'vitest'
import { EventParser } from '../src/sse'
describe('SSE事件解析', () => {
  it('保留分块边界并解析CRLF、多行data与心跳', () => {
    const parser = new EventParser()
    expect(parser.push(': ping\r\n\r\nevent: meta\r\ndata: {"chatId":')).toEqual([])
    expect(parser.push('"c1",\r\ndata: "messageId":"m1"}\r\n\r\nevent: delta\ndata: {"text":"你')).toEqual([{ event: 'meta', data: { chatId: 'c1', messageId: 'm1' } }])
    expect(parser.push('好"}\n\nevent: done\ndata: {"status":"COMPLETED"}\n\n')).toEqual([{event:'delta',data:{text:'你好'}},{event:'done',data:{status:'COMPLETED'}}])
  })
  it('错误数据不会静默转为有效事件', () => { expect(() => new EventParser().push('event: delta\ndata: {broken}\n\n')).toThrow() })
})
