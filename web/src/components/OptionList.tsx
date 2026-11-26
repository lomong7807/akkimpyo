import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { matchesName } from '../lib/nameSearch'
import Icon from './Icon'
import fieldStyles from './Field.module.css'
import styles from './OptionList.module.css'

/** 고를 수 있는 줄. 하위 줄은 상위 줄 아래에 들여 쓴다. */
export interface PickerOption {
  value: string
  label: string
  children?: readonly { value: string; label: string }[]
}

/** 머리가 있는 묶음. 머리는 고를 수 없다. */
export interface PickerSection {
  heading?: string
  options: readonly PickerOption[]
}

interface OptionListProps {
  /** 목록의 이름. 연 칸의 이름이다. */
  label: string
  /** 맨 위에 이름 찾기 칸을 둔다. 0.8에서 찾기 칸은 카테고리 판에만 있다. */
  searchable?: boolean
  /** 찾기 칸의 이름이자 흐린 글자. 없으면 "{목록 이름} 이름 찾기"다. */
  searchLabel?: string
  sections: readonly PickerSection[]
  /** 지금 고른 값 */
  value: string
  /** 열 때 초점 테두리를 보이는지. 연 칸이 알려 준다. */
  focusVisible: boolean
  /**
   * 지금 값이 고르지 않은 때의 기본 줄(카테고리의 미분류처럼 맨 아래에 있는 줄)이라 그 줄 대신 첫 줄에서 시작한다.
   * 지금 값의 표시는 그대로다.
   */
  startAtFirst?: boolean
  onSelect: (value: string) => void
}

/** 찾아서 남는 것이 없을 때(화면설계서 02 0.8에 문구가 없어 정한 문구) */
export const NO_MATCH = '찾는 이름이 없어요'

/**
 * 하나를 고르는 목록과 그 위의 이름 찾기 칸(화면설계서 02 0.8, 찾기 칸은 켜고 끌 수 있다). 시트나 판 안에 열 때마다 새로 그린다.
 * 찾기 칸은 맨 위에 남고 목록만 스크롤된다. 초점은 고른 줄(없거나 startAtFirst면 첫 줄)로 간다.
 * 위아래 화살표로 줄을 옮기고 엔터나 스페이스로 고른다. 찾기 칸에서 아래 화살표를 누르면 목록으로 들어간다.
 */
