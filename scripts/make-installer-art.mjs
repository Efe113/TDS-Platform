import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Resvg } from '@resvg/resvg-js'

/**
 * NSIS can only load BMP bitmaps, so the installer art is rendered from SVG to PNG first and then
 * converted with System.Drawing. The welcome page cycles six of the 164x220 frames with a timer;
 * the standard pages and the uninstaller get a static 164x314 sidebar.
 */

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'apps/desktop/build/installer')
const RESVG_OPTIONS = { fitTo: { mode: 'width', value: 0 } }

const BRAND = '#4c8dff'
const INK = '#e6edf6'
const BG = '#0b0e14'
const PANEL = '#111827'

function tower(cx, cy, scale) {
  return `<g transform="translate(${cx} ${cy}) scale(${scale}) translate(-256 -256)">
    <rect x="228" y="96" width="56" height="64" rx="14" fill="${BRAND}" />
    <path d="M152 168H360" stroke="${INK}" stroke-width="36" stroke-linecap="round" />
    <path d="M212 186 188 392h136L300 186Z" stroke="${INK}" stroke-width="30" stroke-linejoin="round" />
    <path d="M152 392h208" stroke="${INK}" stroke-width="36" stroke-linecap="round" />
  </g>`
}

function frameSvg(width, height, frame, total) {
  const cx = width / 2
  const cy = height * 0.44
  const radius = Math.min(width, height) * 0.31
  const rings = [0, 1, 2].map((index) => {
    const phase = ((frame + index * 1.7) / total) * Math.PI * 2
    const r = radius + 10 + index * 13 + Math.sin(phase) * 4
    const opacity = 0.08 + 0.08 * (0.5 + 0.5 * Math.sin(phase))
    return `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${BRAND}" stroke-width="1" opacity="${opacity.toFixed(3)}" />`
  })
  const particles = Array.from({ length: 14 }, (_, index) => {
    const phase = ((frame + index * 2.3) / total) * Math.PI * 2
    const spread = radius * (0.55 + (index % 5) * 0.18)
    const x = cx + Math.cos(phase + index * 0.9) * spread
    const y = cy + Math.sin(phase * 0.8 + index) * spread * 0.75
    const opacity = 0.18 + 0.45 * (0.5 + 0.5 * Math.sin(phase + 0.8))
    return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${index % 4 === 0 ? 2.2 : 1.2}" fill="${index % 3 === 0 ? INK : BRAND}" opacity="${opacity.toFixed(3)}" />`
  })
  const beams = Array.from({ length: 3 }, (_, index) => {
    const x = width * (0.16 + index * 0.32) + Math.sin((frame + index) / total * Math.PI * 2) * 8
    return `<path d="M${x} 0L${x + 26} ${height}H${x + 8}L${x - 18} 0Z" fill="${BRAND}" opacity="0.018" />`
  })
  const grid = Array.from({ length: Math.ceil(width / 18) }, (_, index) => {
    const x = index * 18 + 4
    return `<path d="M${x} 0V${height}" stroke="${INK}" stroke-width="0.5" opacity="0.035" />`
  })

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <defs>
      <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="${BG}" />
        <stop offset="0.62" stop-color="${PANEL}" />
        <stop offset="1" stop-color="${BG}" />
      </linearGradient>
      <radialGradient id="glow" cx="50%" cy="50%" r="50%">
        <stop offset="0" stop-color="${BRAND}" stop-opacity="0.34" />
        <stop offset="0.55" stop-color="${BRAND}" stop-opacity="0.08" />
        <stop offset="1" stop-color="${BRAND}" stop-opacity="0" />
      </radialGradient>
      <linearGradient id="line" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="${BRAND}" stop-opacity="0" />
        <stop offset="0.5" stop-color="${BRAND}" stop-opacity="0.9" />
        <stop offset="1" stop-color="${BRAND}" stop-opacity="0" />
      </linearGradient>
    </defs>
    <rect width="${width}" height="${height}" fill="url(#bg)" />
    ${grid.join('')}
    ${beams.join('')}
    <circle cx="${cx}" cy="${cy}" r="${radius * 2.1}" fill="url(#glow)" />
    ${rings.join('')}
    <path d="M${cx - radius} ${cy + radius + 22}H${cx + radius}" stroke="url(#line)" stroke-width="1" />
    ${tower(cx, cy, Math.min(width, height) / 560)}
    ${particles.join('')}
    <rect x="0" y="${height - 3}" width="${width}" height="3" fill="${BRAND}" opacity="0.55" />
  </svg>`
}

function headerSvg(width, height) {
  const cx = width - 34
  const cy = height / 2
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <defs>
      <linearGradient id="hbg" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stop-color="${BG}" />
        <stop offset="1" stop-color="${PANEL}" />
      </linearGradient>
      <linearGradient id="hline" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="${BRAND}" stop-opacity="0" />
        <stop offset="1" stop-color="${BRAND}" stop-opacity="0.8" />
      </linearGradient>
    </defs>
    <rect width="${width}" height="${height}" fill="url(#hbg)" />
    <path d="M0 ${height - 1}H${width}" stroke="url(#hline)" stroke-width="2" />
    ${tower(cx, cy, 0.075)}
    <circle cx="${cx}" cy="${cy}" r="25" fill="none" stroke="${BRAND}" stroke-width="1" opacity="0.25" />
    <circle cx="${cx}" cy="${cy}" r="34" fill="none" stroke="${BRAND}" stroke-width="1" opacity="0.12" />
  </svg>`
}

