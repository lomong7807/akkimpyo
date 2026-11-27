import { describe, expect, it } from 'vitest'
import { currentTime, formatTimeText, normalizeTime, positionAfterTimeDigits } from '../src/lib/timeInput'
import { basisText, isValidTime } from '../src/lib/timeText'
import { setDeviceClock } from './support/clock'

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

// 시간대마다 그 시간대의 시각을 오프셋으로 적는다(11월이라 로스앤젤레스는 겨울 시간 −08:00)
describe.each([
  ['Asia/Seoul', '+09:00'],
  ['UTC', 'Z'],
  ['America/Los_Angeles', '-08:00'],
  ['Pacific/Kiritimati', '+14:00'],
  ['Pacific/Pago_Pago', '-11:00'],
])('기기의 시간대가 %s일 때 지금 시각', (timeZone, offset) => {
  it('기기 시계의 시와 분을 그대로 쓴다', () => {
    setDeviceClock(`2026-11-26T09:05:59${offset}`, timeZone)
    expect(currentTime()).toBe('09:05')
  })

  it('자정 직전과 직후', () => {
    setDeviceClock(`2026-11-26T23:59:59.999${offset}`, timeZone)
    expect(currentTime()).toBe('23:59')
    setDeviceClock(`2026-11-27T00:00:00${offset}`, timeZone)
    expect(currentTime()).toBe('00:00')
  })
})

describe('연결이 없을 때의 기준 시각(00-common 3.2, F-908)', () => {
  // 받은 때: 서울 2026-11-19(목) 22:10
  const received = Date.parse('2026-11-19T22:10:00+09:00')

  it('기기의 오늘에 받았으면 시각만 적는다', () => {
    setDeviceClock('2026-11-19T23:59:00+09:00')
    expect(basisText(received)).toBe('22:10 기준')
  })

  it('자정이 지나면 날짜와 요일을 붙인다', () => {
    setDeviceClock('2026-11-20T00:00:00+09:00')
    expect(basisText(received)).toBe('11월 19일 (목) 22:10 기준')
  })

  it('다른 해에 받았으면 연도를 붙인다', () => {
    setDeviceClock('2027-01-02T09:00:00+09:00')
    expect(basisText(received)).toBe('2026년 11월 19일 22:10 기준')
  })

  it.each([
    ['Asia/Seoul', '22:10 기준'],
    ['UTC', '13:10 기준'],
    ['America/Los_Angeles', '05:10 기준'],
    ['Pacific/Kiritimati', '03:10 기준'],
    ['Pacific/Pago_Pago', '02:10 기준'],
  ])('기기의 시간대로 본 날짜와 시각이다(%s)', (timeZone, text) => {
    // 서울 2026-11-19 23:00. Kiritimati(UTC+14)는 받은 때도 지금도 11월 20일이다
    setDeviceClock('2026-11-19T23:00:00+09:00', timeZone)
    expect(basisText(received)).toBe(text)
  })

  it('오늘인지는 기기의 시간대의 자정으로 가른다', () => {
    // Kiritimati 11월 19일 23:50에 받고 11월 20일 00:10에 본다. 서울로는 같은 날 18:50과 19:10이다
    const late = Date.parse('2026-11-19T09:50:00Z')
    setDeviceClock('2026-11-19T10:10:00Z', 'Pacific/Kiritimati')
    expect(basisText(late)).toBe('11월 19일 (목) 23:50 기준')
    setDeviceClock('2026-11-19T10:10:00Z', 'Asia/Seoul')
    expect(basisText(late)).toBe('18:50 기준')
  })
})
