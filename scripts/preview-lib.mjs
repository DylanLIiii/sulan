// A small stand-in for Claude Code's renderer, so the pane can be previewed and
// tested from plain Node: fake elements, and a layout that prints them with ANSI.
// It approximates the terminal; a real session is the final check.

import { graphemes, widthOf } from '../hooks/text.js'

export const SAMPLE = `TLDR: 方案已定，正在实现 sulan 的 pane 与流程图渲染
## why
- 把 catch-me-up 改成中文、更好看的速览 mod
- 指令要短，界面要有图标，末尾要有图表加文字
## did
- 克隆原仓库，读 \`hooks/register.js\` 和 \`INSTRUCTIONS.md\`
- 研究 prismantis：只打包 beautiful-mermaid 的字符画引擎
- 写 \`hooks/diagram.js\`：宽字符补位、按状态给框上色
## out
- 模型输出固定格式，pane 负责排版，比直接渲染 Markdown 好看
- \`$.ui.status\` 带 ⚠ 前缀，TL;DR 改放在 PromptHint
## now
- [done] 方案已确认，图表方案参考 prismantis
- [wip] pane 渲染写完，等真机核对
- [fail] \`claude plugin test\` 因网关关闭特性开关而无法运行
## next
- [ask] 要不要在 Desktop 里换成 SVG 矢量图？
## flow
flowchart LR
  a["✓ 读原仓库"] --> b["✓ 定方案"]
  b --> c["◐ 写代码"]
  c --> d["○ 真机验证"]
- 窄 pane 放不下图时自动改成步骤列表`

const el = (type) => (props = {}) => ({ type, props })
export const fakeElements = Object.fromEntries(['Box', 'Text', 'Button', 'Markdown', 'Code', 'Input', 'Select', 'Link'].map((t) => [t, el(t)]))

const COLORS = { black: 30, red: 31, green: 32, yellow: 33, blue: 34, magenta: 35, cyan: 36, white: 37, gray: 90 }

function sgr(style, color) {
  if (!color) return ''
  const codes = []
  if (style.bold) codes.push(1)
  if (style.dimColor) codes.push(2)
  if (style.italic) codes.push(3)
  if (style.color?.startsWith('#')) {
    const n = Number.parseInt(style.color.slice(1), 16)
    codes.push(38, 2, (n >> 16) & 255, (n >> 8) & 255, n & 255)
  } else if (COLORS[style.color]) codes.push(COLORS[style.color])
  return codes.length ? `\x1b[${codes.join(';')}m` : ''
}

const STYLE_KEYS = ['color', 'bold', 'dimColor', 'italic']

// A Text and the Texts inside it, as runs of plain text with a merged style
function spansOf(node, inherited = {}) {
  if (typeof node === 'string') return [{ text: node, style: inherited }]
  if (!node || node.type !== 'Text') return []
  const style = { ...inherited }
  for (const k of STYLE_KEYS) if (node.props[k] !== undefined) style[k] = node.props[k]
  return (node.props.children ?? []).flatMap((c) => spansOf(c, style))
}

// Lays runs out into lines at most `max` cells wide
function layoutSpans(spans, max, mode, color) {
  const lines = []
  let line = ''
  let w = 0
  const flush = () => {
    lines.push({ s: line, w })
    line = ''
    w = 0
  }
  outer: for (const span of spans) {
    const open = sgr(span.style, color)
    let chunk = ''
    for (const g of graphemes(span.text)) {
      if (g === '\n') {
        line += open + chunk + (open ? '\x1b[0m' : '')
        chunk = ''
        flush()
        continue
      }
      const gw = widthOf(g)
      if (w + gw > max) {
        if (mode === 'truncate-end') {
          line += open + chunk + (open ? '\x1b[0m' : '')
          break outer
        }
        line += open + chunk + (open ? '\x1b[0m' : '')
        chunk = ''
        flush()
      }
      chunk += g
      w += gw
    }
    line += open + chunk + (open ? '\x1b[0m' : '')
  }
  flush()
  return lines
}

const blank = (n) => Array.from({ length: n }, () => ({ s: '', w: 0 }))
const padTo = (l, n) => l.s + ' '.repeat(Math.max(0, n - l.w))

