/*
 * 거래 id(ADR 006 결정 8): UUID 버전 7(RFC 9562). 앞 48비트가 밀리초 시각이라 만든 순서대로 커진다.
 * 같은 밀리초 안에서는 rand_a 12비트를 순번으로 써서 순서를 지킨다(RFC 9562 6.2의 방법 1).
 * 순번은 밀리초마다 무작위 11비트에서 시작하므로 적어도 2048개를 더 만들 수 있고, 다 차면 다음 밀리초로 넘어간다.
 * 나머지 62비트(rand_b)는 늘 새 무작위 값이다. id는 추측할 수 없는 값이어야 한다(ADR 006 결정 3).
 */

import { now } from './clock'

const MAX_COUNTER = 0xfff

interface Source {
  /** 지금 시각(밀리초) */
  now: () => number
  /** 받은 배열을 무작위 값으로 채운다. */
  fillRandom: (bytes: Uint8Array<ArrayBuffer>) => void
}

const browserSource: Source = {
  now,
  fillRandom: (bytes) => void crypto.getRandomValues(bytes),
}

/** 값을 만들 때마다 앞서 만든 값보다 큰 UUID v7을 주는 함수를 만든다. */
export function createUuidV7({ now, fillRandom }: Source = browserSource): () => string {
  let lastTime = -1
  let counter = 0

  return function next() {
    const random = new Uint8Array(10)
    fillRandom(random)
    // 기기 시계가 뒤로 가도 앞서 만든 값보다 작아지지 않게 한다
    let time = Math.max(Math.floor(now()), lastTime)
    if (time === lastTime && counter < MAX_COUNTER) {
      counter += 1
    } else {
      if (time === lastTime) time += 1
      counter = ((random[0] & 0x07) << 8) | random[1]
    }
    lastTime = time

    const bytes = new Uint8Array(16)
    let rest = time
    for (let index = 5; index >= 0; index -= 1) {
      bytes[index] = rest % 256
      rest = Math.floor(rest / 256)
    }
    bytes[6] = 0x70 | (counter >> 8)
    bytes[7] = counter & 0xff
    bytes[8] = 0x80 | (random[2] & 0x3f)
    bytes.set(random.subarray(3), 9)
    return format(bytes)
  }
}

/** 소문자 36자 표준 표기 */
function format(bytes: Uint8Array): string {
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

/** 이 탭에서 쓰는 거래 id 만들기 */
export const uuidV7 = createUuidV7()

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** 36자 표준 표기의 UUID인지. 서버와 기기 저장소에서 받은 id를 주소나 요청에 쓰기 전에 본다. */
export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID.test(value)
}
