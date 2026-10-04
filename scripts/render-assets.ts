/**
 * Renders INTERLOCK's raster brand assets from SVG/HTML with headless Chromium.
 *
 *   node scripts/render-assets.ts
 *
 * Writes into apps/web/public/:
 *   favicon-16.png favicon-32.png favicon-48.png   (then: python scripts/make-ico.py)
 *   apple-touch-icon.png (180, full bleed)  icon-192.png  icon-512.png
 *   icon-maskable-512.png (full bleed, mark inside the 80% safe zone)
 *   og-image.png (1200x630)
 * Fonts are embedded from node_modules/@fontsource as data URLs, so rendering
 * needs no network.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { chromium } from '@playwright/test'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const pub = path.join(root, 'apps/web/public')
const fontDir = path.join(root, 'node_modules/@fontsource')

const PAPER = '#F5F1E8'
const PAPER2 = '#ECE7DC'
const INK = '#151617'
const INK2 = '#5A5852'
const CORAL = '#EE6048'
const LINE = '#DAD3C5'

async function fontFace(family: string, file: string, weight: number): Promise<string> {
  const data = await readFile(path.join(fontDir, file))
  return `@font-face{font-family:'${family}';src:url(data:font/woff2;base64,${data.toString('base64')}) format('woff2');font-weight:${weight};font-style:normal;}`
}

/** The mark: normally-closed contact, plates in `color`, trip slash in coral. viewBox 64. */
function markSvg(color: string, size: number, stroke = 5): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64" width="${size}" height="${size}">
  <g fill="none" stroke="${color}" stroke-linecap="round" stroke-width="${stroke}">
    <path d="M5 32H20"/><path d="M44 32H59"/><path d="M20 16V48"/><path d="M44 16V48"/>
  </g>
  <path d="M25.5 45L38.5 19" fill="none" stroke="${CORAL}" stroke-linecap="round" stroke-width="${stroke + 0.5}"/>
