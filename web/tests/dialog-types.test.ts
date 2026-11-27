// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { typeErrorsOf } from './support/typeErrors'

const typeErrors = (jsx: string) => typeErrorsOf(`import ConfirmDialog from './components/ConfirmDialog'`, jsx)

const props =
  'open title="버릴까요?" description="사라져요." closeLabel="계속 쓰기" actionLabel="버리기" onClose={() => {}} onAction={() => {}}'

describe('확인 창의 타입', () => {
  it('정해진 쓰임은 통과한다', () => {
    expect(typeErrors(`<ConfirmDialog ${props} />`)).toEqual([])
  })

  it.each([
    ['className', `<ConfirmDialog ${props} className="a" />`, 'className'],
    ['style', `<ConfirmDialog ${props} style={{ margin: 0 }} />`, 'style'],
    ['설명 없는 확인 창', `<ConfirmDialog ${props.replace(/description="[^"]*" /, '')} />`, 'description'],
  ])('%s는 타입 오류다', (_, jsx, word) => {
    const errors = typeErrors(jsx)
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain(word)
  })
})
