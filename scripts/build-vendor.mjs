// Bundles the ASCII renderer of beautiful-mermaid into hooks/vendor/mermaid-text.js.
// The mod has no runtime dependencies: a hooks module may only import files inside
// the plugin, so the renderer ships as one self-contained ES module.
// The two source patches below follow prismantis (MIT, github.com/NahumLitvin/prismantis).
import { build } from 'esbuild'
import { readFileSync } from 'node:fs'

const bundled = new Set()

// Clears line fragments that the engine leaves inside the gaps of edge labels
const CANVAS = /beautiful-mermaid\/src\/ascii\/canvas\.ts$/
const CANVAS_ANCHOR = 'export function isJunctionChar('
const CLEAR_LABEL_GAPS = `export function clearLabelGaps(canvas: Canvas, label: Canvas): void {
  for (let y = 0; y < (label[0]?.length ?? 0); y++) {
    const xs = label.map((col, x) => (col[y] !== ' ' ? x : -1)).filter(x => x >= 0)
    if (xs.length === 0) continue
    for (let x = xs[0]!; x <= xs[xs.length - 1]!; x++) {
      if (label[x]![y] === ' ' && !isAlphanumeric(canvas[x]![y]!)) canvas[x]![y] = ' '
    }
  }
}
`
const DRAW = /beautiful-mermaid\/src\/ascii\/draw\.ts$/
const DRAW_ANCHOR = '  graph.canvas = mergeCanvases(graph.canvas, zero, useAscii, ...labelCanvases)'
const DRAW_IMPORT = 'import { mkCanvas, copyCanvas,'

// Lets a node id hold a dash (s-1) without swallowing the arrow after it
const PARSER = /beautiful-mermaid\/src\/parser\.ts$/
const NODE_ID_START = 'const NODE_PATTERNS'
const NODE_ID_END = 'const CLASS_SHORTHAND_REGEX'
const NODE_ID = '[\\w-]+'
const NODE_ID_BEFORE_ARROW = '(?:\\w|-(?![-.>]))+'

const result = await build({
  metafile: true,
  stdin: {
    contents: "export { renderMermaidAscii } from './node_modules/beautiful-mermaid/src/ascii/index.ts'",
    resolveDir: '.',
    loader: 'ts',
  },
  bundle: true,
  format: 'esm',
  platform: 'neutral',
  target: 'es2023',
  minifySyntax: true,
  minifyWhitespace: true,
  legalComments: 'none',
  banner: { js: '// beautiful-mermaid 1.1.3 (MIT, Craft Docs), ASCII renderer only. Built by scripts/build-vendor.mjs.' },
  outfile: '../hooks/vendor/mermaid-text.js',
  plugins: [{
    name: 'patches',
    setup(api) {
      api.onLoad({ filter: CANVAS }, args => {
        const src = readFileSync(args.path, 'utf8')
        if (!src.includes(CANVAS_ANCHOR)) throw new Error('canvas.ts no longer has isJunctionChar')
        return { contents: src.replace(CANVAS_ANCHOR, `${CLEAR_LABEL_GAPS}\n${CANVAS_ANCHOR}`), loader: 'ts' }
      })
      api.onLoad({ filter: DRAW }, args => {
        const src = readFileSync(args.path, 'utf8')
        if (!src.includes(DRAW_ANCHOR)) throw new Error('draw.ts no longer merges label canvases the same way')
        if (!src.includes(DRAW_IMPORT)) throw new Error('draw.ts no longer imports from canvas.ts the same way')
        const patched = src
          .replace(DRAW_ANCHOR, `${DRAW_ANCHOR}\n  for (const label of labelCanvases) clearLabelGaps(graph.canvas, label)`)
          .replace(DRAW_IMPORT, DRAW_IMPORT.replace('{ ', '{ clearLabelGaps, '))
        return { contents: patched, loader: 'ts' }
      })
      api.onLoad({ filter: PARSER }, args => {
        const src = readFileSync(args.path, 'utf8')
        const start = src.indexOf(NODE_ID_START)
        const end = src.indexOf(NODE_ID_END, start)
        if (start < 0 || end < 0) throw new Error('parser.ts no longer declares NODE_PATTERNS before CLASS_SHORTHAND_REGEX')
        const ids = src.slice(start, end)
        if (!ids.includes(NODE_ID)) throw new Error(`parser.ts node patterns no longer use ${NODE_ID}`)
        return { contents: src.slice(0, start) + ids.replaceAll(NODE_ID, NODE_ID_BEFORE_ARROW) + src.slice(end), loader: 'ts' }
      })
    },
  }],
})

for (const input of Object.keys(result.metafile.inputs)) {
  const match = /node_modules\/((?:@[^/]+\/)?[^/]+)/.exec(input)
  if (match) bundled.add(match[1])
}
for (const name of bundled) {
  const { license } = JSON.parse(readFileSync(`node_modules/${name}/package.json`, 'utf8'))
  if (license !== 'MIT') throw new Error(`${name} is ${license}, only MIT may be bundled`)
  console.log(`bundled ${name}: ${license}`)
}
