import { describe, expect, it, vi } from 'vitest'
import { registerServiceWorker } from '../src/app/registerServiceWorker'

/*
 * service worker 등록(설계 8.2). 배포 빌드에서만 main.tsx가 load 뒤에 부른다(테스트와 개발 모드는 등록하지 않는다).
 * /sw.js는 HTTP 캐시를 거치지 않고 확인한다(updateViaCache: 'none', devops Q15).
 */

describe('registerServiceWorker', () => {
  it('/sw.js를 앱 전체 범위로, HTTP 캐시를 거치지 않게 등록한다', () => {
    const register = vi.fn().mockResolvedValue({})
    registerServiceWorker({ register } as unknown as ServiceWorkerContainer)
    expect(register).toHaveBeenCalledWith('/sw.js', { scope: '/', updateViaCache: 'none' })
  })

  it('등록에 실패해도 앱은 그대로다(던지지 않는다)', async () => {
    const register = vi.fn().mockRejectedValue(new DOMException('blocked', 'SecurityError'))
    const unhandled = vi.fn()
    process.on('unhandledRejection', unhandled)
    expect(() => registerServiceWorker({ register } as unknown as ServiceWorkerContainer)).not.toThrow()
    await new Promise((resolve) => setTimeout(resolve, 0))
    process.off('unhandledRejection', unhandled)
    expect(unhandled).not.toHaveBeenCalled()
  })
})