export default function OptionList({
  label,
  searchable = true,
  searchLabel = `${label} 이름 찾기`,
  sections,
  value,
  focusVisible,
  startAtFirst = false,
  onSelect,
}: OptionListProps) {
  const id = useId()
  const [query, setQuery] = useState('')
  const shown = filterSections(sections, query)
  const values = shown.flatMap(({ options }) =>
    options.flatMap((option) => [option.value, ...(option.children ?? []).map((child) => child.value)]),
  )
  const [active, setActive] = useState<string>()
  // 찾아서 빠진 줄에는 Tab으로 들어갈 수 없으므로 남은 줄로 옮긴다
  const start = !startAtFirst && values.includes(value) ? value : values[0]
  const tabStop = active !== undefined && values.includes(active) ? active : start
  const list = useRef<HTMLDivElement>(null)
  const search = useRef<HTMLInputElement>(null)

  const [openingFocus] = useState<FocusOptions>({ focusVisible })
  // 시트와 판은 layout effect에서 열린다. 열린 뒤에 초점을 옮긴다
  useEffect(() => {
    list.current?.querySelector<HTMLElement>('[tabindex="0"]')?.focus(openingFocus)
  }, [openingFocus])

  function options(): HTMLElement[] {
    return [...(list.current?.querySelectorAll<HTMLElement>('[role="option"]') ?? [])]
  }

  function focusOption(option: HTMLElement | undefined) {
    if (!option) return
    setActive(option.dataset.value)
    option.focus()
  }

  function handleListKeyDown(event: KeyboardEvent<HTMLElement>) {
    if (event.altKey || event.ctrlKey || event.metaKey) return
    const all = options()
    const index = all.indexOf(document.activeElement as HTMLElement)
    if (index < 0) return
    const moves: Partial<Record<string, () => void>> = {
      ArrowDown: () => focusOption(all[Math.min(index + 1, all.length - 1)]),
      // 첫 줄에서는 찾기 칸으로 간다. 찾기 칸이 없으면 첫 줄에 남는다
      ArrowUp: () => (index === 0 ? search.current?.focus() : focusOption(all[index - 1])),
      Home: () => focusOption(all[0]),
      End: () => focusOption(all.at(-1)),
      Enter: () => !event.repeat && onSelect(all[index].dataset.value!),
      ' ': () => !event.repeat && onSelect(all[index].dataset.value!),
    }
    const move = moves[event.key]
    if (!move) return
    event.preventDefault()
    move()
  }

  function handleSearchKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    // 시트가 양식 안에 그려지므로 엔터가 양식을 보내지 않게 한다
    if (event.key === 'Enter') event.preventDefault()
    if (event.key !== 'ArrowDown' || event.altKey || event.ctrlKey || event.metaKey) return
    event.preventDefault()
    focusOption(options()[0])
  }

  function optionRow(option: { value: string; label: string }, depth: 0 | 1, optionId?: string) {
    const selected = option.value === value
    return (
      <div
        key={option.value}
        id={optionId}
        role="option"
        aria-selected={selected}
        tabIndex={option.value === tabStop ? 0 : -1}
        data-value={option.value}
        className={depth === 1 ? `${styles.option} ${styles.child}` : styles.option}
        onClick={() => onSelect(option.value)}
        onFocus={() => setActive(option.value)}
      >
        <span className={styles.label}>{option.label}</span>
        {selected && (
          <span className={styles.check}>
            <Icon name="Check" size={20} />
          </span>
        )}
      </div>
    )
  }

  return (
    <div>
      {searchable && (
        <div className={styles.search}>
          <input
            ref={search}
            type="text"
            className={`${fieldStyles.control} ${styles.searchInput}`}
            aria-label={searchLabel}
            placeholder={searchLabel}
            enterKeyHint="search"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={handleSearchKeyDown}
          />
          <span className={styles.searchIcon}>
            <Icon name="MagnifyingGlass" size={20} />
          </span>
        </div>
      )}
      {values.length > 0 && (
        <div ref={list} role="listbox" aria-label={label} className={styles.list} onKeyDown={handleListKeyDown}>
          {shown.map((section, sectionIndex) => {
            const rows = section.options.map((option, optionIndex) => {
              const optionId = `${id}-${sectionIndex}-${optionIndex}`
              const children = option.children ?? []
              return (
                <div key={option.value} role="none">
                  {optionRow(option, 0, optionId)}
                  {children.length > 0 && (
                    <div role="group" aria-labelledby={optionId}>
                      {children.map((child) => optionRow(child, 1))}
                    </div>
                  )}
                </div>
              )
            })
            if (!section.heading) return rows
            const headingId = `${id}-${sectionIndex}`
            return (
              <div key={section.heading} role="group" aria-labelledby={headingId}>
                <div id={headingId} role="presentation" className={styles.heading}>
                  {section.heading}
                </div>
                {rows}
              </div>
            )
          })}
        </div>
      )}
      <p role="status" className={styles.empty}>
        {values.length === 0 ? NO_MATCH : ''}
      </p>
    </div>
  )
}

/**
 * 찾는 글이 이름에 들어 있는 줄만 남긴다. 하위 줄은 상위 이름까지 붙여 보고, 맞으면 상위 줄과 함께 남는다.
 * 상위 이름이 맞으면 하위 줄도 모두 남는다. 남은 줄이 없는 묶음은 빠진다.
 */
function filterSections(sections: readonly PickerSection[], query: string): PickerSection[] {
  return sections
    .map((section) => ({
      ...section,
      options: section.options.flatMap((option) => {
        const children = (option.children ?? []).filter((child) => matchesName(option.label + child.label, query))
        return matchesName(option.label, query) || children.length > 0 ? [{ ...option, children }] : []
      }),
    }))
    .filter((section) => section.options.length > 0)
}
