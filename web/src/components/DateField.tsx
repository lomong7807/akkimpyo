import { useEffect, useId, useState, type Ref } from 'react'
import BottomSheet from './BottomSheet'
import Calendar from './Calendar'
import { formatDate, today } from './calendarDate'
import Field, { type FieldLabels } from './Field'
import FieldPanel from './FieldPanel'
import Icon from './Icon'
import styles from './DateField.module.css'

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
  const [opened, setOpened] = useState<{ button: HTMLButtonElement; focusVisible: boolean; wide: boolean }>()
  const close = () => setOpened(undefined)

  useEffect(() => {
    if (!opened) return
    const wide = wideScreen()
    wide.addEventListener('change', close)
    return () => wide.removeEventListener('change', close)
  }, [opened])

  function open(button: HTMLButtonElement) {
    setOpened({ button, focusVisible: button.matches(':focus-visible'), wide: wideScreen().matches })
    // Safari는 누른 버튼에 초점을 주지 않는다. 닫힐 때 이 칸으로 돌아오게 한다
    button.focus()
  }

  function select(date: string) {
    onChange(date)
    close()
  }

  const calendar = <Calendar value={value} focusVisible={opened?.focusVisible ?? false} onSelect={select} />
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
            aria-expanded={opened !== undefined}
            aria-disabled={readOnly || undefined}
            onClick={readOnly ? undefined : (event) => open(event.currentTarget)}
          >
            <span id={valueId} className="tabular-nums">
              {value && formatDate(value, today())}
            </span>
            <Icon name="CalendarBlank" size={20} />
          </button>
        )}
      </Field>
      <BottomSheet title={labels.label} open={opened?.wide === false} onClose={close}>
        {calendar}
      </BottomSheet>
      {opened?.wide && (
        <FieldPanel label={labels.label} anchor={opened.button} onClose={close}>
          {calendar}
        </FieldPanel>
      )}
    </>
  )
}

function wideScreen(): MediaQueryList {
  return window.matchMedia('(width >= 1024px)')
}
