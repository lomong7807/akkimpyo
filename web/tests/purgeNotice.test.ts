import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { purgeNoticeOf } from '../src/features/transactions/purgeNotice'

/* 휴지통에서 연 거래의 안내 띠(D-06 상태). 남은 날 = (purgeAt − 지금)을 일 단위로 올림(ledger·planner 결정 2026-11-26) */

const purgeAt = '2026-12-26T03:15:00.123Z'
const at = (iso: string) => Date.parse(iso)

afterEach(() => {
  vi.unstubAllEnvs()
})

describe.each(['Asia/Seoul', 'UTC', 'America/Los_Angeles'])('기기의 시간대가 %s일 때', (timeZone) => {
  beforeEach(() => vi.stubEnv('TZ', timeZone))

  it.each([
    ['정확히 30일 남음', '2026-11-26T03:15:00.123Z', '삭제한 거래예요. 30일 뒤 영구 삭제돼요.'],
    ['30일 하고 1분 남음', '2026-11-26T03:14:00.123Z', '삭제한 거래예요. 31일 뒤 영구 삭제돼요.'],
    ['29일 23시간 59분 남음', '2026-11-26T03:16:00.123Z', '삭제한 거래예요. 30일 뒤 영구 삭제돼요.'],
    ['28일 남음(화면설계서의 예)', '2026-11-28T03:15:00.123Z', '삭제한 거래예요. 28일 뒤 영구 삭제돼요.'],
    ['하루 하고 1ms 남음', '2026-12-25T03:15:00.122Z', '삭제한 거래예요. 2일 뒤 영구 삭제돼요.'],
    ['정확히 하루 남음', '2026-12-25T03:15:00.123Z', '삭제한 거래예요. 1일 뒤 영구 삭제돼요.'],
    ['1분 남음', '2026-12-26T03:14:00.123Z', '삭제한 거래예요. 1일 뒤 영구 삭제돼요.'],
    ['1ms 남음', '2026-12-26T03:15:00.122Z', '삭제한 거래예요. 1일 뒤 영구 삭제돼요.'],
    ['0초 남음', '2026-12-26T03:15:00.123Z', '삭제한 거래예요. 곧 영구 삭제돼요.'],
    ['예정 시각이 지남', '2026-12-27T00:00:00.000Z', '삭제한 거래예요. 곧 영구 삭제돼요.'],
  ])('%s: "%s"', (_, now, expected) => {
    expect(purgeNoticeOf(purgeAt, at(now))).toBe(expected)
  })

  it('기기 시간대의 자정과 상관없이 시각 차이로 센다(한국 날짜가 바뀌는 15:00Z 앞뒤)', () => {
    expect(purgeNoticeOf(purgeAt, at('2026-12-24T14:59:59.000Z'))).toBe('삭제한 거래예요. 2일 뒤 영구 삭제돼요.')
    expect(purgeNoticeOf(purgeAt, at('2026-12-24T15:00:01.000Z'))).toBe('삭제한 거래예요. 2일 뒤 영구 삭제돼요.')
  })

  it('서머타임이 바뀌는 날(미국 11월 첫 일요일)을 지나도 하루는 24시간이다', () => {
    const purge = '2026-11-09T12:00:00.000Z'
    expect(purgeNoticeOf(purge, at('2026-10-31T12:00:00.000Z'))).toBe('삭제한 거래예요. 9일 뒤 영구 삭제돼요.')
  })
})
