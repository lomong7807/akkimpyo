package app.accountbook.api;

import app.accountbook.transaction.TransactionPage;
import io.swagger.v3.oas.annotations.media.Schema;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.jspecify.annotations.Nullable;

/**
 * 거래 검색의 한 쪽(#64 응답 계약). 거래는 목록(#15)과 같은 모양이고 마지막 쪽이면 {@code nextCursor}가 null이다.
 *
 * @param nextCursor {@link TransactionCursor}. 다음 요청에 같은 조건과 함께 그대로 보낸다
 * @param totals     검색 조건 전체의 건수와 P-205 합계. 첫 쪽(cursor 없는 요청)에만 있고 다음 쪽은 null
 */
record TransactionSearchResponse(List<TransactionResponse> items, @Nullable String nextCursor, @Nullable Totals totals) {

    /** @param names 장부 구성원의 표시 이름. 쪽마다 한 번 읽는다 */
    static TransactionSearchResponse of(TransactionPage page, Map<UUID, String> names, String nextCursor) {
        return new TransactionSearchResponse(page.items().stream().map(tx -> TransactionResponse.of(tx, names))
                .toList(), nextCursor,
                page.totals() == null ? null : new Totals(page.totals().count(), page.totals().income(),
                        page.totals().expense()));
    }

    /**
     * @param count   목록에 나오는 거래 수(휴지통 제외, 취소 포함). D-03의 "결과 N건"이다
     * @param income  수입 합계, {@code expense}는 지출 합계(양수). 취소·이체는 빠진다(P-205)
     */
    @Schema(name = "TransactionSearchTotals")
    record Totals(long count, long income, long expense) {
    }

    /** 스프링이 응답 객체를 로그에 남길 때 가맹점, 메모, 이름이 나가지 않게 한다(ADR 001 결정 10). */
    @Override
    public String toString() {
        return "TransactionSearchResponse[]";
    }
}
