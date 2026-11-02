import { expect, test } from 'claude-code/testing'
import { FOLLOW_MODEL, modelChoices } from '../hooks/chat-models.js'
import { mainContext } from '../hooks/chat.js'

test('custom model picker entries keep full routes and replace built-in aliases', async () => {
  const choices = modelChoices({ replaceBuiltInOptions: true, options: [
    { model: 'remote/sonnet[1m]', label: 'Sonnet · Remote' },
    { model: 'remote/sonnet[1m]', label: 'Duplicate' },
    { model: 'subscription/sonnet[1m]', label: 'Sonnet · Subscription' },
    { label: 'Invalid' }, null,
  ] }, 'subscription/sonnet[1m]')
  expect(choices).toEqual([
    { value: FOLLOW_MODEL, label: '跟随主会话' },
    { value: 'remote/sonnet[1m]', label: 'Sonnet · Remote' },
    { value: 'subscription/sonnet[1m]', label: 'Sonnet · Subscription' },
  ])
})

test('a standard install gets built-in aliases and its current model', async () => {
  const choices = modelChoices(undefined, 'claude-custom')
  expect(choices.map((option) => option.value)).toEqual([FOLLOW_MODEL, 'sonnet', 'opus', 'haiku', 'claude-custom'])
})

test('explicit-model context carries the full visible history when it fits', async () => {
  const messages = Array.from({ length: 20 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', text: `消息${i}`, toolUses: [] }))
  const context = mainContext(messages, '速览摘要')
  expect(context.truncated).toBe(false)
  expect(context.text).toContain('速览摘要')
  for (let i = 0; i < 20; i++) expect(context.text).toContain(`消息${i}`)
  expect(context.text.indexOf('消息0')).toBeLessThan(context.text.indexOf('消息19'))
})

test('large histories stay bounded and explicitly disclose omitted details', async () => {
  const messages = Array.from({ length: 40 }, (_, i) => ({ role: 'user', text: `消息${i} ` + 'x'.repeat(8000), toolUses: [] }))
  const context = mainContext(messages, '早期进度摘要')
  expect(context.truncated).toBe(true)
  expect(context.text).toContain('早期进度摘要')
  expect(context.text).toContain('消息39 ')
  expect(context.text).not.toContain('消息0 ')
  expect(context.text).toContain('已限长')
  expect(context.text.length).toBeLessThan(81_000)
})

test('oversized tool output also reports truncation and reminders are removed', async () => {
  const context = mainContext([{ role: 'assistant', text: '结论<system-reminder>隐藏提示</system-reminder>', toolUses: [
    { tool: 'Read', input: { path: '/work' }, text: 'x'.repeat(5000) },
  ] }], '')
  expect(context.truncated).toBe(true)
  expect(context.text).toContain('Read')
  expect(context.text).toContain('/work')
  expect(context.text).not.toContain('隐藏提示')
})
