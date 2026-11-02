// Use the same configured entries as Claude Code's /model picker. Keep model
// identifiers intact: a gateway can attach meaning to the full route or suffix.
export const FOLLOW_MODEL = '__follow_main__'

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
