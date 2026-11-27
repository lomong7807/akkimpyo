package app.accountbook.api;

import app.accountbook.transaction.TransactionPage;
import app.accountbook.transaction.TransactionPage.DayTotals;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/**
 * 거래 목록의 한 쪽(#15 응답 계약). 거래는 만들기 응답(#14)과 같은 모양이다. 마지막 쪽이면 {@code nextCursor}가 null이다.
 * 합계는 P-205이고 지출은 양수다.
 *
 * @param nextCursor {@link TransactionCursor}. 다음 요청에 그대로 보낸다
 * @param totals     그 달(하루 모드면 그날) 전체의 합계. 첫 쪽(cursor 없는 요청)에만 있고, 다음 쪽과 장부 전체 모드는 null
 * @param days       이 쪽에 나온 날마다 그날 전체의 합계. 날짜 역순이고 거래가 없는 날은 없다
 */
record TransactionListResponse(List<TransactionResponse> items, String nextCursor, Totals totals, List<Day> days) {

    /** @param names 장부 구성원의 표시 이름. 쪽마다 한 번 읽는다 */
    static TransactionListResponse of(TransactionPage page, Map<UUID, String> names, String nextCursor) {
        return new TransactionListResponse(page.items().stream().map(tx -> TransactionResponse.of(tx, names)).toList(),
                nextCursor,
                page.totals() == null ? null : new Totals(page.totals().income(), page.totals().expense()),
                page.days().stream().map(Day::of).toList());
    }

    /** 스프링이 응답 객체를 로그에 남길 때 가맹점, 메모, 이름이 나가지 않게 한다(ADR 001 결정 10). */
    @Override
    public String toString() {
        return "TransactionListResponse[]";
    }

    record Totals(long income, long expense) {
    }

    /** 그날의 합계. 달력의 날짜별 합계(#66, {@link DailyTotalsResponse})도 같은 모양이다. */
    record Day(LocalDate date, long income, long expense) {

        static Day of(DayTotals day) {
            return new Day(day.date(), day.income(), day.expense());
        }
    }
}
