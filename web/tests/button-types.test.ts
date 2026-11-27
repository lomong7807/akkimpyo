// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { typeErrorsOf } from './support/typeErrors'

const typeErrors = (jsx: string) => typeErrorsOf(`import { Button, ButtonLink } from './components/Button'`, jsx)

describe('버튼의 타입', () => {
  it('정해진 쓰임은 통과한다', () => {
    expect(
      typeErrors(`
        <Button kind="primary" onClick={() => {}} busy>저장</Button>
        <Button kind="icon" icon="X" aria-label="닫기" />
        <Button kind="square" aria-label="마이너스" aria-pressed>+/-</Button>
        <ButtonLink kind="text" to="/home">홈으로</ButtonLink>
      `),
    ).toEqual([])
  })

  it.each([
    ['이름 없는 아이콘 버튼', '<Button kind="icon" icon="X" />', 'aria-label'],
    ['이름 없는 아이콘 링크', '<ButtonLink kind="icon" icon="X" to="/home" />', 'aria-label'],
    ['이름 없는 기호 버튼', '<Button kind="square">+/-</Button>', 'aria-label'],
    ['글자 없는 버튼', '<Button kind="primary" />', 'children'],
    ['className으로 모양 덮어쓰기', '<Button kind="primary" className="a">저장</Button>', 'className'],
    ['style로 모양 덮어쓰기', '<Button kind="primary" style={{ margin: 0 }}>저장</Button>', 'style'],
    ['링크의 className', '<ButtonLink kind="primary" to="/" className="a">홈</ButtonLink>', 'className'],
    ['링크의 style', '<ButtonLink kind="primary" to="/" style={{ margin: 0 }}>홈</ButtonLink>', 'style'],
    ['없는 종류', '<Button kind="ghost">저장</Button>', 'ghost'],
  ])('%s는 타입 오류다', (_, jsx, word) => {
    const errors = typeErrors(jsx)
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain(word)
  })
})
