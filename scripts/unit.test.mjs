// Unit tests for the mod's pure modules, runnable with plain Node (npm test).
// The session-level tests live in tests/sulan.test.ts and run with `claude plugin test`.
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { flowNodes, renderFlow } from '../hooks/diagram.js'
import { inlineSpans, parseSummary } from '../hooks/summary.js'
import { cells, truncate, width } from '../hooks/text.js'
import { buildPane, hintLine, iconSet } from '../hooks/view.js'
import { SAMPLE, fakeElements, renderTree } from './preview-lib.mjs'

const FLOW = `flowchart TD
  a["✓ 读原仓库"] --> b["✓ 定方案"]
  b --> c["◐ 写代码"]
  c --> d["○ 验证"]
  c -->|失败| e["✗ 回退"]`

test('width counts CJK letters as two cells', () => {
  assert.equal(width('ab'), 2)
  assert.equal(width('读原'), 4)
  assert.deepEqual(cells('a读'), ['a', '读', ''])
  assert.equal(truncate('读原仓库读原仓库', 7), '读原仓…')
  assert.ok(width(truncate('读原仓库读原仓库', 7)) <= 7)
})

test('parses the summary format', () => {
  const p = parseSummary(SAMPLE)
  assert.match(p.tldr, /^方案已定/)
  assert.deepEqual(p.sections.map((s) => s.id), ['why', 'did', 'out', 'now', 'next', 'terms'])
  assert.deepEqual(p.sections.find((s) => s.id === 'now').items[0], { status: 'done', text: '方案已确认，图表方案参考 prismantis' })
  assert.match(p.sections.find((s) => s.id === 'terms').items[0].text, /^\*\*PromptHint\*\*/)
  assert.match(p.flow, /^flowchart LR/)
  assert.doesNotMatch(p.flow, /```/)
  assert.equal(p.caption.length, 1)
  assert.equal(parseSummary('## Why this session\n- legacy'), null)
  // Empty terms ("- 无") is omitted; Chinese heading aliases map to terms
  const noTerms = parseSummary('TLDR: x\n## why\n- a\n## terms\n- 无')
  assert.deepEqual(noTerms.sections.map((s) => s.id), ['why'])
  const zhTerms = parseSummary('TLDR: x\n## 名词与概念\n- **P0**：共用事件底座工作包')
  assert.deepEqual(zhTerms.sections.map((s) => s.id), ['terms'])
})

test('inline code and bold spans', () => {
  assert.deepEqual(inlineSpans('改 `a.js` 的 **核心**'), [
    { text: '改 ' }, { text: 'a.js', code: true }, { text: ' 的 ' }, { text: '核心', bold: true },
  ])
})

test('box art keeps CJK frames aligned and is colored by status', () => {
  const drawn = renderFlow(FLOW, 40)
  assert.equal(drawn.kind, 'art')
  const lines = drawn.art.split('\n')
  for (let r = 0; r < lines.length; r++) {
    if (!lines[r].startsWith('╭')) continue
    // The label row's right frame sits in the same cell column as the top-right corner
    const right = cells(lines[r]).indexOf('╮')
    const label = cells(lines[r + 1])
    assert.match(label[right], /[│├┤]/, lines[r + 1])
  }
  const tones = new Set(drawn.rows.flat().map((r) => r.tone))
  for (const t of ['done', 'wip', 'todo', 'fail', 'edge', 'text']) assert.ok(tones.has(t), t)
})

test('LR is drawn top to bottom, narrow panes get a list, broken input does not throw', () => {
  assert.equal(renderFlow('flowchart LR\n  a["✓ A"] --> b["○ B"]', 40).art.split('\n').filter((l) => l.startsWith('╭')).length, 2)
  assert.equal(renderFlow(FLOW, 12).kind, 'list')
  assert.doesNotThrow(() => renderFlow('flowchart TD\n  a[[[ -->', 40))
  assert.equal(renderFlow('sequenceDiagram\n  A->>B: hi', 40), null)
  assert.deepEqual(flowNodes('a-->b["x"]'), [{ label: 'x', status: null }])
})

test('the hint line fits', () => {
  const line = hintLine(iconSet('terminal', 'unicode'), '一个很长很长很长很长很长很长很长很长很长很长的摘要', '? for shortcuts', 40)
  assert.ok(width(line) < 40)
  assert.ok(line.startsWith('? for shortcuts · ◆ '))
})

test('the pane tree renders on every surface without throwing', () => {
  for (const surface of ['terminal', 'desktop', 'vscode']) {
    for (const columns of [30, 44, 60]) {
      const tree = buildPane(fakeElements, {
        parsed: parseSummary(SAMPLE), raw: SAMPLE, status: '', isError: false, when: '14:32 更新', columns, surface,
        icons: iconSet(surface, 'nerd'), onRefresh() {}, onRebuild() {},
      })
      const out = renderTree(tree, columns, { color: false })
      assert.match(out, /目标/)
      assert.match(out, /名词与概念/)
      assert.match(out, /进度/)
      assert.match(out, /2\/4 · 50%/)
    }
  }
})
