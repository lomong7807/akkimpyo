// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { typeErrorsOf } from './support/typeErrors'

const typeErrors = (jsx: string) => typeErrorsOf(`import Amount from './components/Amount'`, jsx)

describe('금액 표시의 타입', () => {
  it('정해진 쓰임은 통과한다', () => {
    expect(
      typeErrors(`
        <Amount kind="expense" value={12000} />
        <Amount kind="income" value={12000} canceled />
        <Amount kind="transfer" value={12000} canceled={false} />
        <Amount kind="balance" value={-12000} />
        <Amount kind="difference" value={-12000} />
      `),
    ).toEqual([])
  })

  it.each([
    ['className으로 모양 덮어쓰기', '<Amount kind="balance" value={1} className="a" />', 'className'],
    ['style로 모양 덮어쓰기', '<Amount kind="balance" value={1} style={{ color: "red" }} />', 'style'],
    ['없는 종류', '<Amount kind="refund" value={1} />', 'refund'],
    ['글자로 준 금액', '<Amount kind="balance" value="1" />', 'number'],
    ['취소한 잔액', '<Amount kind="balance" value={1} canceled />', 'balance'],
    ['취소한 차액', '<Amount kind="difference" value={1} canceled />', 'difference'],
  ])('%s는 타입 오류다', (_, jsx, word) => {
    const errors = typeErrors(jsx)
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain(word)
  })
})
