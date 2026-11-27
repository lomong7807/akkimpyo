// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { detailPayeeOf, ONE_LINE_MAX, oneLineProblem, parseOneLine } from '../src/lib/oneLine'

/* 한 줄 입력 해석(F-210, 화면설계서 D-05 "한 줄 해석 규칙"). 기기에서 하는 순수 함수다. */

describe('화면설계서 D-05의 해석 표', () => {
  it.each([
    ['점심 12000', 12_000, '점심'],
    ['스타벅스 4,500원', 4_500, '스타벅스'],
    ['이마트 3.5만', 35_000, '이마트'],
    ['1만2천 택시', 12_000, '택시'],
    ['버스 2 1500', 1_500, '버스 2'],
    ['12000', 12_000, ''],
  ])('"%s"는 %d원, 가맹점/내용 "%s"', (text, amount, payee) => {
    expect(parseOneLine(text)).toEqual({ amount, payee })
  })

  it.each(['점심', '점심 0'])('"%s"는 실패한다', (text) => {
    expect(parseOneLine(text)).toBeUndefined()
  })
})

/** 조각 하나만 금액으로 읽는지. 앞에 가맹점 조각을 두고 본다 */
function amountOf(token: string): number | undefined {
  const parsed = parseOneLine(`가게 ${token}`)
  return parsed?.payee === '가게' ? parsed.amount : undefined
}

describe('금액 조각의 모양', () => {
  it.each([
    ['12000', 12_000],
    ['12,000', 12_000],
    ['1,234,567', 1_234_567],
    ['12000원', 12_000],
    ['12,000원', 12_000],
    ['012000', 12_000],
    ['1만2천', 12_000],
    ['1만2천원', 12_000],
    ['3.5만', 35_000],
    ['3.5만원', 35_000],
    ['2천', 2_000],
    ['2천원', 2_000],
    ['1만5000', 15_000],
    ['1만5,000', 15_000],
    ['2천500', 2_500],
    ['1만2천500', 12_500],
    ['10만', 100_000],
    ['1,000만', 10_000_000],
    ['1.5천', 1_500],
    ['0.5천', 500],
    ['3.55만', 35_500],
    ['1.2345만', 12_345],
    // 소수점 뒤의 0은 정수를 바꾸지 않는다
    ['3.50000만', 35_000],
    ['1.5만2천', 17_000],
  ])('"%s"는 %d원', (token, amount) => {
    expect(amountOf(token)).toBe(amount)
  })

  it.each([
    // 만·천 앞의 소수점은 결과가 정수일 때만 금액이다
    ['1.23456만'],
    ['1.2345천'],
    // 만·천이 없는 소수점은 금액이 아니다
    ['12.5'],
    ['3.5'],
    // "만"이나 "천"만 있는 조각
    ['만'],
    ['천'],
    ['만원'],
    ['천원'],
    ['만2천'],
    // 숫자 뒤에 다른 글자가 붙은 조각
    ['2인분'],
    ['12000원어치'],
    ['1만2천원짜리'],
    ['3시'],
    // 원만 있는 조각, 쉼표 자리가 틀린 조각
    ['원'],
    ['12,00'],
    ['1,2000'],
    [',12000'],
    ['12000,'],
    ['1,5만'],
    // 만과 천의 순서, 단위를 두 번
    ['2천1만'],
    ['1만1만'],
    ['1천2천'],
    // 소수점만, 점 뒤 숫자 없음
    ['3.만'],
    ['.5만'],
    // 부호, 다른 글자의 숫자, 다른 단위
    ['-12000'],
    ['+12000'],
    ['１２０００'],
    ['1억'],
    ['5백'],
  ])('"%s"는 금액 조각이 아니다', (token) => {
    expect(parseOneLine(`가게 ${token}`)).toBeUndefined()
    // 금액 조각이 따로 있으면 가맹점/내용에 남는다
    expect(parseOneLine(`가게 ${token} 1000`)).toEqual({ amount: 1_000, payee: `가게 ${token}` })
  })
})

