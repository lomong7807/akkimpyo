// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { trimEmail } from '../src/features/auth/email'

const named = (code: number) => [`U+${code.toString(16).toUpperCase().padStart(4, '0')}`, String.fromCharCode(code)]

describe('이메일의 앞뒤 공백(P-101)', () => {
  it.each([0x20, 0x09, 0x0a, 0x0c, 0x0d].map(named))('%s는 앞뒤에서 모두 지우고 가운데는 남긴다', (_, space) => {
    expect(trimEmail(`${space}${space}a${space}b${space}`)).toBe(`a${space}b`)
    expect(trimEmail(space)).toBe('')
  })

  // trim()이 지우지만 서버는 거부하는 글자
  it.each([0x0b, 0x85, 0xa0, 0x2028, 0x3000, 0xfeff].map(named))('%s는 남긴다', (_, character) => {
    expect(trimEmail(`${character}a${character}`)).toBe(`${character}a${character}`)
  })

  it('다섯 글자가 섞여 있어도 모두 지운다', () => {
    const all = String.fromCharCode(0x20, 0x09, 0x0a, 0x0c, 0x0d)
    expect(trimEmail(`${all}a@b${all}`)).toBe('a@b')
  })

  it('가운데에 긴 공백이 있어도 앞뒤만 지운다', () => {
    const middle = `a${' '.repeat(10_000)}b`
    expect(trimEmail(`  ${middle}  `)).toBe(middle)
    expect(trimEmail(' '.repeat(10_000))).toBe('')
  })
})
