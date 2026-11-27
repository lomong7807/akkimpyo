import type { LoginRecord } from '../device/loginRecord'

/*
 * 연결 없이 앱을 열 때 '확인하지 못한 로그인'으로 열 수 있는지(architect·security 결정 2026-11-26, #102, #234).
 * 앱을 열 때 갱신이 '연결 없음과 같은 실패'일 때만 본다. 하나라도 어긋나면 지금처럼 '확인하지 못함'이고 어떤 사본도 보이지 않는다.
 * 조건 6(기록의 userId와 여는 계정별 저장의 사용자가 같다)은 사본을 기록의 사용자 키로만 읽는 것으로 지킨다(device/copies).
 */

const DAY_MS = 24 * 60 * 60 * 1000

/** 확인한 때부터 이 시간 안이어야 한다(ADR 001 결정 3의 기한) */
export const CONFIRMED_WITHIN_MS = 30 * DAY_MS
/** 로그인한 때부터 이 시간 안이어야 한다(ADR 001 결정 3의 절대 만료) */
export const LOGGED_IN_WITHIN_MS = 180 * DAY_MS
/** 확인한 시각이 지금보다 이만큼 넘게 뒤면 믿지 않는다(security Q3). 시계를 조금 고친 것은 받아들인다 */
const CLOCK_AHEAD_MS = DAY_MS

/** 지금 이 탭이 보는 sessionMarks */
export interface Marks {
  login: string | undefined
  logout: string | undefined
  pendingLogout: boolean
  /** 다른 탭과 표시를 나누고 있다(marksShared) */
  shared: boolean
}

/**
 * 열 수 있으면 그 사용자. 조건(번호는 결정 댓글의 순서):
 * 1. 지금 loginValue·logoutValue가 기록과 같다. 기록에 로그인 값이 없으면 어긋난 것이다(security Q3)
 * 2. 로그아웃 대기가 없다
 * 3. 확인한 때부터 30일, 로그인한 때부터 180일 안이다. 확인한 시각이 지금보다 하루 넘게 뒤이거나 로그인한 시각이 확인한
 *    시각보다 뒤이면 어긋난 것이다(security Q3). 기기 시계를 뒤로 돌린 것은 받아들인 위험이다
 * 4. 탭이 표시를 나누고 있다
 * 5. 기록을 읽을 수 있다(없거나 모양이 틀리면 undefined로 온다)
 */
export function unconfirmedUserOf(record: LoginRecord | undefined, marks: Marks, now: number): string | undefined {
  if (!record) return undefined
  if (record.loginValue === null || marks.login !== record.loginValue) return undefined
  if ((marks.logout ?? null) !== record.logoutValue) return undefined
  if (marks.pendingLogout || !marks.shared) return undefined
  if (record.loggedInAt > record.confirmedAt || record.confirmedAt - now > CLOCK_AHEAD_MS) return undefined
  if (now - record.confirmedAt >= CONFIRMED_WITHIN_MS || now - record.loggedInAt >= LOGGED_IN_WITHIN_MS) return undefined
  return record.userId
}
