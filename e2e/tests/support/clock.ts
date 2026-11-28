import type { Page } from '@playwright/test'

/*
 * 브라우저 시계. "이번 달"이 걸리는 기대값(홈의 이번 달 합계, 내역의 달)이 실행하는 때에 따라 흔들리지 않게 고정한다
 * (test-strategy.md 4절). 서버의 시계는 고정하지 않는다(실제 시계, 장부 시간대 Asia/Seoul).
 *
 * 고정하는 시각: 실행을 시작한 때의 서울 날짜의 12:00(서울).
 * - 브라우저의 오늘(계좌 기준일, 거래 날짜의 처음 값, 이번 달)을 서버의 오늘과 같은 날로 둔다. 실행 도중 서울 자정이나 월말을
 *   넘으면 서버의 오늘만 하루 뒤로 가고 브라우저의 오늘은 그대로다. 그래서 늘 2000-01-01 ≤ 고정한 날 ≤ 서버의 오늘
 *   ≤ 서버의 오늘+1년이라 서버의 날짜 범위 검사(P-202)를 지나고, 장부 전체 목록(홈의 최근 거래, 서버의 오늘까지)에도 든다.
 *   서버는 같은 컴퓨터에서 뜬다(playwright.config.ts의 webServer).
 * - 달의 중간(예: 15일)으로 옮기지 않는다. 실행한 날이 15일보다 앞이면 거래가 서버의 오늘보다 뒤라 홈의 최근 거래에 없다.
 *   고정했으므로 월말에 돌려도 브라우저의 달은 바뀌지 않는다.
 * - 12:00은 거래 입력의 시각 칸 처음 값(지금 시각, D-04)을 "12:00"으로 정하려는 것이다.
 *
 * setFixedTime은 Date만 고정하고 타이머는 그대로 흐른다(토스트가 사라지는 시간, 뼈대를 보이기 전의 300ms).
 */

/** 장부 시간대(CLAUDE.md, playwright.config.ts의 timezoneId) */
const LEDGER_ZONE = 'Asia/Seoul'

/** 서울은 일광 절약 시간이 없어 늘 +09:00이다 */
const LEDGER_OFFSET = '+09:00'

const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토']

/** 브라우저 시계를 고정한 날과, 그날을 화면에 보이는 글자(화면설계서 02 0.3, 00-common 3.2) */
export interface FixedDay {
  /** 그달 `YYYY-MM` */
  month: string
  /** 그달의 이름. 올해이므로 "11월" */
  monthName: string
  /** 날짜 묶음 머리의 날짜 "11월 27일 (금)" */
  dayName: string
  /** 지난달 `YYYY-MM` */
  previousMonth: string
  /** 지난달의 이름. 1월이면 지난해라 "2025년 12월"이다 */
  previousMonthName: string
}

/** 브라우저 시계를 고정한다. 페이지를 열기 전에 부른다 */
export async function fixBrowserClock(page: Page): Promise<FixedDay> {
  const date = ledgerToday()
  await page.clock.setFixedTime(new Date(`${date}T12:00:00${LEDGER_OFFSET}`))
  return fixedDayOf(date)
}

/** 지금의 서울 날짜 `YYYY-MM-DD`. 실행하는 컴퓨터의 시간대(CI는 UTC)와 상관없다 */
function ledgerToday(): string {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: LEDGER_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date())
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((each) => each.type === type)!.value
  return `${part('year')}-${part('month')}-${part('day')}`
}

function fixedDayOf(date: string): FixedDay {
  const [year, month, day] = date.split('-').map(Number)
  const weekday = WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()]
  const [previousYear, previousMonth] = month === 1 ? [year - 1, 12] : [year, month - 1]
  return {
    month: date.slice(0, 7),
    monthName: `${month}월`,
    dayName: `${month}월 ${day}일 (${weekday})`,
    previousMonth: `${previousYear}-${String(previousMonth).padStart(2, '0')}`,
    previousMonthName: previousYear === year ? `${previousMonth}월` : `${previousYear}년 ${previousMonth}월`,
  }
}