function render(node, max, opts) {
  if (node == null || node === false) return []
  if (typeof node === 'string') return layoutSpans([{ text: node, style: {} }], max, 'wrap', opts.color)
  const p = node.props
  switch (node.type) {
    case 'Text':
      return layoutSpans(spansOf(node), max, p.wrap === 'truncate-end' ? 'truncate-end' : 'wrap', opts.color)
    case 'Button': {
      const key = p.hotkey ? sgr({ color: 'cyan' }, opts.color) + p.hotkey + (opts.color ? '\x1b[0m' : '') + ': ' : ''
      const text = p.plain ? key + p.label : `[ ${p.label} ]`
      return [{ s: text, w: (p.hotkey ? p.hotkey.length + 2 : 0) + [...p.label].reduce((a, g) => a + widthOf(g), 0) + (p.plain ? 0 : 4) }]
    }
    case 'Markdown':
      return layoutSpans([{ text: p.text, style: { dimColor: true } }], max, 'wrap', opts.color)
    case 'Code':
      return p.source.split('\n').map((s) => ({ s, w: [...graphemes(s)].reduce((a, g) => a + widthOf(g), 0) }))
    case 'Box':
      return renderBox(node, max, opts)
    default:
      return []
  }
}

function renderBox(node, max, opts) {
  const p = node.props
  const left = p.paddingLeft ?? p.paddingX ?? 0
  const inner = Math.max(1, max - left)
  const kids = (p.children ?? []).filter((c) => c != null && c !== false)
  let lines = []
  if (p.flexDirection === 'row') {
    const gap = p.columnGap ?? 0
    const fixed = kids.map((k) => (k.props?.flexGrow ? null : render(k, inner, opts)))
    const used = fixed.reduce((a, b) => a + (b ? Math.max(0, ...b.map((l) => l.w)) : 0), 0) + gap * Math.max(0, kids.length - 1)
    const blocks = kids.map((k, i) => fixed[i] ?? render(k, Math.max(1, inner - used), opts))
    const widths = blocks.map((b, i) => (fixed[i] ? Math.max(0, ...b.map((l) => l.w)) : Math.max(1, inner - used)))
    let between = gap
    if (p.justifyContent === 'space-between' && kids.length === 2) between = Math.max(1, inner - widths[0] - widths[1])
    const height = Math.max(0, ...blocks.map((b) => b.length))
    for (let r = 0; r < height; r++) {
      let s = ''
      let w = 0
      blocks.forEach((b, i) => {
        const l = b[r] ?? { s: '', w: 0 }
        if (i > 0) {
          s += ' '.repeat(between)
          w += between
        }
        const last = i === blocks.length - 1
        s += last ? l.s : padTo(l, widths[i])
        w += last ? l.w : widths[i]
      })
      lines.push({ s, w })
    }
  } else {
    kids.forEach((k, i) => {
      if (i > 0 && p.rowGap) lines.push(...blank(p.rowGap))
      lines.push(...render(k, inner, opts))
    })
  }
  if (left) lines = lines.map((l) => ({ s: ' '.repeat(left) + l.s, w: l.w + left }))
  if (p.marginTop) lines = [...blank(p.marginTop), ...lines]
  return lines
}

export function renderTree(tree, columns, opts = { color: true }) {
  return render(tree, columns, opts).map((l) => l.s.replace(/\s+$/, '')).join('\n')
}

// The pane inside a rounded frame, the way the terminal draws a docked pane
export function framed(tree, columns, title, opts = { color: true }) {
  const dim = (s) => (opts.color ? `\x1b[2m${s}\x1b[0m` : s)
  const lines = render(tree, columns, opts)
  const titleW = [...graphemes(title)].reduce((a, g) => a + widthOf(g), 0)
  const top = dim('╭ ') + title + dim(' ' + '─'.repeat(Math.max(0, columns - titleW - 1)) + '╮')
  const body = lines.map((l) => dim('│ ') + padTo(l, columns) + dim(' │'))
  return [top, ...body, dim('╰' + '─'.repeat(columns + 2) + '╯')].join('\n')
}
