// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { typeErrorsOf } from './support/typeErrors'

const typeErrors = (jsx: string) =>
  typeErrorsOf(`import { ListButton, ListLink } from './components/ListRow'\nimport { Info, SignOut } from './components/icons'`, jsx)

describe('목록 줄의 타입', () => {
  it('정해진 쓰임은 통과한다', () => {
    expect(
      typeErrors(`
        <ListLink icon={Info} to="/accounts">계좌</ListLink>
        <ListButton icon={SignOut} onClick={() => {}}>로그아웃</ListButton>
      `),
    ).toEqual([])
  })

  it.each([
    ['링크의 className', '<ListLink icon={Info} to="/" className="a">계좌</ListLink>', 'className'],
    ['링크의 style', '<ListLink icon={Info} to="/" style={{ margin: 0 }}>계좌</ListLink>', 'style'],
    ['버튼의 className', '<ListButton icon={SignOut} onClick={() => {}} className="a">로그아웃</ListButton>', 'className'],
    ['버튼의 style', '<ListButton icon={SignOut} onClick={() => {}} style={{ margin: 0 }}>로그아웃</ListButton>', 'style'],
    ['아이콘 없는 줄', '<ListLink to="/">계좌</ListLink>', 'icon'],
  ])('%s는 타입 오류다', (_, jsx, word) => {
    const errors = typeErrors(jsx)
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain(word)
  })
})
