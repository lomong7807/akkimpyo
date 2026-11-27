package app.accountbook.api;

import app.accountbook.stats.CategoryTotal;
import app.accountbook.stats.MonthlySummary;
import java.time.YearMonth;
import java.util.List;
import java.util.UUID;

/**
 * 월별 통계(F-301, #16 응답 계약). 합계는 P-205이고 지출은 양수다. 환불이 더 큰 달은 지출이 음수 그대로다.
 *
 * @param month                요청한 달({@code YYYY-MM})
 * @param net                  수입 - 지출
 * @param topExpenseCategories 지출이 큰 최상위 카테고리 5개까지(하위는 상위에 합친다). 금액 큰 순, 같으면 categoryId 순이고
 *                             0원 이하는 없다. 미분류도 카테고리다. 거래가 없는 달은 빈 목록이다
 */
record MonthlyStatsResponse(String month, long income, long expense, long net,
                            List<TopExpenseCategory> topExpenseCategories) {

    static MonthlyStatsResponse of(YearMonth month, MonthlySummary summary) {
        return new MonthlyStatsResponse(month.toString(), summary.income(), summary.expense(), summary.net(),
                summary.topExpenses().stream().map(TopExpenseCategory::of).toList());
    }

    /** @param amount 그 카테고리의 지출(양수) */
    record TopExpenseCategory(UUID categoryId, long amount) {

        static TopExpenseCategory of(CategoryTotal total) {
            return new TopExpenseCategory(total.categoryId(), total.total());
        }
    }
}
