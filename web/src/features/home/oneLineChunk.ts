import { oneLineProblem, parseOneLine, type OneLine } from '../../lib/oneLine'

/*
 * 한 줄 입력의 따로 싣는 조각(#233): 해석기, 해석하지 않을 때의 문구와 "자세히 입력", 결과 확인(D-05), 거래 입력(D-04)과 주고받는
 * 값. 첫 화면 묶음에는 홈의 입력칸(OneLineInput)과 조각을 받지 못했을 때의 문구만 둔다. 입력칸이 초점을 받거나 글을 쓰기 시작할 때,
 * 그리고 홈이 한가할 때 받아 둔다.
 */

export { default as DetailEntry } from './DetailEntry'
export { default as OneLineResult } from './OneLineResult'
export { forgetOneLineHandoff, oneLineReturnOf, settleOneLineReturn } from '../transactions/oneLineHandoff'

/** 해석하지 않고 입력칸 아래에 보이는 문구(F-210 해석 규칙 1, 8) */
export const problemMessages = {
  empty: '입력할 내용을 적어 주세요. 예: 점심 12000',
  'too-long': '100자까지 쓸 수 있어요',
  'not-found': '금액을 찾지 못했어요. 예: 점심 12000',
}

export type OneLineProblem = keyof typeof problemMessages

/** 입력칸의 글을 해석한다. 비었거나 100자를 넘거나 금액을 찾지 못하면 그 까닭이다 */
export function readOneLine(text: string): OneLine | OneLineProblem {
  return oneLineProblem(text) ?? parseOneLine(text) ?? 'not-found'
}

/** 보인 문구의 까닭을 고쳤는지. 고치는 동안 다른 까닭의 새 문구는 띄우지 않는다(00-common 4.4) */
export function isFixed(problem: OneLineProblem, text: string): boolean {
  if (problem === 'not-found') return parseOneLine(text) !== undefined
  return oneLineProblem(text) !== problem
}
