// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { accountAddMessages, toNewAccount, validateAccount } from '../src/features/accounts/accountForm'
import { nameRequired, nameTooLong, nameUnusable, validateSignup } from '../src/features/auth/signupForm'
import {
  memoTooLong,
  newTransactionValues,
  payeeTooLong,
  toNewTransaction,
  unusableCharacter,
  validateTransaction,
} from '../src/features/transactions/transactionForm'
import { normalizeName, TRIMMED_SPACES } from '../src/lib/visibleText'

/*
 * 서버의 글자 규칙(P-214, #123)과 화면의 미리 검사가 같은 답을 내는지(#220).
 * 값 목록은 server/src/test/java/app/accountbook/common/UserTextTest.java(a61768c, PR #217)에서 그대로 옮겼다.
 * 메서드 이름을 각 묶음의 제목에 적었다. 글자는 `\uXXXX`를 `\u{XXXX}`로만 바꿔 적었다.
 * 서버의 FieldErrorCode 대신 화면이 그 칸에 보이는 문구를 같은 코드로 읽는다.
 * 저장된 값의 비교용 맞추기(comparablePayee, comparableMemo)는 서버의 재전송 비교에만 쓰여 옮기지 않았다.
 */

const NAME_MAX = 20
type FieldErrorCode = 'REQUIRED' | 'INVALID_FORMAT' | 'TOO_LONG'
/** 서버가 돌려주는 값(받았을 때)이나 FieldErrorCode(거부했을 때) */
type Outcome = { value: string | null } | FieldErrorCode

const ZWJ = '\u{200D}'
const VS16 = '\u{FE0F}'
const KEYCAP = '\u{20E3}'
const FAMILY = '\u{D83D}\u{DC68}' + ZWJ + '\u{D83D}\u{DC69}' + ZWJ + '\u{D83D}\u{DC67}'

/** 보이지 않는 글자(P-214)의 목록 그대로. 범위는 끝을 포함한다. */
const INVISIBLE = [
  [0x034f, 0x034f], [0x115f, 0x1160], [0x17b4, 0x17b5],
  [0x180b, 0x180f], [0x2800, 0x2800], [0x3164, 0x3164],
  [0xffa0, 0xffa0], [0xfe00, 0xfe0f], [0xe0100, 0xe01ef],
]

const nfd = (text: string) => text.normalize('NFD')
const nfc = (text: string) => text.normalize('NFC')
const codeOf = (message: string | undefined, codes: Record<string, FieldErrorCode>) => {
  if (message === undefined) return undefined
  const code = codes[message]
  if (code === undefined) throw new Error(`모르는 문구: ${message}`)
  return code
}

/** 표시 이름(가입, 20자). 서버 UserText.name(raw, 20, "displayName") 자리 */
function displayName(raw: string): Outcome {
  const message = validateSignup({ email: 'seoyeon@example.com', password: 'abcd1234', passwordConfirm: 'abcd1234', displayName: raw })
    .displayName
  const code = codeOf(message, { [nameRequired]: 'REQUIRED', [nameUnusable]: 'INVALID_FORMAT', [nameTooLong]: 'TOO_LONG' })
  // 가입은 쓴 값을 조합형으로만 맞춰 보내고 서버가 앞뒤를 지운다. 서버가 저장할 값은 normalizeName과 같다
  return code ?? { value: normalizeName(raw) }
}

/** 계좌 이름(50자). 서버 UserText.name(raw, 50, "name") 자리. 글자 수를 보는 묶음은 20자인 표시 이름으로 본다 */
function accountName(raw: string): Outcome {
  const account = { name: raw, type: 'BANK', openingBalance: 0, negative: false, openingDate: '2026-11-26' } as const
  const m = accountAddMessages
  const code = codeOf(validateAccount(account).name, {
    [m.nameRequired]: 'REQUIRED',
    [m.nameUnusable]: 'INVALID_FORMAT',
    [m.nameTooLong]: 'TOO_LONG',
  })
  return code ?? { value: toNewAccount(account).name }
}

function transaction(payee: string, memo: string) {
  const values = { ...newTransactionValues(), amount: 12000, accountId: 'account-1', payee, memo }
  const errors = validateTransaction(values)
  const sent = toNewTransaction(values, 'transaction-1')
  if (sent.type === 'TRANSFER') throw new Error('지출로 본다')
  return { errors, sent }
}

