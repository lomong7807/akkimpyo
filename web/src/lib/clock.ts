/*
 * 지금 시각과 기기의 시간대를 읽는 곳. 앱의 다른 코드는 Date.now()나 new Date()로 지금을 읽지 않고, Date의 지역 시각
 * (getHours, getDate 같은 것)도 쓰지 않는다. 기기의 오늘과 지금 시각은 여기서 읽은 지금을 기기의 시간대로 나눠 얻는다.
 * 테스트는 setClock으로 지금과 시간대를 정한다. 그래서 테스트를 돌리는 기기의 시간대(TZ)와 상관없이 결과가 같다(#225).
 */

export interface Clock {
  /** 지금 시각(밀리초) */
  now: () => number
  /** 기기의 시간대(IANA 이름). 없으면 기기가 쓰는 시간대다. */
  timeZone?: string
}

/** 기기의 시계와 시간대 */
export const deviceClock: Clock = { now: () => Date.now() }

let clock = deviceClock

/** 지금과 시간대를 읽을 시계를 바꾼다. 테스트가 쓴다. 인자가 없으면 기기의 시계로 돌아간다. */
export function setClock(next: Clock = deviceClock): void {
  clock = next
}

/** 지금 시각(밀리초) */
export function now(): number {
  return clock.now()
}

/** 기기의 시간대로 본 날짜와 시각 */
export interface WallTime {
  /** `YYYY-MM-DD` */
  date: string
  /** 24시간제 `HH:mm` */
  time: string
}

/**
 * 시간대가 없으면 Intl이 기기의 시간대를 쓴다. Date의 지역 시각과 같은 시간대다.
 * 읽을 때마다 만든다. 열어 둔 사이 기기의 시간대가 바뀌면 만들어 둔 것은 앞 시간대에 머문다.
 */
function formatIn(timeZone: string | undefined): Intl.DateTimeFormat {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  })
}

/** 지금을 기기의 시간대로 본 날짜와 시각 */
export function wallTimeNow(): WallTime {
  const parts = new Map(formatIn(clock.timeZone).formatToParts(clock.now()).map(({ type, value }) => [type, value]))
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.get(type) ?? ''
  return {
    date: `${part('year').padStart(4, '0')}-${part('month')}-${part('day')}`,
    time: `${part('hour')}:${part('minute')}`,
  }
}
