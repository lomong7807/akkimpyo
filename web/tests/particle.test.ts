import { describe, expect, it } from 'vitest'
import { towardParticle } from '../src/lib/particle'

describe('방향을 나타내는 조사 "(으)로"', () => {
  it.each([
    ['국민카드', '로'],
    ['신한카드', '로'],
    ['지갑', '으로'],
    ['급여통장', '으로'],
    ['비상금', '으로'],
    // ㄹ 받침 뒤는 "로"다
    ['생활', '로'],
    ['교통카드 월', '로'],
  ])('%s 뒤에는 "%s"', (word, expected) => {
    expect(towardParticle(word)).toBe(expected)
  })

  it.each([
    // 읽는 소리로 정한다: 일, 이, 사, 오, 칠, 팔, 구는 "로", 영(십, 백, 천, 만), 삼, 육은 "으로"
    ['통장1', '로'],
    ['통장2', '로'],
    ['통장3', '으로'],
    ['통장4', '로'],
    ['통장5', '로'],
    ['통장6', '으로'],
    ['통장7', '로'],
    ['통장8', '로'],
    ['통장9', '로'],
    ['통장10', '으로'],
  ])('숫자로 끝나는 %s 뒤에는 "%s"', (word, expected) => {
    expect(towardParticle(word)).toBe(expected)
  })

  it.each([
    ['급여(국민)', '으로'],
    ['카드 ', '로'],
    ['비상금.', '으로'],
  ])('끝의 괄호, 공백, 문장 부호는 건너뛰고 본다: %s', (word, expected) => {
    expect(towardParticle(word)).toBe(expected)
  })

  it.each(['KB Card', 'Toss', '', '!!'])('한글이나 숫자로 끝나지 않으면(%s) 받침을 알 수 없어 "(으)로"', (word) => {
    expect(towardParticle(word)).toBe('(으)로')
  })
})
