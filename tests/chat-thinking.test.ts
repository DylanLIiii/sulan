import { expect, test } from 'claude-code/testing'
import { chatPrompt, cleanTurns, createChat } from '../hooks/chat.js'
import { MAX_THINKING, replyFields, splitReply } from '../hooks/chat-response.js'
import { buildChatPane } from '../hooks/chat-view.js'
import { fakeElements } from '../scripts/preview-lib.mjs'

function collect(node: any): any[] {
  if (!node || typeof node !== 'object') return []
  return [node, ...(node.props?.children ?? []).flatMap(collect)]
}

test('thinking is collapsed rather than rendered inside the final answer', async () => {
  const chat = createChat()
  chat.turns = [{ question: '先看协议吗？', answer: '<think>Need to compare protocol dependencies.</think>先确认协议，再验证数据。' }]
  const tree = buildChatPane(fakeElements, { chat, columns: 40, onToggleThinking() {} })
  const nodes = collect(tree)
  const answer = nodes.find((node) => node.type === 'Markdown' && node.props.key === 'chat-answer-1')
  expect(answer.props.text).toBe('先确认协议，再验证数据。')
  expect(nodes.some((node) => node.type === 'Button' && node.props.key === 'chat-thinking-1')).toBe(true)
  expect(nodes.some((node) => node.type === 'Markdown' && node.props.text.includes('Need to compare'))).toBe(false)
})

test('tagged reasoning is parsed before truncating so a long preamble cannot eat the answer', async () => {
  const fields = replyFields('<think>' + '计划'.repeat(4000) + '</think>最终建议', 4000)
  expect(fields.answer).toBe('最终建议')
  expect(fields.thinking?.length).toBeLessThan(MAX_THINKING + 30)
  expect(fields.thinking).toContain('已截断')
})

test('multiple reasoning blocks and a missing opening marker keep their answer', async () => {
  expect(splitReply('<think>A</think>回答一<thinking>B</thinking>回答二')).toMatchObject({ answer: '回答一\n回答二', thinking: 'A\n\nB' })
  expect(splitReply('规划</think>回答')).toMatchObject({ answer: '回答', thinking: '规划' })
})

test('an unfinished reasoning tag is not presented as a completed answer', async () => {
  const fields = replyFields('<think>还在规划', 4000)
  expect(fields.answer).toBe(null)
  expect(fields.thinking).toBe('还在规划')
  expect(fields.thinkingIncomplete).toBe(true)
})

test('code examples and ordinary English are never folded as thinking', async () => {
  const cases = [
    'The protocol should be reviewed first. Then validate data.',
    'The user asks for a protocol review. This is a normal explanation.',
    '解释标签：`<think>plan</think>`。',
    '```xml\n<think>example</think>\n```\n这是一段代码示例。',
    '~~~xml\n<analysis>example</analysis>\n~~~\n代码示例。',
  ]
  for (const text of cases) {
    expect(splitReply(text)).toMatchObject({ answer: text, thinking: '' })
  }
})

test('the reported untagged self-narration is labelled suspected rather than a final answer', async () => {
  const text = 'The user asks in this side chat: "先看协议吗?"\n\nContext: protocol planning.\n\nI should not claim to have done anything. Structure: explain the dependencies.'
  expect(splitReply(text)).toMatchObject({ answer: '', thinking: text, kind: 'suspected', incomplete: true })
  expect(splitReply(text + '\n\nFinal answer: 先确认协议。')).toMatchObject({ answer: '先确认协议。', thinking: text, kind: 'suspected' })
})

test('loading legacy replies separates thinking and prompt history excludes it', async () => {
  const turns = cleanTurns([{ question: '旧问题', answer: '<think>private planning</think>结论' }])
  expect(turns[0]).toMatchObject({ answer: '结论', thinking: 'private planning' })
  const prompt = chatPrompt([...turns, { question: '追问', answer: null }])
  expect(prompt).toContain('结论')
  expect(prompt).not.toContain('private planning')
  expect(cleanTurns(turns)).toEqual(turns)
})

test('expanded thinking uses its own Markdown node and can remain separate from the answer', async () => {
  const chat = createChat()
  chat.turns = [{ question: '问题', answer: '<think>规划过程</think>最终回答' }]
  chat.expandedThinking.add(0)
  const nodes = collect(buildChatPane(fakeElements, { chat, columns: 24, onToggleThinking() {} }))
  expect(nodes.find((node) => node.props?.key === 'chat-thinking-body-1').props.text).toBe('规划过程')
  expect(nodes.find((node) => node.props?.key === 'chat-answer-1').props.text).toBe('最终回答')
})
