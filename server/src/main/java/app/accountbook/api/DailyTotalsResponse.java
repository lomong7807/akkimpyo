package app.accountbook.api;

import app.accountbook.api.TransactionListResponse.Day;
import app.accountbook.transaction.TransactionPage.DayTotals;
import java.time.YearMonth;
import java.util.List;

/**
 * 달력의 날짜별 합계(#66 응답 계약). 합계는 P-205이고 지출은 양수다.
 *
 * @param month 요청한 달({@code YYYY-MM})
 * @param days  합계에 드는 거래가 있는 날만, 날짜 순. 날마다의 모양은 거래 목록(#15)의 {@code days}와 같다
 */
record DailyTotalsResponse(String month, List<Day> days) {

    static DailyTotalsResponse of(YearMonth month, List<DayTotals> days) {
        return new DailyTotalsResponse(month.toString(), days.stream().map(Day::of).toList());
    }
}
