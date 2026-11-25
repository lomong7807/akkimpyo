// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { hasUnusableCharacter, trimWhiteSpace } from '../src/features/auth/visibleText'

/** 보이지 않는 글자를 시험 이름에서 알아보게 적는다. */
const named = (text: string) =>
  [...text].map((character) => `U+${character.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`).join(' ')

const table = (texts: string[]) => texts.map((text) => [named(text), text])

describe('쓸 수 있는 글자(P-214)', () => {
  it.each(table(['이서연', 'Kim Seo-yeon 2', '이서연'.normalize('NFD'), 'Jos\u00E9', '가\u00A0나', '가\u3000나', '']))(
    '글: %s',
    (_, text) => {
      expect(hasUnusableCharacter(text)).toBe(false)
    },
  )

  it.each(
    table([
      '\u{1F600}',
      // 가족
      '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}\u200D\u{1F466}',
      // 피부색이 든 직업, 피부색이 든 두 사람
      '\u{1F469}\u{1F3FD}\u200D\u{1F4BB}',
      '\u{1F9D1}\u{1F3FB}\u200D\u{1F91D}\u200D\u{1F9D1}\u{1F3FF}',
      // 하트, 불붙은 하트, 무지개 깃발, 해적 깃발
      '\u2764\uFE0F',
      '\u2764\uFE0F\u200D\u{1F525}',
      '\u{1F3F3}\uFE0F\u200D\u{1F308}',
      '\u{1F3F4}\u200D\u2620\uFE0F',
      // 글자 모양과 피부색을 함께 적은 이모지
      '\u261D\uFE0F\u{1F3FD}',
      '\u00A9\uFE0F',
      // 국기
      '\u{1F1F0}\u{1F1F7}',
      // 키캡
      '1\uFE0F\u20E3',
      '#\uFE0F\u20E3',
      '*\uFE0F\u20E3',
      '1\uFE0F\u20E32\uFE0F\u20E3',
    ]),
  )('이모지: %s', (_, text) => {
    expect(hasUnusableCharacter(text)).toBe(false)
    expect(hasUnusableCharacter(`앞${text}뒤`)).toBe(false)
  })

  // 쓸 수 없는 글자의 바로 옆 글자
  it.each(table(['\u034E', '\u0350', '\u115E', '\u1161', '\u17B3', '\u180A', '\u1810', '\u27FF', '\u2801', '\u3163', '\u3165', '\uFFA1', '\uFE10']))(
    '목록의 바로 옆: %s',
    (_, text) => {
      expect(hasUnusableCharacter(text)).toBe(false)
    },
  )
})

describe('쓸 수 없는 글자(P-214)', () => {
  it.each(
    table([
      // 제어 문자
      '\u0000',
      '\u0007',
      '\t',
      '\n',
      '\u001F',
      '\u007F',
      '\u0085',
      '\u009F',
      // 줄·문단 구분 문자
      '\u2028',
      '\u2029',
      // 서식 문자
      '\u00AD',
      '\u061C',
      '\u200B',
      '\u200C',
      '\u200E',
      '\u202E',
      '\u2060',
      '\u2066',
      '\uFEFF',
      '\u{E0001}',
      '\u{E007F}',
      // 보이지 않는 글자
      '\u034F',
      '\u115F',
      '\u1160',
      '\u17B4',
      '\u17B5',
      '\u180B',
      '\u180E',
      '\u180F',
      '\u2800',
      '\u3164',
      '\uFFA0',
      '\uFE00',
      '\uFE0E',
      '\u{E0100}',
      '\u{E01EF}',
    ]),
  )('%s', (_, text) => {
    expect(hasUnusableCharacter(text)).toBe(true)
    expect(hasUnusableCharacter(`앞${text}뒤`)).toBe(true)
  })

  it.each(
    table([
      // 이모지 사이가 아닌 U+200D
      '\u200D',
      '가\u200D나',
      '\u{1F468}\u200D',
      '\u200D\u{1F469}',
      '\u{1F468}\u200D가',
      '가\u200D\u{1F469}',
      '\u{1F468}\u200D\u200D\u{1F469}',
      '1\u200D\u{1F469}',
      // 이모지 바로 뒤나 키캡 속이 아닌 U+FE0F
      '\uFE0F',
      '가\uFE0F',
      '\u2764\uFE0F\uFE0F',
      '\u2764가\uFE0F',
      '1\uFE0F',
      '1\uFE0F가',
      'a\uFE0F\u20E3',
      '\uFE0F\u20E3',
      // 글자 모양으로 고르는 선택자와, 꼬리표(Cf)로 이루는 깃발
      '\u2764\uFE0E',
      '\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}',
      // 쓸 수 있는 이모지와 함께 있어도
      '\u2764\uFE0F\u200B',
      '1\uFE0F\u20E3\uFE0F',
    ]),
  )('이모지를 이루지 않는 자리: %s', (_, text) => {
    expect(hasUnusableCharacter(text)).toBe(true)
  })

  it('여러 번 물어도 답이 같다', () => {
    expect([1, 2, 3].map(() => hasUnusableCharacter('가\u200B나'))).toEqual([true, true, true])
    expect([1, 2, 3].map(() => hasUnusableCharacter('\u2764\uFE0F'))).toEqual([false, false, false])
  })
})

describe('앞뒤의 공백류 글자(유니코드 White_Space)', () => {
  it.each(
    table([
      ...'\t\n\v\f\r \u0085\u00A0\u1680\u2000\u2001\u2002\u2003\u2004\u2005\u2006\u2007\u2008\u2009\u200A\u2028\u2029\u202F\u205F\u3000',
    ]),
  )('%s는 앞뒤에서 모두 지우고 가운데는 남긴다', (_, space) => {
    expect(trimWhiteSpace(`${space}${space}가${space}나${space}`)).toBe(`가${space}나`)
    expect(trimWhiteSpace(space)).toBe('')
  })

  it.each(table(['\u200B', '\uFEFF', '\u180E', '\u3164', '\u2800']))('공백류가 아닌 %s는 남긴다', (_, text) => {
    expect(trimWhiteSpace(`${text}가${text}`)).toBe(`${text}가${text}`)
  })
})
