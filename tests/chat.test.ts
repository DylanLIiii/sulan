import { expect, mock, test } from 'claude-code/testing'

const PANE = {
  plugin: 'sulan', component: 'Pane', requestId: 'sulan-chat',
  viewport: { columns: 140, rows: 40 },
  props: { title: '侧聊', isFocused: false, bodyColumns: 40, placement: 'dock', scroll: { offset: 0, bodyRows: 30 }, view: {} },
} as const
const USAGE = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }
const answer = (text: string) => ({ isAnswered: true, text, usage: USAGE })

function stub(on: any, fork: (event: any) => any = () => answer('这是回答。'), readFailure = { enabled: false }) {
  const store = new Map<string, any>()
  const prompts: string[] = []
  const copied: string[] = []
  const opened: any[] = []
  let session = 'one'
  mock.clock(on, { now: Date.UTC(2026, 9, 30, 6, 32) })
  on('session.start', () => ({ cwd: '/work' }))
  on('classic.SessionStart', () => ({}))
  on('session.id', () => ({ value: session }))
  on('session.surfaces', () => ({ value: [] }))
  on('session.messages', () => ({ value: [
    { role: 'assistant', text: '主会话刚完成的回答', toolUses: [{ tool: 'Read', text: '最新工具结果' }] },
  ] }))
  on('store.get', (_: any, e: any) => e.key === 'chat:one' && readFailure.enabled ? { deny: '读取失败' } : { value: store.get(e.key) })
  on('store.keys', () => ({ value: [...store.keys()] }))
  on('store.set', (_: any, e: any) => { store.set(e.key, e.value); return { value: undefined } })
  on('store.delete', (_: any, e: any) => { store.delete(e.key); return { value: undefined } })
  on('command.register', () => ({ value: undefined }))
  on('ui.open', (_: any, e: any) => { opened.push(e); return { value: { isPlaced: true } } })
  on('ui.copy', (_: any, e: any) => { copied.push(e.text); return { value: { isCopied: true } } })
  on('model.fork', async (_: any, e: any) => { prompts.push(e.prompt); return { value: await fork(e) } })
  return { store, prompts, copied, opened, switchTo: (id: string) => { session = id } }
}

async function start($: any) {
  await $.session.start({ surface: 'terminal', isInteractive: false, cwd: '/work' })
  await $.command.run({ command: 'sulan-chat', args: '' })
  return $.ui.mount({ ...PANE, surface: 'terminal' })
}

test('side chat uses a fork and includes previous side turns in follow-up questions', async ($, on) => {
  const { prompts, store, copied } = stub(on, () => answer('先检查测试。'))
  const ui = await start($)
  await ui.input({ key: 'chat-input', text: '现在的状态？' })
  expect(await ui.find({ type: 'Text', text: '现在的状态？' })).toBeDefined()
  expect(await ui.find({ type: 'Markdown', text: '先检查测试。' })).toBeDefined()
  expect(prompts[0]).toContain('现在的状态？')
  expect(prompts[0]).toContain('主会话刚完成的回答')
  expect(prompts[0]).toContain('最新工具结果')
  await ui.input({ key: 'chat-input', text: '接下来呢？' })
  expect(prompts[1]).toContain('现在的状态？')
  expect(prompts[1]).toContain('先检查测试。')
  expect(prompts[1]).toContain('接下来呢？')
  expect(store.get('chat:one').turns).toHaveLength(2)
  await ui.press({ key: 'chat-copy' })
  expect(copied).toEqual(['先检查测试。'])
})

test('the side chat is its own pane, separate from the summary', async ($, on) => {
  const { opened } = stub(on)
  await $.session.start({ surface: 'terminal', isInteractive: false, cwd: '/work' })
  await $.command.run({ command: 'sulan-chat', args: '' })
  expect(opened.at(-1)).toMatchObject({ id: 'sulan-chat', title: '侧聊', focus: true })
  for (const surface of ['terminal', 'desktop', 'vscode'] as const) {
    const chatUi = await $.ui.mount({ ...PANE, surface })
    expect(await chatUi.find({ key: 'chat-input' })).toBeDefined()
    expect(await chatUi.find({ key: 'suggest-解释当前改动' })).toBeDefined()
    expect(await chatUi.find({ key: 'refresh' })).toBeUndefined()
    await chatUi.unmount()
    const summaryUi = await $.ui.mount({ ...PANE, requestId: 'sulan', props: { ...PANE.props, title: '速览' }, surface })
    expect(await summaryUi.find({ key: 'refresh' })).toBeDefined()
    expect(await summaryUi.find({ key: 'chat-input' })).toBeUndefined()
    await summaryUi.unmount()
  }
})

