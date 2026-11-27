// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { typeErrorsOf } from './support/typeErrors'

const imports = `
import AmountField from './components/AmountField'
import DateField from './components/DateField'
import { PasswordField, TextField } from './components/TextField'
`
const typeErrors = (jsx: string) => typeErrorsOf(imports, jsx)

describe('입력칸의 타입', () => {
  it('정해진 쓰임은 통과한다', () => {
    expect(
      typeErrors(`
        <TextField label="이메일" inputMode="email" autoComplete="username" help="도움말" error="오류" onBlur={() => {}} readOnly />
        <TextField label="이름" count={{ current: 17, max: 20 }} />
        <PasswordField label="비밀번호" autoComplete="current-password" ref={() => {}} />
        <DateField label="기준일" value="2026-11-26" onChange={(date: string) => date} help="도움말" error="오류" readOnly ref={() => {}} />
        <AmountField label="금액" value={undefined} onChange={(value: number | undefined) => value} help="도움말" error="오류" onBlur={() => {}} readOnly ref={() => {}} />
        <AmountField label="시작 잔액" value={0} onChange={() => {}} sign={{ negative: true, onChange: (negative: boolean) => negative }} />
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
    ['입력칸의 종류 바꾸기', '<TextField label="이메일" type="checkbox" />', 'type'],
    ['비밀번호 칸의 종류 바꾸기', '<PasswordField label="비밀번호" type="text" />', 'type'],
    ['비밀번호 칸의 글자 수', '<PasswordField label="비밀번호" count={{ current: 8, max: 72 }} />', 'count'],
    ['비밀번호 칸의 모양 덮어쓰기', '<PasswordField label="비밀번호" className="a" />', 'className'],
    ['이름 없는 날짜 칸', '<DateField value="" onChange={() => {}} />', 'label'],
    ['Date를 값으로 받는 날짜 칸', '<DateField label="기준일" value={new Date(0)} onChange={() => {}} />', 'string'],
    ['날짜 칸의 모양 덮어쓰기', '<DateField label="기준일" value="" onChange={() => {}} className="a" />', 'className'],
    ['모양이 정해지지 않은 날짜 칸의 비활성', '<DateField label="기준일" value="" onChange={() => {}} disabled />', 'disabled'],
    ['이름 없는 금액 칸', '<AmountField value={0} onChange={() => {}} />', 'label'],
    ['글자를 값으로 받는 금액 칸', '<AmountField label="금액" value="1,000" onChange={() => {}} />', 'number'],
    ['금액 칸의 모양 덮어쓰기', '<AmountField label="금액" value={0} onChange={() => {}} className="a" />', 'className'],
    ['바꿀 수 없는 부호', '<AmountField label="금액" value={0} onChange={() => {}} sign={{ negative: true }} />', 'onChange'],
    ['날짜 칸의 글자 수', '<DateField label="기준일" value="" onChange={() => {}} count={{ current: 1, max: 2 }} />', 'count'],
  ])('%s는 타입 오류다', (_, jsx, word) => {
    const errors = typeErrors(jsx)
    expect(errors).toHaveLength(1)
    expect(errors[0]).toContain(word)
  })
})