const transactionCodes = { [unusableCharacter]: 'INVALID_FORMAT', [payeeTooLong]: 'TOO_LONG', [memoTooLong]: 'TOO_LONG' } as const

/** 가맹점/내용. 서버 UserText.payee(raw, 100) 자리. 보내는 값이 서버가 저장할 값이다 */
function payee(raw: string): Outcome {
  const { errors, sent } = transaction(raw, '')
  return codeOf(errors.payee, transactionCodes) ?? { value: sent.payee }
}

/**
 * 메모. 서버 UserText.memo(raw, 500) 자리. 화면은 조합형으로만 맞춰 보내고 `\r\n`·`\r`을 `\n`으로 바꾸는 것은
 * 서버다. 받는 값을 비교할 때는 서버가 바꾼 값과 비교한다.
 */
function memo(raw: string): Outcome {
  const { errors, sent } = transaction('', raw)
  const code = codeOf(errors.memo, transactionCodes)
  return code ?? { value: sent.memo === null ? null : sent.memo.replace(/\r\n?/g, '\n') }
}

const kept = (value: string | null): Outcome => ({ value })

const codePoints = (test: RegExp) => {
  const found: number[] = []
  for (let cp = 0; cp <= 0x10ffff; cp += 1) {
    if (cp >= 0xd800 && cp <= 0xdfff) continue
    if (test.test(String.fromCodePoint(cp))) found.push(cp)
  }
  return found
}
const label = (cp: number) => `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`

/** assertRejectedEverywhereInName: 처음, 가운데, 끝 */
function expectRejectedEverywhereInName(cp: number) {
  const character = String.fromCodePoint(cp)
  for (const text of [character + '식비', '식' + character + '비', '식비' + character]) {
    expect(displayName(text), label(cp)).toBe('INVALID_FORMAT')
    expect(accountName(text), label(cp)).toBe('INVALID_FORMAT')
  }
}

describe('조합형(NFC)과 글자 수', () => {
  it('nameIsStoredInComposedForm', () => {
    const decomposed = nfd('식비')
    expect(decomposed).toHaveLength(5)
    expect(displayName(decomposed)).toEqual(kept('식비'))
    expect(accountName(decomposed)).toEqual(kept('식비'))
  })

  it('lengthIsCountedAfterComposing', () => {
    // 분해형 한글 20자는 코드포인트로 60개지만 조합형 20자다.
    const decomposedTwenty = nfd('가각간갇갈감갑갓강갖갗같갚갛개객갠갤갬갭')
    expect([...decomposedTwenty].length).toBeGreaterThan(NAME_MAX)
    expect(displayName(decomposedTwenty)).toEqual(kept(nfc(decomposedTwenty)))
    expect(displayName(nfd('가'.repeat(21)))).toBe('TOO_LONG')
  })

  it('lengthIsCountedInCodePoints', () => {
    const twentyEmoji = '\u{D83D}\u{DE00}'.repeat(20)
    expect(displayName(twentyEmoji)).toEqual(kept(twentyEmoji))
    expect(displayName('\u{D83D}\u{DE00}'.repeat(21))).toBe('TOO_LONG')
  })
})

