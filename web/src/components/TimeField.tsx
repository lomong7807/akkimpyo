import { useRef, useState, type ChangeEvent, type CompositionEvent, type Ref } from 'react'
import { formatTimeText, positionAfterTimeDigits } from '../lib/timeInput'
import { Button } from './Button'
import type { FieldLabels } from './Field'
import { InputField } from './TextField'

interface TimeFieldProps extends FieldLabels {
  /** 칸의 글자. 비었으면 시각이 없다. 형식 검사는 화면이 한다. */
  value: string
  onChange: (value: string) => void
  onBlur?: () => void
  /** 값을 바꿀 수 없다. 모양은 그대로다. */
  readOnly?: boolean
  ref?: Ref<HTMLInputElement>
}

/**
 * 시각 칸(화면설계서 00-common 5.8). 숫자 키패드로 네 자리를 치면 가운데에 쌍점이 들어간다("14:30").
 * 값이 있으면 칸 안 오른쪽에 "지우기"가 있고, 비면 흐린 글자 "시각 없음"이 보인다.
 */
export default function TimeField({ value, onChange, onBlur, readOnly = false, ref, ...labels }: TimeFieldProps) {
  const input = useRef<HTMLInputElement>(null)
  // 한글을 조합하는 동안에는 쓰던 글자를 건드리지 않는다
  const [composed, setComposed] = useState<string>()

  function setInput(element: HTMLInputElement | null) {
    input.current = element
    if (typeof ref === 'function') ref(element)
    else if (ref) ref.current = element
  }

  /** 칸의 글자를 읽어 맞춘다. 리액트가 그리면 커서가 끝으로 가므로 먼저 넣는다. */
  function read(element: HTMLInputElement, inputType?: string) {
    const caret = element.selectionStart ?? element.value.length
    let before = element.value.slice(0, caret)
    const after = element.value.slice(caret)
    // 뒤에 숫자가 있는 쌍점만 지웠으면 그 앞의 숫자를 지운다. 그대로 두면 쌍점이 다시 들어와 지울 수 없다
    const colonRemoved = value.includes(':') && element.value === value.replace(':', '')
    if (inputType === 'deleteContentBackward' && colonRemoved && /[0-9]/.test(after)) {
      before = before.slice(0, -1)
    }
    const shown = formatTimeText(before + after)
    const position = positionAfterTimeDigits(shown, before.replace(/[^0-9]/g, '').length, before.endsWith(':'))
    element.value = shown
    element.setSelectionRange(position, position)
    if (shown !== value) onChange(shown)
  }

  function handleChange(event: ChangeEvent<HTMLInputElement>) {
    const { inputType, isComposing } = event.nativeEvent as InputEvent
    if (isComposing) setComposed(event.target.value)
    else read(event.target, inputType)
  }

  function handleCompositionEnd(event: CompositionEvent<HTMLInputElement>) {
    setComposed(undefined)
    read(event.currentTarget)
  }

  function clear() {
    onChange('')
    // 누른 "지우기"가 사라지므로 초점을 칸에 둔다
    input.current?.focus()
  }

  return (
    <InputField
      {...labels}
      ref={setInput}
      type="text"
      inputMode="numeric"
      autoComplete="off"
      placeholder="시각 없음"
      value={composed ?? value}
      readOnly={readOnly}
      onChange={handleChange}
      onCompositionEnd={handleCompositionEnd}
      onBlur={onBlur}
      action={
        value !== '' ? (
          <Button kind="text" onClick={readOnly ? undefined : clear}>
            지우기
          </Button>
        ) : undefined
      }
    />
  )
}
