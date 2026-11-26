import { describe, expect, it } from 'vitest'
import { unconfirmedUserOf, type Marks } from '../src/api/unconfirmedLogin'
import type { LoginRecord } from '../src/device/loginRecord'

/*
 * 연결 없이 앱을 열 때 '확인하지 못한 로그인'으로 열 수 있는 사용자(architect·security 결정 2026-11-26, #234).
 * 갱신이 '연결 없음과 같은 실패'일 때만 부른다. 여기서는 기록과 표시, 시각으로 보는 조건을 본다.
 * 조건 6(기록의 사용자와 여는 계정별 저장의 사용자)은 사본을 그 사용자의 키로만 읽는 것으로 지킨다(deviceStore.test.ts).
 */

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.parse('2026-11-26T12:00:00+09:00')

const record: LoginRecord = {
  userId: 'user-1',
  loggedInAt: NOW - 10 * DAY,
  confirmedAt: NOW - DAY,
  loginValue: 'login-a',
  logoutValue: 'logout-a',
}

const marks: Marks = { login: 'login-a', logout: 'logout-a', pendingLogout: false, shared: true }

describe('여섯 조건을 모두 만족하면 기록의 사용자로 연다', () => {
  it('기록의 사용자', () => {
    expect(unconfirmedUserOf(record, marks, NOW)).toBe('user-1')
  })

  it('이 브라우저에서 한 번도 로그아웃하지 않았으면 로그아웃 값이 둘 다 없어도 같은 것이다', () => {
    expect(unconfirmedUserOf({ ...record, logoutValue: null }, { ...marks, logout: undefined }, NOW)).toBe('user-1')
  })
})

describe('하나라도 어긋나면 열지 않는다', () => {
  it.each<[string, Partial<LoginRecord> | undefined, Partial<Marks>, number?]>([
    ['1. 그 뒤 이 브라우저에서 다른 로그인이 있었다(로그인 값이 다름)', {}, { login: 'login-b' }],
    ['1. 그 뒤 이 브라우저에서 로그아웃했다(로그아웃 값이 다름)', {}, { logout: 'logout-b' }],
    ['1. 기록에 로그인 값이 없다', { loginValue: null }, { login: undefined }],
    ['1. 지금 로그인 값이 없다', {}, { login: undefined }],
    ['2. 로그아웃 대기가 있다', {}, { pendingLogout: true }],
    ['3. 확인한 때부터 30일이 됐다', { confirmedAt: NOW - 30 * DAY }, {}],
    ['3. 로그인한 때부터 180일이 됐다', { loggedInAt: NOW - 180 * DAY }, {}],
    ['3. 확인한 시각이 지금보다 하루 넘게 뒤다', { confirmedAt: NOW + DAY + 1 }, {}],
    ['3. 로그인한 시각이 확인한 시각보다 뒤다', { loggedInAt: NOW - DAY + 1 }, {}],
    ['4. 탭이 표시를 나누지 못한다', {}, { shared: false }],
    ['5. 기록을 읽지 못했거나 없다', undefined, {}],
  ])('%s', (_, recordChange, marksChange) => {
    const changed = recordChange === undefined ? undefined : { ...record, ...recordChange }
    expect(unconfirmedUserOf(changed, { ...marks, ...marksChange }, NOW)).toBeUndefined()
  })
})

describe('기한의 경계(밀리초로 센다. 기기의 시간대와 상관없다)', () => {
  it.each([
    ['확인한 때부터 30일에서 1ms 모자람', { confirmedAt: NOW - 30 * DAY + 1, loggedInAt: NOW - 30 * DAY + 1 }, 'user-1'],
    ['확인한 때부터 정확히 30일', { confirmedAt: NOW - 30 * DAY, loggedInAt: NOW - 30 * DAY }, undefined],
    ['로그인한 때부터 180일에서 1ms 모자람', { loggedInAt: NOW - 180 * DAY + 1 }, 'user-1'],
    ['로그인한 때부터 정확히 180일', { loggedInAt: NOW - 180 * DAY }, undefined],
    ['확인한 시각이 지금보다 정확히 하루 뒤', { confirmedAt: NOW + DAY, loggedInAt: NOW }, 'user-1'],
    ['확인한 시각과 로그인한 시각이 같다', { confirmedAt: NOW, loggedInAt: NOW }, 'user-1'],
  ])('%s', (_, change, expected) => {
    expect(unconfirmedUserOf({ ...record, ...change }, marks, NOW)).toBe(expected)
  })
})
