import { useRef } from 'react'
import { moveMonth } from '../lib/calendarDate'
import { Button } from './Button'
import { CaretLeft, CaretRight } from './icons'
import styles from './MonthNavigation.module.css'

interface MonthNavigationProps {
  /** 보이는 달 `YYYY-MM` */
  month: string
  /** 화면에 쓰는 달 이름(00-common 3.2) */
  label: string
  /** 고를 수 있는 처음과 끝 달 */
  first: string
  last: string
  /** 옆 달로 옮긴다. `months`는 -1이나 1이다. */
  onMove: (months: -1 | 1) => void
  /** 달 이름의 제목 단계. 탭 첫 화면이면 화면 제목(h1), 상단 바에 화면 이름이 있는 하위 화면(달력 D-02)이면 2다. 모양은 같다. */
  headingLevel?: 1 | 2
  /** 달 이름의 id. 달 이름으로 이름을 붙이는 곳(달력의 표)이 쓴다. */
  headingId?: string
}

/**
 * 달 이동(화면설계서 00-common 5.9). 가운데 달 이름은 탭 첫 화면의 제목(h1)이고 바뀌면 화면 읽기에 알린다.
 * 범위 끝에서는 그 방향 버튼을 자리는 남긴 채 숨긴다.
 */
export default function MonthNavigation({
  month,
  label,
  first,
  last,
  onMove,
  headingLevel = 1,
  headingId,
}: MonthNavigationProps) {
  const Heading = `h${headingLevel}` as const
  const previous = useRef<HTMLButtonElement>(null)
  const next = useRef<HTMLButtonElement>(null)

  function move(months: -1 | 1) {
    // 끝에 닿으면 누른 버튼이 사라지므로 초점을 반대쪽 버튼으로 먼저 옮긴다
    const reachesEnd = months < 0 ? moveMonth(month, -1) === first : moveMonth(month, 1) === last
    if (reachesEnd) (months < 0 ? next : previous).current?.focus()
    onMove(months)
  }

  return (
    <div className={styles.navigation}>
      <span>
        {month > first && <Button ref={previous} kind="icon" icon={CaretLeft} aria-label="이전 달" onClick={() => move(-1)} />}
      </span>
      {/* 초점을 받을 수 있게 둔다. 넓은 화면 내역에서 오른쪽 칸의 거래를 지웠는데 남은 줄이 없으면 여기로 옮긴다(D-01 (13)) */}
      <Heading id={headingId} tabIndex={-1} className={`${styles.month} tabular-nums`} aria-live="polite">
        {label}
      </Heading>
      <span>
        {month < last && <Button ref={next} kind="icon" icon={CaretRight} aria-label="다음 달" onClick={() => move(1)} />}
      </span>
    </div>
  )
}
