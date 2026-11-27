package app.accountbook.api;

import app.accountbook.transaction.TransactionPage;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * 거래 목록의 한 쪽(#15 응답 계약). 거래는 만들기 응답(#14)과 같은 모양이다. 마지막 쪽이면 {@code nextCursor}가 null이다.
 *
 * @param nextCursor {@link TransactionCursor}. 다음 요청에 그대로 보낸다
 */
record TransactionListResponse(List<TransactionResponse> items, String nextCursor) {

    /** @param names 장부 구성원의 표시 이름. 쪽마다 한 번 읽는다 */
    static TransactionListResponse of(TransactionPage page, Map<UUID, String> names, String nextCursor) {
        return new TransactionListResponse(page.items().stream().map(tx -> TransactionResponse.of(tx, names)).toList(),
                nextCursor);
    }

    /** 스프링이 응답 객체를 로그에 남길 때 가맹점, 메모, 이름이 나가지 않게 한다(ADR 001 결정 10). */
    @Override
    public String toString() {
        return "TransactionListResponse[]";
    }
}
