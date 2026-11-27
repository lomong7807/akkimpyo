import { describe, expect, it } from 'vitest'
import {
  BROWSERS,
  checkedDeviceValue,
  DEVICE_VALUES,
  DEVICES,
  deviceValueOf,
  UNKNOWN_DEVICE,
} from '../src/lib/deviceValue'

// #21의 목록. 서버가 받는 값과 글자 그대로 같아야 한다
const listed = [
  ['iphone', 'iPhone'],
  ['ipad', 'iPad'],
  ['mac', 'Mac'],
  ['windows', 'Windows'],
  ['android', 'Android'],
  ['linux', 'Linux'],
  ['unknown', ''],
]
const listedBrowsers = ['safari', 'chrome', 'edge', 'firefox', 'samsung', 'unknown']

describe('목록', () => {
  it('기기 7개와 브라우저 6개의 조합 42개다', () => {
    expect(DEVICES).toEqual(listed.map(([value]) => value))
    expect(BROWSERS).toEqual(listedBrowsers)
    expect(DEVICE_VALUES).toHaveLength(42)
    expect(new Set(DEVICE_VALUES).size).toBe(42)
  })

  it('모두 소문자 `<기기>.<브라우저>`이고 서버의 형식(1~64자, A-Z a-z 0-9 . _ : -) 안이며 15자 이하다', () => {
    for (const value of DEVICE_VALUES) {
      expect(value).toMatch(/^[a-z]+\.[a-z]+$/)
      expect(value).toMatch(/^[A-Za-z0-9._:-]{1,64}$/)
      expect(value.length).toBeLessThanOrEqual(15)
    }
  })

  it('모르면 unknown.unknown이고 목록에 있다', () => {
    expect(UNKNOWN_DEVICE).toBe('unknown.unknown')
    expect(DEVICE_VALUES).toContain(UNKNOWN_DEVICE)
  })
})

describe('목록과 다시 대조', () => {
  it.each(DEVICE_VALUES)('목록의 %s는 그대로다', (value) => {
    expect(checkedDeviceValue(value)).toBe(value)
  })

  it.each([
    'iphone.app',
    'IPHONE.SAFARI',
    'iphone.safari ',
    'iphone',
    'chromeos.chrome',
    '',
    'iphone.safari\nX-Other: 1',
    'unknown',
    'Mozilla/5.0 (iPhone)',
  ])('목록 밖의 %j는 unknown.unknown이다', (value) => {
    expect(checkedDeviceValue(value)).toBe('unknown.unknown')
  })
})

const ua = {
  iphoneSafari:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1',
  iphoneHomeScreen:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148',
  iphoneChrome:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0.6478.54 Mobile/15E148 Safari/604.1',
  iphoneEdge:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 EdgiOS/126.2592.56 Mobile/15E148 Safari/605.1.15',
  iphoneFirefox:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/127.0 Mobile/15E148 Safari/605.1.15',
  iphoneKakaoTalk:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 KAKAOTALK 10.8.1',
  iphoneNaver:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 NAVER(inapp; search; 2000; 12.6.4; 14PRO)',
  iphoneInstagram:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 340.0.2.18.80 (iPhone15,2; iOS 17_5; ko_KR; ko)',
  ipadSafari:
    'Mozilla/5.0 (iPad; CPU OS 16_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.6 Mobile/15E148 Safari/604.1',
  ipadAsMac:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15',
  macChrome:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  macEdge:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0',
  macFirefox: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14.5; rv:127.0) Gecko/20100101 Firefox/127.0',
  macWhale:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Whale/3.26.244.21 Safari/537.36',
  macAppWebView: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)',
  windowsChrome:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  windowsEdge:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0',
  windowsFirefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0',
  windowsOpera:
    'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36 OPR/111.0.0.0',
  windowsIe: 'Mozilla/5.0 (Windows NT 10.0; WOW64; Trident/7.0; rv:11.0) like Gecko',
  androidChrome:
    'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
  androidSamsung:
    'Mozilla/5.0 (Linux; Android 14; SAMSUNG SM-S921N) AppleWebKit/537.36 (KHTML, like Gecko) SamsungBrowser/25.0 Chrome/121.0.0.0 Mobile Safari/537.36',
  androidEdge:
    'Mozilla/5.0 (Linux; Android 10; K) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36 EdgA/126.0.2592.61',
  androidFirefox: 'Mozilla/5.0 (Android 14; Mobile; rv:127.0) Gecko/127.0 Firefox/127.0',
  androidWebView:
    'Mozilla/5.0 (Linux; Android 14; SM-S921N Build/UP1A.231005.007; wv) AppleWebKit/537.36 (KHTML, like Gecko) Version/4.0 Chrome/126.0.6478.71 Mobile Safari/537.36',
  androidKakaoTalk:
    'Mozilla/5.0 (Linux; Android 14; SM-S921N Build/UP1A.231005.007) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.6478.71 Mobile Safari/537.36 KAKAOTALK/10.8.1 (INAPP)',
  linuxFirefox: 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:127.0) Gecko/20100101 Firefox/127.0',
  linuxChrome:
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  linuxChromium:
    'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chromium/126.0.0.0 Chrome/126.0.0.0 Safari/537.36',
  chromeOs:
    'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36',
  bot: 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)',
}