</svg>`
}

function page(body: string, w: number, h: number, css = ''): string {
  return `<!doctype html><html><head><meta charset="utf-8"><style>
  html,body{margin:0;padding:0;width:${w}px;height:${h}px;overflow:hidden;background:transparent}
  ${css}
  </style></head><body>${body}</body></html>`
}

async function main(): Promise<void> {
  const fonts = [
    await fontFace('Manrope', 'manrope/files/manrope-latin-800-normal.woff2', 800),
    await fontFace('Manrope', 'manrope/files/manrope-latin-600-normal.woff2', 600),
    await fontFace('Manrope', 'manrope/files/manrope-latin-500-normal.woff2', 500),
    await fontFace('IBM Plex Mono', 'ibm-plex-mono/files/ibm-plex-mono-latin-500-normal.woff2', 500),
    await fontFace('IBM Plex Mono', 'ibm-plex-mono/files/ibm-plex-mono-latin-600-normal.woff2', 600),
  ].join('\n')
  const favicon = await readFile(path.join(pub, 'favicon.svg'), 'utf8')

  const browser = await chromium.launch()
  const context = await browser.newContext({ deviceScaleFactor: 1 })
  const p = await context.newPage()

  async function shot(name: string, w: number, h: number, html: string): Promise<void> {
    await p.setViewportSize({ width: w, height: h })
    await p.setContent(html, { waitUntil: 'load' })
    await p.evaluate(async () => {
      await document.fonts.ready
    })
    const buf = await p.screenshot({ type: 'png', omitBackground: true, clip: { x: 0, y: 0, width: w, height: h } })
    await writeFile(path.join(pub, name), buf)
    console.log(`wrote ${name} (${w}x${h})`)
  }

  // Favicons: the simplified 32-unit favicon.svg scaled to each size.
  for (const s of [16, 32, 48]) {
    const svg = favicon.replace('width="32" height="32"', `width="${s}" height="${s}"`)
    await shot(`favicon-${s}.png`, s, s, page(svg, s, s, 'svg{display:block}'))
  }

  // Rounded app icons (transparent corners).
  for (const s of [192, 512]) {
    const r = Math.round(s * 0.225)
    const body = `<div style="width:${s}px;height:${s}px;border-radius:${r}px;background:${INK};display:flex;align-items:center;justify-content:center">${markSvg(PAPER, Math.round(s * 0.7), 4.6)}</div>`
    await shot(`icon-${s}.png`, s, s, page(body, s, s))
  }

  // Full-bleed icons: iOS and maskable icons are cropped by the platform.
  await shot(
    'apple-touch-icon.png',
    180,
    180,
    page(`<div style="width:180px;height:180px;background:${INK};display:flex;align-items:center;justify-content:center">${markSvg(PAPER, 124, 4.6)}</div>`, 180, 180),
  )
  await shot(
    'icon-maskable-512.png',
    512,
    512,
    page(`<div style="width:512px;height:512px;background:${INK};display:flex;align-items:center;justify-content:center">${markSvg(PAPER, 300, 4.6)}</div>`, 512, 512),
  )

  // Open Graph card.
  const W = 1200
  const H = 630
  const og = `
  <div class="card">
    <div class="grid"></div>
    <header>
      ${markSvg(INK, 52, 5)}
      <span class="word">INTERLOCK</span>
      <span class="tag">PLC Safety Logic Integrity &amp; Impact Analyzer</span>
    </header>
    <h1>When PLC logic changes, the diff is only the beginning.</h1>
    <svg class="rung" viewBox="0 0 1060 120" width="1060" height="120" xmlns="http://www.w3.org/2000/svg">
      <g stroke-linecap="round" fill="none">
        <path d="M4 14V106M1056 14V106" stroke="${INK}" stroke-width="5"/>
        <rect x="402" y="18" width="136" height="84" rx="18" stroke="${CORAL}" stroke-width="2" stroke-dasharray="6 7" fill="${PAPER}"/>
        <path d="M4 60H150M168 60H330M348 60H456" stroke="${INK}" stroke-width="4.5"/>
        <path d="M484 60H842M866 60H1056" stroke="${LINE}" stroke-width="3"/>
        <path d="M150 38V82M168 38V82M330 38V82M348 38V82" stroke="${INK}" stroke-width="4.5"/>
        <path d="M456 36V84M484 36V84" stroke="${INK}" stroke-width="4.5"/>
        <path d="M463.5 79L476.5 41" stroke="${CORAL}" stroke-width="5"/>
        <path d="M842 38Q826 60 842 82M866 38Q882 60 866 82" stroke="${CORAL}" stroke-width="4.5"/>
      </g>
      <g font-family="IBM Plex Mono" font-weight="500" font-size="15" fill="${INK2}" letter-spacing="1.5">
        <text x="159" y="112" text-anchor="middle">Pressure_High</text>
        <text x="339" y="112" text-anchor="middle">Safety_Enable</text>
        <text x="854" y="112" text-anchor="middle">Shutdown_Cmd</text>
      </g>
      <text x="470" y="12" text-anchor="middle" font-family="IBM Plex Mono" font-weight="600" font-size="14" fill="#B3361F" letter-spacing="1.5">XIO Maintenance_Mode</text>
    </svg>
    <footer>
      <span class="sev"><svg viewBox="0 0 12 12" width="14" height="14"><path d="M4 .8h4L11.2 4v4L8 11.2H4L.8 8V4z" fill="${INK}"/></svg>CRITICAL</span>
      <span class="find">Shutdown condition weakened. Maintenance_Mode now suppresses the shutdown.</span>
    </footer>
  </div>`
  const ogCss = `${fonts}
  .card{position:relative;width:${W}px;height:${H}px;background:${PAPER};box-sizing:border-box;padding:56px 70px;font-family:Manrope;color:${INK};overflow:hidden}
  .grid{position:absolute;inset:0;background-image:linear-gradient(rgba(21,22,23,.05) 1px,transparent 1px),linear-gradient(90deg,rgba(21,22,23,.05) 1px,transparent 1px);background-size:30px 30px}
  header{position:relative;display:flex;align-items:center;gap:16px}
  .word{font-weight:800;font-size:26px;letter-spacing:.16em}
  .tag{margin-left:auto;font-family:'IBM Plex Mono';font-weight:500;font-size:15px;letter-spacing:.08em;text-transform:uppercase;color:${INK2}}
  h1{position:relative;margin:54px 0 0;font-weight:800;font-size:76px;line-height:.98;letter-spacing:-.042em;max-width:1000px}
  .rung{position:absolute;left:70px;bottom:92px}
  footer{position:absolute;left:70px;right:70px;bottom:44px;display:flex;align-items:center;gap:16px;font-size:19px;font-weight:600}
  .sev{display:inline-flex;align-items:center;gap:8px;height:32px;padding:0 14px;border-radius:999px;background:${CORAL};font-family:'IBM Plex Mono';font-size:14px;font-weight:600;letter-spacing:.08em;color:${INK}}
  .find{color:${INK}}
  `
  await shot('og-image.png', W, H, page(og, W, H, ogCss + `body{background:${PAPER2}}`))

  await browser.close()
}

main().catch((e: unknown) => {
  console.error(e)
  process.exit(1)
})
