// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { formatAmount, joinDigits, positionAfterDigits } from '../src/components/amountText'

describe('보이는 금액', () => {
  it.each([
    [0, false, '0'],
    [7, false, '7'],
    [999, false, '999'],
    [1000, false, '1,000'],
    [350000, true, '-350,000'],
    [0, true, '-0'],
    [9_999_999_999, true, '-9,999,999,999'],
    [undefined, false, ''],
    [undefined, true, '-'],
  ])('%s, 음수 %s이면 "%s"다', (value, negative, text) => {
    expect(formatAmount(value, negative)).toBe(text)
  })
})

describe('커서 앞뒤의 글자에서 숫자를 골라 잇기', () => {
  it.each([
    ['', '', undefined, 0],
    ['1', '', 1, 1],
    ['1,2345', '', 12345, 5],
    ['15', ',234', 15234, 2],
    ['12,000원', '', 12000, 5],
    ['-3', '50,000', 350000, 1],
    // 전각 숫자와 다른 글자의 숫자는 숫자로 보지 않는다
    ['１２', '3', 3, 0],
    ['٣', '4', 4, 0],
    // 앞자리 0은 지우고 커서는 지운 만큼 당긴다
    ['012', '', 12, 2],
    ['05', '', 5, 1],
    ['00', '', 0, 1],
    ['0', '12', 12, 0],
    ['000', '', 0, 1],
    ['', '0', 0, 0],
    ['00000000012', '', 12, 2],
    ['9999999999', '', 9_999_999_999, 10],
    ['', '9,999,999,999', 9_999_999_999, 0],
  ])('"%s"와 "%s"', (before, after, value, caret) => {
    expect(joinDigits(before, after)).toEqual({ value, caret })
  })

  it.each([
    ['10000000000', ''],
    ['1', '0,000,000,000'],
    ['99999999999', '9'],
  ])('10자리를 넘으면 없다: "%s"와 "%s"', (before, after) => {
    expect(joinDigits(before, after)).toBeUndefined()
  })
})

describe('숫자 몇 개 뒤의 자리', () => {
  it.each([
    ['1,234', 0, 0],
    ['1,234', 1, 1],
    ['1,234', 2, 3],
    ['1,234', 4, 5],
    ['-1,234', 0, 1],
    ['-1,234', 1, 2],
    ['-', 0, 1],
    ['', 0, 0],
    ['0', 1, 1],
  ])('"%s"에서 %d개 뒤는 %d다', (text, count, position) => {
    expect(positionAfterDigits(text, count)).toBe(position)
  })
})