describe('대표 user agent', () => {
  it.each([
    [ua.iphoneSafari, 'iphone.safari'],
    ['iPhone 홈 화면에 설치한 앱', ua.iphoneHomeScreen, 'iphone.safari'],
    [ua.iphoneChrome, 'iphone.chrome'],
    [ua.iphoneEdge, 'iphone.edge'],
    [ua.iphoneFirefox, 'iphone.firefox'],
    ['카카오톡 안의 브라우저', ua.iphoneKakaoTalk, 'iphone.unknown'],
    ['네이버 앱 안의 브라우저', ua.iphoneNaver, 'iphone.unknown'],
    ['인스타그램 안의 브라우저', ua.iphoneInstagram, 'iphone.unknown'],
    [ua.ipadSafari, 'ipad.safari'],
    ['Mac으로 알리는 iPad Safari', ua.ipadAsMac, 'mac.safari'],
    [ua.macChrome, 'mac.chrome'],
    [ua.macEdge, 'mac.edge'],
    [ua.macFirefox, 'mac.firefox'],
    ['웨일', ua.macWhale, 'mac.unknown'],
    ['Mac 앱 안의 WebKit', ua.macAppWebView, 'mac.unknown'],
    [ua.windowsChrome, 'windows.chrome'],
    [ua.windowsEdge, 'windows.edge'],
    [ua.windowsFirefox, 'windows.firefox'],
    ['오페라', ua.windowsOpera, 'windows.unknown'],
    ['Internet Explorer', ua.windowsIe, 'windows.unknown'],
    [ua.androidChrome, 'android.chrome'],
    [ua.androidSamsung, 'android.samsung'],
    [ua.androidEdge, 'android.edge'],
    [ua.androidFirefox, 'android.firefox'],
    ['Android WebView', ua.androidWebView, 'android.unknown'],
    ['Android 카카오톡', ua.androidKakaoTalk, 'android.unknown'],
    [ua.linuxFirefox, 'linux.firefox'],
    [ua.linuxChrome, 'linux.chrome'],
    ['Chromium', ua.linuxChromium, 'linux.unknown'],
    ['Chrome OS', ua.chromeOs, 'unknown.chrome'],
    ['검색 로봇', ua.bot, 'unknown.unknown'],
    ['빈 글자', '', 'unknown.unknown'],
  ].map((row) => (row.length === 2 ? [row[0].slice(0, 60), ...row] : row)))('%s → %s', (_, userAgent, expected) => {
    expect(deviceValueOf(userAgent)).toBe(expected)
  })
})

/** 기기 자리와 브라우저 자리를 이어 만든 user agent */
const deviceParts: Record<string, string> = {
  iphone: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko)',
  ipad: 'Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko)',
  mac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko)',
  windows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko)',
  android: 'Mozilla/5.0 (Linux; Android 14; K) AppleWebKit/537.36 (KHTML, like Gecko)',
  linux: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko)',
  unknown: 'Mozilla/5.0 (X11; FreeBSD amd64) AppleWebKit/537.36 (KHTML, like Gecko)',
}
const browserParts: Record<string, string> = {
  safari: 'Version/17.5 Safari/605.1.15',
  chrome: 'Chrome/126.0.0.0 Safari/537.36',
  edge: 'Chrome/126.0.0.0 Safari/537.36 Edg/126.0.0.0',
  firefox: 'Gecko/20100101 Firefox/127.0',
  samsung: 'SamsungBrowser/25.0 Chrome/121.0.0.0 Safari/537.36',
  unknown: 'Mozilla-like/1.0',
}

describe('목록의 값 42개를 모두 고를 수 있다', () => {
  it.each(DEVICE_VALUES)('%s', (value) => {
    const [device, browser] = value.split('.')
    expect(deviceValueOf(`${deviceParts[device]} ${browserParts[browser]}`)).toBe(value)
  })
})

describe('어떤 user agent를 받아도 목록 안의 값이다', () => {
  const samples = [
    ...Object.values(ua),
    ...Object.values(deviceParts).flatMap((device) => Object.values(browserParts).map((browser) => `${device} ${browser}`)),
    'iPhone.Safari',
    'iphone.safari',
    '\u0000\n\r',
    'Mozilla/5.0 (iPhone) Version/1 Safari/1 '.repeat(500),
    String.fromCharCode(...Array.from({ length: 300 }, (_, index) => index)),
  ]

  it.each(samples.map((sample, index) => [index, sample]))('%d', (_, sample) => {
    expect(DEVICE_VALUES).toContain(deviceValueOf(sample))
  })
})
