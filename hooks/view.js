// Builds the pane's element tree from a parsed summary. Pure: it gets the
// elements from $.ui.resolve(e) and plain data, and never touches $.

import { flowNodes, renderFlow } from './diagram.js'
import { inlineSpans } from './summary.js'
import { truncate, width } from './text.js'

// Nerd Font (Font Awesome range, stable across Nerd Font versions)
const NERD = {
  tldr: '\uf0e7', why: '\uf140', did: '\uf0ad', out: '\uf0eb', now: '\uf041', next: '\uf0a9', terms: '\uf02d', flow: '\uf0e8', time: '\uf017',
  done: '\uf00c', wip: '\uf110', fail: '\uf00d', ask: '\uf128', todo: '\uf10c',
}
const PLAIN = {
  tldr: '◆', why: '◎', did: '✎', out: '✦', now: '◉', next: '➜', terms: '◈', flow: '❖', time: '',
  done: '✓', wip: '◐', fail: '✗', ask: '?', todo: '○',
}
// Inside the diagram, glyphs stay one cell wide everywhere
const NODE_GLYPH = { done: '✓', wip: '◐', fail: '✗', todo: '○' }

const TITLES = { why: '目标', did: '做了什么', out: '结论', now: '现状', next: '需要你', terms: '名词与概念', flow: '进度' }
const SECTION_COLOR = { why: 'blue', did: 'magenta', out: 'yellow', now: 'green', next: 'cyan', terms: 'magenta', flow: 'blue' }
const STATUS_STYLE = { done: { color: 'green' }, wip: { color: 'yellow' }, fail: { color: 'red' }, ask: { color: 'cyan' }, todo: { dimColor: true } }
const TONE = {
  done: { color: 'green' },
  wip: { color: 'yellow' },
  fail: { color: 'red' },
  todo: { dimColor: true },
  box: { color: 'blue' },
  edge: { dimColor: true },
  label: { dimColor: true, italic: true },
}
const ACCENT = '#D97757'
const EMPTY_ITEM = /^(无|无待办|暂无|none|n\/a)[。.]?$/i

export const iconSet = (surface, option) => (surface === 'terminal' && option !== 'unicode' ? NERD : PLAIN)

function rich(Text, text, props = {}) {
  const spans = inlineSpans(text)
  return Text({
    ...props,
    children: spans.map((s) => (s.code ? Text({ color: 'cyan', children: [s.text] }) : s.bold ? Text({ bold: true, children: [s.text] }) : s.text)),
  })
}

function heading({ Text }, icons, id, extra) {
  const color = SECTION_COLOR[id]
  return Text({
    children: [
      Text({ color, children: [icons[id] + ' '] }),
      Text({ color, bold: true, children: [TITLES[id]] }),
      ...(extra ? [Text({ dimColor: true, children: ['  ' + extra] })] : []),
    ],
  })
}

function itemRow({ Box, Text }, icons, item) {
  const empty = EMPTY_ITEM.test(item.text.trim())
  const marker = item.status ? icons[item.status] : '•'
  const markerStyle = item.status ? STATUS_STYLE[item.status] : { dimColor: true }
  const textStyle = empty ? { dimColor: true } : item.status === 'ask' ? { bold: true } : {}
  return Box({
    flexDirection: 'row',
    children: [
      Text({ ...markerStyle, children: [marker + ' '] }),
      Box({ flexDirection: 'column', flexGrow: 1, flexShrink: 1, children: [rich(Text, item.text, textStyle)] }),
    ],
  })
}

function section(el, icons, { id, items }) {
  return el.Box({
    flexDirection: 'column',
    children: [heading(el, icons, id), el.Box({ flexDirection: 'column', paddingLeft: 2, children: items.map((item) => itemRow(el, icons, item)) })],
  })
}

// Counts for the progress bar: the flow's nodes, or else the statuses under "now"
function progressOf(parsed) {
  const statuses = parsed.flow ? flowNodes(parsed.flow).map((n) => n.status) : (parsed.sections.find((s) => s.id === 'now')?.items ?? []).map((i) => i.status)
  const counted = statuses.filter((s) => s === 'done' || s === 'wip' || s === 'fail' || s === 'todo')
  if (!counted.length) return null
  const n = (k) => counted.filter((s) => s === k).length
  return { total: counted.length, done: n('done'), wip: n('wip'), fail: n('fail') }
}

function progressBar({ Text }, p, columns) {
  const size = Math.max(8, Math.min(28, columns - 4))
  const seg = (k) => Math.round((p[k] / p.total) * size)
  const done = seg('done')
  const wip = Math.min(size - done, seg('wip'))
  const fail = Math.min(size - done - wip, seg('fail'))
  const rest = size - done - wip - fail
  return Text({
    children: [
      Text({ color: 'green', children: ['━'.repeat(done)] }),
      Text({ color: 'yellow', children: ['━'.repeat(wip)] }),
      Text({ color: 'red', children: ['━'.repeat(fail)] }),
      Text({ dimColor: true, children: ['─'.repeat(rest)] }),
    ],
  })
}

