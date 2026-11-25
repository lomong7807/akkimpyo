import type { KeyboardEvent } from 'react'
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
}: SegmentedChoiceProps<T>) {
  function choose(next: T) {
    if (next !== value) onChange(next)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step = steps.get(event.key)
    const withModifier = event.metaKey || event.ctrlKey || event.shiftKey || event.altKey
    if (step === undefined || withModifier) return
    event.preventDefault()
    const current = options.findIndex((option) => option.value === value)
    const next = (current + step + options.length) % options.length
    event.currentTarget.querySelectorAll('button')[next].focus()
    choose(options[next].value)
  }

  return (
    <div role="radiogroup" aria-label={label} className={styles.box} onKeyDown={handleKeyDown}>
      {options.map((option) => {
        const checked = option.value === value
        return (
          <button
            key={option.value}
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
