// The composer and newest exchange stay near the top; older exchanges follow
// below and can be reached with the pane's normal scrolling.

import { FOLLOW_MODEL, modelLabel, effortLabel } from './chat-models.js'
import { truncate } from './text.js'
import { durationText, turnReply } from './chat-response.js'

const ACCENT = '#D97757'
const SUGGESTIONS = [
  ['解释当前改动', '请结合当前会话，解释已经完成的改动及其原因。'],
  ['梳理下一步', '根据当前会话，接下来最值得做什么？'],
  ['检查潜在风险', '请根据当前会话，指出尚未解决的风险或需要验证的地方。'],
]

export function buildChatPane(el, view) {
  const { Box, Text, Button, Input, Markdown, Select } = el
  const { chat, columns } = view
  const children = [
    Text({ children: [Text({ color: ACCENT, bold: true, children: ['✦ 侧聊'] }), Text({ dimColor: true, children: ['  ·  当前会话'] })] }),
    Text({ dimColor: true, wrap: 'wrap', children: ['独立提问，不打断任务；侧聊不会自动进入主会话。'] }),
  ]

  if (chat.loading || chat.loadFailed) {
    children.push(Text({ color: chat.loadFailed ? 'red' : 'yellow', wrap: 'wrap', children: [chat.loadFailed ? chat.status : '正在读取侧聊…'] }))
    if (chat.loadFailed) children.push(Button({ key: 'chat-reload', label: '重试读取', plain: true, onPress: view.onReload }))
    return Box({ flexDirection: 'column', children })
  }

  const label = modelLabel(chat)
  const effortLabelText = effortLabel(chat.effort)
  if (chat.modelsLoading) {
    children.push(Text({ dimColor: true, children: ['正在读取模型列表…'] }))
  } else if (chat.choosingModel && !chat.running) {
    children.push(Select({ key: 'chat-model', label: '模型', value: chat.model, options: chat.modelOptions, autoFocus: true, onSelect: view.onModelSelect }))
    children.push(Button({ key: 'chat-model-cancel', label: '取消选择', plain: true, onPress: view.onModelCancel }))
  } else if (chat.choosingEffort && !chat.running) {
    children.push(Select({ key: 'chat-effort', label: '思考深度', value: chat.effort, options: chat.effortOptions, autoFocus: true, onSelect: view.onEffortSelect }))
    children.push(Button({ key: 'chat-effort-cancel', label: '取消选择', plain: true, onPress: view.onEffortCancel }))
  } else if (chat.running) {
    children.push(Text({ dimColor: true, wrap: 'wrap', children: ['模型：' + label] }))
    children.push(Text({ dimColor: true, wrap: 'wrap', children: ['思考深度：' + effortLabelText] }))
  } else {
    children.push(Button({ key: 'chat-model-open', label: '模型：' + truncate(label, Math.max(8, columns - 8)) + ' ▾', plain: true, onPress: view.onModelOpen }))
    children.push(Button({ key: 'chat-effort-open', label: '思考：' + effortLabelText + ' ▾', plain: true, onPress: view.onEffortOpen }))
  }
  if (chat.modelsError) {
    children.push(Text({ color: 'yellow', wrap: 'wrap', children: [chat.modelsError] }))
    children.push(Button({ key: 'chat-models-reload', label: '重新读取模型', plain: true, onPress: view.onModelsReload }))
  }
  if (chat.model !== FOLLOW_MODEL) {
    children.push(Text({ dimColor: true, wrap: 'wrap', children: [chat.modelNotice || '自动携带速览、主会话历史和侧聊记录。'] }))
  }

  if (chat.running) {
    const phase = { preparing: '准备上下文', waiting: '等待模型回复', saving: '保存回答' }[chat.phase] || '等待模型回复'
    children.push(Text({ color: 'yellow', children: ['◐ ' + phase + '…'] }))
  } else if (chat.phase === 'complete' || chat.phase === 'failed') {
    const elapsed = durationText(chat.durationMs)
    children.push(Text({ color: chat.phase === 'failed' ? 'red' : 'green', children: [(chat.phase === 'failed' ? '✗ 请求未完成' : '✓ 已完成') + (elapsed ? ' · ' + elapsed : '')] }))
  }

  if (!chat.running && chat.unanswered) {
    children.push(Box({ flexDirection: 'row', columnGap: 2, children: [
      Button({ key: 'chat-retry', label: '重试', plain: true, onPress: view.onRetry }),
      Button({ key: 'chat-edit', label: '编辑问题', plain: true, onPress: view.onEdit }),
    ] }))
  } else if (!chat.running && !chat.choosingModel && !chat.choosingEffort && !chat.modelsLoading) {
    children.push(Input({
      key: 'chat-input', label: '提问', placeholder: '输入问题…', value: chat.draft,
      submitLabel: '发送', autoFocus: true, onInput: view.onInput, onSubmit: view.onSubmit,
    }))
  }

  if (chat.status && !(chat.running && !chat.isError)) {
    children.push(Text({ color: chat.isError ? 'red' : 'green', wrap: 'wrap', children: [chat.status] }))
  }

  if (chat.turns.length) {
    const actions = []
    if (chat.lastAnswer && !chat.confirmClear) actions.push(Button({ key: 'chat-copy', label: '复制最近回答', plain: true, onPress: view.onCopy }))
    if (chat.confirmClear) {
      actions.push(Button({ key: 'chat-clear-confirm', label: '确认清空', plain: true, onPress: view.onClear }))
      actions.push(Button({ key: 'chat-clear-cancel', label: '取消', plain: true, onPress: view.onCancelClear }))
    } else {
      actions.push(Button({ key: 'chat-clear', label: '清空侧聊', plain: true, onPress: view.onClear }))
    }
    children.push(Box({ flexDirection: columns < 26 && !chat.confirmClear ? 'column' : 'row', columnGap: 2, children: actions }))
    if (chat.confirmClear) children.push(Text({ color: 'yellow', children: ['将删除此会话的侧聊记录。'] }))
  }

  children.push(Text({ dimColor: true, children: ['─'.repeat(Math.max(4, columns))] }))
  if (!chat.turns.length) {
    children.push(Text({ dimColor: true, children: ['从这里开始，或者试试：'] }))
    for (const [label, question] of SUGGESTIONS) {
      children.push(Button({ key: 'suggest-' + label, label: '› ' + label, plain: true, onPress: () => view.onSubmit(question) }))
    }
  } else {
    children.push(Text({ dimColor: true, children: ['最近的对话在上方'] }))
    for (const [index, turn] of [...chat.turns].reverse().entries()) {
      const exchange = [
        Text({ color: 'cyan', bold: true, children: ['你'] }),
        Text({ wrap: 'wrap', children: [turn.question] }),
      ]
      const number = chat.turns.length - index
      const reply = turnReply(turn)
      if (reply.thinking) {
        const expanded = chat.expandedThinking.has(number - 1)
        const title = reply.kind === 'suspected' ? '疑似 Thinking' : 'Thinking'
        exchange.push(Button({
          key: `chat-thinking-${number}`, plain: true,
          label: (expanded ? '▾ ' : '▸ ') + title + ' · ' + (expanded ? '收起' : '展开'),
          onPress: () => view.onToggleThinking(number - 1),
        }))
        if (expanded) exchange.push(Markdown({ key: `chat-thinking-body-${number}`, text: reply.thinking, dimColor: true }))
      }
      if (reply.answer) {
        exchange.push(Text({ color: ACCENT, bold: true, children: ['✦ 侧聊'] }))
        exchange.push(Markdown({ key: `chat-answer-${number}`, text: reply.answer }))
      } else if (reply.thinking && !chat.running) {
        exchange.push(Text({ color: 'yellow', wrap: 'wrap', children: ['只收到思考，未识别到最终回答。可重试。'] }))
      } else if (!chat.running) {
        exchange.push(Text({ dimColor: true, children: ['这条提问尚未得到回答。'] }))
      }
      children.push(Box({ flexDirection: 'column', marginTop: 1, children: exchange }))
    }
  }
  return Box({ flexDirection: 'column', children })
}
