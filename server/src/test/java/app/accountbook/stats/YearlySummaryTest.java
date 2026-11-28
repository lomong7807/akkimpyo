package app.accountbook.stats;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import app.accountbook.category.CategoryKind;
import java.time.Month;
import java.time.Year;
import java.time.YearMonth;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/** 달마다의 카테고리 합계로 연 단위 통계(F-304, #10)를 만드는 계산. DB와 스프링 없이 돈다. */
class YearlySummaryTest {

    static final Year YEAR = Year.of(2025);
    static final UUID FOOD = UUID.fromString("00000000-0000-4000-8000-000000000001");
    static final UUID CAFE = UUID.fromString("00000000-0000-4000-8000-000000000002");
    static final UUID SALARY = UUID.fromString("00000000-0000-4000-8000-000000000003");
    /** UUID.compareTo로는 FOOD보다 앞서고 36자 표기로는 뒤다. */
    static final UUID GIFT = UUID.fromString("f0000000-0000-4000-8000-000000000004");

    @Test
    void of_hasTwelveZeroMonthsWithoutData() {
        YearlySummary summary = YearlySummary.of(YEAR, Map.of());

        assertThat(summary.months()).extracting(YearlySummary.MonthTotals::month)
                .containsExactly(YearMonth.of(2025, 1), YearMonth.of(2025, 2), YearMonth.of(2025, 3),
                        YearMonth.of(2025, 4), YearMonth.of(2025, 5), YearMonth.of(2025, 6), YearMonth.of(2025, 7),
                        YearMonth.of(2025, 8), YearMonth.of(2025, 9), YearMonth.of(2025, 10), YearMonth.of(2025, 11),
                        YearMonth.of(2025, 12));
        assertThat(summary.months()).allSatisfy(month -> assertThat(List.of(month.income(), month.expense(),
                month.net())).containsOnly(0L));
        assertThat(List.of(summary.income(), summary.expense(), summary.net())).containsOnly(0L);
        assertThat(summary.categories()).isEmpty();
    }

    /** 카테고리는 달을 넘어 더하고, 연 합계가 0이면 뺀다. 수입, 지출 순이고 같은 구분에서는 금액이 큰 순이다. */
    @Test
    void of_addsEachCategoryAcrossMonths() {
        YearlySummary summary = YearlySummary.of(YEAR, Map.of(
                Month.JANUARY, List.of(expense(FOOD, 10_000), expense(CAFE, 3_000), income(SALARY, 100_000)),
                Month.MARCH, List.of(expense(FOOD, -2_000), expense(CAFE, -3_000), expense(GIFT, 8_000)),
                Month.DECEMBER, List.of(income(SALARY, 50_000), expense(GIFT, -9_000))));

        assertThat(summary.months().get(0)).isEqualTo(
                new YearlySummary.MonthTotals(YearMonth.of(2025, 1), 100_000, 13_000));
        assertThat(summary.months().get(2)).isEqualTo(
                new YearlySummary.MonthTotals(YearMonth.of(2025, 3), 0, 3_000));
        assertThat(summary.months().get(11).net()).isEqualTo(59_000);
        assertThat(summary.months().get(1).net()).isZero();
        assertThat(List.of(summary.income(), summary.expense(), summary.net()))
                .containsExactly(150_000L, 7_000L, 143_000L);
        assertThat(summary.categories()).containsExactly(
                income(SALARY, 150_000), expense(FOOD, 8_000), expense(GIFT, -1_000));
    }

    /**
     * 하위별 금액은 그해로 더한다. 하위가 없던 달에 상위에 바로 넣은 금액도 맨 뒤의 상위 줄에 든다. 달마다 0이 된 최상위도
     * 그 하위별 금액은 그해에 든다(3월의 점심과 바로 넣은 환불).
     */
    @Test
    void of_addsSubcategoriesAcrossMonths() {
        UUID lunch = UUID.fromString("00000000-0000-4000-8000-000000000005");
        YearlySummary summary = YearlySummary.of(YEAR, Map.of(
                Month.JANUARY, List.of(CategoryTotal.ofLine(FOOD, FOOD, CategoryKind.EXPENSE, -1_000)),
                Month.FEBRUARY, List.of(CategoryTotal.ofLine(FOOD, lunch, CategoryKind.EXPENSE, -3_000)),
                Month.MARCH, List.of(CategoryTotal.ofLine(FOOD, lunch, CategoryKind.EXPENSE, -500),
                        CategoryTotal.ofLine(FOOD, FOOD, CategoryKind.EXPENSE, 500))));

        assertThat(summary.categories()).containsExactly(new CategoryTotal(FOOD, CategoryKind.EXPENSE, 4_000,
                List.of(expense(lunch, 3_500), expense(FOOD, 500))));
        assertThat(summary.months().get(2).expense()).isZero();
    }

    @Test
    void of_ordersEqualTotalsByIdText() {
        YearlySummary summary = YearlySummary.of(YEAR, Map.of(
                Month.MAY, List.of(expense(GIFT, 5_000)), Month.JUNE, List.of(expense(FOOD, 5_000))));

        assertThat(summary.categories()).extracting(CategoryTotal::categoryId).containsExactly(FOOD, GIFT);
    }

    /** 달마다는 long 안이어도 연 합계나 한 카테고리의 연 합계가 넘으면 틀린 값 대신 ArithmeticException이다. */
    @Test
    void of_failsWhenAYearTotalIsAboveLong() {
        Map<Month, List<CategoryTotal>> yearIncome = Map.of(
                Month.JANUARY, List.of(income(SALARY, Long.MAX_VALUE)), Month.FEBRUARY, List.of(income(GIFT, 1)));
        // 연 수입은 (MAX - 1) + 1로 long 안이고, 급여만 MAX + 1이다.
        Map<Month, List<CategoryTotal>> oneCategory = Map.of(
                Month.JANUARY, List.of(income(SALARY, Long.MAX_VALUE), income(GIFT, -1)),
                Month.FEBRUARY, List.of(income(SALARY, 1)));

        assertThatThrownBy(() -> YearlySummary.of(YEAR, yearIncome)).isInstanceOf(ArithmeticException.class);
        assertThatThrownBy(() -> YearlySummary.of(YEAR, oneCategory)).isInstanceOf(ArithmeticException.class);
    }

    private static CategoryTotal expense(UUID categoryId, long total) {
        return new CategoryTotal(categoryId, CategoryKind.EXPENSE, total);
    }

    private static CategoryTotal income(UUID categoryId, long total) {
        return new CategoryTotal(categoryId, CategoryKind.INCOME, total);
    }
}