test('a failed question can be retried or edited without losing it', async ($, on) => {
  let attempts = 0
  const { store, prompts } = stub(on, () => ++attempts === 1 ? { isAnswered: false, reason: 'offline' } : answer('重试成功。'))
  const ui = await start($)
  await ui.input({ key: 'chat-input', text: '失败后怎么办？' })
  expect(await ui.find({ type: 'Text', text: /offline/ })).toBeDefined()
  expect(await ui.find({ key: 'chat-retry' })).toBeDefined()
  expect(store.get('chat:one').turns[0]).toEqual({ question: '失败后怎么办？', answer: null })
  await ui.press({ key: 'chat-retry' })
  expect(await ui.find({ type: 'Markdown', text: '重试成功。' })).toBeDefined()
  expect(prompts).toHaveLength(2)
  expect(store.get('chat:one').turns).toHaveLength(1)
})

test('a recovered unfinished question can be edited and resubmitted', async ($, on) => {
  const { store } = stub(on)
  store.set('chat:one', { turns: [{ question: '原问题', answer: null }] })
  const ui = await start($)
  expect(await ui.find({ type: 'Text', text: /上次提问未完成/ })).toBeDefined()
  await ui.press({ key: 'chat-edit' })
  expect((await ui.find({ key: 'chat-input' })).props.value).toBe('原问题')
  await ui.input({ key: 'chat-input', text: '修改后的问题' })
  expect(store.get('chat:one').turns).toEqual([{ question: '修改后的问题', answer: '这是回答。' }])
})

test('clear requires confirmation and keeps the main summary intact', async ($, on) => {
  const { store } = stub(on)
  store.set('session:one', { summary: 'TLDR: 原有速览', covered: 0, marker: '', updatedAt: 1 })
  const ui = await start($)
  await ui.input({ key: 'chat-input', text: '问题' })
  await ui.press({ key: 'chat-clear' })
  expect(store.get('chat:one')).toBeDefined()
  await ui.press({ key: 'chat-clear-cancel' })
  expect(await ui.find({ type: 'Text', text: '问题' })).toBeDefined()
  await ui.press({ key: 'chat-clear' })
  await ui.press({ key: 'chat-clear-confirm' })
  expect(store.has('chat:one')).toBe(false)
  expect(await ui.find({ type: 'Text', text: '问题' })).toBeUndefined()
  const summaryUi = await $.ui.mount({ ...PANE, requestId: 'sulan', surface: 'terminal' })
  expect(await summaryUi.find({ type: 'Text', text: '原有速览' })).toBeDefined()
})

test('switching sessions isolates side chats and restores each one on resume', async ($, on) => {
  const { switchTo, store } = stub(on)
  const ui = await start($)
  await ui.input({ key: 'chat-input', text: '第一会话的问题' })
  switchTo('two')
  await $.classic.SessionStart({ source: 'resume' })
  expect(await ui.find({ type: 'Text', text: '第一会话的问题' })).toBeUndefined()
  await ui.input({ key: 'chat-input', text: '第二会话的问题' })
  switchTo('one')
  await $.classic.SessionStart({ source: 'resume' })
  expect(await ui.find({ type: 'Text', text: '第一会话的问题' })).toBeDefined()
  expect(await ui.find({ type: 'Text', text: '第二会话的问题' })).toBeUndefined()
  expect(store.get('chat:two').turns[0].question).toBe('第二会话的问题')
})

