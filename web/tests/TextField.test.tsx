import { cleanup, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it } from 'vitest'
import { PasswordField, TextField } from '../src/components/TextField'
import { readCssRule } from './support/cssRule'
import { readWebFile } from './support/webFile'

const ruleBody = (selector: string) => readCssRule('src/components/Field.module.css', selector)

afterEach(cleanup)

const fields = [
  ['입력칸', TextField],
  ['비밀번호 칸', PasswordField],
] as const

describe.each(fields)('%s', (_, Field) => {
  it('이름은 label로 칸과 묶인다', () => {
    render(<Field label="이메일" />)
    expect(screen.getByLabelText('이메일').tagName).toBe('INPUT')
  })

  it('이름, 칸, 도움말, 오류 문구 순서로 놓인다', () => {
    const { container } = render(<Field label="이메일" help="도움말 문장" error="오류 문장" />)
    const inOrder = [screen.getByText('이메일'), screen.getByLabelText('이메일'), screen.getByText('도움말 문장'), screen.getByText('오류 문장')]
    const positions = inOrder.map((element) => [...container.querySelectorAll('*')].indexOf(element))
    expect(positions).toEqual(positions.toSorted((a, b) => a - b))
  })

  it('도움말과 오류 문구를 aria-describedby로 잇는다', () => {
    render(<Field label="이메일" help="도움말 문장" error="오류 문장" />)
    const described = screen
      .getByLabelText('이메일')
      .getAttribute('aria-describedby')!
      .split(' ')
      .map((id) => document.getElementById(id)?.textContent)
    expect(described).toEqual(['도움말 문장', '오류 문장'])
  })

  it('오류 칸에 aria-invalid를 단다', () => {
    render(<Field label="이메일" error="오류 문장" />)
    expect(screen.getByLabelText('이메일').getAttribute('aria-invalid')).toBe('true')
  })

  it('도움말과 오류가 없으면 aria-describedby와 aria-invalid가 없다', () => {
    render(<Field label="이메일" />)
    expect(screen.getByLabelText('이메일').hasAttribute('aria-describedby')).toBe(false)
    expect(screen.getByLabelText('이메일').hasAttribute('aria-invalid')).toBe(false)
  })

  it('오류 문구 앞에 장식 아이콘 20px을 그린다', () => {
    render(<Field label="이메일" error="오류 문장" />)
    const icon = document.getElementById(screen.getByLabelText('이메일').getAttribute('aria-describedby')!)!.querySelector('svg')!
    expect(icon.getAttribute('aria-hidden')).toBe('true')
    expect(getComputedStyle(icon).width).toBe('var(--size-icon-20)')
  })

  it('오류 문구의 낱말이 줄보다 길어도 칸을 넘지 않는다', () => {
    render(<Field label="이메일" error="9,999,999,999원까지" />)
    expect(getComputedStyle(screen.getByText('9,999,999,999원까지')).minWidth).toBe('0px')
  })

  it('칸 둘을 그려도 이름과 설명이 섞이지 않는다', () => {
    render(
      <>
        <Field label="이메일" error="첫째 오류" />
        <Field label="이름" error="둘째 오류" />
      </>,
    )
    const describedBy = (label: string) =>
      document.getElementById(screen.getByLabelText(label).getAttribute('aria-describedby')!)?.textContent
    expect(describedBy('이메일')).toBe('첫째 오류')
    expect(describedBy('이름')).toBe('둘째 오류')
  })

  it('글자는 설계서 5.2의 토큰이다', () => {
    render(<Field label="이메일" help="도움말 문장" error="오류 문장" />)
    const style = (element: Element) => getComputedStyle(element)
    expect(style(screen.getByText('이메일')).font).toBe('var(--text-label)')
    expect(style(screen.getByLabelText('이메일')).font).toBe('var(--text-body)')
    expect(style(screen.getByText('도움말 문장')).font).toBe('var(--text-caption)')
    expect(style(screen.getByText('도움말 문장')).color).toBe('var(--color-text-secondary)')
    const error = document.getElementById(screen.getByLabelText('이메일').getAttribute('aria-describedby')!.split(' ')[1])!
    expect(style(error).font).toBe('var(--text-secondary)')
    expect(style(error).color).toBe('var(--color-danger)')
  })

  it('칸은 높이 48px, 모서리 10px, 면 색 바탕이다', () => {
    render(<Field label="이메일" />)
    const style = getComputedStyle(screen.getByLabelText('이메일'))
    expect(style.height).toBe('var(--size-field)')
    expect(style.borderRadius).toBe('var(--radius-10)')
    expect(style.backgroundColor).toBe('var(--color-surface)')
  })

  it.each([
    ['평소', false, undefined, ['1px', 'var(--color-border-strong)']],
    ['초점', true, undefined, ['var(--border-width-strong)', 'var(--color-accent)']],
    ['오류', false, '오류 문장', ['var(--border-width-strong)', 'var(--color-danger)']],
    ['오류 칸의 초점', true, '오류 문장', ['var(--border-width-strong)', 'var(--color-accent)']],
  ])('%s일 때의 테두리는 설계서 5.2의 굵기와 색이다', (_, focused, error, expected) => {
    render(<Field label="이메일" error={error} />)
    const input = screen.getByLabelText('이메일')
    if (focused) input.focus()
    const style = getComputedStyle(input)
    expect([style.getPropertyValue('--border-width'), style.getPropertyValue('--border-color')]).toEqual(expected)
  })

  it('오류 칸은 초점이 벗어나면 위험색으로 돌아간다', () => {
    render(<Field label="이메일" error="오류 문장" />)
    const input = screen.getByLabelText('이메일')
    input.focus()
    input.blur()
    expect(getComputedStyle(input).getPropertyValue('--border-color')).toBe('var(--color-danger)')
  })

  it('초점은 안쪽 테두리 하나로 보인다. 바깥 테두리는 고대비 모드에서 남도록 없애지 않고 투명하게 둔다', () => {
    const rule = ruleBody('.control:focus-visible')
    expect(rule).toContain('outline-color: transparent')
    expect(readWebFile('src/components/Field.module.css')).not.toMatch(/outline(-style|-width)?:/)
    expect(readWebFile('src/components/TextField.module.css')).not.toContain('outline')
  })

  it('테두리가 굵어진 만큼 안쪽 여백을 줄여 글자가 움직이지 않는다', () => {
    expect(ruleBody('.control')).toContain('border: var(--border-width) solid var(--border-color)')
    expect(ruleBody('.control')).toContain('padding: 0 calc(var(--space-12) + 1px - var(--border-width))')
  })

  it('칸보다 긴 글자는 말줄임표로 줄인다', () => {
    render(<Field label="이메일" />)
    expect(getComputedStyle(screen.getByLabelText('이메일')).textOverflow).toBe('ellipsis')
  })

  it('값, 입력 속성, ref를 칸에 넘긴다', async () => {
    let input: HTMLInputElement | null = null
    render(
      <Field
        label="이메일"
        autoComplete="username"
        readOnly
        defaultValue="name@example.com"
        ref={(element) => {
          input = element
        }}
      />,
    )
    expect(input).toBe(screen.getByLabelText('이메일'))
    expect(input!.value).toBe('name@example.com')
    expect(input!.readOnly).toBe(true)
    expect(input!.autocomplete).toBe('username')
  })
})