describe('금액 조각이 여럿이면 마지막 조각이 금액이다', () => {
  it.each([
    ['버스 2 1500', 1_500, '버스 2'],
    ['1500 버스 2', 2, '1500 버스'],
    ['3 4 5', 5, '3 4'],
    ['1만 2천 택시', 2_000, '1만 택시'],
    ['점심 12000 2인분', 12_000, '점심 2인분'],
  ])('"%s"는 %d원, "%s"', (text, amount, payee) => {
    expect(parseOneLine(text)).toEqual({ amount, payee })
  })

  it('마지막 금액 조각이 범위 밖이면 앞 조각으로 물러나지 않고 실패한다', () => {
    expect(parseOneLine('점심 12000 0')).toBeUndefined()
    expect(parseOneLine('점심 12000 10000000000')).toBeUndefined()
  })
})

describe('금액의 범위(P-201)', () => {
  it.each([
    ['1', 1],
    ['9999999999', 9_999_999_999],
    ['9,999,999,999원', 9_999_999_999],
    ['999999.9999만', 9_999_999_999],
  ])('"%s"는 %d원', (token, amount) => {
    expect(amountOf(token)).toBe(amount)
  })

  it.each(['0', '0원', '0만', '0.0천', '10000000000', '1000000만', '99999999999999999999999', '9999999999.9999만'])(
    '"%s"는 범위 밖이라 실패한다',
    (token) => {
      expect(parseOneLine(`점심 ${token}`)).toBeUndefined()
    },
  )
})

describe('가맹점/내용(나머지 조각)', () => {
  it('금액 조각을 뺀 나머지를 공백 하나로 잇고 앞뒤 공백을 지운다', () => {
    expect(parseOneLine('  올래   국수    12000  ')).toEqual({ amount: 12_000, payee: '올래 국수' })
  })

  it('전각 공백과 줄 바꿈 없는 공백도 조각을 나눈다', () => {
    expect(parseOneLine('올래　국수 12000')).toEqual({ amount: 12_000, payee: '올래 국수' })
  })

  it('나머지가 100자를 넘으면 앞의 100자만 남긴다', () => {
    const long = '가'.repeat(60)
    const parsed = parseOneLine(`${long} ${long} 12000`)
    expect(parsed?.amount).toBe(12_000)
    expect([...parsed!.payee].length).toBe(100)
    expect(parsed!.payee).toBe(`${long} ${'가'.repeat(39)}`)
  })

  it('자른 끝이 공백이면 지운다', () => {
    // 앞의 100자는 '가' 99자와 공백이다
    const parsed = parseOneLine(`${'가'.repeat(99)} 나나 12000`)
    expect(parsed!.payee).toBe('가'.repeat(99))
  })

  it('이모지는 한 글자로 센다(서로게이트를 가르지 않는다)', () => {
    const parsed = parseOneLine(`${'😀'.repeat(101)} 12000`)
    expect(parsed!.payee).toBe('😀'.repeat(100))
  })

  it('분해형(맥에서 복사한 한글)도 조합형으로 맞춰 읽는다', () => {
    expect(parseOneLine('점심 1만2천'.normalize('NFD'))).toEqual({ amount: 12_000, payee: '점심' })
  })
})

describe('입력칸의 글(1~100자, F-210)', () => {
  it.each([
    ['', 'empty'],
    ['   ', 'empty'],
    ['　', 'empty'],
    ['가'.repeat(ONE_LINE_MAX + 1), 'too-long'],
    [`${'가'.repeat(ONE_LINE_MAX)}나`, 'too-long'],
  ])('"%s"는 %s', (text, problem) => {
    expect(oneLineProblem(text)).toBe(problem)
  })

  it.each([
    ['점심'],
    ['가'.repeat(ONE_LINE_MAX)],
    // 앞뒤 공백은 세지 않는다
    [`  ${'가'.repeat(ONE_LINE_MAX)}  `],
    // 분해형은 조합형으로 맞춰 센다
    ['한'.repeat(ONE_LINE_MAX).normalize('NFD')],
    ['😀'.repeat(ONE_LINE_MAX)],
  ])('"%s"는 받는다', (text) => {
    expect(oneLineProblem(text)).toBeUndefined()
  })
})

describe('"자세히 입력"이 가맹점/내용에 채우는 글', () => {
  it('글 전체를 앞뒤 공백만 지워 채운다', () => {
    expect(detailPayeeOf('  점심  먹음 ')).toBe('점심  먹음')
  })

  it('100자까지만 채운다', () => {
    expect(detailPayeeOf('가'.repeat(120))).toBe('가'.repeat(100))
  })
})
