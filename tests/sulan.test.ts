import { expect, mock, test } from 'claude-code/testing'

import { flowNodes, renderFlow } from '../hooks/diagram.js'
import { parseSummary } from '../hooks/summary.js'
import { width } from '../hooks/text.js'
import { hintLine, iconSet } from '../hooks/view.js'

const SAMPLE = `TLDR: 方案已定，正在写 \`register.js\`
## why
- 把 catch-me-up 改成中文可视化版
## did
- 克隆原仓库，读 \`hooks/register.js\`
## out
- 改为结构化输出，pane 负责排版
## now
- [done] 方案已确认
- [wip] 代码写到一半
## next
- [ask] 要不要加 SVG？
## flow
\`\`\`mermaid
flowchart LR
  a["✓ 读原仓库"] --> b["✓ 定方案"]
  b --> c["◐ 写代码"]
  c --> d["○ 验证"]
\`\`\`
- 验证要在宽、窄终端各看一次`

const FLOW = `flowchart TD
  a["✓ 读原仓库"] --> b["✓ 定方案"]
  b --> c["◐ 写代码"]
  c --> d["○ 验证"]
  c -->|失败| e["✗ 回退"]`

const PANE = {
  plugin: 'sulan',
  component: 'Pane',
  requestId: 'sulan',
  viewport: { columns: 140, rows: 40 },
  props: { title: '速览', isFocused: false, bodyColumns: 44, placement: 'dock', scroll: { offset: 0, bodyRows: 60 }, view: {} },
} as const

const USAGE = { input_tokens: 1, output_tokens: 1, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 }

const within = <T,>(p: Promise<T>, ms: number) => Promise.race([p, new Promise<'timeout'>((r) => setTimeout(() => r('timeout'), ms))])

