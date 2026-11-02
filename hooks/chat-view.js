// The composer and newest exchange stay near the top; older exchanges follow
// below and can be reached with the pane's normal scrolling.

const ACCENT = '#D97757'
const SUGGESTIONS = [
  ['解释当前改动', '请结合当前会话，解释已经完成的改动及其原因。'],
  ['梳理下一步', '根据当前会话，接下来最值得做什么？'],
  ['检查潜在风险', '请根据当前会话，指出尚未解决的风险或需要验证的地方。'],
]

export function buildChatPane(el, view) {
  const { Box, Text, Button, Input, Markdown } = el
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

  if (chat.running) {
    children.push(Text({ color: 'yellow', children: ['◐ 正在思考…'] }))
  } else if (chat.unanswered) {
    children.push(Box({ flexDirection: 'row', columnGap: 2, children: [
      Button({ key: 'chat-retry', label: '重试', plain: true, onPress: view.onRetry }),
      Button({ key: 'chat-edit', label: '编辑问题', plain: true, onPress: view.onEdit }),
    ] }))
  } else {
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
      if (turn.answer !== null) {
        exchange.push(Text({ color: ACCENT, bold: true, children: ['✦ 侧聊'] }))
        exchange.push(Markdown({ key: `chat-answer-${chat.turns.length - index}`, text: turn.answer }))
      } else if (!chat.running) {
        exchange.push(Text({ dimColor: true, children: ['这条提问尚未得到回答。'] }))
      }
      children.push(Box({ flexDirection: 'column', marginTop: 1, children: exchange }))
    }
  }
  return Box({ flexDirection: 'column', children })
}