function diagram(el, surface, drawn, room) {
  const { Box, Text, Code } = el
  if (drawn.kind === 'list') {
    const rows = []
    drawn.nodes.forEach((node, i) => {
      if (i > 0 && drawn.nodes.length <= 6) rows.push(Text({ dimColor: true, children: ['│'] }))
      const status = node.status ?? 'todo'
      rows.push(Text({ children: [Text({ ...TONE[status], children: [NODE_GLYPH[status] + ' '] }), truncate(node.label, 40)] }))
    })
    return Box({ flexDirection: 'column', children: rows })
  }
  // The VS Code panel has no monospaced Text, so the art goes in a code block there
  if (surface === 'vscode') return Code({ source: drawn.art })
  const mono = surface === 'desktop' ? { mono: true } : {}
  // Centered in the room the pane leaves beside the art
  const artWidth = Math.max(0, ...drawn.art.split('\n').map(width))
  return Box({
    flexDirection: 'column',
    paddingLeft: Math.max(0, Math.floor((room - artWidth) / 2)),
    children: drawn.rows.map((runs) =>
      Text({
        ...mono,
        wrap: 'truncate-end',
        children: runs.length ? runs.map((run) => (run.tone && TONE[run.tone] ? Text({ ...TONE[run.tone], children: [run.text] }) : run.text)) : [' '],
      }),
    ),
  })
}

function progressSection(el, icons, parsed, columns, surface) {
  const { Box, Text } = el
  const p = progressOf(parsed)
  const drawn = parsed.flow ? renderFlow(parsed.flow, columns - 2) : null
  if (!p && !drawn && !parsed.caption.length) return null
  const body = []
  if (p) body.push(progressBar(el, p, columns))
  if (drawn) body.push(Box({ flexDirection: 'column', marginTop: 1, children: [diagram(el, surface, drawn, columns - 2)] }))
  if (parsed.caption.length) {
    body.push(
      Box({
        flexDirection: 'column',
        marginTop: drawn ? 1 : 0,
        children: parsed.caption.map((line) =>
          Box({ flexDirection: 'row', children: [Text({ dimColor: true, children: ['› '] }), Box({ flexGrow: 1, flexShrink: 1, children: [rich(Text, line, { dimColor: true, italic: true })] })] }),
        ),
      }),
    )
  }
  const extra = p ? `${p.done}/${p.total} · ${Math.round((p.done / p.total) * 100)}%` : ''
  return Box({ flexDirection: 'column', children: [heading(el, icons, 'flow', extra), Box({ flexDirection: 'column', paddingLeft: 2, children: body })] })
}

// view: { parsed, raw, status, isError, when, columns, surface, icons, onRefresh, onRebuild }
export function buildPane(el, view) {
  const { Box, Text, Button, Markdown } = el
  const { parsed, raw, columns, surface, icons } = view

  const title = Text({
    wrap: 'wrap',
    children: [Text({ color: ACCENT, children: [icons.tldr + ' '] }), Text({ bold: true, children: [parsed?.tldr || '速览'] })],
  })
  const statusText = view.status
    ? Text({ color: view.isError ? 'red' : 'yellow', wrap: 'truncate-end', children: [view.status] })
    : Text({ dimColor: true, children: [(icons.time ? icons.time + ' ' : '') + view.when] })
  const controls = Box({
    flexDirection: 'row',
    justifyContent: 'space-between',
    children: [
      Box({
        flexDirection: 'row',
        columnGap: 2,
        children: [
          Button({ key: 'refresh', label: '刷新', hotkey: 'r', plain: true, onPress: view.onRefresh }),
          Button({ key: 'rebuild', label: '重建', hotkey: 'b', plain: true, onPress: view.onRebuild }),
        ],
      }),
      statusText,
    ],
  })
  const rule = Text({ dimColor: true, children: ['─'.repeat(Math.max(4, columns))] })

  let body
  if (parsed) {
    body = parsed.sections.map((s) => section(el, icons, s))
    const progress = progressSection(el, icons, parsed, columns, surface)
    if (progress) body.push(progress)
  } else if (raw) {
    body = [Markdown({ key: 'raw', text: raw })]
  } else {
    body = [Text({ dimColor: true, children: ['还没有摘要。用到工具后自动生成，或按 r 立即生成。'] })]
  }

  return Box({
    flexDirection: 'column',
    children: [Box({ flexDirection: 'column', children: [title, controls, rule] }), Box({ flexDirection: 'column', rowGap: 1, children: body })],
  })
}

// The text appended to the hint line under the prompt
export function hintLine(icons, tldr, hint, columns) {
  if (!tldr) return null
  const lead = hint ? hint + ' · ' : ''
  const room = columns - lead.length - 4
  if (room < 8) return null
  return lead + (icons.tldr + ' ') + truncate(tldr, room)
}