describe('거부 글자', () => {
  it('everyControlCharacterIsRejected', () => {
    // Cc: U+0000~U+001F, U+007F~U+009F
    const controls = codePoints(/^\p{Cc}$/u)
    expect(controls).toHaveLength(65)
    expect(controls).toEqual(expect.arrayContaining([0x0000, 0x0009, 0x000a, 0x000d, 0x001f, 0x007f, 0x0085, 0x009f]))
    controls.forEach(expectRejectedEverywhereInName)
  })

  it('lineAndParagraphSeparatorsAreRejected', () => {
    expectRejectedEverywhereInName(0x2028)
    expectRejectedEverywhereInName(0x2029)
  })

  it('everyFormatCharacterIsRejected', () => {
    const formats = codePoints(/^\p{Cf}$/u)
    // 폭 없는 공백, 방향 제어, BOM, 단어 잇기, 태그 문자 같은 것이 들어 있는지 본다.
    expect(formats).toEqual(
      expect.arrayContaining([0x00ad, 0x061c, 0x180e, 0x200b, 0x200c, 0x200d, 0x200e, 0x200f, 0x202a,
        0x202e, 0x2060, 0x2066, 0x2069, 0xfeff, 0xfff9, 0xe0001, 0xe0020, 0xe007f]),
    )
    formats.forEach(expectRejectedEverywhereInName)
  })

  it('everyListedInvisibleCharacterIsRejected', () => {
    INVISIBLE.forEach(([first, last]) => {
      for (let cp = first; cp <= last; cp += 1) expectRejectedEverywhereInName(cp)
    })
  })

  it.each(['\u{200D}', '\u{FE0F}', '\u{3164}'])('nameEndingWithInvisibleCharacterIsRejected: %#', (invisible) => {
    expect(displayName('식비' + invisible)).toBe('INVALID_FORMAT')
    expect(accountName('식비' + invisible)).toBe('INVALID_FORMAT')
  })

  it('nameOfOnlyHangulFillerIsRejected', () => {
    // U+3164는 strip()으로 비지 않는 글자라 지우지 않고 거부한다.
    expect(displayName('\u{3164}')).toBe('INVALID_FORMAT')
    expect(displayName('\u{3164}\u{3164}')).toBe('INVALID_FORMAT')
  })

  it('rejectionDoesNotEchoTheInput', () => {
    const message = validateSignup({ email: '', password: '', passwordConfirm: '', displayName: '비밀이름\u{200B}' }).displayName
    expect(message).toBe(nameUnusable)
    expect(message).not.toContain('비밀이름')
  })
})

describe('이모지를 이루는 자리의 예외', () => {
  it.each([
    FAMILY, // 가족: 이모지 U+200D 이모지 U+200D 이모지
    '1' + VS16 + KEYCAP, '#' + VS16 + KEYCAP, '*' + VS16 + KEYCAP, '0' + VS16 + KEYCAP, '9' + VS16 + KEYCAP,
    '\u{2764}' + VS16, // 빨간 하트: 이모지 바로 뒤의 U+FE0F
    '\u{2764}' + VS16 + ZWJ + '\u{D83D}\u{DD25}', // 불붙은 하트: U+FE0F가 붙은 이모지 뒤의 U+200D
    '\u{D83E}\u{DDD1}\u{D83C}\u{DFFD}' + ZWJ + '\u{D83D}\u{DCBB}', // 노트북 쓰는 사람(피부색): 피부색이 붙은 이모지 뒤의 U+200D
    '\u{D83C}\u{DFF3}' + VS16 + ZWJ + '\u{D83C}\u{DF08}', // 무지개 깃발
    '\u{D83C}\u{DFC3}\u{D83C}\u{DFFD}' + ZWJ + '\u{2642}' + VS16, // 달리는 남자(피부색): 피부색 뒤 U+200D, 이모지 뒤 U+FE0F
    '\u{D83D}\u{DC4D}\u{D83C}\u{DFFD}', // 엄지(피부색): 피부색만
    '\u{D83C}\u{DDF0}\u{D83C}\u{DDF7}', // 태극기: 지역 표시 글자 둘
    '1' + KEYCAP, // U+FE0F 없는 키캡
  ])('emojiSequencesAreKept: %#', (emoji) => {
    expect(displayName('가족 ' + emoji)).toEqual(kept('가족 ' + emoji))
    expect(displayName(emoji)).toEqual(kept(emoji))
    expect(accountName(emoji)).toEqual(kept(emoji))
    expect(payee(emoji + '카페')).toEqual(kept(emoji + '카페'))
    expect(memo(emoji + '\n' + emoji)).toEqual(kept(emoji + '\n' + emoji))
  })

  it.each([
    ZWJ + '\u{D83D}\u{DE00}', // 앞이 없다
    '\u{D83D}\u{DE00}' + ZWJ, // 뒤가 없다
    '식' + ZWJ + '\u{D83D}\u{DE00}', // 앞이 이모지가 아니다
    '\u{D83D}\u{DE00}' + ZWJ + '식', // 뒤가 이모지가 아니다
    '\u{D83D}\u{DE00}' + ZWJ + ZWJ + '\u{D83D}\u{DE00}', // 겹친 U+200D
    '\u{D83D}\u{DE00}' + VS16 + VS16, // 겹친 U+FE0F
    '식' + VS16, // 이모지가 아닌 글자 뒤
    '1' + VS16, // 키캡이 아닌 숫자 뒤
    'a' + VS16 + KEYCAP, // 0-9 # * 가 아닌 글자와 U+20E3 사이
    '\u{D83D}\u{DC4D}\u{D83C}\u{DFFD}' + VS16, // 피부색 뒤의 U+FE0F
    '\u{2764}\u{FE0E}', // 글자 모양 선택자(U+FE0E)는 이모지 뒤여도 거부한다
    '\u{D83D}\u{DE00}' + VS16 + '\u{FE01}', // 다른 변형 선택자
    // 잉글랜드 깃발: 태그 문자(Cf)라 거부한다(받아들임, security)
    '\u{D83C}\u{DFF4}\u{DB40}\u{DC67}\u{DB40}\u{DC62}\u{DB40}\u{DC65}\u{DB40}\u{DC6E}\u{DB40}\u{DC67}\u{DB40}\u{DC7F}',
  ])('joinerAndSelectorOutsideEmojiAreRejected: %#', (text) => {
    expect(displayName(text)).toBe('INVALID_FORMAT')
    expect(accountName(text)).toBe('INVALID_FORMAT')
    expect(payee(text)).toBe('INVALID_FORMAT')
    expect(memo(text)).toBe('INVALID_FORMAT')
  })
})

