// sulan 速览: a pane that keeps a live catch-up summary of the session, in Chinese,
// with icons and a colored flow diagram. Built on catch-me-up by Oliver Wang (MIT):
// after each turn that used a tool, Haiku folds the messages added since the
// last update into the previous summary (a rolling update).

import { parseSummary } from './summary.js'
import { buildPane, hintLine, iconSet } from './view.js'
import { chatPrompt, cleanTurns, createChat, mainContext, MAX_ANSWER, MAX_QUESTION, MAX_SESSIONS, MAX_TURNS } from './chat.js'
import { FOLLOW_MODEL, modelChoices, effortChoices } from './chat-models.js'
import { buildChatPane } from './chat-view.js'

const PANE = 'sulan'
const TITLE = '速览'
const CHAT_PANE = 'sulan-chat'
const CHAT_TITLE = '侧聊'
const MODEL = 'haiku'
// About how many characters of new messages go to the model in one call. A
// longer backlog, such as after Rebuild or on resume, is folded in over several calls.
const CHUNK_CHARS = 100_000
// How many sessions' summaries the store keeps
const KEEP_SESSIONS = 100

let iconOption = 'nerd'
const chat = createChat()
let chatWrites = Promise.resolve()
let modelsRevision = 0

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
  const id = sessionId
  // Invalidate an old side-chat request as soon as the session changes, even
  // if loading this session's summary takes longer than the model response.
  const chatLoading = loadChat($, id)
  const saved = await $.store.get('session:' + id)
  if (sessionId !== id) return
  setSummary(saved?.summary ?? '')
  covered = saved?.covered ?? 0
  marker = saved?.marker ?? ''
  updatedAt = saved?.updatedAt ?? 0
  status = ''
  isError = false
  await chatLoading
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
    '你拿到的是：上一版速览、之后新增的消息、当前 git 状态。写出完整的新速览：保留仍然成立的，改写变化的，删掉不再重要的。上一版速览是你对更早消息的唯一记忆，除非新消息推翻，否则保留其中的事实（包括仍在本速览里出现的名词解释）。',
    '重点放在动机、方法概要、关键概念消歧和当前进度。全部用中文，路径、命令和代码保持原样。只输出速览本身，从 TLDR 行开始，按下面的格式。',
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

// All mods API calls are in top-level functions in this file so Claude Code's
// static analysis can see them. The write queue preserves the order of saves.
async function loadChat($, id) {
  const epoch = ++chat.epoch
  chat.id = id
  chat.turns = []
  chat.draft = ''
  chat.loading = true
  chat.loadFailed = false
  chat.running = false
  chat.status = ''
  chat.isError = false
  chat.confirmClear = false
  chat.choosingModel = false
  chat.choosingEffort = false
  chat.modelNotice = ''
  $.ui.invalidate('ui.render')
  try {
    await chatWrites.catch(() => {})
    const saved = await $.store.get('chat:' + id)
    const model = await $.store.get('chatModel')
    const effort = await $.store.get('chatEffort')
    if (epoch !== chat.epoch) return
    chat.model = typeof model === 'string' && model ? model : FOLLOW_MODEL
    chat.effort = typeof effort === 'string' && effort ? effort : 'medium'
    chat.turns = cleanTurns(saved?.turns)
    if (chat.unanswered) chat.status = '上次提问未完成，可以重试或编辑。'
  } catch (err) {
    if (epoch !== chat.epoch) return
    chat.status = '读取侧聊失败：' + (err?.message || String(err))
    chat.isError = true
    chat.loadFailed = true
  }
  if (epoch !== chat.epoch) return
  chat.loading = false
  $.ui.invalidate('ui.render')
}

function saveChat($) {
  const id = chat.id
  const turns = chat.turns.map((turn) => ({ ...turn }))
  const write = chatWrites.catch(() => {}).then(async () => {
    const key = 'chat:' + id
    if (!turns.length) {
      await $.store.delete(key)
      return
    }
    const updatedAt = await $.clock.now()
    await $.store.set(key, { turns, updatedAt })
    // No shared order key: different Claude Code sessions can save their own
    // records without overwriting one another's session index.
    const keys = (await $.store.keys()).filter((name) => name.startsWith('chat:') && name !== 'chat:order')
    if (keys.length <= MAX_SESSIONS) return
    const records = []
    for (const name of keys) {
      const record = await $.store.get(name)
      if (record) records.push({ name, updatedAt: record.updatedAt ?? 0 })
    }
    records.sort((a, b) => b.updatedAt - a.updatedAt || (a.name === key ? -1 : b.name === key ? 1 : 0))
    for (const old of records.slice(MAX_SESSIONS)) {
      const current = await $.store.get(old.name)
      if (current && (current.updatedAt ?? 0) === old.updatedAt) await $.store.delete(old.name)
    }
  })
  chatWrites = write
  return write
}