test('a late fork response cannot leak into a different session', async ($, on) => {
  let resolveAnswer: (value: any) => void = () => {}
  let markStarted: () => void = () => {}
  const started = new Promise<void>((resolve) => { markStarted = resolve })
  const result = new Promise((resolve) => { resolveAnswer = resolve })
  const { switchTo, store } = stub(on, () => { markStarted(); return result })
  const ui = await start($)
  const sending = ui.input({ key: 'chat-input', text: '第一个会话' })
  await started
  switchTo('two')
  await $.classic.SessionStart({ source: 'resume' })
  resolveAnswer(answer('过期的回答'))
  await sending
  expect(await ui.find({ type: 'Markdown', text: '过期的回答' })).toBeUndefined()
  expect(store.get('chat:two')).toBeUndefined()
  expect(store.get('chat:one').turns).toEqual([{ question: '第一个会话', answer: null }])
})


test('without a main-session snapshot the user gets an actionable message', async ($, on) => {
  stub(on, () => ({ isAnswered: false, reason: 'nothing-to-fork' }))
  const ui = await start($)
  await ui.press({ key: 'suggest-解释当前改动' })
  expect(await ui.find({ type: 'Text', text: /请先在主会话发送消息/ })).toBeDefined()
  expect(await ui.find({ key: 'chat-retry' })).toBeDefined()
})

test('draft survives reopening the pane and invalid input never calls a model', async ($, on) => {
  const { prompts } = stub(on)
  const ui = await start($)
  await ui.input({ key: 'chat-input', text: '未发送的草稿', kind: 'change' })
  await ui.unmount()
  const again = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect((await again.find({ key: 'chat-input' })).props.value).toBe('未发送的草稿')
  await again.input({ key: 'chat-input', text: 'x'.repeat(2001) })
  expect(await again.find({ type: 'Text', text: /2000 字符以内/ })).toBeDefined()
  expect(prompts).toHaveLength(0)
})

test('clearing during a pending fork discards its late result', async ($, on) => {
  let resolveAnswer: (value: any) => void = () => {}
  let markStarted: () => void = () => {}
  const started = new Promise<void>((resolve) => { markStarted = resolve })
  const result = new Promise((resolve) => { resolveAnswer = resolve })
  const { store } = stub(on, () => { markStarted(); return result })
  const ui = await start($)
  const sending = ui.input({ key: 'chat-input', text: '待取消的问题' })
  await started
  await ui.press({ key: 'chat-clear' })
  await ui.press({ key: 'chat-clear-confirm' })
  resolveAnswer(answer('过期回答'))
  await sending
  expect(store.has('chat:one')).toBe(false)
  expect(await ui.find({ type: 'Markdown', text: '过期回答' })).toBeUndefined()
  expect(await ui.find({ key: 'chat-input' })).toBeDefined()
})


test('history stays bounded and older sessions are pruned independently', async ($, on) => {
  const { store, prompts } = stub(on)
  for (let i = 0; i < 15; i++) {
    store.set('chat:old-' + i, { turns: [{ question: '旧问题', answer: '旧回答' }], updatedAt: i + 1 })
  }
  const ui = await start($)
  for (let i = 0; i < 9; i++) await ui.input({ key: 'chat-input', text: '问题' + i })
  expect(store.get('chat:one').turns).toHaveLength(8)
  expect(store.get('chat:one').turns[0].question).toBe('问题1')
  expect(store.has('chat:old-0')).toBe(false)
  expect([...store.keys()].filter((key) => key.startsWith('chat:'))).toHaveLength(15)
  expect(prompts[8]).toContain('问题8')
})


test('a storage read failure cannot overwrite history and can be retried', async ($, on) => {
  const failure = { enabled: true }
  const { store, prompts } = stub(on, () => answer('这是回答。'), failure)
  store.set('chat:one', { turns: [{ question: '保存的问题', answer: '保存的回答' }] })
  const ui = await start($)
  expect(await ui.find({ type: 'Text', text: /读取侧聊失败/ })).toBeDefined()
  expect(await ui.find({ key: 'chat-input' })).toBeUndefined()
  expect(await ui.find({ key: 'suggest-解释当前改动' })).toBeUndefined()
  expect(prompts).toHaveLength(0)
  failure.enabled = false
  await ui.press({ key: 'chat-reload' })
  expect(await ui.find({ type: 'Text', text: '保存的问题' })).toBeDefined()
  expect(await ui.find({ type: 'Markdown', text: '保存的回答' })).toBeDefined()
})
