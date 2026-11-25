/**
 * 앞뒤에서 `isSpace`인 글자를 지운다. 지우는 글자는 모두 UTF-16 한 단위다.
 * 정규식의 `+$`는 가운데에 긴 공백이 있으면 길이의 제곱으로 느려지므로 끝에서부터 본다.
 */
export function trimEnds(text: string, isSpace: (character: string) => boolean): string {
  let start = 0
  let end = text.length
  while (start < end && isSpace(text[start])) start += 1
  while (start < end && isSpace(text[end - 1])) end -= 1
  return text.slice(start, end)
}
