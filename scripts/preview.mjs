// node scripts/preview.mjs [--chat] [--empty] [--cols 44] [--icons unicode] [--no-color]
import { parseSummary } from '../hooks/summary.js'
import { buildPane, hintLine, iconSet } from '../hooks/view.js'
import { buildChatPane } from '../hooks/chat-view.js'
import { createChat } from '../hooks/chat.js'
import { modelChoices } from '../hooks/chat-models.js'
import { SAMPLE, fakeElements, framed } from './preview-lib.mjs'

const arg = (name, fallback) => {
  const i = process.argv.indexOf('--' + name)
  return i > 0 ? process.argv[i + 1] : fallback
}
const columns = Number(arg('cols', 44))
const surface = arg('surface', 'terminal')
const icons = iconSet(surface, arg('icons', 'nerd'))
const color = !process.argv.includes('--no-color')
const parsed = parseSummary(SAMPLE)
const isChat = process.argv.includes('--chat')
const noop = () => {}

let content
if (isChat) {
  const chat = createChat()
  chat.modelOptions = modelChoices({ replaceBuiltInOptions: true, options: [
    { model: 'gateway/sonnet[1m]', label: 'Sonnet · Gateway' },
    { model: 'gateway/opus[1m]', label: 'Opus · Gateway' },
  ] }, 'gateway/sonnet[1m]')
  if (process.argv.includes('--models')) chat.choosingModel = true
  if (!process.argv.includes('--empty')) chat.turns = [
    { question: '现在的进度如何？', answer: '侧栏的核心交互已经完成。\n\n接下来验证窄屏显示和会话切换。' },
    { question: '有哪些地方需要特别注意？', answer: '优先检查请求失败后的重试，以及切换会话时旧回答是否会被丢弃。' },
  ]
  content = buildChatPane(fakeElements, {
    chat, columns, onInput: noop, onSubmit: noop, onRetry: noop, onEdit: noop, onClear: noop, onCancelClear: noop, onCopy: noop,
    onModelOpen: noop, onModelCancel: noop, onModelSelect: noop, onModelsReload: noop,
  })
} else {
  content = buildPane(fakeElements, {
    parsed, raw: SAMPLE, status: '', isError: false, when: '14:32 更新', columns, surface, icons, onRefresh: noop, onRebuild: noop,
  })
}
console.log(framed(content, columns, isChat ? '侧聊' : '速览', { color }))
console.log()
const hint = hintLine(icons, parsed.tldr, '? for shortcuts', 100)
console.log('  ' + (color ? `\x1b[2m${hint}\x1b[0m` : hint))
