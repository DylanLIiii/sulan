export const FOLLOW_MODEL = '__follow_main__'
export const DEFAULT_EFFORT = 'medium'

export function effortChoices() {
  return [
    { value: DEFAULT_EFFORT, label: '中等思考 (medium)' },
    { value: 'low', label: '较快回答 (low)' },
    { value: 'high', label: '较深思考 (high)' },
    { value: 'xhigh', label: '深度推理 (xhigh)' },
    { value: 'max', label: '极致推理 (max)' },
  ]
}

export function effortLabel(effort) {
  return effortChoices().find((option) => option.value === effort)?.label?.split(' ')[0] ?? effort
}

// Use the same configured entries as Claude Code's /model picker. Keep model
// identifiers intact: a gateway can attach meaning to the full route or suffix.

export function modelChoices(picker, current) {
  const choices = [{ value: FOLLOW_MODEL, label: '跟随主会话' }]
  const seen = new Set([FOLLOW_MODEL])
  const add = (value, label) => {
    if (typeof value !== 'string' || !value.trim() || seen.has(value)) return
    seen.add(value)
    choices.push({ value, label: typeof label === 'string' && label.trim() ? label : value })
  }
  if (!picker?.replaceBuiltInOptions) {
    // Claude Code resolves these aliases itself, including provider mappings.
    add('sonnet', 'Sonnet')
    add('opus', 'Opus')
    add('haiku', 'Haiku')
  }
  for (const option of Array.isArray(picker?.options) ? picker.options : []) {
    if (option) add(option.model, option.label)
  }
  add(current, current)
  return choices
}

export function modelLabel(chat) {
  return chat.modelOptions.find((option) => option.value === chat.model)?.label ?? chat.model
}
