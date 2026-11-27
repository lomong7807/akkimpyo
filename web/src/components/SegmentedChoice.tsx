import type { KeyboardEvent, Ref } from 'react'
import styles from './SegmentedChoice.module.css'

// 모양은 화면에서 덮어쓰지 않는다
interface SegmentedChoiceProps<T extends string> {
  /** 무엇을 고르는지. 화면 낭독기가 읽는 이름 */
  label: string
  /** 칸. 적은 순서대로 같은 폭으로 놓인다 */
  options: readonly { value: T; label: string }[]
  value: T
  /** 다른 칸을 고르면 부른다. */
  onChange: (value: T) => void
  /** 바꿀 수 없다. 모양은 그대로다. */
  readOnly?: boolean
  'aria-describedby'?: string
  /** 고른 칸 */
  ref?: Ref<HTMLButtonElement>
}

/** 화살표 키가 옮기는 칸 수 */
const steps = new Map([
  ['ArrowRight', 1],
  ['ArrowDown', 1],
  ['ArrowLeft', -1],
  ['ArrowUp', -1],
])

/** 유형 고르기(components.md 4절). 두세 칸 가운데 하나를 고르는 상자 */
export default function SegmentedChoice<T extends string>({
  label,
  options,
  value,
  onChange,
  readOnly = false,
  'aria-describedby': describedBy,
  ref,
}: SegmentedChoiceProps<T>) {
  function choose(next: T) {
    if (next !== value && !readOnly) onChange(next)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step = steps.get(event.key)
    const withModifier = event.metaKey || event.ctrlKey || event.shiftKey || event.altKey
    if (step === undefined || withModifier || readOnly) return
    event.preventDefault()
    const current = options.findIndex((option) => option.value === value)
    const next = (current + step + options.length) % options.length
    event.currentTarget.querySelectorAll('button')[next].focus()
    choose(options[next].value)
  }

  return (
    <div
      role="radiogroup"
      aria-label={label}
      aria-describedby={describedBy}
      aria-readonly={readOnly || undefined}
      className={styles.box}
      onKeyDown={handleKeyDown}
    >
      {options.map((option) => {
        const checked = option.value === value
        return (
          <button
            key={option.value}
            ref={checked ? ref : undefined}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked ? 0 : -1}
            className={styles.option}
            onClick={() => choose(option.value)}
          >
            {option.label}
          </button>
        )
      })}
    </div>
  )
}

/** 유형 고르기를 그리기 전의 자리(#251). 같은 높이를 보이지 않게 비워 두어 고르기가 나타날 때 아래 내용이 밀리지 않는다. */
export function SegmentedChoiceSpace() {
  return <div aria-hidden="true" className={`${styles.box} ${styles.space}`} />
}
