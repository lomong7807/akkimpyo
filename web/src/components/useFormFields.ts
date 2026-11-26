import { useRef, useState, type ChangeEvent } from 'react'

/** 칸마다 오류 문구. 맞는 칸은 없다. */
export type FieldErrors<Field extends PropertyKey> = Partial<Record<Field, string>>

interface FormFieldsOptions<Values> {
  /** 오류를 보이는 칸. 화면 위쪽부터 놓인 순서 */
  fields: (keyof Values)[]
  initialValues: Values
  validate: (values: Values) => FieldErrors<keyof Values>
}

/** 글자를 쓰는 칸 */
type TextField<Values> = { [Field in keyof Values]: Values[Field] extends string ? Field : never }[keyof Values]

/** 입력칸의 값과 오류 문구. 검사하는 때와 초점의 규칙은 화면설계서 00-common 4.4다. */
export function useFormFields<Values extends object>({ fields, initialValues, validate }: FormFieldsOptions<Values>) {
  type Field = keyof Values
  const [initial] = useState(initialValues)
  const [values, setValues] = useState(initial)
  /** 칸을 벗어나거나 제출해 오류 문구를 보이고 있는 칸 */
  const [shown, setShown] = useState<Set<Field>>(new Set())
  /** 서버가 거부한 칸의 문구 */
  const [rejected, setRejected] = useState<FieldErrors<Field>>({})
  const elements = useRef<Partial<Record<Field, HTMLElement | null>>>({})
  const errors = validate(values)

  /**
   * 함께 바뀌는 칸은 한 번에 바꾼다. `check`에 적은 칸은 바꾼 값으로 바로 검사해 오류를 보인다(고르면 칸을 벗어나지 않는
   * 고르는 칸 등).
   */
  function change(changes: Partial<Values>, { check = [] }: { check?: Field[] } = {}) {
    const changed = { ...values, ...changes }
    const remaining = validate(changed)
    setValues(changed)
    // 맞게 고치면 바로 지운다. 다시 틀려도 칸을 벗어나기 전에는 띄우지 않는다.
    setShown((current) => new Set([...current, ...check].filter((name) => remaining[name])))
    setRejected((current) => {
      const kept = { ...current }
      for (const field of Object.keys(changes) as Field[]) delete kept[field]
      return kept
    })
  }

  /** 칸을 벗어났을 때의 검사 */
  function check(field: Field) {
    if (errors[field]) setShown((current) => new Set(current).add(field))
  }

  /** 제출할 때의 검사. 오류가 있으면 위에서부터 첫 오류 칸으로 초점을 옮긴다. 모두 맞으면 true다. */
  function checkAll(): boolean {
    setRejected({})
    setShown(new Set(fields.filter((field) => errors[field])))
    return !focusFirst(errors)
  }

  /** 서버가 거부한 칸에 문구를 보이고 위에서부터 첫 칸으로 초점을 옮긴다. 문구는 그 칸을 고치면 사라진다. */
  function reject(messages: FieldErrors<Field>) {
    setRejected(messages)
    focusFirst(messages)
  }

  function focusFirst(messages: FieldErrors<Field>): boolean {
    const first = fields.find((field) => messages[field])
    if (first === undefined) return false
    const element = elements.current[first]
    element?.focus()
    // 이미 초점이 있는 칸이면 focus()는 스크롤하지 않는다
    element?.scrollIntoView({ block: 'nearest' })
    return true
  }

  /** 칸에 넘기는 것. 바뀐 값은 화면이 `change`로 알린다. */
  function control<Name extends Field>(field: Name) {
    return {
      ref: (element: HTMLElement | null) => {
        elements.current[field] = element
      },
      value: values[field],
      error: (shown.has(field) && errors[field]) || rejected[field],
    }
  }

  /** 글자를 쓰는 칸에 넘기는 것 */
  function fieldProps<Name extends TextField<Values>>(field: Name) {
    return {
      ...control(field),
      onChange: (event: ChangeEvent<HTMLInputElement>) =>
        change({ [field]: event.target.value } as unknown as Partial<Values>),
      onBlur: () => check(field),
    }
  }

  /** 연 뒤에 바꾼 값이 있다. 되돌린 값은 바꾸지 않은 것이다. */
  const changed = (Object.keys(initial) as Field[]).some((field) => values[field] !== initial[field])

  return { values, changed, change, control, fieldProps, check, checkAll, reject }
}
