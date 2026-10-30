// sulan 速览: a pane that keeps a live catch-up summary of the session, in Chinese,
// with icons and a colored flow diagram. Built on catch-me-up by Oliver Wang (MIT):
// after each turn that used a tool, Haiku folds the messages added since the
// last update into the previous summary (a rolling update).

import { parseSummary } from './summary.js'
import { buildPane, hintLine, iconSet } from './view.js'

const PANE = 'sulan'
const TITLE = '速览'
const MODEL = 'haiku'
// About how many characters of new messages go to the model in one call. A
// longer backlog, such as after Rebuild or on resume, is folded in over several calls.
const CHUNK_CHARS = 100_000
// How many sessions' summaries the store keeps
const KEEP_SESSIONS = 100

let iconOption = 'nerd'

// The current session's summary, how many transcript messages it covers, and
// a fingerprint of the last of them
let sessionId = ''
let summary = ''
let parsed = null
let covered = 0
let marker = ''
let updatedAt = 0
let status = ''
let isError = false
let running = false
// The update asked for while one was running: null, or its onlyIfWork
let queued = null

function setSummary(text) {
  summary = text
  parsed = parseSummary(text)
}

async function load($) {
  sessionId = await $.session.id()
  const saved = await $.store.get('session:' + sessionId)
  setSummary(saved?.summary ?? '')
  covered = saved?.covered ?? 0
  marker = saved?.marker ?? ''
  updatedAt = saved?.updatedAt ?? 0
  status = ''
  isError = false
  $.ui.invalidate('ui.render')
}

async function save($) {
  await $.store.set('session:' + sessionId, { summary, covered, marker, updatedAt })
  // Most recent first; drop the summaries of the oldest sessions
  const order = [sessionId, ...((await $.store.get('order')) ?? []).filter((id) => id !== sessionId)]
  for (const id of order.slice(KEEP_SESSIONS)) await $.store.delete('session:' + id)
  await $.store.set('order', order.slice(0, KEEP_SESSIONS))
}

const fingerprint = (m) => m.role + '\n' + m.text.slice(0, 200) + '\n' + m.toolUses.map((t) => t.tool_use_id).join(',')

// Claude Code adds system reminders to user messages; they aren't the user's words
const unremind = (s) => s.replace(/<system-reminder>[\s\S]*?<\/system-reminder>/g, '').trim()

const clip = (s, n) => (s.length > n ? s.slice(0, n) + ' […]' : s)

function formatMessage(m) {
  const lines = []
  const text = unremind(m.text)
  if (text) lines.push((m.role === 'user' ? 'USER: ' : 'ASSISTANT: ') + clip(text, 4000))
  for (const t of m.toolUses) {
    lines.push(`  [tool ${t.tool}] ${clip(JSON.stringify(t.input), 300)}` + (t.text ? ` → ${clip(t.text, 300)}` : ''))
  }
  return lines.join('\n')
}

async function gitState($) {
  const out = []
  for (const argv of [['git', 'status', '--short'], ['git', 'diff', '--stat'], ['git', 'log', '--oneline', '-n', '5']]) {
    const r = await $.process.run(argv)
    out.push('$ ' + argv.join(' ') + '\n' + ((r.exitCode ? r.stderr : r.stdout).trim() || '(empty)'))
  }
  return out.join('\n\n')
}

async function systemPrompt($) {
  const instructions = await $.fs.read($.plugin.root + '/INSTRUCTIONS.md')
  return [
    '你维护一个 Claude Code 会话的实时速览，显示在窄的侧边 pane 里，随会话推进不断更新。',
    '你拿到的是：上一版速览、之后新增的消息、当前 git 状态。写出完整的新速览：保留仍然成立的，改写变化的，删掉不再重要的。上一版速览是你对更早消息的唯一记忆，除非新消息推翻，否则保留其中的事实。',
    '重点放在动机、方法概要和当前进度。全部用中文，路径、命令和代码保持原样。只输出速览本身，从 TLDR 行开始，按下面的格式。',
    '<instructions>\n' + instructions + '\n</instructions>',
  ].join('\n\n')
}

