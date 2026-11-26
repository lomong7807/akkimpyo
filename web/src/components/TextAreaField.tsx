import { useLayoutEffect, useRef, type ChangeEvent, type Ref } from 'react'
import Field, { type FieldLabels } from './Field'
import styles from './TextAreaField.module.css'

interface TextAreaFieldProps extends FieldLabels {
  value: string
  onChange: (event: ChangeEvent<HTMLTextAreaElement>) => void
  onBlur?: () => void
  /** 글자 수 제한이 있는 칸의 지금 글자 수와 최대. 세는 법은 칸마다 다르므로 화면이 센다. */
  count?: { current: number; max: number }
  /** 값을 바꿀 수 없다. 모양은 그대로다. */
  readOnly?: boolean
  ref?: Ref<HTMLTextAreaElement>
}

/**
 * 여러 줄 입력칸. 엔터는 줄바꿈이다. 세 줄 높이로 시작해 글이 늘면 여덟 줄까지 커지고, 그 뒤에는 칸 안에서 스크롤한다.
 * 글자 수 제한을 넘는 입력은 막지 않고 화면이 오류로 알린다(화면설계서 00-common 4.4).
 */
export default function TextAreaField({ value, onChange, onBlur, count, readOnly, ref, ...labels }: TextAreaFieldProps) {
  const area = useRef<HTMLTextAreaElement>(null)

  // 글의 높이는 쓸 때마다 달라 CSS에 적어 둘 수 없다. 높이를 풀어 잰 뒤 테두리까지 더해 넘긴다
  useLayoutEffect(() => {
    const element = area.current!
    function fit() {
      element.style.setProperty('--content-height', 'auto')
      const borders = element.offsetHeight - element.clientHeight
      element.style.setProperty('--content-height', `${element.scrollHeight + borders}px`)
    }
    fit()
    window.addEventListener('resize', fit)
    return () => window.removeEventListener('resize', fit)
  }, [value])

  function setArea(element: HTMLTextAreaElement | null) {
    area.current = element
    if (typeof ref === 'function') ref(element)
    else if (ref) ref.current = element
  }

  return (
    <Field {...labels} count={count}>
      {(control) => (
        <textarea
          {...control}
          ref={setArea}
          className={`${control.className} ${styles.area}`}
          aria-invalid={labels.error ? true : undefined}
          value={value}
          readOnly={readOnly}
          onChange={onChange}
          onBlur={onBlur}
        />
      )}
    </Field>
  )
}
