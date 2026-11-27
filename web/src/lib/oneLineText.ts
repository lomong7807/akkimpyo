import { lengthOf, normalizeName } from './visibleText'

/*
 * 한 줄 입력칸의 글 검사(F-210 해석 규칙 1). 해석기(oneLine)와 달리 홈의 첫 화면 묶음에 둔다. 해석기 조각을 받기 전이나 받지
 * 못해도(연결 없음) 빈 글과 100자 넘는 글은 바로 알린다(#233).
 */

/** 한 줄 글과 가맹점/내용의 최대 글자 수(F-210, P-214) */
export const ONE_LINE_MAX = 100

/** 해석하기 전에 막는 글: 비었거나 100자를 넘는다. 서버처럼 앞뒤 공백을 지우고 조합형으로 맞춰 센다 */
export function oneLineProblem(text: string): 'empty' | 'too-long' | undefined {
  const length = lengthOf(normalizeName(text))
  if (length === 0) return 'empty'
  if (length > ONE_LINE_MAX) return 'too-long'
}
