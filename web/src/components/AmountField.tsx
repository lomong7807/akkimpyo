import {
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type ClipboardEvent,
  type CompositionEvent,
  type KeyboardEvent,
  type Ref,
} from 'react'
import { digitsOf, formatAmount, joinDigits, pastedDigits, positionAfterDigits } from '../lib/amountText'
import { Button } from './Button'
import Field, { type FieldLabels } from './Field'
import styles from './AmountField.module.css'

/** 최대 자릿수(P-201)를 넘는 입력을 막을 때의 문구 */
export const amountTooLarge = '9,999,999,999원까지 입력할 수 있어요'

interface AmountFieldProps extends FieldLabels {
  /** 부호를 뺀 금액(원). 비었으면 없다. */
  value: number | undefined
  onChange: (value: number | undefined) => void
  /** 음수도 쓰는 칸의 부호. 칸 왼쪽에 부호를 바꾸는 버튼을 둔다. */
  sign?: { negative: boolean; onChange: (negative: boolean) => void }
  /** 값과 부호를 바꿀 수 없다. 모양은 그대로다. */
  readOnly?: boolean
  /** 금액이 화면의 중심인 곳(D-04)은 값의 글자를 text-title로 키운다. "원"은 그대로다. */
  size?: 'body' | 'title'
  onBlur?: () => void
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void
  ref?: Ref<HTMLInputElement>
}

/** 금액 입력칸(화면설계서 00-common 5.3). 최소 금액과 비었을 때의 검사는 화면이 한다. */
export default function AmountField({
  value,
  onChange,
  sign,
  readOnly = false,
  size = 'body',
  onBlur,
  onKeyDown,
  ref,
  error,
  ...labels
}: AmountFieldProps) {
  const unitId = useId()
  // 한글을 조합하는 동안에는 쓰던 글자를 건드리지 않는다
  const [composed, setComposed] = useState<string>()
  // 최대 자릿수를 넘는 입력을 막았다
  const [refused, setRefused] = useState(false)
  const pressedToFocus = useRef(false)
  const negative = sign?.negative ?? false
  const text = formatAmount(value, negative)
  const shownError = refused ? amountTooLarge : error

  /** 커서가 숫자 `caret`개 뒤에 있게 그린다. 리액트가 그리면 커서가 끝으로 가므로 먼저 넣는다. */
  function show(input: HTMLInputElement, shownText: string, caret: number) {
    input.value = shownText
    const position = positionAfterDigits(shownText, caret)
    input.setSelectionRange(position, position)
  }

  function write(input: HTMLInputElement, before: string, after: string) {
    const written = joinDigits(before, after)
    if (!written) {
      const added = digitsOf(before + after).length - digitsOf(text).length
      show(input, text, Math.max(0, digitsOf(before).length - added))
      setRefused(true)
      return
    }
    show(input, formatAmount(written.value, negative), written.caret)
    if (written.value === value) return
    setRefused(false)
    onChange(written.value)
  }

  /** 칸의 글자를 읽어 값으로 바꾼다. `inserted`는 이번에 들어온 글자다. */
  function read(input: HTMLInputElement, inputType?: string, inserted?: string | null) {
    const caret = input.selectionStart ?? input.value.length
    let before = input.value.slice(0, caret)
    let after = input.value.slice(caret)
    if (inputType?.startsWith('insert') && inserted && digitsOf(inserted) === '') {
      // 고른 숫자가 있었어도 지우지 않는다
      show(input, text, digitsOf(before).length)
      return
    }
    // 쉼표만 지워졌으면 그 너머의 숫자를 지운다. 부호는 지울 수 없다
    if (digitsOf(input.value) === digitsOf(text) && input.value.includes('-') === negative) {
      if (inputType === 'deleteContentBackward') before = digitsOf(before).slice(0, -1)
      if (inputType === 'deleteContentForward') after = digitsOf(after).slice(1)
    }
    write(input, before, after)
  }

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const { inputType, data, isComposing } = event.nativeEvent as InputEvent
    if (isComposing) setComposed(event.target.value)
    else read(event.target, inputType, data)
  }

  function handleCompositionEnd(event: CompositionEvent<HTMLInputElement>) {
    setComposed(undefined)
    read(event.currentTarget, 'insertCompositionText', event.data)
  }

  function handlePaste(event: ClipboardEvent<HTMLInputElement>) {
    event.preventDefault()
    const pasted = pastedDigits(event.clipboardData.getData('text'))
    if (readOnly || pasted === '') return
    const input = event.currentTarget
    write(input, input.value.slice(0, input.selectionStart!) + pasted, input.value.slice(input.selectionEnd!))
  }

  function selectZero(input: HTMLInputElement) {
    if (value === 0) input.setSelectionRange(0, input.value.length)
  }

  return (
    <Field {...labels} error={shownError}>
      {(control, labelId) => (
        <div className={styles.row}>
          {sign && (
            <Button
              kind="square"
              aria-label="마이너스"
              aria-pressed={negative}
              onClick={readOnly ? undefined : () => sign.onChange(!negative)}
            >
              +/-
            </Button>
          )}
          <div className={styles.box}>
            <input
              {...control}
              ref={ref}
              type="text"
              inputMode="numeric"
              autoComplete="off"
              className={`${control.className} ${styles.input} ${size === 'title' ? styles.title : ''} tabular-nums`}
              aria-labelledby={`${labelId} ${unitId}`}
              aria-invalid={shownError ? true : undefined}
              value={composed ?? text}
              readOnly={readOnly}
              onChange={handleChange}
              onCompositionEnd={handleCompositionEnd}
              onPaste={handlePaste}
              onKeyDown={onKeyDown}
              // 눌러서 초점을 받으면 브라우저가 누른 자리에 커서를 놓으므로 다 누른 뒤에 고른다.
              // WebKit은 미리 고른 것 위에서 누르면 다 누른 뒤에 선택을 푼다
              onMouseDown={(event) => {
                pressedToFocus.current = document.activeElement !== event.currentTarget
              }}
              onFocus={(event) => {
                if (!pressedToFocus.current) selectZero(event.currentTarget)
              }}
              onClick={(event) => {
                if (pressedToFocus.current) selectZero(event.currentTarget)
                pressedToFocus.current = false
              }}
              onBlur={() => {
                pressedToFocus.current = false
                setRefused(false)
                onBlur?.()
              }}
            />
            <span id={unitId} className={styles.unit} aria-hidden="true">
              원
            </span>
          </div>
        </div>
      )}
    </Field>
  )
}
