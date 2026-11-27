import { describe, expect, it } from 'vitest'
import { matchesName, searchKey } from '../src/lib/nameSearch'

describe('이름 찾기', () => {
  it.each([
    ['식비', '식', true],
    ['식비', '비', true],
    ['카페·간식', '간식', true],
    ['카페·간식', '카페 간식', false],
    ['국민은행 급여통장', '급여 통장', true],
    ['국민은행 급여통장', '은행급여', true],
    ['Netflix', 'netf', true],
    ['NETFLIX', 'Flix', true],
    ['식비', '교통', false],
    ['식비', '', true],
    ['식비', '   ', true],
    ['식비', '\u{3000}식\u{A0}', true],
  ])('%s에서 %j를 찾으면 %s', (name, query, expected) => {
    expect(matchesName(name, query)).toBe(expected)
  })

  it('분해형으로 쓴 이름과 찾는 글도 조합형으로 맞춰 찾는다', () => {
    expect(matchesName('외식'.normalize('NFD'), '외식')).toBe(true)
    expect(matchesName('외식', '외'.normalize('NFD'))).toBe(true)
  })

  it('비교하는 모양은 공백을 빼고 소문자다', () => {
    expect(searchKey(' 카드 Bill\t')).toBe('카드bill')
  })
})
