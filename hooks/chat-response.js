// These APIs expose a completed text reply, not native reasoning blocks.
// Separate explicit markup; only label untagged planning as *suspected* when
// both its opening and its self-instructions match. Never infer from language.
export const MAX_THINKING = 4000

function codeRanges(text) {
  const ranges = []
  const fences = /(^|\n)[ \t]{0,3}(`{3,}|~{3,})[^\n]*\n/g
  let match
  while ((match = fences.exec(text))) {
    const start = match.index
    const close = new RegExp('(?:^|\\n)[ \\t]{0,3}' + match[2][0] + '{' + match[2].length + ',}[ \\t]*(?:\\n|$)', 'g')
    close.lastIndex = fences.lastIndex
    const end = close.exec(text)
    const until = end ? close.lastIndex : text.length
    ranges.push([start, until])
    fences.lastIndex = until
  }
  // Inline code mentioning <think> is content too, not a reasoning boundary.
  const inline = /(`+)[^\n]*?\1/g
  while ((match = inline.exec(text))) ranges.push([match.index, inline.lastIndex])
  return ranges
}

export function splitReply(value) {
  const text = String(value ?? '').trim()
  const ranges = codeRanges(text)
  const tags = /<\/?(think|thinking|analysis|reasoning)\s*>/gi
  const answers = []
  const thoughts = []
  let position = 0
  let start = -1
  let depth = 0
  let match
  while ((match = tags.exec(text))) {
    if (ranges.some(([a, b]) => match.index >= a && match.index < b)) continue
    const closing = match[0][1] === '/'
    if (!closing) {
      if (depth++ === 0) {
        answers.push(text.slice(position, match.index))
        start = tags.lastIndex
      }
    } else if (depth > 0) {
      if (--depth === 0) {
        thoughts.push(text.slice(start, match.index))
        position = tags.lastIndex
      }
    } else if (!thoughts.length && !answers.length) {
      // Some providers return a closing marker with no opening marker.
      thoughts.push(text.slice(0, match.index))
      position = tags.lastIndex
    }
  }
  if (depth > 0) thoughts.push(text.slice(start))
  else answers.push(text.slice(position))
  if (thoughts.length) {
    return { answer: answers.join('\n').trim(), thinking: thoughts.join('\n\n').trim(), kind: 'tagged', incomplete: depth > 0 }
  }

  const planningOpening = /^(?:The user (?:asks|is asking|wants)|We need to (?:answer|respond)|I need to (?:answer|respond))\b/i
  const selfInstruction = /\b(?:I should|I must|Let me|We should|So (?:the )?answer|Structure:|Key considerations)\b/i
  if (planningOpening.test(text) && selfInstruction.test(text) && text.includes('\n\n')) {
    const boundary = /^(?:#{1,3}\s*)?(?:Final answer|Final response|最终回答|最终答案|正式回答|最终回复)\s*[:：]\s*/im.exec(text)
    return {
      answer: boundary ? text.slice(boundary.index + boundary[0].length).trim() : '',
      thinking: boundary ? text.slice(0, boundary.index).trim() : text,
      kind: 'suspected', incomplete: !boundary,
    }
  }
  return { answer: text, thinking: '', kind: '', incomplete: false }
}

const clipped = (text, max, note) => text.length > max ? text.slice(0, max) + '\n\n…（' + note + '已截断）' : text

export function replyFields(text, answerLimit) {
  const parts = splitReply(text)
  if (!parts.thinking) return { answer: clipped(parts.answer, answerLimit, '回答过长，') }
  return {
    answer: parts.answer ? clipped(parts.answer, answerLimit, '回答过长，') : null,
    thinking: clipped(parts.thinking, MAX_THINKING, '思考过长，'),
    thinkingKind: parts.kind,
    ...(parts.incomplete ? { thinkingIncomplete: true } : {}),
  }
}

export function turnReply(turn) {
  const parts = splitReply(turn.answer ?? '')
  return {
    answer: parts.answer,
    thinking: turn.thinking || parts.thinking,
    kind: turn.thinkingKind || parts.kind,
    incomplete: turn.thinkingIncomplete || parts.incomplete,
  }
}

export function durationText(ms) {
  if (!Number.isFinite(ms) || ms < 0) return ''
  return ms < 1000 ? '<1 秒' : Math.round(ms / 1000) + ' 秒'
}