// Stubs every call session.start and an update make; `messages` is the transcript
function stubSession(on: any, { saved, messages = [], reply = SAMPLE }: { saved?: unknown; messages?: unknown[]; reply?: string } = {}) {
  const calls = { model: 0 }
  let answered: () => void = () => {}
  const modelCalled = new Promise<void>((r) => (answered = r))
  mock.clock(on, { now: Date.UTC(2026, 9, 30, 6, 32) })
  on('session.start', () => ({ cwd: '/work' }))
  on('session.id', () => ({ value: 'sess-1' }))
  on('session.surfaces', () => ({ value: ['terminal'] }))
  on('session.messages', () => ({ value: messages }))
  on('store.get', ($: any, e: any) => ({ value: e.key === 'session:sess-1' ? saved : undefined }))
  on('store.set', () => ({ value: undefined }))
  on('store.delete', () => ({ value: undefined }))
  on('command.register', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('fs.read', () => ({ value: '# rules' }))
  on('process.run', () => ({ value: { exitCode: 0, stdout: '', stderr: '' } }))
  on('model.complete', () => {
    calls.model++
    answered()
    return { value: { isAnswered: true, text: reply, usage: USAGE } }
  })
  return { calls, modelCalled }
}

test('parses the TL;DR, sections, statuses, flow and caption', async () => {
  const p = parseSummary(SAMPLE)!
  expect(p.tldr).toBe('方案已定，正在写 `register.js`')
  expect(p.sections.map((s) => s.id)).toEqual(['why', 'did', 'out', 'now', 'next'])
  expect(p.sections[3]!.items).toEqual([
    { status: 'done', text: '方案已确认' },
    { status: 'wip', text: '代码写到一半' },
  ])
  expect(p.flow).toMatch(/^flowchart LR/)
  expect(p.flow).not.toMatch(/```/)
  expect(p.caption).toEqual(['验证要在宽、窄终端各看一次'])
})

test('free-form text that matches no section parses as null', async () => {
  expect(parseSummary('## Why this session\n- something')).toBe(null)
  expect(parseSummary('')).toBe(null)
})

test('CJK labels keep the box frames aligned', async () => {
  const drawn = renderFlow(FLOW, 40)!
  expect(drawn.kind).toBe('art')
  const lines = (drawn as any).art.split('\n') as string[]
  // Each box's top border and label row end in the same column
  const top = lines.findIndex((l) => l.startsWith('╭'))
  expect(width(lines[top]!)).toBe(width(lines[top + 1]!.replace(/\s+$/, '')))
  expect(lines[top + 1]).toMatch(/│ ✓ 读原仓库 │/)
})

test('flowchart LR is drawn top to bottom', async () => {
  const drawn = renderFlow('flowchart LR\n  a["✓ A"] --> b["○ B"]', 40) as any
  expect(drawn.kind).toBe('art')
  expect(drawn.art.split('\n').filter((l: string) => l.startsWith('╭')).length).toBe(2)
})

test('boxes take the color of their status glyph', async () => {
  const drawn = renderFlow(FLOW, 40) as any
  const tones = new Set(drawn.rows.flat().map((r: any) => r.tone))
  for (const t of ['done', 'wip', 'todo', 'fail', 'edge', 'text']) expect(tones.has(t)).toBe(true)
})

test('a pane too narrow for the art falls back to a list of steps', async () => {
  const drawn = renderFlow(FLOW, 12) as any
  expect(drawn.kind).toBe('list')
  expect(drawn.nodes.map((n: any) => n.status)).toEqual(['done', 'done', 'wip', 'todo', 'fail'])
})

test('a broken diagram does not throw', async () => {
  expect(() => renderFlow('flowchart TD\n  a[[[ -->', 40)).not.toThrow()
  expect(renderFlow('sequenceDiagram\n  A->>B: hi', 40)).toBe(null)
  expect(flowNodes('a-->b["x"]')).toEqual([{ label: 'x', status: null }])
})

test('the hint line fits the terminal', async () => {
  const icons = iconSet('terminal', 'unicode')
  const line = hintLine(icons, '一个很长很长很长很长很长很长很长很长很长很长的摘要', '? for shortcuts', 40)!
  expect(width(line)).toBeLessThan(40)
  expect(line.startsWith('? for shortcuts · ◆ ')).toBe(true)
  expect(hintLine(icons, '', 'x', 80)).toBe(null)
})

test('the pane draws every section and the diagram on each surface', async ($, on) => {
  stubSession(on, { saved: { summary: SAMPLE, covered: 0, marker: '', updatedAt: Date.UTC(2026, 9, 30, 6, 32) } })
  await $.session.start({ surface: 'terminal', isInteractive: false, cwd: '/work' })
  for (const surface of ['terminal', 'desktop', 'vscode'] as const) {
    const ui = await $.ui.mount({ ...PANE, surface })
    for (const title of ['目标', '做了什么', '结论', '现状', '需要你', '进度']) {
      expect(await ui.find({ type: 'Text', text: title })).toBeDefined()
    }
    expect(await ui.find({ type: 'Text', text: '2/4 · 50%' })).toBeDefined()
    expect(await ui.find({ key: 'refresh' })).toBeDefined()
    if (surface === 'vscode') expect(await ui.find({ type: 'Code' })).toBeDefined()
    else expect(await ui.find({ type: 'Text', text: '读原仓库' })).toBeDefined()
    await ui.unmount()
  }
})

test('opening a session with history summarizes it once', async ($, on) => {
  const messages = [
    { role: 'user', text: '帮我改个 bug', toolUses: [] },
    { role: 'assistant', text: '好的', toolUses: [] },
  ]
  const { calls, modelCalled } = stubSession(on, { messages })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  expect(await within(modelCalled, 2000)).not.toBe('timeout')
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /方案已定/ })).toBeDefined()
  expect(calls.model).toBe(1)
})

test('opening a session with no history does nothing', async ($, on) => {
  const { calls, modelCalled } = stubSession(on, { messages: [] })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/work' })
  expect(await within(modelCalled, 200)).toBe('timeout')
  expect(calls.model).toBe(0)
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ type: 'Text', text: /还没有摘要/ })).toBeDefined()
})

test('a summary that does not parse still shows as Markdown', async ($, on) => {
  stubSession(on, { saved: { summary: '## Why this session\n- legacy text', covered: 0, marker: '', updatedAt: 1 } })
  await $.session.start({ surface: 'terminal', isInteractive: false, cwd: '/work' })
  const ui = await $.ui.mount({ ...PANE, surface: 'terminal' })
  expect(await ui.find({ key: 'raw' })).toBeDefined()
})

test('the TL;DR joins the hint line under the prompt', async ($, on) => {
  stubSession(on, { saved: { summary: SAMPLE, covered: 0, marker: '', updatedAt: 1 } })
  on('ui.render', ($: any, e: any) => ({ type: 'Text', props: {}, children: [e.props.hint] }))
  await $.session.start({ surface: 'terminal', isInteractive: false, cwd: '/work' })
  const ui = await $.ui.mount({
    plugin: 'sulan',
    component: 'PromptHint',
    requestId: 'hint',
    surface: 'terminal',
    viewport: { columns: 120, rows: 40 },
    props: { isDraft: false, isWorking: false, hint: '? for shortcuts' },
  })
  expect(await ui.find({ type: 'Text', text: /^\? for shortcuts · .+方案已定/ })).toBeDefined()
})
