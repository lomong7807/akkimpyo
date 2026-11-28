import { useId, type ReactNode, type Ref } from 'react'
import Field, { type FieldLabels } from './Field'
import FieldPopup from './FieldPopup'
import Icon from './Icon'
import { CaretDown } from './icons'
import { useFieldPopup } from './useFieldPopup'
import styles from './FieldButton.module.css'

interface PickerFieldProps extends FieldLabels {
  /** 칸에 보이는 지금 값. 고르지 않았으면 빈 글자 */
  valueText: string
  /** 눌러도 열리지 않는다. */
  readOnly?: boolean
  ref?: Ref<HTMLButtonElement>
  /** 판 안의 내용. 열 때마다 새로 그린다. 고르면 `close`를 부른다. */
  children: (popup: { close: () => void; focusVisible: boolean }) => ReactNode
}

/**
 * 고르는 칸(화면설계서 00-common 5.2): 입력칸 모양에 오른쪽 CaretDown. 누르면 휴대폰 배치는 고르기 시트,
 * 넓은 화면은 칸 아래 펼친 판을 연다(5.4). 스페이스와 엔터로도 연다.
 */
export default function PickerField({ valueText, readOnly = false, ref, children, ...labels }: PickerFieldProps) {
  const valueId = useId()
  const popup = useFieldPopup()
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
            aria-disabled={readOnly || undefined}
            onClick={readOnly ? undefined : (event) => popup.openFrom(event.currentTarget)}
            onKeyDown={popup.ignoreHeldKey}
          >
            <span id={valueId} className={styles.value}>
              {valueText}
            </span>
            <Icon icon={CaretDown} size={20} />
          </button>
        )}
      </Field>
      <FieldPopup popup={popup} title={labels.label} kind="list">
        {children({ close: popup.close, focusVisible: popup.opened?.focusVisible ?? false })}
      </FieldPopup>
    </>
  )
}
