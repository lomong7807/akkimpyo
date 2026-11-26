import { useEffect, useId, useRef, useState, type KeyboardEvent, type MouseEvent } from 'react'
import { flushSync } from 'react-dom'
import {
  addDays,
  addMonths,
  clampDate,
  endOfWeek,
  formatMonth,
  fullDate,
  monthOf,
  selectableRange,
  startOfWeek,
  today,
  WEEKDAYS,
  weeksOf,
} from '../lib/calendarDate'
import { Button } from './Button'
import styles from './Calendar.module.css'

const moves: Partial<Record<string, (date: string) => string>> = {
  ArrowLeft: (date) => addDays(date, -1),
  ArrowRight: (date) => addDays(date, 1),
  ArrowUp: (date) => addDays(date, -7),
  ArrowDown: (date) => addDays(date, 7),
  PageUp: (date) => addMonths(date, -1),
  PageDown: (date) => addMonths(date, 1),
  Home: startOfWeek,
  End: endOfWeek,
}

interface CalendarProps {
  /** 고른 날. 없으면 빈 글자 */
  value: string
  /** 열 때 초점 테두리를 보이는지. 브라우저에 따라 눌러서 열어도 보이므로 연 칸이 알려 준다. */
  focusVisible: boolean
  onSelect: (date: string) => void
}

/** 한 달 달력. 열리는 시트나 판 안에 열 때마다 새로 그린다. 그때의 오늘을 쓰고, 초점이 고른 날(없으면 오늘)로 간다. */
export default function Calendar({ value, focusVisible, onSelect }: CalendarProps) {
  const [openedOn] = useState(today)
  const range = selectableRange(openedOn)
  const isSelectable = (date: string) => clampDate(date, range) === date
  // Tab으로 들어가는 날짜. 보이는 달은 이 날짜가 속한 달이다
  const [active, setActive] = useState(() => (value !== '' && isSelectable(value) ? value : openedOn))
  const activeCell = useRef<HTMLTableCellElement>(null)
  const monthId = useId()
  const month = monthOf(active)

  const [openingFocus] = useState<FocusOptions>({ focusVisible })
  // 시트와 판은 layout effect에서 열린다. 열린 뒤에 초점을 옮긴다
  useEffect(() => activeCell.current?.focus(openingFocus), [openingFocus])

  function moveTo(date: string) {
    flushSync(() => setActive(clampDate(date, range)))
  }

  function changeMonth(event: MouseEvent, months: number) {
    const button = event.currentTarget
    moveTo(addMonths(active, months))
    // 범위 끝에 닿아 누른 버튼이 사라지면 초점을 잃지 않게 옮긴다
    if (!button.isConnected) activeCell.current?.focus()
  }

  function handleKeyDown(event: KeyboardEvent) {
    if (event.altKey || event.ctrlKey || event.metaKey) return
    const move = moves[event.key]
    if (move) {
      event.preventDefault()
      moveTo(move(active))
      activeCell.current?.focus()
    } else if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault()
      // 칸을 연 키를 누르고 있으면 되풀이해서 들어온다
      if (!event.repeat && isSelectable(active)) onSelect(active)
    }
  }

  function dayCell(date: string) {
    const selectable = isSelectable(date)
    return (
      <td
        key={date}
        role="gridcell"
        ref={date === active ? activeCell : undefined}
        className={styles.day}
        tabIndex={date === active ? 0 : selectable ? -1 : undefined}
        aria-label={fullDate(date)}
        aria-selected={date === value || undefined}
        aria-current={date === openedOn ? 'date' : undefined}
        aria-disabled={!selectable || undefined}
        onClick={selectable ? () => onSelect(date) : undefined}
      >
        <span className={`${styles.mark} tabular-nums`}>{Number(date.slice(-2))}</span>
      </td>
    )
  }

  return (
    <div className={styles.calendar}>
      <div className={styles.monthBar}>
        <span>
          {month > monthOf(range.first) && (
            <Button kind="icon" icon="CaretLeft" aria-label="이전 달" onClick={(event) => changeMonth(event, -1)} />
          )}
        </span>
        <p id={monthId} className={`${styles.month} tabular-nums`} aria-live="polite">
          {formatMonth(month, openedOn)}
        </p>
        <span>
          {month < monthOf(range.last) && (
            <Button kind="icon" icon="CaretRight" aria-label="다음 달" onClick={(event) => changeMonth(event, 1)} />
          )}
        </span>
      </div>
      <table role="grid" aria-labelledby={monthId} className={styles.grid} onKeyDown={handleKeyDown}>
        <thead>
          <tr>
            {WEEKDAYS.map((weekday) => (
              <th key={weekday} scope="col" className={styles.weekday} aria-label={`${weekday}요일`}>
                {weekday}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {weeksOf(month).map((week, weekIndex) => (
            <tr key={weekIndex}>
              {week.map((date, weekday) => (date ? dayCell(date) : <td key={weekday} className={styles.blank} />))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className={styles.today}>
        <Button kind="text" onClick={() => onSelect(today())}>
          오늘
        </Button>
      </div>
    </div>
  )
}
