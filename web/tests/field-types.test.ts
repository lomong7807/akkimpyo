// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { typeErrorsOf } from './support/typeErrors'

const typeErrors = (jsx: string) => typeErrorsOf(`import { PasswordField, TextField } from './components/TextField'`, jsx)

describe('입력칸의 타입', () => {
  it('정해진 쓰임은 통과한다', () => {
    expect(
      typeErrors(`
        <TextField label="이메일" type="email" autoComplete="username" help="도움말" error="오류" onBlur={() => {}} readOnly />
        <PasswordField label="비밀번호" autoComplete="current-password" ref={() => {}} />
      `),
    ).toEqual([])
  })

  it.each([
    ['이름 없는 입력칸', '<TextField />', 'label'],
    ['className으로 모양 덮어쓰기', '<TextField label="이메일" className="a" />', 'className'],
    ['style로 모양 덮어쓰기', '<TextField label="이메일" style={{ margin: 0 }} />', 'style'],
    ['size로 폭 바꾸기', '<TextField label="이메일" size={3} />', 'size'],
    ['모양이 정해지지 않은 비활성', '<TextField label="이메일" disabled />', 'disabled'],
    ['이름과 다른 id', '<TextField label="이메일" id="email" />', 'id'],
    ['설명의 연결 덮어쓰기', '<TextField label="이메일" aria-describedby="a" />', 'undefined'],
    ['오류 표시 덮어쓰기', '<TextField label="이메일" aria-invalid />', 'undefined'],
    ['이름 대신 aria-label', '<TextField label="이메일" aria-label="다른 이름" />', 'undefined'],
    ['입력칸이 아닌 종류', '<TextField label="이메일" type="checkbox" />', 'checkbox'],
    ['비밀번호 칸의 종류 바꾸기', '<PasswordField label="비밀번호" type="text" />', 'type'],
    ['비밀번호 칸의 모양 덮어쓰기', '<PasswordField label="비밀번호" className="a" />', 'className'],
  ])('%s는 타입 오류다', (_, jsx, word) => {
    const errors = typeErrors(jsx)
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain(word)
  })
})
