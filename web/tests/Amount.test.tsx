import { cleanup, render } from '@testing-library/react'
import type { ReactElement } from 'react'
import { afterEach, describe, expect, it } from 'vitest'
import Amount from '../src/components/Amount'

function show(amount: ReactElement) {
  const element = render(amount).container.firstElementChild!
  return { text: element.textContent, style: getComputedStyle(element), element }
}

afterEach(cleanup)

describe('금액의 색과 부호(00-common 2.2)', () => {
  it.each([
    ['지출', <Amount kind="expense" value={12000} />, '12,000원', 'var(--color-text)'],
    ['수입', <Amount kind="income" value={3200000} />, '+3,200,000원', 'var(--color-accent)'],
    ['이체', <Amount kind="transfer" value={500000} />, '500,000원', 'var(--color-text-secondary)'],
    ['잔액과 합계', <Amount kind="balance" value={85000} />, '85,000원', 'var(--color-text)'],
    ['음수인 잔액과 합계', <Amount kind="balance" value={-120000} />, '-120,000원', 'var(--color-text)'],
  ])('%s', (_, amount, text, color) => {
    const shown = show(amount)
    expect(shown.text).toBe(text)
    expect(shown.style.color).toBe(color)
    expect(shown.style.textDecoration).not.toContain('line-through')
  })

  it.each([
    ['지출', <Amount kind="expense" value={12000} canceled />, '12,000원'],
    ['수입', <Amount kind="income" value={3200000} canceled />, '+3,200,000원'],
    ['이체', <Amount kind="transfer" value={500000} canceled />, '500,000원'],
  ])('취소한 거래는 원래 유형의 부호에 보조 글자색과 취소선이다: %s', (_, amount, text) => {
    const shown = show(amount)
    expect(shown.text).toBe(text)
    expect(shown.style.color).toBe('var(--color-text-secondary)')
    expect(shown.style.textDecoration).toContain('line-through')
  })

  // 거래의 라인 금액은 빠져나간 쪽이 음수다(ADR 002 2절의 예)
  it.each([
    ['지출', <Amount kind="expense" value={-12000} />, '12,000원'],
    ['수입', <Amount kind="income" value={-12000} />, '+12,000원'],
    ['이체', <Amount kind="transfer" value={-12000} />, '12,000원'],
  ])('%s의 부호는 값이 아니라 종류가 정한다', (_, amount, text) => {
    expect(show(amount).text).toBe(text)
  })

  it('둘레의 글자색을 따르지 않는다', () => {
    const { container } = render(
      <p style={{ color: 'var(--color-danger)' }}>
        <Amount kind="balance" value={-482300} />
      </p>,
    )
    expect(getComputedStyle(container.querySelector('span')!).color).toBe('var(--color-text)')
  })
})

describe('금액의 글자(00-common 3.2)', () => {
  it.each([
    [0, '0원'],
    [-0, '0원'],
    [1, '1원'],
    [-1, '-1원'],
    [999, '999원'],
    [1000, '1,000원'],
    [-999, '-999원'],
    [-1000, '-1,000원'],
    [999999, '999,999원'],
    [1000000, '1,000,000원'],
    [9999999999, '9,999,999,999원'],
    [-9999999999, '-9,999,999,999원'],
  ])('%d은 줄이지 않고 세 자리마다 쉼표와 "원"을 붙인다', (value, text) => {
    expect(show(<Amount kind="balance" value={value} />).text).toBe(text)
  })

  it('숫자의 폭이 같고 가운데에서 줄이 바뀌지 않는다', () => {
    const { element, style } = show(<Amount kind="balance" value={1000} />)
    expect(element.classList.contains('tabular-nums')).toBe(true)
    expect(style.whiteSpace).toBe('nowrap')
  })

  it('글자 크기와 굵기는 놓인 자리를 따른다', () => {
    const { container } = render(
      <p style={{ fontSize: '20px', fontWeight: 700 }}>
        <Amount kind="balance" value={1000} />
      </p>,
    )
    const style = getComputedStyle(container.querySelector('span')!)
    expect(style.fontSize).toBe('20px')
    expect(style.fontWeight).toBe('700')
  })
})