describe('짝 없는 서로게이트(#164)', () => {
  it.each([
    '\u{D800}식비', '식\u{D800}비', '식비\u{D800}', // 앞(high)만: 처음, 가운데, 끝
    '\u{DC00}식비', '식\u{DC00}비', '식비\u{DC00}', // 뒤(low)만: 처음, 가운데, 끝
    '식\u{DE00}\u{D83D}비', // 순서가 뒤집힌 짝
    '\u{D800}', 'a\u{D800}b',
  ])('unpairedSurrogateIsRejectedEverywhere: %#', (text) => {
    expect(displayName(text)).toBe('INVALID_FORMAT')
    expect(accountName(text)).toBe('INVALID_FORMAT')
    expect(payee(text)).toBe('INVALID_FORMAT')
    // 메모도 예외가 없다.
    expect(memo(text)).toBe('INVALID_FORMAT')
  })

  it('unpairedSurrogateIsRejectedBeforeLengthIsCounted', () => {
    // 글자 수를 넘는 값이어도 서로게이트 오류다. 검사가 글자 수보다 먼저다.
    expect(displayName('가'.repeat(30) + '\u{D800}')).toBe('INVALID_FORMAT')
  })

  it('pairedSurrogatesAreKept', () => {
    expect(displayName('\u{D83D}\u{DE00}식비')).toEqual(kept('\u{D83D}\u{DE00}식비'))
    expect(payee('a\u{D83D}\u{DE00}b')).toEqual(kept('a\u{D83D}\u{DE00}b'))
    expect(memo('a\u{D83D}\u{DE00}b')).toEqual(kept('a\u{D83D}\u{DE00}b'))
  })
})

