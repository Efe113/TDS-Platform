import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { loadEnv } from 'vite'
import { resolve } from 'node:path'

const sharedEntry = resolve(__dirname, '../../packages/shared/src/index.ts')
const rendererSrc = resolve(__dirname, 'src/renderer/src')
const envDir = resolve(__dirname, '../..')

const STRICT_CSP =
  "content=\"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:\""

/**
 * The renderer talks to Supabase directly under RLS, so `connect-src` must name that origin:
 * `'self'` alone is http://localhost in dev and `file://` when packaged, which turns every
 * request into "TypeError: Failed to fetch". Inline scripts are allowed only in dev, because
 * Vite injects the React-refresh preamble inline.
 */
function cspPlugin(supabaseUrl: string, isDev: boolean, telemetry: boolean) {
  let host = ''
  try {
    host = new URL(supabaseUrl).host
  } catch {
    host = ''
  }
  const remote = host ? `https://${host} wss://${host}` : 'https://*.supabase.co wss://*.supabase.co'
  const devConnect = isDev ? " ws://localhost:5173 http://localhost:5173 'unsafe-inline'" : ''
  const devScript = isDev ? " 'unsafe-inline'" : ''
  // The renderer SDK does not reach sentry.io; it hands events to the main process over this local
  // scheme, which is the only extra origin the page is allowed to talk to.
  const ipcConnect = telemetry ? ' sentry-ipc:' : ''

  return {
    name: 'csp',
    transformIndexHtml: (html: string) =>
      html.replace(
        STRICT_CSP,
        `content="default-src 'self'; script-src 'self'${devScript}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: ${remote}; connect-src 'self' ${remote}${ipcConnect}${devConnect}; font-src 'self' data:"`
      )
  }
}

export default defineConfig(({ command }) => {
  const isDev = command === 'serve'
  const env = loadEnv(isDev ? 'development' : 'production', envDir, 'VITE_')

  const externalizeShared = () => [
    // @tds/shared ships unbundled TypeScript consumed through the workspace symlink; leaving it
    // external would make Electron resolve `./src/index.ts` at runtime and crash on load.
    externalizeDepsPlugin({ exclude: ['@tds/shared'] })
  ]

  return {
    main: {
      plugins: externalizeShared(),
      define: {
        'process.env.VITE_SUPABASE_URL': JSON.stringify(env.VITE_SUPABASE_URL ?? ''),
        'process.env.VITE_SUPABASE_ANON_KEY': JSON.stringify(env.VITE_SUPABASE_ANON_KEY ?? ''),
        // Main only sees process.env keys listed here; the renderer deliberately does not get this one,
        // because its SDK instance is configured by the main process over IPC.
        'process.env.VITE_SENTRY_DSN': JSON.stringify(env.VITE_SENTRY_DSN ?? '')
      },
      envDir,
      resolve: { alias: { '@tds/shared': sharedEntry } },
      build: { lib: { entry: resolve(__dirname, 'src/main/index.ts'), formats: ['cjs'] } }
    },
    preload: {
      plugins: externalizeShared(),
      envDir,
      resolve: { alias: { '@tds/shared': sharedEntry } },
      build: {
        lib: {
          entry: {
            main: resolve(__dirname, 'src/preload/main.ts'),
            overlay: resolve(__dirname, 'src/preload/overlay.ts')
          },
          formats: ['cjs']
        }
      }
    },
    renderer: {
      root: resolve(__dirname, 'src/renderer'),
      envDir,
      plugins: [react(), tailwindcss(), cspPlugin(env.VITE_SUPABASE_URL ?? '', isDev, (env.VITE_SENTRY_DSN ?? '').trim().length > 0)],
      resolve: {
        // Array form on purpose: the object form would let a bare '@' alias swallow '@tds/shared'.
        // shadcn's generated files import from '@/lib/utils' and '@/components/ui/*'.
        alias: [
          { find: '@tds/shared', replacement: sharedEntry },
          { find: '@renderer', replacement: rendererSrc },
          { find: /^@\//, replacement: `${rendererSrc.replace(/\\/g, '/')}/` }
        ]
      },
      build: {
        rollupOptions: {
          input: {
            index: resolve(__dirname, 'src/renderer/index.html'),
            overlay: resolve(__dirname, 'src/renderer/overlay.html')
          }
        }
      }
    }
  }
})
