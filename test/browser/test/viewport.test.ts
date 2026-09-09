import { describe, expect, it } from 'vitest'
import { server } from 'vitest/browser'

describe.skipIf(
  // preview cannot control viewport
  server.provider === 'preview'
  // other tests affect the viewport if they run in a different order
  || server.config.browser.isolate === false,
)('viewport window has been properly initialized', () => {
  it.skipIf(!server.config.browser.headless)('viewport has proper size', async () => {
    const { width, height } = server.config.browser.viewport

    // On the Windows runner firefox reports the pre-sizing dimensions for a
    // beat after the session comes up, so poll instead of reading once. The
    // assertion is unchanged, it just stops racing the initial resize.
    await expect.poll(() => window.document.documentElement.getBoundingClientRect().width).toBe(width)
    await expect.poll(() => window.document.documentElement.getBoundingClientRect().height).toBe(height)
  })

  it.skipIf(server.config.browser.headless)('window has been maximized', () => {
    let topWindow = window
    while (topWindow.parent && topWindow !== topWindow.parent) {
      topWindow = topWindow.parent as unknown as any
    }

    // edge will show the Hub Apps right panel
    if (server.browser === 'edge') {
      expect(topWindow.visualViewport.width - topWindow.innerWidth === 0).toBe(true)
    }
    else {
      expect(screen.availWidth - topWindow.innerWidth === 0).toBe(true)
    }
  })
})
