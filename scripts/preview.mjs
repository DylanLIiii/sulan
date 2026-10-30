// Prints the pane for a sample summary: node scripts/preview.mjs [--cols 44] [--icons nerd|unicode] [--surface terminal] [--no-color]
import { parseSummary } from '../hooks/summary.js'
import { buildPane, hintLine, iconSet } from '../hooks/view.js'
import { SAMPLE, fakeElements, framed } from './preview-lib.mjs'

const arg = (name, fallback) => {
  const i = process.argv.indexOf('--' + name)
  return i > 0 ? process.argv[i + 1] : fallback
}
const columns = Number(arg('cols', 44))
const surface = arg('surface', 'terminal')
const icons = iconSet(surface, arg('icons', 'nerd'))
const color = !process.argv.includes('--no-color')
const parsed = parseSummary(SAMPLE)

const tree = buildPane(fakeElements, {
  parsed, raw: SAMPLE, status: '', isError: false, when: '14:32 更新', columns, surface, icons, onRefresh() {}, onRebuild() {},
})
console.log(framed(tree, columns, '速览', { color }))
console.log()
const hint = hintLine(icons, parsed.tldr, '? for shortcuts', 100)
console.log('  ' + (color ? `\x1b[2m${hint}\x1b[0m` : hint))
