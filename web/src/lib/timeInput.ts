/* 시각 칸에서 치는 글자(화면설계서 00-common 5.8). 보이는 글자와 검사는 timeText.ts에 있다(#355에서 나눔). */

import { wallTimeNow } from './clock'

function digitsOf(text: string): string {
  return text.replace(/[^0-9]/g, '')
}

/**
 * 칸에 보일 글자. 숫자를 셋 이상 치면 둘째 숫자 뒤에 쌍점을 넣고 숫자는 넷까지만 받는다("1430" → "14:30").
 * 손으로 친 쌍점은 그 자리를 따른다("9:05"). 숫자와 쌍점이 아닌 글자는 받지 않는다.
 */
export function formatTimeText(text: string): string {
  const colon = text.indexOf(':')
  if (colon >= 0) {
    const hours = digitsOf(text.slice(0, colon))
    if (hours.length <= 2) return `${hours}:${digitsOf(text.slice(colon + 1)).slice(0, 2)}`
  }
  const digits = digitsOf(text).slice(0, 4)
  return digits.length <= 2 ? digits : `${digits.slice(0, 2)}:${digits.slice(2)}`
}

/** 보이는 글자에서 숫자 `count`개 바로 뒤의 자리. 쌍점 바로 앞이면 `afterColon`일 때 쌍점 뒤로 간다. */
export function positionAfterTimeDigits(text: string, count: number, afterColon: boolean): number {
  let position = 0
  for (let passed = 0; passed < count && position < text.length; position += 1) {
    if (text[position] !== ':') passed += 1
  }
  return afterColon && text[position] === ':' ? position + 1 : position
}

/** 한 자리 시를 두 자리로 맞춘다("9:05" → "09:05"). 맞출 수 없으면 그대로다. */
export function normalizeTime(text: string): string {
  return /^[0-9]:[0-9]{2}$/.test(text) ? `0${text}` : text
}

/** 기기의 지금 시각(분 단위) */
export function currentTime(): string {
  return wallTimeNow().time
}
