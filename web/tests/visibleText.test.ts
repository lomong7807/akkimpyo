// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { hasUnusableCharacter, lengthOf, normalizeName, TRIMMED_SPACES, trimSpaces } from '../src/lib/visibleText'

/** 보이지 않는 글자를 시험 이름에서 알아보게 적는다. */
const named = (text: string) =>
  [...text].map((character) => `U+${character.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`).join(' ')

const table = (texts: string[]) => texts.map((text) => [named(text), text])

describe('쓸 수 있는 글자(P-214)', () => {
  it.each(table(['이서연', 'Kim Seo-yeon 2', '이서연'.normalize('NFD'), 'Jos\u{E9}', '가\u{A0}나', '가\u{3000}나', '']))(
    '글: %s',
    (_, text) => {
      expect(hasUnusableCharacter(text)).toBe(false)
    },
  )

  it.each(
    table([
      '\u{1F600}',
      // 가족
      '\u{1F468}\u{200D}\u{1F469}\u{200D}\u{1F467}\u{200D}\u{1F466}',
      // 피부색이 든 직업, 피부색이 든 두 사람
      '\u{1F469}\u{1F3FD}\u{200D}\u{1F4BB}',
      '\u{1F9D1}\u{1F3FB}\u{200D}\u{1F91D}\u{200D}\u{1F9D1}\u{1F3FF}',
      // 하트, 불붙은 하트, 무지개 깃발, 해적 깃발
      '\u{2764}\u{FE0F}',
      '\u{2764}\u{FE0F}\u{200D}\u{1F525}',
      '\u{1F3F3}\u{FE0F}\u{200D}\u{1F308}',
      '\u{1F3F4}\u{200D}\u{2620}\u{FE0F}',
      // 글자 모양과 피부색을 함께 적은 이모지
      '\u{261D}\u{FE0F}\u{1F3FD}',
      '\u{A9}\u{FE0F}',
      // 국기
      '\u{1F1F0}\u{1F1F7}',
      // 키캡, U+FE0F 없는 키캡
      '1\u{FE0F}\u{20E3}',
      '#\u{FE0F}\u{20E3}',
      '*\u{FE0F}\u{20E3}',
      '1\u{FE0F}\u{20E3}2\u{FE0F}\u{20E3}',
      '1\u{20E3}',
      // 홀로 선 피부색과 U+20E3은 거부 글자가 아니다
      '\u{1F3FD}',
      'a\u{20E3}',
    ]),
  )('이모지: %s', (_, text) => {
    expect(hasUnusableCharacter(text)).toBe(false)
    expect(hasUnusableCharacter(`앞${text}뒤`)).toBe(false)
  })

  // 쓸 수 없는 글자의 바로 옆 글자
  it.each(
    table(['\u{34E}', '\u{350}', '\u{115E}', '\u{1161}', '\u{17B3}', '\u{180A}', '\u{1810}', '\u{27FF}', '\u{2801}', '\u{3163}', '\u{3165}', '\u{FFA1}', '\u{FE10}']),
  )('목록의 바로 옆: %s', (_, text) => {
    expect(hasUnusableCharacter(text)).toBe(false)
  })
})