it('비밀번호 보기 버튼의 초점은 다른 버튼처럼 바깥 테두리다', () => {
  expect(readWebFile('src/components/TextField.module.css')).not.toMatch(/\.action[^{]*:focus/)
  expect(readWebFile('src/components/Button.module.css')).not.toContain('outline')
})

describe('비밀번호 보기', () => {
  it('처음에는 가려져 있고, 누르면 보이고 다시 누르면 가려진다', async () => {
    const user = userEvent.setup()
    render(<PasswordField label="비밀번호" />)
    const input = screen.getByLabelText<HTMLInputElement>('비밀번호')
    expect(input.type).toBe('password')

    await user.click(screen.getByRole('button', { name: '비밀번호 보기' }))
    expect(input.type).toBe('text')
    expect(screen.queryByRole('button', { name: '비밀번호 보기' })).toBeNull()

    await user.click(screen.getByRole('button', { name: '비밀번호 숨기기' }))
    expect(input.type).toBe('password')
    expect(screen.getByRole('button', { name: '비밀번호 보기' })).toBeTruthy()
  })

  it('키보드로 누를 수 있고 초점이 버튼에 남는다', async () => {
    const user = userEvent.setup()
    render(<PasswordField label="비밀번호" />)
    await user.tab()
    await user.tab()
    await user.keyboard('{Enter}')
    expect(screen.getByLabelText<HTMLInputElement>('비밀번호').type).toBe('text')
    expect(document.activeElement).toBe(screen.getByRole('button', { name: '비밀번호 숨기기' }))
  })

  it('양식 안에서 눌러도 양식을 보내지 않는다', async () => {
    const user = userEvent.setup()
    let submitted = false
    render(
      <form
        onSubmit={(event) => {
          event.preventDefault()
          submitted = true
        }}
      >
        <PasswordField label="비밀번호" />
      </form>,
    )
    await user.click(screen.getByRole('button', { name: '비밀번호 보기' }))
    expect(submitted).toBe(false)
  })

  it('값을 바꾸지 않는다', async () => {
    const user = userEvent.setup()
    render(<PasswordField label="비밀번호" />)
    await user.type(screen.getByLabelText('비밀번호'), ' pass 1234 ')
    await user.click(screen.getByRole('button', { name: '비밀번호 보기' }))
    expect(screen.getByLabelText<HTMLInputElement>('비밀번호').value).toBe(' pass 1234 ')
  })

  it('보이는 동안에도 맞춤법 검사와 자동 대문자, 자동 고침을 끈다', async () => {
    const user = userEvent.setup()
    render(<PasswordField label="비밀번호" />)
    await user.click(screen.getByRole('button', { name: '비밀번호 보기' }))
    const input = screen.getByLabelText('비밀번호')
    expect(input.getAttribute('spellcheck')).toBe('false')
    expect(input.getAttribute('autocapitalize')).toBe('none')
    expect(input.getAttribute('autocorrect')).toBe('off')
  })
})

describe('글자 수(설계서 00-common 4.4)', () => {
  const name = () => screen.getByLabelText('이름')
  const descriptions = () =>
    (name().getAttribute('aria-describedby') ?? '')
      .split(' ')
      .filter(Boolean)
      .map((id) => document.getElementById(id)?.textContent)

  it.each([
    [0, 20],
    [16, 20],
    [80, 100],
    [400, 500],
  ])('%d자이면 최대 %d자의 80퍼센트를 넘지 않아 보이지 않는다', (current, max) => {
    render(<TextField label="이름" help="도움말 문장" count={{ current, max }} />)
    expect(descriptions()).toEqual(['도움말 문장'])
    expect(screen.queryByText(`${current}/${max}`)).toBeNull()
  })

  it.each([
    [17, 20, '17/20'],
    [20, 20, '20/20'],
    [21, 20, '21/20'],
    [81, 100, '81/100'],
    [401, 500, '401/500'],
  ])('%d자이면 최대 %d자의 80퍼센트를 넘어 "%s"를 보인다', (current, max, text) => {
    render(<TextField label="이름" count={{ current, max }} />)
    expect(screen.getByText(text)).toBeTruthy()
  })

  it('칸의 설명에 도움말, 글자 수, 오류 문구 순서로 넣는다', () => {
    render(<TextField label="이름" help="도움말 문장" error="오류 문장" count={{ current: 21, max: 20 }} />)
    expect(descriptions()).toEqual(['도움말 문장', '21/20', '오류 문장'])
  })

  it('글자를 칠 때마다 읽히지 않게 알림으로 두지 않는다', () => {
    const { container } = render(<TextField label="이름" count={{ current: 17, max: 20 }} />)
    expect(container.querySelector('[aria-live], [role]')).toBeNull()
  })

  it('입력을 막지 않는다', () => {
    render(<TextField label="이름" count={{ current: 20, max: 20 }} />)
    expect(name().hasAttribute('maxlength')).toBe(false)
  })

  it('도움말은 왼쪽, 글자 수는 같은 줄의 오른쪽이고 오류 문구는 그 줄 아래다', () => {
    render(<TextField label="이름" help="도움말 문장" error="오류 문장" count={{ current: 21, max: 20 }} />)
    const help = screen.getByText('도움말 문장')
    const count = screen.getByText('21/20')
    const row = help.parentElement!
    expect([...row.children]).toEqual([help, count])
    expect(getComputedStyle(row).display).toBe('flex')
    expect(getComputedStyle(count).getPropertyValue('margin-inline-start')).toBe('auto')
    expect(row.contains(screen.getByText('오류 문장'))).toBe(false)
    expect(row.compareDocumentPosition(screen.getByText('오류 문장'))).toBe(Node.DOCUMENT_POSITION_FOLLOWING)
  })

  it('글자는 작은 설명 글자와 보조 글자색이고 숫자 폭이 같다', () => {
    render(<TextField label="이름" count={{ current: 17, max: 20 }} />)
    const count = screen.getByText('17/20')
    expect(getComputedStyle(count).font).toBe('var(--text-caption)')
    expect(getComputedStyle(count).color).toBe('var(--color-text-secondary)')
    expect(count.classList.contains('tabular-nums')).toBe(true)
  })
})
