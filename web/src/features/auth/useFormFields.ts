import { useRef, useState, type ChangeEvent } from 'react'

/** 칸마다 오류 문구. 맞는 칸은 없다. */
export type FieldErrors<Field extends string> = Partial<Record<Field, string>>

interface FormFieldsOptions<Field extends string> {
  /** 화면 위쪽부터 놓인 순서 */
  fields: Field[]
  initialValues: Record<Field, string>
  validate: (values: Record<Field, string>) => FieldErrors<Field>
}

/** 입력칸의 값과 오류 문구. 검사하는 때와 초점의 규칙은 화면설계서 00-common 4.4다. */
export function useFormFields<Field extends string>({ fields, initialValues, validate }: FormFieldsOptions<Field>) {
  const [values, setValues] = useState(initialValues)
  /** 칸을 벗어나거나 제출해 오류 문구를 보이고 있는 칸 */
  const [shown, setShown] = useState<Set<Field>>(new Set())
  /** 서버가 거부한 칸의 문구 */
  const [rejected, setRejected] = useState<FieldErrors<Field>>({})
  const inputs = useRef<Partial<Record<Field, HTMLInputElement | null>>>({})
  const errors = validate(values)

  function change(field: Field, value: string) {
    const changed = { ...values, [field]: value }
    const remaining = validate(changed)
    setValues(changed)
    // 맞게 고치면 바로 지운다. 다시 틀려도 칸을 벗어나기 전에는 띄우지 않는다.
    setShown((current) => new Set([...current].filter((name) => remaining[name])))
    setRejected((current) => ({ ...current, [field]: undefined }))
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
    if (!first) return false
    const input = inputs.current[first]
    input?.focus()
    // 이미 초점이 있는 칸이면 focus()는 스크롤하지 않는다
    input?.scrollIntoView({ block: 'nearest' })
    return true
  }

  function fieldProps(field: Field) {
    return {
      ref: (input: HTMLInputElement | null) => {
        inputs.current[field] = input
      },
      value: values[field],
      error: (shown.has(field) && errors[field]) || rejected[field],
      onChange: (event: ChangeEvent<HTMLInputElement>) => change(field, event.target.value),
      onBlur: () => check(field),
    }
  }

  return { values, fieldProps, check, checkAll, reject }
}