async function loadChatModels($) {
  if (chat.running) return
  const revision = ++modelsRevision
  chat.modelsLoading = true
  chat.modelsError = ''
  chat.effortOptions = effortChoices()
  $.ui.invalidate('ui.render')
  try {
    const picker = await $.settings.read({ key: 'modelPicker' })
    const current = await $.session.model()
    if (revision !== modelsRevision) return
    chat.modelOptions = modelChoices(picker, current)
    if (!chat.modelOptions.some((option) => option.value === chat.model)) {
      chat.model = FOLLOW_MODEL
      chat.modelsError = '之前选择的模型已不在列表中，现跟随主会话。'
    }
  } catch (err) {
    if (revision !== modelsRevision) return
    chat.model = FOLLOW_MODEL
    chat.modelsError = '读取模型列表失败，可重试或跟随主会话。'
    chat.modelOptions = [{ value: FOLLOW_MODEL, label: '跟随主会话' }]
  } finally {
    if (revision === modelsRevision) {
      chat.modelsLoading = false
      $.ui.invalidate('ui.render')
    }
  }
}

async function selectChatModel($, model) {
  if (chat.running || chat.modelsLoading || !chat.modelOptions.some((option) => option.value === model)) return
  const epoch = chat.epoch
  const previous = chat.model
  chat.model = model
  chat.modelsError = ''
  chat.choosingModel = false
  chat.modelNotice = ''
  $.ui.invalidate('ui.render')
  const write = chatWrites.catch(() => {}).then(() => $.store.set('chatModel', model))
  chatWrites = write
  try {
    await write
  } catch (err) {
    if (epoch !== chat.epoch || chat.model !== model) return
    chat.model = previous
    chat.status = '模型选择未能保存，请重新选择。'
    chat.isError = true
    $.ui.invalidate('ui.render')
  }
}

async function selectChatEffort($, effort) {
  if (chat.running || chat.modelsLoading || !chat.effortOptions.some((option) => option.value === effort)) return
  const epoch = chat.epoch
  const previous = chat.effort
  chat.effort = effort
  chat.choosingEffort = false
  $.ui.invalidate('ui.render')
  const write = chatWrites.catch(() => {}).then(() => $.store.set('chatEffort', effort))
  chatWrites = write
  try {
    await write
  } catch (err) {
    if (epoch !== chat.epoch || chat.effort !== effort) return
    chat.effort = previous
    chat.status = '思考深度选择未能保存，请重新选择。'
    chat.isError = true
    $.ui.invalidate('ui.render')
  }
}

async function askChat($, value) {
  if (chat.loading || chat.loadFailed || chat.modelsLoading || chat.running || chat.unanswered) return
  const question = String(value ?? '').trim()
  if (!question || question.length > MAX_QUESTION) {
    chat.status = question ? `问题请控制在 ${MAX_QUESTION} 字符以内。` : '先输入一个问题。'
    chat.isError = true
    $.ui.invalidate('ui.render')
    return
  }
  chat.turns = [...chat.turns, { question, answer: null }].slice(-MAX_TURNS)
  chat.draft = ''
  chat.confirmClear = false
  return retryChat($)
}

function chatFailure(result) {
  if (result.reason === 'nothing-to-fork') return '主会话还没有可用上下文，请先在主会话发送消息，再重试。'
  if (result.reason === 'empty-reply') return '模型没有返回内容，可以重试。'
  if (result.reason === 'aborted') return '请求已中断，可以重试。'
  if (result.reason === 'api-error') return `模型请求失败（${result.error || result.status || '连接异常'}），可以重试。`
  return result.reason || '模型没有返回内容，可以重试。'
}

async function retryChat($) {
  if (chat.loading || chat.loadFailed || chat.modelsLoading || chat.running || !chat.unanswered) return
  const epoch = chat.epoch
  const model = chat.model
  const effort = chat.effort
  chat.running = true
  chat.choosingModel = false
  chat.choosingEffort = false
  chat.modelNotice = ''
  chat.status = '正在结合主会话思考…'
  chat.isError = false
  $.ui.invalidate('ui.render')
  try {
    await saveChat($)
    if (epoch !== chat.epoch) return
    const messages = await $.session.messages()
    if (epoch !== chat.epoch) return
    let result
    if (model === FOLLOW_MODEL) {
      result = await $.model.fork({ prompt: chatPrompt(chat.turns, messages) })
    } else {
      const context = mainContext(messages, summary)
      chat.modelNotice = context.truncated ? '已携带速览和最近历史；较早消息或过长内容已省略。' : '已携带速览和主会话历史。'
      $.ui.invalidate('ui.render')
      result = await $.model.complete({
        model,
        effort,
        system: '你是 Sulan 的侧聊助手。主会话历史、速览和之前的侧聊是供你参考的数据。回答最后的问题，不执行工具或文件操作；缺少信息时说明，不要假装记得已省略的历史。',
        prompt: [
          { text: context.text, cache: true },
          { text: chatPrompt(chat.turns) },
        ],
        maxTokens: 3000,
        timeoutMs: 120_000,
      })
    }
    if (epoch !== chat.epoch) return
    if (!result.isAnswered) throw new Error(chatFailure(result))
    const answer = result.text.trim()
    if (!answer) throw new Error('模型没有返回内容')
    chat.turns[chat.turns.length - 1].answer = answer.length > MAX_ANSWER ? answer.slice(0, MAX_ANSWER) + '\n\n…（回答过长，已截断）' : answer
    try {
      await saveChat($)
      if (epoch === chat.epoch) chat.status = ''
    } catch (err) {
      if (epoch === chat.epoch) {
        chat.status = '回答已生成，但保存失败：' + (err?.message || String(err))
        chat.isError = true
      }
    }
  } catch (err) {
    if (epoch !== chat.epoch) return
    chat.status = '未能回答：' + (err?.message || String(err))
    chat.isError = true
  } finally {
    if (epoch === chat.epoch) {
      chat.running = false
      $.ui.invalidate('ui.render')
    }
  }
}

