/*
 * 쓰기 요청에 싣는 기기 값(#21의 목록, ADR 007 결정 10). `<기기>.<브라우저>` 소문자이고 이 목록의 42개 가운데 하나다.
 * 버전, 모델, 화면 크기, 기기 고유 값은 담지 않는다. user agent 원문은 이 파일 밖으로 내보내지 않는다.
 * 새 값은 서버 목록에 먼저 더한 뒤 여기에 더한다. 목록에 없는 값은 서버가 되살릴 수 없게 저장한다.
 */

export const DEVICES = ['iphone', 'ipad', 'mac', 'windows', 'android', 'linux', 'unknown'] as const
export const BROWSERS = ['safari', 'chrome', 'edge', 'firefox', 'samsung', 'unknown'] as const

type Device = (typeof DEVICES)[number]
type Browser = (typeof BROWSERS)[number]
export type DeviceValue = `${Device}.${Browser}`

export const UNKNOWN_DEVICE: DeviceValue = 'unknown.unknown'

/** 보낼 수 있는 기기 값 42개 */
export const DEVICE_VALUES: readonly DeviceValue[] = DEVICES.flatMap((device) =>
  BROWSERS.map((browser): DeviceValue => `${device}.${browser}`),
)

/** 목록에 있는 값이면 그대로, 아니면 모르는 기기다. 보내기 전에 늘 거친다. */
export function checkedDeviceValue(candidate: string): DeviceValue {
  return DEVICE_VALUES.find((value) => value === candidate) ?? UNKNOWN_DEVICE
}

/** user agent에서 기기와 브라우저의 종류만 고른다. 모르면 그 자리는 unknown이다. */
export function deviceValueOf(userAgent: string): DeviceValue {
  const device = deviceOf(userAgent)
  return checkedDeviceValue(`${device}.${browserOf(userAgent, device)}`)
}

function deviceOf(userAgent: string): Device {
  // iPhone과 iPad의 user agent에도 "Mac OS X"가, Android의 user agent에도 "Linux"가 들어 있어 먼저 본다
  if (/\biPhone\b/.test(userAgent)) return 'iphone'
  // 기본 설정의 iPadOS Safari는 Mac으로 알린다. 구분하려고 다른 신호를 더 읽지 않는다(#21)
  if (/\biPad\b/.test(userAgent)) return 'ipad'
  if (/\bAndroid\b/.test(userAgent)) return 'android'
  if (/\bWindows NT\b/.test(userAgent)) return 'windows'
  if (/\bMacintosh\b/.test(userAgent)) return 'mac'
  if (/\bLinux\b/.test(userAgent)) return 'linux'
  return 'unknown'
}

/**
 * 같은 엔진이라 Chrome이나 Safari의 표시를 함께 싣는 다른 브라우저와 앱 안의 브라우저. 목록에 없으므로 모르는 브라우저다.
 * Android WebView는 "; wv)"를 싣는다.
 */
const OTHER_BROWSERS = new RegExp(
  [
    String.raw`\b(OPR|OPiOS|OPT|Whale|Line|YaBrowser|Vivaldi|DuckDuckGo|Ddg|UCBrowser|Chromium|Electron|MiuiBrowser|HuaweiBrowser)/`,
    String.raw`\b(Opera|NAVER|KAKAOTALK|Instagram|DaumApps|FBAN|FBAV)\b`,
    String.raw`; wv\)`,
  ].join('|'),
)

function browserOf(userAgent: string, device: Device): Browser {
  if (OTHER_BROWSERS.test(userAgent)) return 'unknown'
  if (/\bSamsungBrowser\//.test(userAgent)) return 'samsung'
  if (/\bEdg(e|A|iOS)?\//.test(userAgent)) return 'edge'
  if (/\b(Firefox|FxiOS)\//.test(userAgent)) return 'firefox'
  if (/\b(Chrome|CriOS)\//.test(userAgent)) return 'chrome'
  if (/\bAppleWebKit\//.test(userAgent) && isSafari(userAgent, device)) return 'safari'
  return 'unknown'
}

/**
 * Safari는 "Version/..."과 "Safari/"를 싣는다. iPhone과 iPad의 홈 화면에 설치한 앱은 이 둘이 없지만 Safari로 보낸다(#21).
 * 그 밖의 Apple 기기 앱 안 브라우저는 위의 다른 브라우저 표시로 거른다.
 */
function isSafari(userAgent: string, device: Device): boolean {
  if (/\bVersion\/[\d.]+.*\bSafari\//.test(userAgent)) return true
  return (device === 'iphone' || device === 'ipad') && /\bMobile\/\w+$/.test(userAgent.trim())
}
