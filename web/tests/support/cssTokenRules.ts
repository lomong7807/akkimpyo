/** 간격 척도(docs/design/tokens.md 3절)와 허용 예외 1px, 0. */
const allowedPx = [0, 1, 4, 8, 12, 16, 24, 32, 40]
/** 배치를 나누는 화면 폭(7절). 미디어 조건에는 CSS 변수를 쓸 수 없어 직접 쓴다. */
const allowedBreakpointPx = [0, 768, 1024]

const colorFunctions = 'rgba?|hsla?|hwb|lab|lch|oklab|oklch|color|color-mix|device-cmyk'

// CSS Color 4의 색 이름과 시스템 색. 새 색을 만들지 않는 transparent와 currentColor는 뺀다.
const colorNames = `
  aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood
  cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray
  darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen
  darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue
  firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew
  hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan
  lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray
  lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue
  mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred
  midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid
  palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple
  rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue
  slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow
  yellowgreen
  accentcolor accentcolortext activetext buttonborder buttonface buttontext canvas canvastext field fieldtext graytext
  highlight highlighttext linktext mark marktext selecteditem selecteditemtext visitedtext
`
  .trim()
  .split(/\s+/)
  .join('|')

const colorLiteral = new RegExp(
  `#[0-9a-f]{3,8}\\b|(?<![\\w-])(?:${colorFunctions})\\(|(?<![\\w-])(?:${colorNames})(?![\\w(-])`,
  'gi',
)
const length = /(?<![\w.])-?((?:\d*\.)?\d+)(px|rem)\b/gi

export interface TokenViolation {
  line: number
  value: string
}

/** 주석, 글자, 주소는 검사하지 않도록 같은 길이의 공백으로 바꾼다. 줄 번호는 그대로 남는다. */
function mask(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|url\([^)"']*\)/g, (text) =>
    text.replace(/[^\n]/g, ' '),
  )
}

function offScale(text: string, allowed: number[]): RegExpMatchArray[] {
  return [...text.matchAll(length)].filter(([, amount, unit]) => {
    const px = Number(amount) * (unit.toLowerCase() === 'rem' ? 16 : 1)
    return !allowed.includes(px)
  })
}

/**
 * `tokens.css` 밖의 CSS에서 색 리터럴과 간격 척도에 없는 길이를 찾는다.
 * 길이는 px로 보고, rem은 16px = 1rem으로 바꿔 같은 척도로 본다.
 */
export function findTokenViolations(css: string): TokenViolation[] {
  const source = mask(css)
  const violations: (TokenViolation & { index: number })[] = []

  function report(offset: number, matches: RegExpMatchArray[]) {
    for (const match of matches) {
      const index = offset + match.index!
      violations.push({ index, line: source.slice(0, index).split('\n').length, value: match[0] })
    }
  }

  // `{`로 끝나는 조각은 선택자나 @규칙의 머리이고, `;`나 `}`로 끝나는 조각은 선언이다. 중첩 규칙도 같다.
  for (const { 0: chunk, 1: text, 2: end, index } of source.matchAll(/([^{};]*)([{};]|$)/g)) {
    if (chunk === '') continue
    if (text.trimStart().startsWith('@')) {
      report(index, offScale(text, allowedBreakpointPx))
    } else if (end !== '{') {
      const valueStart = text.indexOf(':') + 1
      const value = text.slice(valueStart)
      report(index + valueStart, [...value.matchAll(colorLiteral), ...offScale(value, allowedPx)])
    }
  }

  return violations.sort((a, b) => a.index - b.index).map(({ line, value }) => ({ line, value }))
}
