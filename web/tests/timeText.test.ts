import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { currentTime, formatTimeText, isValidTime, normalizeTime, positionAfterTimeDigits } from '../src/lib/timeText'

afterEach(() => {
  vi.useRealTimers()
  vi.unstubAllEnvs()
})

describe('칸에 보일 글자', () => {
  it.each([
    ['', ''],
    ['1', '1'],
    ['14', '14'],
    ['143', '14:3'],
    ['1430', '14:30'],
    ['14305', '14:30'],
    ['14:', '14:'],
    ['14:3', '14:3'],
    ['14:30', '14:30'],
    ['14:305', '14:30'],
    ['9:', '9:'],
    ['9:05', '9:05'],
    [':30', ':30'],
    ['１４３０', ''],
    ['a1b4c3d0', '14:30'],
    ['14.30', '14:30'],
    ['143:0', '14:30'],
  ])('%j → %j', (text, shown) => {
    expect(formatTimeText(text)).toBe(shown)
  })
})

describe('커서 자리', () => {
  it.each([
    ['14:3', 3, false, 4],
    ['14:30', 4, false, 5],
    ['14:', 2, true, 3],
    ['14:30', 2, false, 2],
    ['14:30', 2, true, 3],
    ['14', 2, true, 2],
    ['', 0, false, 0],
  ])('%j에서 숫자 %d개 뒤(쌍점을 넘김: %s)는 %d', (text, count, afterColon, position) => {
    expect(positionAfterTimeDigits(text, count, afterColon)).toBe(position)
  })
})

describe('형식', () => {
  it.each(['00:00', '09:05', '12:30', '23:59', '19:00'])('%s는 맞다', (text) => {
    expect(isValidTime(text)).toBe(true)
  })

  it.each(['', '24:00', '23:60', '9:05', '14', '14:3', '1430', ' 14:30', '14:30 ', '99:99', '14:30:00'])(
    '%j는 틀리다',
    (text) => {
      expect(isValidTime(text)).toBe(false)
    },
  )

  it.each([
    ['9:05', '09:05'],
    ['14:30', '14:30'],
    ['9:5', '9:5'],
    ['', ''],
  ])('%j를 맞추면 %j', (text, normalized) => {
    expect(normalizeTime(text)).toBe(normalized)
  })
})

describe.each(['Asia/Seoul', 'UTC', 'America/Los_Angeles'])('기기의 시간대가 %s일 때 지금 시각', (timeZone) => {
  beforeEach(() => vi.stubEnv('TZ', timeZone))

  it('기기 시계의 시와 분을 그대로 쓴다', () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 10, 26, 9, 5, 59) })
    expect(currentTime()).toBe('09:05')
  })

  it('자정 직전과 직후', () => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date(2026, 10, 26, 23, 59, 59, 999) })
    expect(currentTime()).toBe('23:59')
    vi.setSystemTime(new Date(2026, 10, 27, 0, 0, 0))
    expect(currentTime()).toBe('00:00')
  })
})