describe('앞뒤 공백류', () => {
  it('trimmedSpacesAreExactlyTheSpaceSeparatorsOfJava', () => {
    const spaceSeparators = String.fromCodePoint(...codePoints(/^\p{Zs}$/u))
    expect(TRIMMED_SPACES).toBe(spaceSeparators)
    expect(TRIMMED_SPACES).toHaveLength(17)
    expect(TRIMMED_SPACES).toContain('\u{A0}')
    expect(TRIMMED_SPACES).toContain('\u{3000}')
  })

  it('everySpaceAroundNameIsTrimmedAndInnerSpaceIsKept', () => {
    ;[...TRIMMED_SPACES].forEach((s) => {
      // 가운데의 U+2000, U+2001은 NFC에서 U+2002, U+2003이 된다.
      expect(displayName(s + s + '식' + s + '비' + s), label(s.codePointAt(0)!)).toEqual(kept(nfc('식' + s + '비')))
      expect(accountName(s + s + '식' + s + '비' + s), label(s.codePointAt(0)!)).toEqual(kept(nfc('식' + s + '비')))
    })
  })

  it('nameOfOnlySpacesIsRequired', () => {
    for (const text of [TRIMMED_SPACES, '\u{A0}', '\u{3000}\u{3000}', '']) {
      expect(displayName(text)).toBe('REQUIRED')
      expect(accountName(text)).toBe('REQUIRED')
    }
  })

  it('controlCharacterAtTheEdgeIsRejectedNotTrimmed', () => {
    // 거부 검사가 지우기보다 먼저다. 탭과 줄바꿈은 공백류가 아니라 제어 문자다.
    for (const text of ['식비\t', '\n식비', '\t\n']) {
      expect(displayName(text)).toBe('INVALID_FORMAT')
      expect(accountName(text)).toBe('INVALID_FORMAT')
    }
  })

  it('lengthIsCountedAfterTrimming', () => {
    expect(displayName('\u{3000}' + '가'.repeat(20) + '\u{A0}')).toEqual(kept('가'.repeat(20)))
  })
})

describe('가맹점', () => {
  it('payeeIsTrimmedAndComposed', () => {
    expect(payee('\u{3000} ' + nfd('김밥천국') + '\u{A0}')).toEqual(kept('김밥천국'))
    expect(payee('김밥 천국')).toEqual(kept('김밥 천국'))
  })

  it('emptyOrBlankPayeeIsStoredAsNothing', () => {
    expect(payee('')).toEqual(kept(null))
    expect(payee('   ')).toEqual(kept(null))
    expect(payee(TRIMMED_SPACES)).toEqual(kept(null))
  })

  it('payeeLengthIsCountedAfterComposing', () => {
    expect(payee(nfd('가'.repeat(100)))).toEqual(kept('가'.repeat(100)))
    expect(payee('가'.repeat(101))).toBe('TOO_LONG')
  })

  it.each(['\t', '\n', '\r', '\u{0000}', '\u{0085}', '\u{2028}', '\u{200B}', '\u{202E}', '\u{3164}'])(
    'payeeRejectsTheSameCharactersAsNames: %#',
    (forbidden) => {
      expect(payee('김밥' + forbidden + '천국')).toBe('INVALID_FORMAT')
    },
  )
})

describe('메모', () => {
  it('memoKeepsLineFeedAndConvertsOtherLineEndings', () => {
    expect(memo('점심\n저녁')).toEqual(kept('점심\n저녁'))
    expect(memo('점심\r\n저녁')).toEqual(kept('점심\n저녁'))
    expect(memo('점심\r저녁')).toEqual(kept('점심\n저녁'))
    expect(memo('a\r\n\rb\n\r\nc\r')).toEqual(kept('a\n\nb\n\nc\n'))
  })

  it('memoIsNotTrimmed', () => {
    expect(memo('  점심 \u{3000}')).toEqual(kept('  점심 \u{3000}'))
    expect(memo('   ')).toEqual(kept('   '))
    expect(memo('\n점심\n')).toEqual(kept('\n점심\n'))
  })

  it('emptyMemoIsStoredAsNothing', () => {
    expect(memo('')).toEqual(kept(null))
  })

  it('memoIsComposed', () => {
    expect(memo(nfd('떡볶이\n순대'))).toEqual(kept('떡볶이\n순대'))
  })

  it('memoLengthIsCountedAfterConvertingAndComposing', () => {
    // \r\n 250개는 바꾸면 \n 250개다.
    expect(memo('\r\n'.repeat(250) + nfd('가'.repeat(250)))).toEqual(kept('\n'.repeat(250) + '가'.repeat(250)))
    expect(memo('가'.repeat(501))).toBe('TOO_LONG')
  })

  it.each(['\t', '\u{000B}', '\u{000C}', '\u{0000}', '\u{007F}', '\u{0085}', '\u{2028}', '\u{2029}', '\u{200B}',
    '\u{200E}', '\u{FEFF}', '\u{3164}', '\u{2800}', '\u{FE00}'])('memoAllowsOnlyLineFeedBeyondNames: %#', (forbidden) => {
    expect(memo('점심' + forbidden + '저녁')).toBe('INVALID_FORMAT')
  })
})