function render(svg, width) {
  return new Resvg(svg, { ...RESVG_OPTIONS, fitTo: { mode: 'width', value: width } }).render().asPng()
}

mkdirSync(outDir, { recursive: true })
for (const entry of readdirSync(outDir)) {
  if (/\.(png|bmp)$/i.test(entry)) rmSync(join(outDir, entry), { force: true })
}

const frames = 6
for (let index = 0; index < frames; index += 1) {
  writeFileSync(join(outDir, `welcome-${String(index)}.png`), render(frameSvg(164, 220, index, frames), 164))
}
writeFileSync(join(outDir, 'sidebar.png'), render(frameSvg(164, 314, 0, frames), 164))
writeFileSync(join(outDir, 'uninstallerSidebar.png'), render(frameSvg(164, 314, 3, frames), 164))
writeFileSync(join(outDir, 'header.png'), render(headerSvg(150, 57), 150))

const convert = `Add-Type -AssemblyName System.Drawing
$dir = '${outDir.replace(/'/g, "''")}'
foreach ($png in Get-ChildItem -LiteralPath $dir -Filter *.png) {
  $image = [System.Drawing.Image]::FromFile($png.FullName)
  try {
    $bmp = New-Object System.Drawing.Bitmap($image.Width, $image.Height, [System.Drawing.Imaging.PixelFormat]::Format24bppRgb)
    try {
      $graphics = [System.Drawing.Graphics]::FromImage($bmp)
      try { $graphics.DrawImage($image, 0, 0, $image.Width, $image.Height) } finally { $graphics.Dispose() }
      $bmp.Save([System.IO.Path]::ChangeExtension($png.FullName, '.bmp'), [System.Drawing.Imaging.ImageFormat]::Bmp)
    } finally { $bmp.Dispose() }
  } finally { $image.Dispose() }
  Remove-Item -LiteralPath $png.FullName
}
`
execFileSync('powershell', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', convert], { stdio: 'inherit' })

const bmps = readdirSync(outDir).filter((entry) => entry.endsWith('.bmp'))
if (!existsSync(join(outDir, 'welcome-0.bmp')) || !existsSync(join(outDir, 'header.bmp'))) {
  throw new Error(`installer art missing (${bmps.join(', ')})`)
}
console.log(`installer art: ${String(bmps.length)} BMP files in ${outDir}`)