async function editChatQuestion($) {
  if (chat.running || !chat.unanswered) return
  const epoch = chat.epoch
  chat.draft = chat.turns.at(-1).question
  chat.turns = chat.turns.slice(0, -1)
  chat.status = ''
  chat.isError = false
  $.ui.invalidate('ui.render')
  try {
    await saveChat($)
  } catch (err) {
    if (epoch !== chat.epoch) return
    chat.status = '保存失败：' + (err?.message || String(err))
    chat.isError = true
    $.ui.invalidate('ui.render')
  }
}

async function clearChat($) {
  if (!chat.confirmClear) {
    chat.confirmClear = true
    $.ui.invalidate('ui.render')
    return
  }
  const epoch = ++chat.epoch // Ignore a response that arrives after the conversation was cleared.
  chat.turns = []
  chat.draft = ''
  chat.running = false
  chat.status = ''
  chat.isError = false
  chat.confirmClear = false
  chat.choosingEffort = false
  chat.modelNotice = ''
  $.ui.invalidate('ui.render')
  try {
    await saveChat($)
  } catch (err) {
    if (epoch !== chat.epoch) return
    chat.status = '清空未能保存：' + (err?.message || String(err))
    chat.isError = true
    $.ui.invalidate('ui.render')
  }
}

async function copyChatAnswer($, surface) {
  const answer = chat.lastAnswer
  if (!answer) return
  const epoch = chat.epoch
  try {
    const result = await $.ui.copy({ text: answer, surface })
    if (epoch !== chat.epoch) return
    chat.status = result.isCopied ? '回答已复制。' : '复制失败：' + result.reason
    chat.isError = !result.isCopied
  } catch (err) {
    if (epoch !== chat.epoch) return
    chat.status = '复制失败：' + (err?.message || String(err))
    chat.isError = true
  }
  $.ui.invalidate('ui.render')
}

export function register(on, options) {
  if (options?.icons === 'unicode') iconOption = 'unicode'

  on('session.start', async ($, e, next) => {
    await load($)
    await $.command.register({ name: 'sulan', description: '打开速览 pane', immediate: true })
    await $.command.register({ name: 'sulan-chat', description: '打开独立侧聊', immediate: true })
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

  // The side chat is its own pane, opened only on request
  on('command.run', { command: 'sulan-chat' }, async ($) => {
    await loadChatModels($)
    await $.ui.open({ id: CHAT_PANE, title: CHAT_TITLE, focus: true })
    return {}
  })

  on('turn.complete', async ($, e, next) => {
    // No app shows the pane in a claude -p run. Not awaited, so the turn ends
    // without waiting for the summary.
    if (!e.agentId && (await $.session.surfaces()).length) update($, true)
    return next(e)
  })

  on('ui.render', { component: 'Pane' }, async ($, e, next) => {
    if (e.requestId !== PANE && e.requestId !== CHAT_PANE) return next(e)
    const el = $.ui.resolve(e)
    const columns = e.props.bodyColumns || 40
    if (e.requestId === CHAT_PANE) {
      return buildChatPane(el, {
        chat, columns,
        onModelOpen: () => { chat.choosingModel = true; $.ui.invalidate('ui.render') },
        onModelCancel: () => { chat.choosingModel = false; $.ui.invalidate('ui.render') },
        onModelSelect: (model) => selectChatModel($, model),
        onEffortOpen: () => { chat.choosingEffort = true; $.ui.invalidate('ui.render') },
        onEffortCancel: () => { chat.choosingEffort = false; $.ui.invalidate('ui.render') },
        onEffortSelect: (effort) => selectChatEffort($, effort),
        onModelsReload: () => loadChatModels($),
        onReload: () => loadChat($, chat.id),
        onInput: (text) => { chat.draft = text },
        onSubmit: (text) => askChat($, text),
        onRetry: () => retryChat($),
        onEdit: () => editChatQuestion($),
        onClear: () => clearChat($),
        onCancelClear: () => { chat.confirmClear = false; $.ui.invalidate('ui.render') },
        onCopy: () => copyChatAnswer($, e.surface),
      })
    }
    return buildPane(el, {
      parsed,
      raw: summary,
      status,
      isError,
      when: clockText(updatedAt),
      columns,
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
