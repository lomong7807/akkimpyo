import { afterEach, describe, expect, it, vi } from 'vitest'
import { deviceClock, now, setClock, wallTimeNow } from '../src/lib/clock'

afterEach(() => {
  setClock()
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

const at = (iso: string) => () => Date.parse(iso)

describe('정한 시간대로 본 날짜와 시각', () => {
  it.each([
    // 자정의 앞뒤. 같은 순간도 시간대에 따라 날짜가 다르다
    ['Asia/Seoul', '2026-11-25T14:59:59.999Z', '2026-11-25', '23:59'],
    ['Asia/Seoul', '2026-11-25T15:00:00.000Z', '2026-11-26', '00:00'],
    ['UTC', '2026-11-25T23:59:59.999Z', '2026-11-25', '23:59'],
    ['UTC', '2026-11-26T00:00:00.000Z', '2026-11-26', '00:00'],
    ['America/Los_Angeles', '2026-11-26T07:59:59.999Z', '2026-11-25', '23:59'],
    ['America/Los_Angeles', '2026-11-26T08:00:00.000Z', '2026-11-26', '00:00'],
    ['Pacific/Kiritimati', '2026-11-25T09:59:59.999Z', '2026-11-25', '23:59'],
    ['Pacific/Kiritimati', '2026-11-25T10:00:00.000Z', '2026-11-26', '00:00'],
    ['Pacific/Pago_Pago', '2026-11-26T10:59:59.999Z', '2026-11-25', '23:59'],
    ['Pacific/Pago_Pago', '2026-11-26T11:00:00.000Z', '2026-11-26', '00:00'],
    // 해와 윤일
    ['Asia/Seoul', '2026-12-31T15:00:00.000Z', '2027-01-01', '00:00'],
    ['Asia/Seoul', '2028-02-28T15:00:00.000Z', '2028-02-29', '00:00'],
    // 로스앤젤레스의 여름 시간이 끝나는 날. 01시가 두 번 온다
    ['America/Los_Angeles', '2026-11-01T08:30:00.000Z', '2026-11-01', '01:30'],
    ['America/Los_Angeles', '2026-11-01T09:30:00.000Z', '2026-11-01', '01:30'],
    ['America/Los_Angeles', '2026-11-01T10:30:00.000Z', '2026-11-01', '02:30'],
  ])('%s에서 %s이면 %s %s', (timeZone, instant, date, time) => {
    setClock({ now: at(instant), timeZone })
    expect(wallTimeNow()).toEqual({ date, time })
  })

  it('지금은 시계가 주는 시각이다', () => {
    setClock({ now: at('2026-11-26T03:15:00.123Z'), timeZone: 'UTC' })
    expect(now()).toBe(Date.parse('2026-11-26T03:15:00.123Z'))
  })

  it('읽을 때마다 시계를 다시 읽는다', () => {
    let instant = Date.parse('2026-11-25T14:59:59.999Z')
    setClock({ now: () => instant, timeZone: 'Asia/Seoul' })
    expect(wallTimeNow().date).toBe('2026-11-25')
    instant += 1
    expect(wallTimeNow().date).toBe('2026-11-26')
  })
})

// 기기의 시계를 시험하는 곳만 기기의 시간대(TZ)를 바꾼다. 결과는 테스트를 돌리는 기기의 시간대와 상관없다
describe('기기의 시계', () => {
  const pad = (value: number) => String(value).padStart(2, '0')

  function localOf(instant: number) {
    const local = new Date(instant)
    return {
      date: `${local.getFullYear()}-${pad(local.getMonth() + 1)}-${pad(local.getDate())}`,
      time: `${pad(local.getHours())}:${pad(local.getMinutes())}`,
    }
  }

  it('지금은 Date.now다', () => {
    vi.useFakeTimers({ toFake: ['Date'], now: Date.parse('2026-11-26T03:15:00.123Z') })
    setClock(deviceClock)
    expect(now()).toBe(Date.parse('2026-11-26T03:15:00.123Z'))
  })

  it.each(['Asia/Seoul', 'UTC', 'America/Los_Angeles', 'Pacific/Kiritimati', 'Pacific/Pago_Pago'])(
    '기기의 시간대가 %s이면 Date의 지역 시각과 같은 날짜와 시각이다',
    (timeZone) => {
      vi.stubEnv('TZ', timeZone)
      for (const instant of [
        '2026-11-25T14:59:59.999Z',
        '2026-11-25T15:00:00.000Z',
        '2026-11-26T07:59:59.999Z',
        '2026-11-26T08:00:00.000Z',
        '2026-11-25T10:00:00.000Z',
        '2026-11-26T11:00:00.000Z',
        '2026-11-01T09:30:00.000Z',
      ]) {
        setClock({ now: at(instant) })
        expect(wallTimeNow()).toEqual(localOf(Date.parse(instant)))
      }
    },
  )

  it('열어 둔 사이 기기의 시간대가 바뀌면 다음에 읽을 때부터 새 시간대다', () => {
    setClock({ now: at('2026-11-25T20:00:00.000Z') })
    vi.stubEnv('TZ', 'Asia/Seoul')
    expect(wallTimeNow()).toEqual({ date: '2026-11-26', time: '05:00' })
    vi.stubEnv('TZ', 'America/Los_Angeles')
    expect(wallTimeNow()).toEqual({ date: '2026-11-25', time: '12:00' })
  })
})