describe('쓸 수 없는 글자(P-214)', () => {
  it.each(
    table([
      // 제어 문자
      '\u{0}',
      '\u{7}',
      '\t',
      '\n',
      '\r',
      '\u{1F}',
      '\u{7F}',
      '\u{85}',
      '\u{9F}',
      // 줄·문단 구분 문자
      '\u{2028}',
      '\u{2029}',
      // 서식 문자
      '\u{AD}',
      '\u{61C}',
      '\u{200B}',
      '\u{200C}',
      '\u{200E}',
      '\u{202E}',
      '\u{2060}',
      '\u{2066}',
      '\u{FEFF}',
      '\u{E0001}',
      '\u{E007F}',
      // 보이지 않는 글자
      '\u{34F}',
      '\u{115F}',
      '\u{1160}',
      '\u{17B4}',
      '\u{17B5}',
      '\u{180B}',
      '\u{180E}',
      '\u{180F}',
      '\u{2800}',
      '\u{3164}',
      '\u{FFA0}',
      '\u{FE00}',
      '\u{FE0E}',
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
      '\u{200D}',
      '가\u{200D}나',
      '\u{1F468}\u{200D}',
      '\u{200D}\u{1F469}',
      '\u{1F468}\u{200D}가',
      '가\u{200D}\u{1F469}',
      '\u{1F468}\u{200D}\u{200D}\u{1F469}',
      '1\u{200D}\u{1F469}',
      // U+200D의 앞은 이모지 하나이거나 이모지 뒤에 피부색이나 U+FE0F가 하나만 붙은 것이다(서버 endsEmoji).
      // U+FE0F와 피부색이 함께 붙거나 피부색이 겹치거나 피부색만 있으면 받지 않는다
      '\u{261D}\u{FE0F}\u{1F3FD}\u{200D}\u{1F525}',
      '\u{1F600}\u{1F3FD}\u{1F3FD}\u{200D}\u{1F600}',
      '\u{1F3FD}\u{200D}\u{1F600}',
      // 이모지 바로 뒤나 키캡 속이 아닌 U+FE0F
      '\u{FE0F}',
      '가\u{FE0F}',
      '\u{2764}\u{FE0F}\u{FE0F}',
      '\u{2764}가\u{FE0F}',
      '1\u{FE0F}',
      '1\u{FE0F}가',
      'a\u{FE0F}\u{20E3}',
      '\u{FE0F}\u{20E3}',
      '\u{1F44D}\u{1F3FD}\u{FE0F}',
      // 글자 모양으로 고르는 선택자와, 꼬리표(Cf)로 이루는 깃발
      '\u{2764}\u{FE0E}',
      '\u{1F3F4}\u{E0067}\u{E0062}\u{E0065}\u{E006E}\u{E0067}\u{E007F}',
      // 쓸 수 있는 이모지와 함께 있어도
      '\u{2764}\u{FE0F}\u{200B}',
      '1\u{FE0F}\u{20E3}\u{FE0F}',
    ]),
  )('이모지를 이루지 않는 자리: %s', (_, text) => {
    expect(hasUnusableCharacter(text)).toBe(true)
  })

  it.each([
    ['짝 없는 앞쪽', '\u{D83D}'],
    ['짝 없는 뒤쪽', '\u{DE00}'],
    ['순서가 바뀐 짝', '\u{DE00}\u{D83D}'],
    ['이모지를 사이에 둔 짝', '\u{D83D}\u{2764}\u{FE0F}\u{DE00}'],
    ['앞쪽이 겹친 짝', '\u{D83D}\u{D83D}\u{DE00}'],
  ])('서로게이트: %s', (_, text) => {
    expect(hasUnusableCharacter(text)).toBe(true)
    expect(hasUnusableCharacter(`앞${text}뒤`)).toBe(true)
  })

  it('짝이 맞는 서로게이트는 글자 하나다', () => {
    expect(hasUnusableCharacter('\u{D83D}\u{DE00}')).toBe(false)
    // 이모지가 아닌 글자(한자 확장)
    expect(hasUnusableCharacter('\u{D840}\u{DC00}')).toBe(false)
  })

  it('여러 번 물어도 답이 같다', () => {
    expect([1, 2, 3].map(() => hasUnusableCharacter('가\u{200B}나'))).toEqual([true, true, true])
    expect([1, 2, 3].map(() => hasUnusableCharacter('\u{2764}\u{FE0F}'))).toEqual([false, false, false])
  })
})

describe('앞뒤의 공백류 글자(유니코드 Zs 17자)', () => {
  it('서버 UserText.TRIMMED_SPACES와 같은 17자다', () => {
    expect(named(TRIMMED_SPACES)).toBe(
      'U+0020 U+00A0 U+1680 U+2000 U+2001 U+2002 U+2003 U+2004 U+2005 U+2006 U+2007 U+2008 U+2009 U+200A U+202F U+205F U+3000',
    )
  })

  it.each(table([...TRIMMED_SPACES]))('%s는 앞뒤에서 모두 지우고 가운데는 남긴다', (_, space) => {
    expect(trimSpaces(`${space}${space}가${space}나${space}`)).toBe(`가${space}나`)
    expect(trimSpaces(space)).toBe('')
  })

  // 서버가 거부하는 글자라서 지우면 화면이 미리 알리지 못한다(#220)
  it.each(table([...'\t\n\u{B}\u{C}\r\u{85}\u{2028}\u{2029}']))('공백류가 아닌 공백 %s는 앞뒤에서도 지우지 않는다', (_, text) => {
    expect(trimSpaces(`${text}가${text}`)).toBe(`${text}가${text}`)
    expect(trimSpaces(` ${text} `)).toBe(text)
  })

  it('가운데에 긴 공백이 있어도 앞뒤만 지운다', () => {
    const middle = `가${' '.repeat(10_000)}나`
    expect(trimSpaces(`  ${middle}  `)).toBe(middle)
    expect(trimSpaces(' '.repeat(10_000))).toBe('')
  })

  it.each(table(['\u{200B}', '\u{FEFF}', '\u{180E}', '\u{3164}', '\u{2800}']))('공백류가 아닌 %s는 남긴다', (_, text) => {
    expect(trimSpaces(`${text}가${text}`)).toBe(`${text}가${text}`)
  })
})

describe('이름(P-214)', () => {
  it('앞뒤의 공백류를 지우고 조합형으로 맞춘다', () => {
    expect(normalizeName('\u{3000} 급여 통장\u{A0}')).toBe('급여 통장')
    expect(normalizeName('급여통장'.normalize('NFD'))).toBe('급여통장')
  })

  it('앞뒤의 탭과 줄바꿈은 지우지 않아 쓸 수 없는 글자로 남는다', () => {
    expect(normalizeName(' 급여통장\t')).toBe('급여통장\t')
    expect(hasUnusableCharacter(' 급여통장\t')).toBe(true)
  })

  it('코드포인트로 센다', () => {
    expect(lengthOf('급여통장')).toBe(4)
    expect(lengthOf('\u{1F600}')).toBe(1)
    expect(lengthOf('')).toBe(0)
  })
})
