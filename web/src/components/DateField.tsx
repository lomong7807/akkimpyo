import { useId, type Ref } from 'react'
import { formatDate, today } from '../lib/calendarDate'
import Calendar from './Calendar'
import Field, { type FieldLabels } from './Field'
import FieldPopup from './FieldPopup'
import Icon from './Icon'
import { useFieldPopup } from './useFieldPopup'
import styles from './FieldButton.module.css'

interface DateFieldProps extends FieldLabels {
  /** 고른 날짜(`YYYY-MM-DD`). 고르지 않았으면 빈 글자 */
  value: string
  onChange: (date: string) => void
  /** 눌러도 열리지 않는다. */
  readOnly?: boolean
  ref?: Ref<HTMLButtonElement>
}

/** 날짜 칸(화면설계서 00-common 5.8). 휴대폰 배치는 바닥 시트, 넓은 화면은 칸 아래 판에 달력을 연다. */
export default function DateField({ value, onChange, readOnly = false, ref, ...labels }: DateFieldProps) {
  const valueId = useId()
  const popup = useFieldPopup()

  function select(date: string) {
    onChange(date)
    popup.close()
  }

  return (
    <>
      <Field {...labels}>
        {(control, labelId) => (
          <button
            {...control}
            ref={ref}
            type="button"
            className={`${control.className} ${styles.button}`}
            aria-labelledby={`${labelId} ${valueId}`}
            aria-haspopup="dialog"
            aria-expanded={popup.open}
            aria-invalid={labels.error ? true : undefined}
            aria-disabled={readOnly || undefined}
            onClick={readOnly ? undefined : (event) => popup.openFrom(event.currentTarget)}
            onKeyDown={popup.ignoreHeldKey}
          >
            <span id={valueId} className="tabular-nums">
              {value && formatDate(value, today())}
            </span>
            <Icon name="CalendarBlank" size={20} />
          </button>
        )}
      </Field>
      <FieldPopup popup={popup} title={labels.label} kind="calendar">
        <Calendar value={value} focusVisible={popup.opened?.focusVisible ?? false} onSelect={select} />
      </FieldPopup>
    </>
  )
}
