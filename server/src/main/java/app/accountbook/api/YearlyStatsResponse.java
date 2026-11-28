package app.accountbook.api;

import app.accountbook.stats.YearlySummary;
import java.util.List;

/**
 * 연 단위 통계(F-304, P-224, #48 응답 계약). 연 단위 통계 서비스(#10)의 결과를 그대로 싣는다. 합계는 P-205이고 지출은 양수다.
 *
 * @param year       요청한 해
 * @param months     1월부터 12월까지 늘 12개. 거래가 없는 달은 0이다
 * @param net        연 수입 - 연 지출
 * @param categories 그해 합계가 0이 아닌 최상위 카테고리 전부. 순서는 카테고리별 통계({@link CategoryStatsResponse})와 같다
 */
record YearlyStatsResponse(int year, List<MonthTotals> months, long income, long expense, long net,
                           List<StatsCategory> categories) {

    static YearlyStatsResponse of(YearlySummary summary) {
        return new YearlyStatsResponse(summary.year().getValue(),
                summary.months().stream().map(MonthTotals::of).toList(),
                summary.income(), summary.expense(), summary.net(),
                summary.categories().stream().map(StatsCategory::of).toList());
    }

    /** @param month 그 달({@code YYYY-MM}) */
    record MonthTotals(String month, long income, long expense, long net) {

        static MonthTotals of(YearlySummary.MonthTotals month) {
            return new MonthTotals(month.month().toString(), month.income(), month.expense(), month.net());
        }
    }
}
