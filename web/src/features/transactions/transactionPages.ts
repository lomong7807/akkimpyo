import { ApiError } from '../../api/apiError'
import { request, type SenderCheck } from '../../api/request'
import { ledgerPath } from '../me/ledgerPath'
import { isTransactionPage, type LedgerPage, type TransactionPage } from './transactions'

/*
 * 거래 목록을 한 쪽씩 받는 요청(#15의 한 달, 하루, 장부 전체). 내역, 달력, 기기의 최근 한 달(#238)이 쓴다.
 * 홈은 쓰지 않으므로 첫 화면 JS에 들지 않게 transactions.ts와 나눠 둔다(#355). 응답의 모양은 transactions.ts가 본다.
 */

/** 한 번에 받는 거래 수(P-232) */
export const PAGE_SIZE = 50

/**
 * 장부의 한 달 거래를 한 쪽 받는다. `cursor`가 null이면 첫 쪽이다. 실패하면 ApiError를 던진다.
 * 약속과 다른 응답은 일부만 쓰지 않고 모두 받지 않는다. 빼고 보이면 합계와 줄이 어긋난다.
 */
export async function fetchTransactionPage(
  ledgerId: string,
  month: string,
  cursor: string | null,
): Promise<TransactionPage> {
  const query = new URLSearchParams({ month, limit: String(PAGE_SIZE) })
  if (cursor !== null) query.set('cursor', cursor)
  const body = await request<unknown>(`${ledgerPath(ledgerId, 'transactions')}?${query}`)
  if (!isTransactionPage(body, { month }, cursor === null)) throw ApiError.unreadable()
  return body
}

/**
 * 장부의 하루 거래를 한 쪽 받는다(#15의 하루 모드 `date=YYYY-MM-DD`, 달력 D-02의 고른 날). 순서와 cursor는 달 목록과 같고,
 * 첫 쪽의 합계(totals)는 그날 합계다. 달을 함께 보내지 않는다(서버가 400으로 거부한다). 나머지는 fetchTransactionPage와 같다.
 */
export async function fetchDayPage(ledgerId: string, date: string, cursor: string | null): Promise<TransactionPage> {
  const query = new URLSearchParams({ date, limit: String(PAGE_SIZE) })
  if (cursor !== null) query.set('cursor', cursor)
  const body = await request<unknown>(`${ledgerPath(ledgerId, 'transactions')}?${query}`)
  if (!isTransactionPage(body, { date }, cursor === null)) throw ApiError.unreadable()
  return body
}

/**
 * 장부 전체의 거래를 서버의 순서(목록과 같다)로 한 쪽(50건) 받는다. `cursor`가 null이면 첫 쪽이다. 달을 보내지 않으므로
 * cursor도 장부 전체 기준이다(달 기준 cursor와 섞지 않는다). 장부 시간대의 오늘까지의 거래만 온다(서버가 거른다).
 * `sender`는 request와 같다. 기기에 남기는 최근 한 달(P-902)을 받는 데 쓴다. 실패하면 ApiError를 던진다.
 */
export async function fetchLedgerPage(ledgerId: string, cursor: string | null, sender?: SenderCheck): Promise<LedgerPage> {
  const query = new URLSearchParams({ limit: String(PAGE_SIZE) })
  if (cursor !== null) query.set('cursor', cursor)
  const body = await request<unknown>(`${ledgerPath(ledgerId, 'transactions')}?${query}`, {}, sender)
  if (!isTransactionPage(body, null, cursor === null)) throw ApiError.unreadable()
  return { items: body.items, nextCursor: body.nextCursor, days: body.days }
}
