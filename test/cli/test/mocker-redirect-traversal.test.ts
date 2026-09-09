import type { InterceptorPluginOptions } from '@vitest/mocker/node'
import { fileURLToPath } from 'node:url'
import { interceptorPlugin } from '@vitest/mocker/node'
import { createServer } from 'vite'
import { expect, it, onTestFinished } from 'vitest'
import { WebSocket } from 'ws'

// `new URL` keeps the separators a file URL expects, so this stays correct on
// Windows where `fileURLToPath` gives back a drive-letter path with backslashes
const root = fileURLToPath(
  new URL('../fixtures/mocker/redirect-security/root', import.meta.url),
)

async function createMockerServer(options?: InterceptorPluginOptions) {
  const server = await createServer({
    root,
    configFile: false,
    logLevel: 'silent',
    server: {
      fs: { allow: [root] },
    },
    plugins: [
      {
        name: 'test:virtual-mock',
        enforce: 'pre',
        resolveId(id) {
          if (id === '/mock') {
            return id
          }
        },
      },
      interceptorPlugin(options),
      {
        // Vite dispatches custom websocket events in arrival order, so answering
        // a ping sent right after the registration is a deterministic barrier:
        // once the pong arrives, the registration was already handled or ignored
        name: 'test:ws-barrier',
        configureServer(server) {
          server.ws.on('test:ping', () => {
            server.ws.send('test:pong')
          })
        },
      },
    ],
  })
  await server.listen()
  onTestFinished(() => server.close())
  const localUrl = new URL(server.resolvedUrls!.local[0])
  return { server, host: localUrl.host }
}

function registerRedirect(host: string, redirect: string) {
  return new Promise<void>((resolve, reject) => {
    const ws = new WebSocket(`ws://${host}`, 'vite-hmr')
    const timeout = setTimeout(() => {
      ws.close()
      reject(new Error('timed out waiting for the websocket barrier'))
    }, 20_000)
    ws.on('message', (raw) => {
      let message: any
      try {
        message = JSON.parse(raw.toString())
      }
      catch {
        return
      }
      if (message.type === 'custom' && message.event === 'test:pong') {
        clearTimeout(timeout)
        ws.close()
        resolve()
      }
    })
    ws.on('open', () => {
      ws.send(JSON.stringify({
        type: 'custom',
        event: 'vitest:interceptor:register',
        data: { type: 'redirect', raw: '', id: '/mock', url: '/mock', redirect },
      }))
      ws.send(JSON.stringify({ type: 'custom', event: 'test:ping' }))
    })
    ws.on('error', reject)
  })
}

it('rejects a redirect mock whose target escapes the project root', async () => {
  const { server, host } = await createMockerServer()
  // an opaque URL scheme keeps the `..` segments, so join(root, pathname)
  // resolves outside the root; the mock must not be registered
  await registerRedirect(host, 'traversal:../secret.txt')
  const result = await server.transformRequest('/mock').catch(() => null)
  expect(result).toBe(null)
})

it('rejects a redirect mock pointing at an in-root file the server refuses to serve', async () => {
  const { server, host } = await createMockerServer()
  // stays inside the root, but `server.fs.deny` covers it, so the mock must not
  // become a way around the file-serving allowlist
  await registerRedirect(host, 'traversal:denied.pem')
  const result = await server.transformRequest('/mock').catch(() => null)
  expect(result).toBe(null)
})

it('ignores websocket mock registration when the interceptor does not own the socket', async () => {
  // the dev-server socket performs no token or origin check, so a consumer that
  // registers mocks through its own authenticated channel must be able to opt out
  const { server, host } = await createMockerServer({ registerWebSocketEvents: false })
  await registerRedirect(host, 'traversal:inroot.js')
  const result = await server.transformRequest('/mock').catch(() => null)
  expect(result).toBe(null)
})

it('serves a redirect mock whose target stays inside the project root', async () => {
  const { server, host } = await createMockerServer()
  await registerRedirect(host, 'traversal:inroot.js')
  const result = await server.transformRequest('/mock').catch(() => null)
  expect(result?.code).toContain('in-root-redirect-ok')
})
