import { useState } from 'react'
import { useSearchParams } from 'react-router'
import { MonthNavigationSpace } from '../../components/MonthNavigation'
import Skeleton, { LoadingStatus, SkeletonBar } from '../../components/Skeleton'
import { useLoadingMessage } from '../../components/useLoadingMessage'
import { isSelectableMonth, monthOf, monthWeeks, selectableMonths, today, WEEKDAYS } from '../../lib/calendarDate'
import { useListMemory } from './listMemory'
import { DayHeadSkeleton, RowsSkeleton } from './TransactionListSkeleton'
import styles from './CalendarPage.module.css'

/**
 * 달력(D-02)의 코드를 받는 동안의 틀(#251). 화면과 같은 배치와 CSS로 달 이동 자리, 그 달의 날짜 숫자, 금액 자리의 뼈대,
 * 고른 날의 머리와 거래 줄 3개 모양의 뼈대를 둔다. 달은 화면이 열 달과 같게 정한다(주소의 달, 없으면 기억한 달이나 이번 달).
 * 첫 화면 묶음에 들어가므로 화면 코드(CalendarPage)를 불러오지 않는다.
 */
export default function CalendarSkeleton() {
  const memory = useListMemory()
  const [searchParams] = useSearchParams()
  const [openedOn] = useState(today)
  const range = selectableMonths(openedOn)
  const requested = searchParams.get('month')
  const remembered = memory.month() ?? null
  const month = isSelectableMonth(requested, range)
    ? requested
    : isSelectableMonth(remembered, range)
      ? remembered
      : monthOf(openedOn)
  const message = useLoadingMessage()

  return (
    <div className={styles.columns}>
      <div className={styles.monthColumn}>
        <div className={styles.monthNavigation}>
          <MonthNavigationSpace />
        </div>
        <LoadingStatus message={message} />
        <table aria-hidden="true" className={styles.grid}>
          <thead>
            <tr>
              {WEEKDAYS.map((weekday) => (
                <th key={weekday} className={styles.weekday}>
                  {weekday}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {monthWeeks(month).map((week, weekIndex) => (
              <tr key={weekIndex}>
                {week.map((date, weekday) =>
                  date ? (
                    <td key={date} className={styles.day}>
                      <span className={`${styles.number} tabular-nums`}>{Number(date.slice(-2))}</span>
                      <span className={styles.figures}>
                        {message && (
                          <span className={styles.figureSkeleton}>
                            <SkeletonBar kind="name" text="label" />
                          </span>
                        )}
                      </span>
                    </td>
                  ) : (
                    <td key={weekday} className={styles.blank} />
                  ),
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className={styles.dayColumn}>
        <Skeleton>
          <DayHeadSkeleton />
          <RowsSkeleton count={3} />
        </Skeleton>
      </div>
    </div>
  )
}