// Fold the messages added since the last update into the summary.
// With onlyIfWork, skip when none of them used a tool.
async function update($, onlyIfWork) {
  if (running) {
    queued = (queued ?? true) && onlyIfWork
    return
  }
  running = true
  const id = sessionId
  try {
    const messages = await $.session.messages()
    // The summary normally ends at message `covered`. Past the newest 4096
    // messages the list slides, and compaction replaces it, so otherwise look
    // for the last message summarized, and start over when it is gone.
    let i =
      covered > 0 && covered <= messages.length && fingerprint(messages[covered - 1]) === marker
        ? covered
        : messages.findLastIndex((m) => fingerprint(m) === marker) + 1
    const fresh = messages.slice(i)
    if (!fresh.length) return
    if (onlyIfWork && !fresh.some((m) => m.toolUses.length)) return

    status = '更新中…'
    isError = false
    $.ui.invalidate('ui.render')
    const system = await systemPrompt($)
    const git = await gitState($)

    while (i < messages.length) {
      let chunk = ''
      let end = i
      while (end < messages.length && (end === i || chunk.length < CHUNK_CHARS)) chunk += formatMessage(messages[end++]) + '\n\n'
      const r = await $.model.complete({
        model: MODEL,
        system,
        prompt:
          '<previous_summary>\n' + (summary || '(还没有)') + '\n</previous_summary>\n\n' +
          '<new_messages>\n' + chunk + '</new_messages>\n\n' +
          '<git_state>\n' + git + '\n</git_state>',
        maxTokens: 3000,
      })
      if (!r.isAnswered) throw new Error(r.reason + (r.error ? ` (${r.error})` : ''))
      // /clear, /resume or /branch switched sessions while the model ran
      if (sessionId !== id) return
      setSummary(r.text.trim().slice(0, 10_000))
      covered = i = end
      marker = fingerprint(messages[end - 1])
      updatedAt = await $.clock.now()
      await save($)
      $.ui.invalidate('ui.render')
    }
    status = ''
  } catch (err) {
    status = '更新失败：' + err.message
    isError = true
  } finally {
    running = false
    $.ui.invalidate('ui.render')
    if (queued !== null) {
      const onlyIfWorkNext = queued
      queued = null
      update($, onlyIfWorkNext)
    }
  }
}

// On open: summarize history that has no summary yet; with no history, do nothing
async function catchUp($) {
  if (!(await $.session.surfaces()).length) return
  await update($, false)
}

function rebuild($) {
  if (running) return
  setSummary('')
  covered = 0
  marker = ''
  update($, false)
}

function clockText(at) {
  if (!at) return '暂无摘要'
  const d = new Date(at)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')} 更新`
}

export function register(on, options) {
  if (options?.icons === 'unicode') iconOption = 'unicode'

  on('session.start', async ($, e, next) => {
    await load($)
    await $.command.register({ name: 'sulan', description: '打开速览 pane', immediate: true })
    // Opened without being asked: the terminal places it only when wide enough
    await $.ui.open({ id: PANE, title: TITLE })
    // Not awaited, so the session starts without waiting for the summary
    if (e.isInteractive) catchUp($)
    return next(e)
  })

  // /clear, /resume and /branch switch to another session's summary
  on('classic.SessionStart', { source: ['clear', 'resume', 'fork'] }, async ($, e, next) => {
    await load($)
    catchUp($)
    return next(e)
  })

  on('command.run', { command: 'sulan' }, async ($) => {
    await $.ui.open({ id: PANE, title: TITLE })
    return {}
  })

  on('turn.complete', async ($, e, next) => {
    // No app shows the pane in a claude -p run. Not awaited, so the turn ends
    // without waiting for the summary.
    if (!e.agentId && (await $.session.surfaces()).length) update($, true)
    return next(e)
  })

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== PANE) return next(e)
    const el = $.ui.resolve(e)
    return buildPane(el, {
      parsed,
      raw: summary,
      status,
      isError,
      when: clockText(updatedAt),
      columns: e.props.bodyColumns || 40,
      surface: e.surface,
      icons: iconSet(e.surface, iconOption),
      onRefresh: () => update($, false),
      onRebuild: () => rebuild($),
    })
  })

  // A standing TL;DR on the hint line under the prompt, while nothing is typed
  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    if (e.props.isDraft || !parsed?.tldr) return next(e)
    const line = hintLine(iconSet(e.surface, iconOption), parsed.tldr, e.props.hint, e.viewport?.columns ?? 80)
    if (!line) return next(e)
    return next({ ...e, props: { ...e.props, hint: line } })
  })
}
