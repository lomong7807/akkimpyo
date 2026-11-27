import { act, cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { HttpResponse } from 'msw'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { delayed, ledgerIdOf, ledgerNameOf, startBackend, type Backend } from './support/backend'
import { setDeviceClock } from './support/clock'
import { goOffline, goOnline } from './support/connection'
import { untilOpened } from './support/dialog'
import { watchDownloads } from './support/download'
import { attachment, exportFile, noTransactions, startExports, XLSX } from './support/exports'
import { startMockServer } from './support/mockServer'
import { openApp } from './support/openApp'
import { problem } from './support/problem'
import { holdClock, passTime } from './support/testClock'
import { toastRegion } from './support/toast'
import { installMatchMedia, resetViewport, setViewportWidth } from './support/viewport'
import { readWebFile } from './support/webFile'

/*
 * K-01 엑셀·CSV 내보내기(#240, F-701, P-228). 서버 계약은 #57: 200 파일(Content-Disposition의 filename*), 거래가 없으면 204,
 * 형식·기간 오류 400 VALIDATION_FAILED(쿼리 이름의 입력란), 구성원이 아니면 404.
 */

const saved = '파일을 내려받았어요'
const noneInLedger = '이 장부에는 아직 내보낼 거래가 없어요'
const noneInPeriod = '이 기간에는 내보낼 거래가 없어요. 기간을 바꿔 주세요.'
const lost = '연결이 끊겨 내보내지 못했어요. 연결되면 다시 시도해 주세요.'
const failed = '문제가 생겨 내보내지 못했어요. 잠시 후 다시 시도해 주세요.'
const gone = '이 장부를 볼 수 없어요.'
const endBeforeStart = '종료일은 시작일과 같거나 뒤여야 해요'
const startRequired = '시작일을 골라 주세요'
const endRequired = '종료일을 골라 주세요'

const server = startMockServer()
let backend: Backend
let exports: ReturnType<typeof startExports>
let downloads: ReturnType<typeof watchDownloads>

beforeEach(() => {
  setDeviceClock('2026-11-26T12:00:00+09:00')
  vi.stubGlobal('scrollTo', vi.fn())
  backend = startBackend(server)
  backend.cookieUser = 'user-1'
  exports = startExports(server, backend)
  downloads = watchDownloads()
  localStorage.clear()
  sessionStorage.clear()
  window.history.replaceState(null, '', '/')
})

afterEach(() => {
  cleanup()
  resetViewport()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

type Opened = Awaited<ReturnType<typeof openApp>>

const exportButton = () => screen.getByRole('button', { name: '내보내기' })
const retryButton = () => screen.getByRole('button', { name: '다시 시도' })
const choice = (name: string) => screen.getByRole('radio', { name })
const checked = (group: string) =>
  within(screen.getByRole('radiogroup', { name: group }))
    .getAllByRole('radio')
    .filter((radio) => radio.getAttribute('aria-checked') === 'true')
    .map((radio) => radio.textContent)
const startField = () => screen.queryByRole('button', { name: /^시작일/ })
const endField = () => screen.queryByRole('button', { name: /^종료일/ })
const content = () => screen.getByRole('main')
const path = ({ router }: Opened) => router.state.location.pathname + router.state.location.search
const tabLinks = () => within(screen.getByRole('navigation', { name: '주 메뉴' })).queryAllByRole('link')
const currentNames = () =>
  tabLinks()
    .filter((link) => link.getAttribute('aria-current') === 'page')
    .map((link) => link.textContent)

/** 칸 아래에 이어진 오류 문구. 없으면 없다. */
function errorOf(control: HTMLElement | null): string | undefined {
  const ids = control?.getAttribute('aria-describedby')?.split(' ') ?? []
  const message = ids.map((id) => document.getElementById(id)!).find((element) => element.querySelector('svg'))
  return message?.textContent
}

async function open(at = '/export', width = 390) {
  installMatchMedia(width)
  const opened = await openApp(at)
  await screen.findByRole('radiogroup', { name: '기간' })
  // 화면 코드가 와서 그린 것은 act 밖이라 연결 신호의 구독(effect)이 아직일 수 있다. 신호를 바꾸는 테스트 전에 마저 돌린다
  await act(async () => {})
  setViewportWidth(width)
  return opened
}

/** 날짜 칸을 열어 그 날을 고른다. 이름은 화면 읽기의 날짜 전체("2026년 1월 10일 토요일")다. */
async function pick(user: Opened['user'], field: HTMLElement, day: string) {
  await user.click(field)
  await untilOpened()
  await user.click(screen.getByRole('gridcell', { name: day }))
}

async function untilSaved() {
  await waitFor(() => expect(within(toastRegion()).queryByText(saved)).not.toBeNull())
}

const validation = (...fieldErrors: [field: string, code: string][]) =>
  problem(400, 'VALIDATION_FAILED', {
    fieldErrors: fieldErrors.map(([field, code]) => ({ field, code, message: '개발자가 읽는 글' })),
  })

describe('들어가는 길(M-01 (6), B-01 5-6)', () => {
  it('더보기의 "카테고리" 다음 줄 "내보내기"(아이콘과 화살표)를 누르면 이 화면이고, 하단 탭은 더보기를 강조한다', async () => {
    installMatchMedia(390)
    const opened = await openApp('/more')
    // 더보기도 따로 싣는다. 틀(불러오는 중)이 아니라 화면이 그려진 뒤에 센다
    await screen.findByRole('button', { name: '로그아웃' })
    setViewportWidth(390)
    const rows = within(content())
      .getAllByRole('link')
      .map((link) => link.textContent)
    expect(rows).toEqual(['계좌', '카테고리', '내보내기'])
    const row = within(content()).getByRole('link', { name: '내보내기' })
    expect(row.querySelectorAll('svg')).toHaveLength(2)
    await opened.user.click(row)
    expect(await screen.findByRole('heading', { level: 1, name: '내보내기' })).toBeTruthy()
    await screen.findByRole('radiogroup', { name: '기간' })
    expect(path(opened)).toBe('/export')
    expect(currentNames()).toEqual(['더보기'])
  })

  it('넓은 화면의 사이드바 더보기 항목은 계좌, 카테고리, 내보내기 순이고 이 화면에서는 "내보내기"를 강조한다', async () => {
    await open('/export', 1280)
    const more = tabLinks()
      .map((link) => link.textContent)
      .filter((name) => ['계좌', '카테고리', '내보내기'].includes(name ?? ''))
    expect(more).toEqual(['계좌', '카테고리', '내보내기'])
    expect(currentNames()).toEqual(['내보내기'])
  })

  it('하위 화면의 상단 바에 "뒤로"와 화면 이름 "내보내기"가 있고 하단 탭이 보인다', async () => {
    await open()
    const bar = within(screen.getByRole('banner'))
    expect(bar.getByRole('button', { name: '뒤로' })).toBeTruthy()
    expect(bar.getByRole('heading', { level: 1, name: '내보내기' })).toBeTruthy()
    expect(screen.getByRole('navigation', { name: '주 메뉴' })).toBeTruthy()
  })

  it('로그인하지 않았으면 로그인 화면으로 보내고 로그인하면 이 화면으로 돌아온다', async () => {
    backend.cookieUser = undefined
    installMatchMedia(390)
    const opened = await openApp('/export')
    await screen.findByRole('heading', { level: 1, name: '로그인' })
    await opened.user.type(screen.getByLabelText('이메일'), 'name@example.com')
    await opened.user.type(screen.getByLabelText('비밀번호'), 'pass1234')
    await opened.user.click(screen.getByRole('button', { name: '로그인' }))
    await screen.findByRole('radiogroup', { name: '기간' })
    expect(path(opened)).toBe('/export')
  })
})

describe('처음 열 때', () => {
  it('장부 이름 글자, 기간 "전체", 형식 "엑셀(xlsx)"이고 날짜 칸은 없다. 받아 오는 것이 없어 뼈대 없이 바로 그린다', async () => {
    await open()
    expect(within(content()).getByText('장부')).toBeTruthy()
    expect(within(content()).getByText(ledgerNameOf('user-1'))).toBeTruthy()
    // 1단계에는 장부가 하나라 고르기가 없다
    expect(within(content()).queryByRole('combobox')).toBeNull()
    expect(checked('기간')).toEqual(['전체'])
    expect(within(screen.getByRole('radiogroup', { name: '기간' })).getAllByRole('radio').map((r) => r.textContent)).toEqual([
      '전체',
      '기간 정하기',
    ])
    expect(checked('형식')).toEqual(['엑셀(xlsx)'])
    expect(within(screen.getByRole('radiogroup', { name: '형식' })).getAllByRole('radio').map((r) => r.textContent)).toEqual([
      '엑셀(xlsx)',
      'CSV',
    ])
    expect([startField(), endField()]).toEqual([null, null])
    expect(exportButton().getAttribute('aria-disabled')).toBeNull()
    expect(exports.requests).toEqual([])
    expect(screen.queryByText(/불러오고 있어요/)).toBeNull()
  })

  it('"내보내기" 버튼은 내용 영역의 맨 아래다', async () => {
    await open()
    const form = exportButton().closest('form')!
    expect(content().contains(form)).toBe(true)
    expect(form.lastElementChild!.contains(exportButton())).toBe(true)
    expect(form.lastElementChild!.contains(screen.getByRole('radiogroup', { name: '형식' }))).toBe(false)
  })

  it('"기간 정하기"를 고르면 시작일 올해 1월 1일과 종료일 오늘이 "~" 사이로 보이고, "전체"로 돌아가면 숨긴다', async () => {
    const { user } = await open()
    await user.click(choice('기간 정하기'))
    expect(startField()!.textContent).toBe('1월 1일 (목)')
    expect(endField()!.textContent).toBe('11월 26일 (목)')
    expect(within(content()).getByText('~')).toBeTruthy()
    await user.click(choice('전체'))
    expect([startField(), endField()]).toEqual([null, null])
    expect(within(content()).queryByText('~')).toBeNull()
  })
})

describe('내보내기', () => {
  it('"전체"이면 2000년 1월 1일부터 오늘로부터 1년 뒤까지를 엑셀로 받아, 서버가 정한 한글 이름으로 저장하고 토스트를 보인다', async () => {
    const opened = await open()
    await opened.user.click(exportButton())
    await untilSaved()
    expect(exports.requests).toHaveLength(1)
    const [request] = exports.requests
    expect(request.ledgerId).toBe(ledgerIdOf('user-1'))
    expect(request.query).toEqual({ format: 'xlsx', from: '2000-01-01', to: '2027-11-26' })
    expect(request.user).toBe('user-1')
    expect(request.authorization).toMatch(/^Bearer /)
    expect(downloads.saved).toHaveLength(1)
    const [file] = downloads.saved
    expect(file.name).toBe('user-1의 장부_20000101_20271126.xlsx')
    expect(file.connected).toBe(true)
    expect(file.revokedBeforeClick).toBe(false)
    expect(await file.file!.text()).toBe('xlsx 파일')
    expect(file.file!.type).toBe(XLSX)
    // 화면에 머물고 고른 값은 그대로다
    expect(path(opened)).toBe('/export')
    expect(checked('기간')).toEqual(['전체'])
    expect(checked('형식')).toEqual(['엑셀(xlsx)'])
  })

  it('임시 링크는 누르게 한 바로 뒤에 문서에서 빼고, 객체 URL은 1분 뒤에 해제한다(iPhone은 물은 뒤에 주소를 읽는다)', async () => {
    const { user } = await open()
    await user.click(exportButton())
    await untilSaved()
    const url = downloads.saved[0].href
    expect(document.querySelector('a[download]')).toBeNull()
    expect(downloads.steps).toEqual([`만듦 ${url}`, `누름 ${url}`])
    holdClock()
    await passTime(59_000)
    expect(downloads.live()).toEqual([url])
    await passTime(1_000)
    expect(downloads.steps).toEqual([`만듦 ${url}`, `누름 ${url}`, `해제 ${url}`])
    expect(downloads.live()).toEqual([])
  })

  it('"기간 정하기"와 CSV를 고르면 고른 기간과 형식으로 보낸다', async () => {
    const { user } = await open()
    await user.click(choice('기간 정하기'))
    await user.click(choice('CSV'))
    await user.click(exportButton())
    await untilSaved()
    expect(exports.requests[0].query).toEqual({ format: 'csv', from: '2026-01-01', to: '2026-11-26' })
    expect(downloads.saved[0].name).toBe('user-1의 장부_20260101_20261126.csv')
    expect(checked('기간')).toEqual(['기간 정하기'])
    expect(checked('형식')).toEqual(['CSV'])
    expect(startField()!.textContent).toBe('1월 1일 (목)')
  })

  it('고른 날짜로 보낸다', async () => {
    const { user } = await open()
    await user.click(choice('기간 정하기'))
    await pick(user, endField()!, '2026년 11월 3일 화요일')
    await user.click(exportButton())
    await untilSaved()
    expect(exports.requests[0].query).toMatchObject({ from: '2026-01-01', to: '2026-11-03' })
  })

  it.each([
    ['filename*이 없으면 장부 이름과 기간으로 짓는다', undefined, 'user-1의 장부_20000101_20271126.xlsx'],
    ['읽을 수 없는 filename*이면 장부 이름과 기간으로 짓는다', `attachment; filename*=UTF-8''%E0%A4%A`, 'user-1의 장부_20000101_20271126.xlsx'],
    ['UTF-8이 아닌 filename*이면 장부 이름과 기간으로 짓는다', `attachment; filename*=ISO-8859-1''a.xlsx`, 'user-1의 장부_20000101_20271126.xlsx'],
    ['filename만 있어도 장부 이름과 기간으로 짓는다(ASCII 밖은 _라)', 'attachment; filename="____20000101_20271126.xlsx"', 'user-1의 장부_20000101_20271126.xlsx'],
    [
      '푼 이름의 경로와 못 쓰는 글자는 _로 바꾼다',
      `attachment; filename*=UTF-8''..%2Fa%2Fb%5Cc%3Ad%2Ae%3Ff%22g%3Ch%3Ei%7Cj%07.xlsx`,
      '.._a_b_c_d_e_f_g_h_i_j_.xlsx',
    ],
    ['따옴표로 감싼 filename*도 읽는다', `attachment; filename*="UTF-8''%EA%B0%80.csv"`, '가.csv'],
    ['언어 표시가 있어도 읽는다', `attachment; filename*=utf-8'ko'%EA%B0%80.xlsx`, '가.xlsx'],
  ])('%s', async (_, disposition, name) => {
    exports.response = () => exportFile('파일', { disposition })
    const { user } = await open()
    await user.click(exportButton())
    await untilSaved()
    expect(downloads.saved[0].name).toBe(name)
  })

  it('장부 이름으로 지을 때도 못 쓰는 글자는 _로 바꾼다', async () => {
    backend.meResponse = () =>
      HttpResponse.json({
        id: 'user-1',
        email: 'user-1@example.com',
        displayName: '이름',
        ledgers: [{ id: ledgerIdOf('user-1'), name: '우리/집:가계부?', role: 'OWNER' }],
      })
    exports.response = () => exportFile('파일')
    const { user } = await open()
    await user.click(choice('CSV'))
    await user.click(exportButton())
    await untilSaved()
    expect(downloads.saved[0].name).toBe('우리_집_가계부__20000101_20271126.csv')
  })

  it('보내는 동안 "내보내기"가 처리 중 표시로 바뀌고 비활성이며, 고르는 칸도 바꿀 수 없다. 두 번 누르지 않는다', async () => {
    const answer = delayed()
    exports.response = answer.respond
    const { user } = await open()
    await user.click(exportButton())
    await answer.arrived
    expect(exportButton().getAttribute('aria-busy')).toBe('true')
    expect(exportButton().getAttribute('aria-disabled')).toBe('true')
    await user.click(exportButton())
    await user.click(choice('CSV'))
    expect(checked('형식')).toEqual(['엑셀(xlsx)'])
    expect(screen.getByRole('radiogroup', { name: '기간' }).getAttribute('aria-readonly')).toBe('true')
    answer.answer(exportFile('파일', { disposition: attachment('a.xlsx') }))
    await untilSaved()
    expect(exports.requests).toHaveLength(1)
    expect(exportButton().hasAttribute('aria-busy')).toBe(false)
    expect(exportButton().getAttribute('aria-disabled')).toBeNull()
  })

  it('확인 창 없이 바로 받는다', async () => {
    const { user } = await open()
    await user.click(exportButton())
    await untilSaved()
    expect(screen.queryByRole('dialog')).toBeNull()
  })
})

describe('거래가 없을 때(204)', () => {
  it('"전체"이면 파일을 저장하지 않고 버튼 바로 위에 "이 장부에는 아직 내보낼 거래가 없어요"를 보인다', async () => {
    exports.response = noTransactions
    const { user } = await open()
    await user.click(exportButton())
    const message = await screen.findByText(noneInLedger)
    expect(message.nextElementSibling).toBe(exportButton())
    expect(downloads.saved).toEqual([])
    expect(downloads.steps).toEqual([])
    expect(within(toastRegion()).queryByText(saved)).toBeNull()
    expect(exportButton().getAttribute('aria-disabled')).toBeNull()
  })

  it('"기간 정하기"이면 "이 기간에는 내보낼 거래가 없어요. 기간을 바꿔 주세요."이고, 기간을 바꾸면 지운다', async () => {
    exports.response = noTransactions
    const { user } = await open()
    await user.click(choice('기간 정하기'))
    await user.click(exportButton())
    expect(await screen.findByText(noneInPeriod)).toBeTruthy()
    await pick(user, endField()!, '2026년 11월 3일 화요일')
    expect(screen.queryByText(noneInPeriod)).toBeNull()
  })

  it('다시 내보내 파일을 받으면 문구를 지운다', async () => {
    exports.response = noTransactions
    const { user } = await open()
    await user.click(exportButton())
    await screen.findByText(noneInLedger)
    exports.response = undefined
    await user.click(exportButton())
    await untilSaved()
    expect(screen.queryByText(noneInLedger)).toBeNull()
  })
})

describe('기간 검사', () => {
  beforeEach(() => setDeviceClock('2026-01-05T12:00:00+09:00'))

  it('시작일이 종료일보다 늦으면 누를 때 종료일 아래 문구를 보이고 보내지 않는다. 초점은 종료일로 간다', async () => {
    const { user } = await open()
    await user.click(choice('기간 정하기'))
    await pick(user, startField()!, '2026년 1월 10일 토요일')
    expect(errorOf(endField())).toBe(endBeforeStart)
    await user.click(exportButton())
    expect(errorOf(endField())).toBe(endBeforeStart)
    expect(errorOf(startField())).toBeUndefined()
    expect(document.activeElement).toBe(endField())
    expect(exports.requests).toEqual([])
  })

  it('고쳐서 맞으면 바로 지운다', async () => {
    const { user } = await open()
    await user.click(choice('기간 정하기'))
    await pick(user, startField()!, '2026년 1월 10일 토요일')
    await pick(user, endField()!, '2026년 1월 10일 토요일')
    expect(errorOf(endField())).toBeUndefined()
    await user.click(exportButton())
    await untilSaved()
    expect(exports.requests[0].query).toMatchObject({ from: '2026-01-10', to: '2026-01-10' })
  })

  it('"전체"로 바꾸면 날짜 칸의 오류는 보내기를 막지 않는다', async () => {
    const { user } = await open()
    await user.click(choice('기간 정하기'))
    await pick(user, startField()!, '2026년 1월 10일 토요일')
    await user.click(choice('전체'))
    await user.click(exportButton())
    await untilSaved()
    expect(exports.requests[0].query).toMatchObject({ from: '2000-01-01', to: '2027-01-05' })
  })

  it('날짜 칸은 2000년 1월 1일부터 오늘로부터 1년 뒤까지만 고를 수 있다', async () => {
    const { user } = await open()
    await user.click(choice('기간 정하기'))
    await user.click(endField()!)
    await untilOpened()
    for (let month = 0; month < 12; month += 1) await user.click(screen.getByRole('button', { name: '다음 달' }))
    expect(screen.getByRole('gridcell', { name: '2027년 1월 5일 화요일' }).getAttribute('aria-disabled')).toBeNull()
    expect(screen.getByRole('gridcell', { name: '2027년 1월 6일 수요일' }).getAttribute('aria-disabled')).toBe('true')
  })
})

describe('서버가 거부했을 때(400 VALIDATION_FAILED)', () => {
  it.each([
    ['to의 NOT_ALLOWED', [['to', 'NOT_ALLOWED']], [undefined, endBeforeStart]],
    ['from의 OUT_OF_RANGE', [['from', 'OUT_OF_RANGE']], ['2000년 1월 1일부터 2027년 11월 26일까지 고를 수 있어요', undefined]],
    ['to의 OUT_OF_RANGE', [['to', 'OUT_OF_RANGE']], [undefined, '2000년 1월 1일부터 2027년 11월 26일까지 고를 수 있어요']],
    ['from과 to의 REQUIRED', [['from', 'REQUIRED'], ['to', 'REQUIRED']], [startRequired, endRequired]],
  ] as const)('%s이면 그 칸 아래에 문구를 보이고 버튼 위에는 없다', async (_, fieldErrors, [start, end]) => {
    exports.response = () => validation(...(fieldErrors as unknown as [string, string][]))
    const { user } = await open()
    await user.click(choice('기간 정하기'))
    await user.click(exportButton())
    await waitFor(() => expect([errorOf(startField()), errorOf(endField())]).toEqual([start, end]))
    expect(screen.queryByRole('alert')).toBeNull()
    expect(downloads.saved).toEqual([])
    expect(document.activeElement).toBe(start ? startField() : endField())
  })

  it.each([
    ['형식 오류', [['format', 'INVALID_FORMAT']]],
    ['모르는 code', [['from', 'SOMETHING_NEW']]],
    ['칸이 없는 400', []],
  ] as const)('%s이면 버튼 위에 실패 문구와 "다시 시도"', async (_, fieldErrors) => {
    exports.response = () => validation(...(fieldErrors as unknown as [string, string][]))
    const { user } = await open()
    await user.click(choice('기간 정하기'))
    await user.click(exportButton())
    expect((await screen.findByRole('alert')).textContent).toBe(failed)
    expect(retryButton()).toBeTruthy()
  })

  it('"전체"인데 기간을 거부하면 숨긴 칸 대신 버튼 위에 실패 문구다', async () => {
    exports.response = () => validation(['to', 'OUT_OF_RANGE'])
    const { user } = await open()
    await user.click(exportButton())
    expect((await screen.findByRole('alert')).textContent).toBe(failed)
  })

  it('고친 칸의 서버 오류는 고르면 지운다', async () => {
    exports.response = () => validation(['to', 'NOT_ALLOWED'])
    const { user } = await open()
    await user.click(choice('기간 정하기'))
    await user.click(exportButton())
    await waitFor(() => expect(errorOf(endField())).toBe(endBeforeStart))
    await pick(user, endField()!, '2026년 11월 3일 화요일')
    expect(errorOf(endField())).toBeUndefined()
  })
})

describe('날짜 경계(기기의 오늘)', () => {
  it.each([
    ['연말 23:59', '2026-12-31T23:59:59+09:00', 'Asia/Seoul', ['1월 1일 (목)', '12월 31일 (목)'], ['2026-01-01', '2026-12-31']],
    ['연초 00:00(시작일과 종료일이 같은 날)', '2027-01-01T00:00:00+09:00', 'Asia/Seoul', ['1월 1일 (금)', '1월 1일 (금)'], ['2027-01-01', '2027-01-01']],
    // 서울은 이미 새해지만 기기의 오늘은 아직 12월 31일이다
    ['기기 시간대가 로스앤젤레스', '2027-01-01T08:00:00+09:00', 'America/Los_Angeles', ['1월 1일 (목)', '12월 31일 (목)'], ['2026-01-01', '2026-12-31']],
    ['월의 마지막 날 자정 직전', '2026-11-30T23:59:59+09:00', 'Asia/Seoul', ['1월 1일 (목)', '11월 30일 (월)'], ['2026-01-01', '2026-11-30']],
    ['다음 달 첫날 자정', '2026-12-01T00:00:00+09:00', 'Asia/Seoul', ['1월 1일 (목)', '12월 1일 (화)'], ['2026-01-01', '2026-12-01']],
  ])('%s: "기간 정하기"의 기본값과 보내는 기간', async (_, at, zone, shown, [from, to]) => {
    setDeviceClock(at, zone)
    const { user } = await open()
    await user.click(choice('기간 정하기'))
    expect([startField()!.textContent, endField()!.textContent]).toEqual(shown)
    expect(errorOf(endField())).toBeUndefined()
    await user.click(exportButton())
    await untilSaved()
    expect(exports.requests[0].query).toMatchObject({ from, to })
    expect(downloads.saved[0].name).toBe(`user-1의 장부_${from.replaceAll('-', '')}_${to.replaceAll('-', '')}.xlsx`)
  })

  it.each([
    ['연말 23:59', '2026-12-31T23:59:59+09:00', 'Asia/Seoul', '2027-12-31'],
    ['연초 00:00', '2027-01-01T00:00:00+09:00', 'Asia/Seoul', '2028-01-01'],
    ['기기 시간대가 로스앤젤레스', '2027-01-01T08:00:00+09:00', 'America/Los_Angeles', '2027-12-31'],
    ['윤년 2월 29일', '2028-02-29T12:00:00+09:00', 'Asia/Seoul', '2029-02-28'],
  ])('%s: "전체"는 오늘로부터 1년 뒤까지 보낸다', async (_, at, zone, to) => {
    setDeviceClock(at, zone)
    const { user } = await open()
    await user.click(exportButton())
    await untilSaved()
    expect(exports.requests[0].query).toMatchObject({ from: '2000-01-01', to })
  })

  it('범위 밖 문구의 끝 날짜는 기기의 오늘로부터 1년 뒤다(연말)', async () => {
    setDeviceClock('2026-12-31T23:59:59+09:00')
    exports.response = () => validation(['from', 'OUT_OF_RANGE'])
    const { user } = await open()
    await user.click(choice('기간 정하기'))
    await user.click(exportButton())
    await waitFor(() => expect(errorOf(startField())).toBe('2000년 1월 1일부터 2027년 12월 31일까지 고를 수 있어요'))
  })
})

describe('볼 수 없는 장부(404)', () => {
  it('버튼 바로 위에 "이 장부를 볼 수 없어요."만 보이고 다시 시도는 없다', async () => {
    exports.response = () => problem(404, 'NOT_FOUND')
    const { user } = await open()
    await user.click(exportButton())
    expect((await screen.findByRole('alert')).textContent).toBe(gone)
    expect(screen.queryByRole('button', { name: '다시 시도' })).toBeNull()
    expect(downloads.saved).toEqual([])
  })
})

describe('로그인이 만료됐을 때(401)', () => {
  it('토큰을 갱신하고 같은 요청을 새 토큰으로 다시 보내 파일을 받는다', async () => {
    const { user } = await open()
    backend.expireTokens()
    await user.click(exportButton())
    await untilSaved()
    expect(exports.requests.map((each) => each.user ?? '만료')).toEqual(['만료', 'user-1'])
    expect(exports.requests[1].authorization).not.toBe(exports.requests[0].authorization)
    expect(exports.requests[1].query).toEqual(exports.requests[0].query)
    expect(downloads.saved).toHaveLength(1)
  })

  it('갱신도 안 되면 로그인 화면으로 가고, 로그인하면 이 화면으로 돌아온다', async () => {
    const opened = await open()
    backend.expireTokens()
    backend.cookieUser = undefined
    await opened.user.click(exportButton())
    await screen.findByRole('heading', { level: 1, name: '로그인' })
    expect(screen.getByText('로그인이 풀렸어요. 다시 로그인해 주세요.')).toBeTruthy()
    expect(downloads.saved).toEqual([])
    await opened.user.type(screen.getByLabelText('이메일'), 'name@example.com')
    await opened.user.type(screen.getByLabelText('비밀번호'), 'pass1234')
    await opened.user.click(screen.getByRole('button', { name: '로그인' }))
    await screen.findByRole('radiogroup', { name: '기간' })
    expect(path(opened)).toBe('/export')
  })
})

describe('서버 오류와 지연', () => {
  it.each([
    ['500', () => problem(500, 'INTERNAL_ERROR')],
    ['읽을 수 없는 502', () => new HttpResponse('<html>', { status: 502 })],
    ['429', () => problem(429, 'TOO_MANY_REQUESTS')],
    ['약속과 다른 201', () => new HttpResponse('파일', { status: 201 })],
  ])('%s이면 버튼 바로 위에 문구와 "다시 시도"이고, 다시 시도로 받으면 지운다', async (_, respond) => {
    exports.response = respond
    const { user } = await open()
    await user.click(choice('CSV'))
    await user.click(exportButton())
    const alert = await screen.findByRole('alert')
    expect(alert.textContent).toBe(failed)
    expect(downloads.saved).toEqual([])
    exports.response = undefined
    await user.click(retryButton())
    await untilSaved()
    expect(screen.queryByRole('alert')).toBeNull()
    expect(exports.requests.map((each) => each.query.format)).toEqual(['csv', 'csv'])
  })

  it('15초 동안 응답이 없으면 같은 문구를 보인다', async () => {
    exports.response = delayed().respond
    await open()
    holdClock()
    fireEvent.click(exportButton())
    await passTime(14_900)
    expect(screen.queryByRole('alert')).toBeNull()
    await passTime(200)
    expect(screen.getByRole('alert').textContent).toBe(failed)
    expect(exportButton().hasAttribute('aria-busy')).toBe(false)
  })

  it('저절로 다시 보내지 않는다', async () => {
    exports.response = () => problem(500, 'INTERNAL_ERROR')
    const { user } = await open()
    await user.click(exportButton())
    await screen.findByRole('alert')
    await act(() => new Promise((resolve) => setTimeout(resolve, 50)))
    expect(exports.requests).toHaveLength(1)
  })
})

describe('연결이 없을 때(R1, #238 4.3)', () => {
  it('(1)~(4)는 고를 수 있고 "내보내기"만 문구 없이 비활성이다. 돌아오면 누를 수 있다', async () => {
    const { user } = await open()
    act(() => goOffline())
    expect(exportButton().getAttribute('aria-disabled')).toBe('true')
    expect(exportButton().previousElementSibling).toBeNull()
    expect(screen.queryByText(/연결되면/)).toBeNull()
    await user.click(choice('기간 정하기'))
    await user.click(choice('CSV'))
    expect([checked('기간'), checked('형식')]).toEqual([['기간 정하기'], ['CSV']])
    await pick(user, endField()!, '2026년 11월 3일 화요일')
    await user.click(exportButton())
    expect(exports.requests).toEqual([])
    act(() => goOnline())
    expect(exportButton().getAttribute('aria-disabled')).toBeNull()
    await user.click(exportButton())
    await untilSaved()
    expect(exports.requests[0].query).toEqual({ format: 'csv', from: '2026-01-01', to: '2026-11-03' })
  })

  it('내보내는 중에 끊기면 "연결이 끊겨 내보내지 못했어요."와 "다시 시도"(연결이 없는 동안 비활성)이고 고른 값이 남는다', async () => {
    exports.response = () => HttpResponse.error()
    const { user } = await open()
    await user.click(choice('CSV'))
    await user.click(exportButton())
    expect((await screen.findByRole('alert')).textContent).toBe(lost)
    expect(retryButton().getAttribute('aria-disabled')).toBe('true')
    expect(exportButton().getAttribute('aria-disabled')).toBe('true')
    expect(checked('형식')).toEqual(['CSV'])
    exports.response = undefined
    act(() => goOnline())
    expect(retryButton().getAttribute('aria-disabled')).toBeNull()
    await user.click(retryButton())
    await untilSaved()
    expect(screen.queryByRole('alert')).toBeNull()
  })
})

describe('넓은 화면', () => {
  it('공통 틀 안에서 같은 배치이고 입력란 폭은 내용 영역 가운데 480px로 제한한다', async () => {
    await open('/export', 1280)
    const form = exportButton().closest('form')!
    expect(getComputedStyle(form).maxWidth).toBe('var(--width-content-form)')
    // jsdom은 margin-inline을 계산하지 않아 규칙의 글자를 본다
    const css = readWebFile('src/features/export/Export.module.css')
    const wide = css.slice(css.indexOf('@media (width >= 1024px)'))
    expect(wide).toMatch(/\.form \{[^}]*max-width: var\(--width-content-form\);[^}]*margin-inline: auto;/)
  })

  it('휴대폰 폭에서는 내용 폭을 다 쓴다', async () => {
    await open('/export', 390)
    expect(getComputedStyle(exportButton().closest('form')!).maxWidth).not.toBe('var(--width-content-form)')
  })
})

describe('키보드', () => {
  it('기간과 형식은 화살표로 고르고, Enter로 내보낸다', async () => {
    const { user } = await open()
    choice('전체').focus()
    await user.keyboard('{ArrowRight}')
    expect(checked('기간')).toEqual(['기간 정하기'])
    choice('엑셀(xlsx)').focus()
    await user.keyboard('{ArrowRight}')
    expect(checked('형식')).toEqual(['CSV'])
    exportButton().focus()
    await user.keyboard('{Enter}')
    await untilSaved()
    expect(exports.requests[0].query.format).toBe('csv')
  })
})
