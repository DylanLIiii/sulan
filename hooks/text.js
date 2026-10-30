// Display width helpers: a CJK letter or a wide emoji takes two terminal cells.

const segmenter = new Intl.Segmenter()
const WIDE = /[\u1100-\u115F\u2E80-\uA4CF\uAC00-\uD7A3\uF900-\uFAFF\uFE30-\uFE4F\uFF00-\uFF60\uFFE0-\uFFE6\u{1F300}-\u{1FAFF}\u{20000}-\u{3FFFD}]/u
const ZERO = /^[\p{M}\p{Default_Ignorable_Code_Point}]+$/u

export const graphemes = (s) => (/^[ -~]*$/.test(s) ? [...s] : [...segmenter.segment(s)].map((g) => g.segment))

export const widthOf = (g) => (ZERO.test(g) ? 0 : WIDE.test(g) ? 2 : 1)

export const width = (s) => (/^[ -~]*$/.test(s) ? s.length : graphemes(s).reduce((w, g) => w + widthOf(g), 0))

// One entry per terminal cell: a wide grapheme is followed by '' for its second cell
export const cells = (s) => graphemes(s).flatMap((g) => (widthOf(g) === 2 ? [g, ''] : [g]))

// Cut to at most `max` cells, ending in … when something was cut
export function truncate(s, max) {
  if (max <= 0) return ''
  if (width(s) <= max) return s
  let out = ''
  let used = 0
  for (const g of graphemes(s)) {
    const w = widthOf(g)
    if (used + w > max - 1) break
    out += g
    used += w
  }
  return out.trimEnd() + '…'
}
