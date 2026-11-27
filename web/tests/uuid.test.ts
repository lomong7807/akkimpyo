import { afterEach, describe, expect, it, vi } from 'vitest'
import { createUuidV7, isUuid, uuidV7 } from '../src/lib/uuid'
import { setDeviceClock } from './support/clock'

const FORMAT = /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/

afterEach(() => vi.restoreAllMocks())

/** 앞 48비트의 밀리초 */
function timeOf(id: string): number {
  return parseInt(id.replaceAll('-', '').slice(0, 12), 16)
}

/** 시각과 무작위 값을 정해 둔 만들기. 무작위 값은 부를 때마다 `random`을 채운다. */
function generatorAt(clock: { now: number }, random: (bytes: Uint8Array) => void = (bytes) => bytes.fill(0)) {
  return createUuidV7({ now: () => clock.now, fillRandom: random })
}

describe('형식(RFC 9562)', () => {
  it('소문자 36자 표준 표기이고 버전 7, 변형 10이다', () => {
    for (let count = 0; count < 200; count += 1) expect(uuidV7()).toMatch(FORMAT)
  })

  it('앞 48비트는 만든 때의 밀리초다', () => {
    const now = Date.UTC(2026, 10, 26, 3, 15, 0, 123)
    const id = generatorAt({ now })()
    expect(timeOf(id)).toBe(now)
    expect(id.slice(0, 13)).toBe(`${now.toString(16).padStart(12, '0').replace(/^(.{8})/, '$1-')}`)
  })

  // 앞서 만든 id보다 작아지지 않으므로 새로 연 탭(새로 읽은 모듈)에서 본다
  it('탭에서 쓰는 거래 id의 시각은 기기의 시계(src/lib/clock)의 지금이다', async () => {
    setDeviceClock('2026-11-26T12:15:00.123+09:00')
    vi.resetModules()
    const { uuidV7: newTab } = await import('../src/lib/uuid')
    expect(timeOf(newTab())).toBe(Date.parse('2026-11-26T03:15:00.123Z'))
  })

  it('무작위 값은 crypto.getRandomValues에서 받는다', () => {
    const random = vi.spyOn(crypto, 'getRandomValues')
    uuidV7()
    expect(random).toHaveBeenCalled()
  })

  it('무작위 자리를 모두 1로 채워도 버전과 변형 자리는 그대로다', () => {
    const id = generatorAt({ now: 1 }, (bytes) => bytes.fill(0xff))()
    expect(id).toMatch(FORMAT)
    expect(id.slice(14, 15)).toBe('7')
    expect(id.slice(19, 20)).toBe('b')
  })

  it('무작위 자리가 다르면 같은 밀리초에도 다른 값이다', () => {
    const ids = new Set(Array.from({ length: 1000 }, () => uuidV7()))
    expect(ids.size).toBe(1000)
  })
})

describe('순서', () => {
  it('같은 밀리초에 만든 값도 만든 순서대로 커진다', () => {
    const clock = { now: Date.UTC(2026, 10, 26) }
    const generate = createUuidV7({ now: () => clock.now, fillRandom: (bytes) => crypto.getRandomValues(bytes) })
    const ids = Array.from({ length: 5000 }, generate)
    expect(ids.toSorted()).toEqual(ids)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('밀리초가 바뀌면 그 시각으로 다시 시작한다', () => {
    const clock = { now: 1000 }
    const generate = generatorAt(clock)
    const first = generate()
    clock.now = 1001
    const second = generate()
    expect(timeOf(second)).toBe(1001)
    expect(second > first).toBe(true)
  })

  it('기기 시계가 뒤로 가도 앞서 만든 값보다 작아지지 않는다', () => {
    const clock = { now: 5000 }
    const generate = generatorAt(clock)
    const before = generate()
    clock.now = 4000
    const after = generate()
    expect(after > before).toBe(true)
    expect(timeOf(after)).toBe(5000)
  })

  it('한 밀리초 안의 순번이 다 차면 다음 밀리초로 넘어가 순서를 지킨다', () => {
    const clock = { now: 7000 }
    // 순번의 시작 값이 가장 큰 경우(2047)에도 4096개 넘게 만들 수 있어야 한다
    const generate = generatorAt(clock, (bytes) => bytes.fill(0xff))
    const ids = Array.from({ length: 4100 }, generate)
    expect(ids.toSorted()).toEqual(ids)
    expect(timeOf(ids[0])).toBe(7000)
    expect(timeOf(ids.at(-1)!)).toBe(7002)
  })
})

describe('UUID 모양', () => {
  it.each([uuidV7(), '0b9f6c1e-3d52-4a7e-9c11-5f2e8a7d4b60', '0B9F6C1E-3D52-4A7E-9C11-5F2E8A7D4B60'])('%s는 UUID다', (value) => {
    expect(isUuid(value)).toBe(true)
  })

  it.each([
    '',
    '0b9f6c1e3d524a7e9c115f2e8a7d4b60',
    '{0b9f6c1e-3d52-4a7e-9c11-5f2e8a7d4b60}',
    '0b9f6c1e-3d52-4a7e-9c11-5f2e8a7d4b60 ',
    '0b9f6c1e-3d52-4a7e-9c11-5f2e8a7d4b6g',
    '../../me',
    'id-비상금',
    123,
    null,
    undefined,
    {},
  ])('%j는 UUID가 아니다', (value) => {
    expect(isUuid(value)).toBe(false)
  })
})
