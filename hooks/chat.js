import { FOLLOW_MODEL, DEFAULT_EFFORT, effortChoices } from './chat-models.js'

// Pure helpers for the side conversation. The hook module owns the state and
// API calls, which Claude Code must be able to inspect statically.

export const MAX_TURNS = 8
export const MAX_SESSIONS = 15
export const MAX_QUESTION = 2000
export const MAX_ANSWER = 4000
const HISTORY_CHARS = 24_000

export function cleanTurns(value) {
  if (!Array.isArray(value)) return []
  return value
    .filter((turn) => turn && typeof turn.question === 'string' && (turn.answer === null || typeof turn.answer === 'string'))
    .slice(-MAX_TURNS)
    .map((turn) => ({ question: turn.question.slice(0, MAX_QUESTION), answer: turn.answer?.slice(0, MAX_ANSWER + 30) ?? null }))
}

export function createChat() {
  return {
    id: '', turns: [], draft: '', loading: false, loadFailed: false, running: false, status: '', isError: false, confirmClear: false, epoch: 0,
    model: FOLLOW_MODEL, modelOptions: [{ value: FOLLOW_MODEL, label: '跟随主会话' }], modelsError: '', modelsLoading: false, choosingModel: false, modelNotice: '',
    effort: DEFAULT_EFFORT, effortOptions: effortChoices(), choosingEffort: false,
    get unanswered() { return this.turns.at(-1)?.answer === null },
    get lastAnswer() { return this.turns.findLast((turn) => turn.answer !== null)?.answer ?? '' },
  }
}

// The fork's cached snapshot predates the most recent assistant reply. Add a
// small, bounded tail so the side chat can also discuss that reply and recent tools.
export function recentTranscript(messages) {
  if (!Array.isArray(messages)) return []
  return messages.slice(-6).map((message) => {
    const text = String(message.text ?? '').replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim()
    const tools = (Array.isArray(message.toolUses) ? message.toolUses : []).slice(-2).map((tool) => ({
      name: String(tool.tool ?? '').slice(0, 100),
      result: String(tool.text ?? '').slice(0, 300),
    }))
    return { role: message.role, text: text.slice(0, 1500), tools }
  }).filter((message) => message.text || message.tools.length)
}

// Explicit-model completions receive the visible transcript, not the fork's
// opaque cached system prompt. Bound its size and say exactly what was omitted.
export function mainContext(messages, summary) {
  const budget = 80_000
  const history = []
  let chars = 0
  let truncated = false
  for (const message of [...(Array.isArray(messages) ? messages : [])].reverse()) {
    const text = String(message.text ?? '').replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim()
    const tools = (Array.isArray(message.toolUses) ? message.toolUses : []).map((tool) => {
      const input = JSON.stringify(tool.input ?? {})
      const result = String(tool.text ?? '')
      if (input.length > 2000 || result.length > 4000) truncated = true
      return { name: String(tool.tool ?? ''), input: input.slice(0, 2000), result: result.slice(0, 4000) }
    })
    const record = { role: message.role, text, tools }
    let encoded = JSON.stringify(record)
    if (encoded.length > 16_000) {
      truncated = true
      record.text = text.slice(-10_000)
      record.tools = tools.slice(-1)
      encoded = JSON.stringify(record)
      if (encoded.length > 16_000) {
        record.text = text.slice(-6000)
        record.tools = []
        encoded = JSON.stringify(record)
      }
    }
    if (chars + encoded.length > budget) { truncated = true; break }
    history.unshift(record)
    chars += encoded.length
  }
  return {
    text: [
      '主会话速览：', String(summary || '(暂无速览)').slice(0, 10_000),
      truncated ? '主会话历史（已限长，仅保留最近可容纳的消息；消息或工具结果可能截短）：' : '主会话历史（按时间顺序）：',
      JSON.stringify(history),
    ].join('\n'),
    truncated,
  }
}

// JSON keeps the roles and message boundaries unambiguous even when a question
// contains markup, quotes, or text that looks like a prompt delimiter.
export function chatPrompt(turns, messages = []) {
  const current = turns.at(-1)
  const previous = []
  let remaining = HISTORY_CHARS
  for (const turn of turns.slice(0, -1).reverse()) {
    if (turn.answer === null) continue
    const size = turn.question.length + turn.answer.length
    if (size > remaining) break
    previous.unshift(turn)
    remaining -= size
  }
  return [
    '这是与主会话并行的独立侧聊。请结合主会话已有上下文，回答最后的问题；侧聊不会自动写入主会话。',
    '请使用提问者的语言，简洁、具体地回答；信息不足时明确说明。你不能在此侧聊中执行操作或修改文件，不要声称已经执行。',
    '主会话最近的片段（JSON，可能与上下文重叠）：',
    JSON.stringify(recentTranscript(messages)),
    '以下是之前的侧聊记录（JSON，按时间顺序）：',
    JSON.stringify(previous),
    '当前问题（JSON 字符串）：',
    JSON.stringify(current?.question ?? ''),
  ].join('\n')
}
