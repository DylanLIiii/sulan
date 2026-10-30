// Parses the summary Haiku writes (the format INSTRUCTIONS.md asks for) into
// a TL;DR, five text sections and a flow diagram with its caption.

export const SECTION_ORDER = ['why', 'did', 'out', 'now', 'next']

// Headings the model might write instead of the ids, mapped back to the ids
const ALIASES = {
  why: 'why', 目标: 'why',
  did: 'did', 做了: 'did', 做了什么: 'did',
  out: 'out', 结论: 'out',
  now: 'now', 现状: 'now',
  next: 'next', 需要你: 'next', 下一步: 'next',
  flow: 'flow', 进度: 'flow', 流程: 'flow',
}

const TLDR = /^(?:\*\*)?TL;?DR(?:\*\*)?\s*[:：]\s*(.*)$/i
const HEADING = /^#{1,3}\s*([^\s#]+)\s*$/
const BULLET = /^(?:[-*•]|\d+[.)])\s+(.*)$/
const STATUS = /^\[(done|wip|fail|ask|todo)\]\s*/i
const FENCE = /^```/

export function parseSummary(text) {
  const tldrLines = []
  const sections = new Map()
  const flowLines = []
  const caption = []
  let current = null

  for (const raw of String(text ?? '').split('\n')) {
    const line = raw.replace(/\s+$/, '')
    const trimmed = line.trim()
    const tldr = TLDR.exec(trimmed)
    if (tldr) {
      if (tldr[1]) tldrLines.push(tldr[1].trim())
      continue
    }
    const heading = HEADING.exec(trimmed)
    const id = heading && ALIASES[heading[1].toLowerCase()]
    if (id) {
      current = id
      if (id !== 'flow' && !sections.has(id)) sections.set(id, [])
      continue
    }
    if (!current || !trimmed) continue

    if (current === 'flow') {
      if (FENCE.test(trimmed)) continue
      const bullet = /^[-*•]\s+(.*)$/.exec(trimmed)
      if (bullet) caption.push(bullet[1])
      else flowLines.push(line)
      continue
    }

    const bullet = BULLET.exec(trimmed)
    const body = bullet ? bullet[1] : trimmed
    const status = STATUS.exec(body)
    sections.get(current).push({
      status: status ? status[1].toLowerCase() : null,
      text: status ? body.slice(status[0].length).trim() : body,
    })
  }

  const ordered = SECTION_ORDER.filter((id) => sections.get(id)?.length).map((id) => ({ id, items: sections.get(id) }))
  const flow = flowLines.join('\n').trim()
  const tldr = tldrLines.join(' ')
  if (!tldr && ordered.length === 0) return null
  return { tldr, sections: ordered, flow: flow || null, caption }
}

// Splits `code` and **bold** spans out of one line of text
export function inlineSpans(text) {
  const spans = []
  const re = /`([^`]+)`|\*\*([^*]+)\*\*/g
  let at = 0
  for (const m of text.matchAll(re)) {
    if (m.index > at) spans.push({ text: text.slice(at, m.index) })
    spans.push(m[1] !== undefined ? { text: m[1], code: true } : { text: m[2], bold: true })
    at = m.index + m[0].length
  }
  if (at < text.length) spans.push({ text: text.slice(at) })
  return spans
}
