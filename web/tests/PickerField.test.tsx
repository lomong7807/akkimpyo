import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import OptionList, { type PickerSection } from '../src/components/OptionList'
import PickerField from '../src/components/PickerField'
import { readCssRule } from './support/cssRule'
import { readWebFile } from './support/webFile'
import { untilOpened } from './support/dialog'
import { installMatchMedia } from './support/viewport'

const PHONE = 390
const WIDE = 1280

let viewport: ReturnType<typeof installMatchMedia>

beforeEach(() => {
  viewport = installMatchMedia(PHONE)
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const categories: PickerSection[] = [
  {
    options: [
      { value: 'food', label: '식비', children: [{ value: 'dining', label: '외식' }, { value: 'grocery', label: '장보기' }] },
      { value: 'cafe', label: '카페·간식' },
      { value: 'traffic', label: '교통', children: [{ value: 'taxi', label: '택시' }] },
      { value: '', label: '미분류' },
    ],
  },
]

const accounts: PickerSection[] = [
  { heading: '은행', options: [{ value: 'salary', label: '국민은행 급여통장' }, { value: 'saving', label: '비상금' }] },
  { heading: '카드', options: [{ value: 'shinhan', label: '신한카드' }] },
  { heading: '현금', options: [{ value: 'wallet', label: '지갑' }] },
]

const names: Record<string, string> = Object.fromEntries(
  [...categories, ...accounts].flatMap(({ options }) =>
    options.flatMap((option) => [[option.value, option.label], ...(option.children ?? []).map((c) => [c.value, c.label])]),
  ),
)

function Sample({
  sections = categories,
  initial = 'food',
  error,
  startAtFirst,
  searchable = true,
}: {
  sections?: PickerSection[]
  initial?: string
  error?: string
  startAtFirst?: boolean
  searchable?: boolean
}) {
  const [value, setValue] = useState(initial)
  return (
    <form onSubmit={(event) => event.preventDefault()}>
      <PickerField label="카테고리" valueText={names[value] ?? ''} error={error}>
        {({ close, focusVisible }) => (
          <OptionList
            label="카테고리"
            searchLabel="카테고리 이름 찾기"
            sections={sections}
            value={value}
            focusVisible={focusVisible}
            startAtFirst={startAtFirst}
            searchable={searchable}
            onSelect={(next) => {
              setValue(next)
              close()
            }}
          />
        )}
      </PickerField>
    </form>
  )
}

const field = () => screen.getByRole<HTMLButtonElement>('button', { name: /^카테고리/ })
const dialog = () => screen.queryByRole<HTMLDialogElement>('dialog')
const listbox = () => screen.getByRole('listbox', { name: '카테고리' })
const option = (name: string) => within(listbox()).getByRole('option', { name })
const shownOptions = () => within(listbox()).queryAllByRole('option').map((element) => element.textContent)
const search = () => screen.getByRole<HTMLInputElement>('textbox', { name: '카테고리 이름 찾기' })

async function open(props: Parameters<typeof Sample>[0] = {}) {
  const user = userEvent.setup()
  render(<Sample {...props} />)
  await user.click(field())
  await untilOpened()
  return user
}

describe('고르는 칸', () => {
  it('이름과 지금 값을 읽고, 대화 상자를 여는 버튼이다', () => {
    render(<Sample />)
    expect(field().textContent).toBe('식비')
    expect(field().getAttribute('aria-haspopup')).toBe('dialog')
    expect(field().getAttribute('aria-expanded')).toBe('false')
    expect(field().querySelector('svg')).toBeTruthy()
  })

  it('입력칸 모양이고 값은 왼쪽, CaretDown은 오른쪽 끝이다', () => {
    render(<Sample />)
    expect(field().className).toContain('control')
    expect(readCssRule('src/components/FieldButton.module.css', '.button')).toContain('justify-content: space-between')
  })

  it('오류 문구를 설명으로 잇고 오류 칸 모양이다. 버튼에 없는 aria-invalid는 쓰지 않는다', () => {
    render(<Sample error="계좌를 골라 주세요" />)
    const described = document.getElementById(field().getAttribute('aria-describedby')!)
    expect(described!.textContent).toBe('계좌를 골라 주세요')
    expect(field().className).toContain('invalid')
    expect(field().hasAttribute('aria-invalid')).toBe(false)
  })

  it.each(['{Enter}', ' '])('키보드 %s로 연다', async (key) => {
    const user = userEvent.setup()
    render(<Sample />)
    field().focus()
    await user.keyboard(key)
    expect(dialog()).toBeTruthy()
    expect(field().getAttribute('aria-expanded')).toBe('true')
  })
})

describe('휴대폰 배치의 고르기 시트', () => {
  it('제목이 칸 이름인 바닥 시트로 열린다', async () => {
    await open()
    expect(screen.getByRole('dialog', { name: '카테고리' })).toBeTruthy()
    expect(screen.getByRole('heading', { name: '카테고리' })).toBeTruthy()
  })

  it('맨 위에 찾기 칸이 있고, 줄은 상위 아래 하위를 들여 쓰며 미분류는 맨 아래다', async () => {
    await open()
    expect(search().placeholder).toBe('카테고리 이름 찾기')
    expect(shownOptions()).toEqual(['식비', '외식', '장보기', '카페·간식', '교통', '택시', '미분류'])
    expect(option('외식').className).toContain('child')
    expect(option('식비').className).not.toContain('child')
  })

  it('하위 줄은 상위 이름으로 묶인다', async () => {
    await open()
    const group = within(listbox()).getByRole('group', { name: '식비' })
    expect(within(group).getAllByRole('option').map((element) => element.textContent)).toEqual(['외식', '장보기'])
  })

  it('지금 값의 줄에 Check와 aria-selected가 있고, 초점이 그 줄로 간다', async () => {
    await open({ initial: 'dining' })
    expect(option('외식').getAttribute('aria-selected')).toBe('true')
    expect(option('외식').querySelector('svg')).toBeTruthy()
    expect(option('식비').getAttribute('aria-selected')).toBe('false')
    expect(option('식비').querySelector('svg')).toBeNull()
    expect(document.activeElement).toBe(option('외식'))
  })

  it('지금 값이 맨 아래의 기본 줄이면 첫 줄에서 시작하고 표시는 그대로다', async () => {
    await open({ initial: '', startAtFirst: true })
    expect(document.activeElement).toBe(option('식비'))
    expect(option('미분류').getAttribute('aria-selected')).toBe('true')
  })

  it('지금 값이 목록에 없으면 첫 줄로 초점이 간다', async () => {
    await open({ initial: 'gone' })
    expect(document.activeElement).toBe(option('식비'))
  })

  it.each([
    ['상위', '교통'],
    ['하위', '택시'],
    ['미분류', '미분류'],
  ])('%s 줄을 누르면 고르고 바로 닫히며 초점이 칸으로 돌아간다', async (_, name) => {
    const user = await open()
    await user.click(option(name))
    await act(async () => {})
    expect(dialog()).toBeNull()
    expect(field().textContent).toBe(name)
    expect(document.activeElement).toBe(field())
  })

  it('위아래 화살표로 줄을 옮기고 엔터로 고른다', async () => {
    const user = await open()
    await user.keyboard('{ArrowDown}{ArrowDown}{ArrowDown}')
    expect(document.activeElement).toBe(option('카페·간식'))
    await user.keyboard('{ArrowUp}')
    expect(document.activeElement).toBe(option('장보기'))
    await user.keyboard('{Enter}')
    await act(async () => {})
    expect(field().textContent).toBe('장보기')
  })

  it('스페이스로도 고른다', async () => {
    const user = await open()
    await user.keyboard('{ArrowDown} ')
    await act(async () => {})
    expect(field().textContent).toBe('외식')
  })

  it('Home과 End로 처음과 끝 줄로 간다', async () => {
    const user = await open({ initial: 'cafe' })
    await user.keyboard('{End}')
    expect(document.activeElement).toBe(option('미분류'))
    await user.keyboard('{Home}')
    expect(document.activeElement).toBe(option('식비'))
  })

  it('첫 줄에서 위 화살표는 찾기 칸으로, 찾기 칸에서 아래 화살표는 첫 줄로 간다', async () => {
    const user = await open()
    await user.keyboard('{ArrowUp}')
    expect(document.activeElement).toBe(search())
    await user.keyboard('{ArrowDown}')
    expect(document.activeElement).toBe(option('식비'))
  })

  it('Tab으로는 목록에 한 번만 들어간다', async () => {
    await open({ initial: 'taxi' })
    const tabbable = within(listbox())
      .getAllByRole('option')
      .filter((element) => element.tabIndex === 0)
    expect(tabbable.map((element) => element.textContent)).toEqual(['택시'])
  })

  it('찾기 칸의 엔터는 양식을 보내지 않는다', async () => {
    const submitted = vi.fn((event: SubmitEvent) => event.preventDefault())
    const user = await open()
    document.querySelector('form')!.addEventListener('submit', submitted)
    search().focus()
    await user.keyboard('식{Enter}')
    expect(submitted).not.toHaveBeenCalled()
  })

  it('X, Esc로 고르지 않고 닫힌다', async () => {
    const user = await open()
    await user.keyboard('{Escape}')
    await act(async () => {})
    expect(dialog()).toBeNull()
    expect(field().textContent).toBe('식비')
  })
})

describe('이름 찾기', () => {
  async function find(text: string, props: Parameters<typeof Sample>[0] = {}) {
    const user = await open(props)
    search().focus()
    await user.paste(text)
    return user
  }

  it('공백과 대소문자를 무시한 부분 일치다', async () => {
    await find(' 간 식 ')
    expect(shownOptions()).toEqual(['카페·간식'])
  })

  it('하위가 맞으면 상위와 함께 보인다', async () => {
    await find('택')
    expect(shownOptions()).toEqual(['교통', '택시'])
  })

  it('하위는 상위 이름까지 붙여 본다', async () => {
    await find('식비외')
    expect(shownOptions()).toEqual(['식비', '외식'])
  })

  it('상위가 맞으면 하위도 모두 보인다', async () => {
    await find('교통')
    expect(shownOptions()).toEqual(['교통', '택시'])
  })

  it('남는 것이 없는 묶음은 머리도 빠진다', async () => {
    await find('카드', { sections: accounts, initial: 'salary' })
    expect(shownOptions()).toEqual(['신한카드'])
    expect(screen.queryByText('은행')).toBeNull()
    expect(screen.getByText('카드')).toBeTruthy()
  })

  it('맞는 것이 없으면 "찾는 이름이 없어요"를 읽어 준다', async () => {
    await find('없는 이름')
    expect(screen.queryByRole('listbox')).toBeNull()
    expect(screen.getByRole('status').textContent).toBe('찾는 이름이 없어요')
  })

  it('찾기 칸을 비우면 다시 모두 보인다', async () => {
    const user = await find('택')
    await user.clear(search())
    expect(shownOptions()).toHaveLength(7)
    expect(screen.getByRole('status').textContent).toBe('')
  })

  it('초점이 있던 줄이 찾아서 빠지면 남은 첫 줄로 Tab이 간다', async () => {
    const user = await open({ initial: 'cafe' })
    search().focus()
    await user.paste('택')
    expect(option('교통').tabIndex).toBe(0)
  })
})

describe('찾기 칸이 없는 목록', () => {
  it('찾기 칸 없이 목록만 있고 지금 값에 초점이 간다', async () => {
    await open({ sections: accounts, initial: 'shinhan', searchable: false })
    expect(screen.queryByRole('textbox')).toBeNull()
    expect(document.activeElement).toBe(within(listbox()).getByRole('option', { name: '신한카드' }))
  })

  it('첫 줄에서 위 화살표를 눌러도 첫 줄에 남는다', async () => {
    const user = await open({ sections: accounts, initial: 'salary', searchable: false })
    await user.keyboard('{ArrowUp}')
    expect(document.activeElement).toBe(within(listbox()).getByRole('option', { name: '국민은행 급여통장' }))
  })

  it('맨 위 줄은 시트 머리 아래 4px(시트의 안쪽 여백)에서 시작하고 찾기 칸 자리가 없다', async () => {
    await open({ sections: accounts, initial: 'salary', searchable: false })
    expect(listbox().parentElement!.querySelector('[class*="search"]')).toBeNull()
  })
})

describe('계좌 묶음', () => {
  it('은행, 카드, 현금 머리 아래 이름만 있는 줄이다', async () => {
    await open({ sections: accounts, initial: 'salary' })
    for (const heading of ['은행', '카드', '현금']) {
      expect(within(listbox()).getByRole('group', { name: heading })).toBeTruthy()
    }
    expect(shownOptions()).toEqual(['국민은행 급여통장', '비상금', '신한카드', '지갑'])
  })

  it('머리는 text-label, 위 16 아래 8이고 고를 수 없다', async () => {
    await open({ sections: accounts, initial: 'salary' })
    const heading = screen.getByText('은행')
    expect(heading.getAttribute('role')).toBe('presentation')
    expect(readCssRule('src/components/OptionList.module.css', '.heading')).toContain(
      'padding: var(--space-16) var(--space-16) var(--space-8)',
    )
    expect(getComputedStyle(heading).font).toBe('var(--text-label)')
  })

  it('머리를 지나 위아래로 옮긴다', async () => {
    const user = await open({ sections: accounts, initial: 'saving' })
    await user.keyboard('{ArrowDown}')
    expect(document.activeElement).toBe(within(listbox()).getByRole('option', { name: '신한카드' }))
  })
})

describe('모양', () => {
  const rule = (selector: string) => readCssRule('src/components/OptionList.module.css', selector)

  it('줄은 56px 이상, 하위는 16px 더 들여 쓴다', () => {
    expect(rule('.option')).toContain('min-height: var(--size-row)')
    expect(rule('.option')).toContain('padding: var(--space-8) var(--space-16)')
    expect(rule('.child')).toContain('padding-inline-start: var(--space-32)')
  })

  it('눌림과 마우스 올림은 color-press, Check는 color-accent다', () => {
    expect(rule('.option:active')).toContain('background-color: var(--color-press)')
    expect(rule('.check')).toContain('color: var(--color-accent)')
  })

  it('찾기 칸은 좌우 16px이고 위에 붙어 남는다', () => {
    expect(rule('.search')).toContain('position: sticky')
    expect(rule('.search')).toContain('padding: var(--space-4) var(--space-16) var(--space-8)')
  })
})

describe('넓은 화면의 펼친 판', () => {
  const panel = () => dialog()!.firstElementChild as HTMLElement

  it('가림막 없는 칸 아래 판이고 목록 모양이다', async () => {
    viewport.resizeTo(WIDE)
    await open()
    expect(screen.queryByRole('heading')).toBeNull()
    expect(panel().className).toContain('list')
    expect(listbox()).toBeTruthy()
  })

  it('폭은 칸 폭과 320px 중 큰 값이다', async () => {
    viewport.resizeTo(WIDE)
    const user = userEvent.setup()
    render(<Sample />)
    vi.spyOn(field(), 'getBoundingClientRect').mockReturnValue(new DOMRect(480, 100, 560, 48))
    await user.click(field())
    expect(panel().style.getPropertyValue('--field-width')).toBe('560px')
    const css = readCssRule('src/components/FieldPanel.module.css', '.list')
    expect(css).toContain('--list-width: max(var(--field-width), var(--width-field-panel))')
    expect(css).toContain('width: var(--list-width)')
    expect(css).toContain('left: min(var(--field-left), 100% - var(--list-width))')
  })

  it('최대 높이는 360px 토큰이고 남은 자리보다 크지 않다', () => {
    const css = (selector: string) => readCssRule('src/components/FieldPanel.module.css', selector)
    expect(css(".list[data-side='measure']")).toContain('max-height: var(--height-field-panel)')
    expect(css(".list[data-side='below']")).toContain(
      'max-height: min(var(--height-field-panel), 100% - var(--field-bottom) - 2 * var(--space-4))',
    )
    expect(css(".list[data-side='above']")).toContain(
      'max-height: min(var(--height-field-panel), var(--field-top) - 2 * var(--space-4))',
    )
    expect(readWebFile('src/components/FieldPanel.module.css')).not.toContain('--list-max-height')
  })

  it('배치가 바뀌면 닫는다', async () => {
    viewport.resizeTo(WIDE)
    await open()
    act(() => viewport.resizeTo(PHONE))
    await act(async () => {})
    expect(dialog()).toBeNull()
  })
})

describe('넓은 화면의 판이 펼치는 쪽', () => {
  const MAX = 360
  const panel = () => dialog()!.firstElementChild as HTMLElement

  /** 창 높이 `windowHeight`에서 칸이 `top`부터 48px이고 판의 내용이 `content`px이다. */
  async function openAt(windowHeight: number, top: number, content: number) {
    viewport.resizeTo(WIDE)
    vi.stubGlobal('innerHeight', windowHeight)
    const user = userEvent.setup()
    render(<Sample />)
    vi.spyOn(field(), 'getBoundingClientRect').mockReturnValue(new DOMRect(480, top, 560, 48))
    vi.spyOn(Element.prototype, 'scrollHeight', 'get').mockReturnValue(content)
    vi.spyOn(Element.prototype, 'clientHeight', 'get').mockImplementation(function (this: Element) {
      const side = (this as HTMLElement).dataset.side
      const room = side === 'above' ? top - 8 : side === 'below' ? windowHeight - top - 48 - 8 : Infinity
      return Math.min(content, MAX, room)
    })
    await user.click(field())
  }

  it('360px이 아래에 들어가면 위가 더 넓어도 아래에 펼친다', async () => {
    await openAt(1000, 560, 2000)
    expect(panel().dataset.side).toBe('below')
  })

  it('짧은 목록이 아래에 들어가면 아래에 펼친다', async () => {
    await openAt(800, 600, 120)
    expect(panel().dataset.side).toBe('below')
  })

  it('아래에 들어가지 않고 위가 더 넓으면 위로 펼친다', async () => {
    await openAt(800, 560, 2000)
    expect(panel().dataset.side).toBe('above')
  })

  it('창 크기가 바뀌면 다시 재어 놓는다', async () => {
    await openAt(1000, 100, 2000)
    expect(panel().dataset.side).toBe('below')
    fireEvent(window, new Event('resize'))
    expect(panel().dataset.side).toBe('below')
  })
})
