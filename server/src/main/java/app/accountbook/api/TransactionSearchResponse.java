package app.accountbook.api;

import app.accountbook.api.TransactionListResponse.Totals;
import app.accountbook.transaction.TransactionPage;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * 거래 검색의 한 쪽(#64 응답 계약). 거래는 목록(#15)과 같은 모양이고 마지막 쪽이면 {@code nextCursor}가 null이다.
 *
 * @param nextCursor {@link TransactionCursor}. 다음 요청에 같은 조건과 함께 그대로 보낸다
 * @param totals     검색 조건 전체의 P-205 합계(지출은 양수). 첫 쪽(cursor 없는 요청)에만 있고 다음 쪽은 null
 */
record TransactionSearchResponse(List<TransactionResponse> items, String nextCursor, Totals totals) {

    /** @param names 장부 구성원의 표시 이름. 쪽마다 한 번 읽는다 */
    static TransactionSearchResponse of(TransactionPage page, Map<UUID, String> names, String nextCursor) {
        return new TransactionSearchResponse(page.items().stream().map(tx -> TransactionResponse.of(tx, names))
                .toList(), nextCursor,
                page.totals() == null ? null : new Totals(page.totals().income(), page.totals().expense()));
    }

    /** 스프링이 응답 객체를 로그에 남길 때 가맹점, 메모, 이름이 나가지 않게 한다(ADR 001 결정 10). */
    @Override
    public String toString() {
        return "TransactionSearchResponse[]";
    }
}
