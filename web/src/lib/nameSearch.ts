/* 이름 찾기(화면설계서 02 0.8의 고르기 판). 공백과 대소문자를 무시한 부분 일치이고 조합형으로 맞춰 찾는다(P-214). */

/** 찾을 때 비교하는 모양. 조합형으로 맞추고 공백류 글자를 모두 빼고 소문자로 바꾼다. */
export function searchKey(text: string): string {
  return text.normalize('NFC').replace(/\p{White_Space}/gu, '').toLowerCase()
}

/** `name`에 찾는 글이 들어 있는지. 찾는 글이 비었으면 모두 맞는다. */
export function matchesName(name: string, query: string): boolean {
  return searchKey(name).includes(searchKey(query))
}
