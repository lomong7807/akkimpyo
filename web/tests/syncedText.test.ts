import { describe, expect, it } from 'vitest'
import { syncedText } from '../src/features/sync/syncedText'
import { setDeviceClock } from './support/clock'

/*
 * 마지막으로 맞춘 시각의 글자(B-04 (2-3), M-01 (16), 00-common 3.2). 오늘이면 시각만, 아니면 날짜와 시각이다. "오늘"은 기기의
 * 시간대로 본 날짜다(lib/clock). 자정 경계를 본다.
 */

const at = (iso: string) => Date.parse(iso)

describe('마지막으로 맞춘 시각', () => {
  it('한 번도 맞추지 못했으면 "아직 맞추지 않았어요"', () => {
    expect(syncedText(undefined)).toBe('아직 맞추지 않았어요')
  })

  it('오늘이면 시각만 쓴다', () => {
    setDeviceClock('2026-11-26T12:00:00+09:00')
    expect(syncedText(at('2026-11-26T10:42:00+09:00'))).toBe('10:42에 맞춤')
    expect(syncedText(at('2026-11-26T09:05:59+09:00'))).toBe('09:05에 맞춤')
  })

  it('오늘이 아니면 날짜(요일)와 시각을 쓴다', () => {
    setDeviceClock('2026-11-26T12:00:00+09:00')
    expect(syncedText(at('2026-11-19T22:10:00+09:00'))).toBe('11월 19일 (목) 22:10에 맞춤')
  })

  describe('자정 경계', () => {
    it('자정 바로 뒤에는 어제 23:59에 맞춘 것을 날짜와 함께 쓴다', () => {
      setDeviceClock('2026-11-26T00:00:00+09:00')
      expect(syncedText(at('2026-11-25T23:59:59.999+09:00'))).toBe('11월 25일 (수) 23:59에 맞춤')
    })

    it('자정에 맞춘 것은 그날의 시각만 쓴다', () => {
      setDeviceClock('2026-11-26T00:00:30+09:00')
      expect(syncedText(at('2026-11-26T00:00:00+09:00'))).toBe('00:00에 맞춤')
    })

    it('자정 바로 앞에는 같은 날의 시각만 쓴다', () => {
      setDeviceClock('2026-11-25T23:59:59.999+09:00')
      expect(syncedText(at('2026-11-25T00:00:00+09:00'))).toBe('00:00에 맞춤')
    })

    it('해가 바뀌면 연도를 붙이고 요일은 쓰지 않는다', () => {
      setDeviceClock('2027-01-01T00:00:30+09:00')
      expect(syncedText(at('2026-12-31T23:59:00+09:00'))).toBe('2026년 12월 31일 23:59에 맞춤')
    })
  })

  it.each([
    ['America/Los_Angeles', '2026-11-26T08:00:00Z', '2026-11-26T07:59:00Z', '11월 25일 (수) 23:59에 맞춤'],
    ['America/Los_Angeles', '2026-11-26T08:00:30Z', '2026-11-26T08:00:00Z', '00:00에 맞춤'],
    ['Pacific/Kiritimati', '2026-11-25T10:00:00Z', '2026-11-25T09:59:00Z', '11월 25일 (수) 23:59에 맞춤'],
    ['Pacific/Pago_Pago', '2026-11-26T11:00:00Z', '2026-11-26T10:59:00Z', '11월 25일 (수) 23:59에 맞춤'],
    ['UTC', '2026-11-26T00:00:00Z', '2026-11-25T23:59:00Z', '11월 25일 (수) 23:59에 맞춤'],
  ])('기기 시간대(%s)의 날짜로 오늘을 본다', (timeZone, now, synced, text) => {
    setDeviceClock(now, timeZone)
    expect(syncedText(at(synced))).toBe(text)
  })
})
