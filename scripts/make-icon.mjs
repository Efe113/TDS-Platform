import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Resvg } from '@resvg/resvg-js'

/**
 * Builds apps/desktop/build/icon.ico from build/logo.svg.
 *
 * electron-builder.yml already points win.icon at that file, but nothing produced it - so every
 * packaged build so far shipped with Electron's default icon. The ICO entries carry PNG payloads
 * (Vista+ format), which keeps the file small and avoids a BMP encoder here.
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const source = join(root, 'apps/desktop/build/logo.svg')
const outDir = join(root, 'apps/desktop/build')

const SIZES = [16, 20, 24, 32, 40, 48, 64, 128, 256]

const render = (svg, size) => new Resvg(svg, { fitTo: { mode: 'width', value: size } }).render().asPng()

const svg = readFileSync(source, 'utf8')
const images = SIZES.map((size) => ({ size, png: render(svg, size) }))

const header = Buffer.alloc(6)
header.writeUInt16LE(0, 0)
header.writeUInt16LE(1, 2)
header.writeUInt16LE(images.length, 4)

const ENTRY_BYTES = 16
let offset = header.length + ENTRY_BYTES * images.length
const entries = Buffer.concat(
  images.map((image, index) => {
    const entry = Buffer.alloc(ENTRY_BYTES)
    // 256 is encoded as 0 in the width/height bytes; anything else is literal.
    entry.writeUInt8(image.size === 256 ? 0 : image.size, 0)
    entry.writeUInt8(image.size === 256 ? 0 : image.size, 1)
    entry.writeUInt8(0, 2)
    entry.writeUInt8(0, 3)
    entry.writeUInt16LE(1, 4)
    entry.writeUInt16LE(32, 6)
    entry.writeUInt32LE(image.png.length, 8)
    entry.writeUInt32LE(offset, 12)
    offset += image.png.length
    void index
    return entry
  })
)

writeFileSync(join(outDir, 'icon.ico'), Buffer.concat([header, entries, ...images.map((image) => image.png)]))
writeFileSync(join(outDir, 'icon.png'), images[images.length - 1].png)

console.log(`icon.ico: ${images.length} sizes (${SIZES.join(', ')}), ${offset} bytes`)
console.log('icon.png: 256px master')
