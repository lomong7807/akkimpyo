package app.accountbook.api;

import app.accountbook.stats.MonthlySummary;
import java.time.YearMonth;
import java.util.List;

/**
 * 달의 카테고리별 통계(F-302, #48 응답 계약). 계산은 월별 통계(#16)와 같다.
 *
 * @param month      요청한 달({@code YYYY-MM})
 * @param categories 합계가 0이 아닌 최상위 카테고리 전부. 수입, 지출 순이고 같은 구분 안에서는 금액이 큰 순, 같으면
 *                   categoryId 순이다. 환불이 더 큰 카테고리는 음수로 그 구분의 끝에 있다. 미분류도 카테고리다
 */
record CategoryStatsResponse(String month, List<StatsCategory> categories) {

    static CategoryStatsResponse of(YearMonth month, MonthlySummary summary) {
        return new CategoryStatsResponse(month.toString(),
                summary.categories().stream().map(StatsCategory::of).toList());
    }
}
