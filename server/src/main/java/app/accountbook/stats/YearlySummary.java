package app.accountbook.stats;

import app.accountbook.category.CategoryKind;
import java.time.Month;
import java.time.Year;
import java.time.YearMonth;
import java.util.Arrays;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.function.ToLongFunction;
import java.util.stream.Collectors;

/**
 * 연 단위 통계(F-304, P-224): 1월부터 12월까지의 수입·지출, 연 합계, 그해의 최상위 카테고리별 합계. 달마다의 값은 그달의
 * 월별 통계({@link MonthlySummary})와 같은 계산이다. 지출은 양수로 표시하고, 환불이 더 크면 음수 그대로다(P-205, F-302).
 *
 * @param months     1월부터 12월까지 늘 12개. 거래가 없는 달은 0이다
 * @param income     달마다의 수입을 더한 값
 * @param expense    달마다의 지출을 더한 값
 * @param categories 그해 합계가 0이 아닌 최상위 카테고리 전부(하위는 상위에 들어 있다). 수입, 지출 순이고, 같은 구분
 *                   안에서는 금액이 큰 순, 같으면 categoryId 순이다. 환불이 더 큰 카테고리는 음수로 그 구분의 끝에 있다.
 *                   미분류도 카테고리다
 */
public record YearlySummary(Year year, List<MonthTotals> months, long income, long expense,
                            List<CategoryTotal> categories) {

    /** 그해 한 달의 수입·지출. */
    public record MonthTotals(YearMonth month, long income, long expense) {

        /** 차액(수입 - 지출). long을 넘으면 틀린 값 대신 ArithmeticException이다. */
        public long net() {
            return Math.subtractExact(income, expense);
        }
    }

    /**
     * DB가 달마다 최상위 카테고리별로 집계한 결과(그달 월별 통계의 categories와 같은 것)에서 만든다. 더한 값이 long을
     * 넘으면 틀린 값 대신 {@link ArithmeticException}이다.
     */
    static YearlySummary of(Year year, Map<Month, List<CategoryTotal>> byMonth) {
        List<MonthTotals> months = Arrays.stream(Month.values())
                .map(month -> {
                    MonthlySummary summary = MonthlySummary.of(byMonth.getOrDefault(month, List.of()));
                    return new MonthTotals(year.atMonth(month), summary.income(), summary.expense());
                })
                .toList();
        List<CategoryTotal> categories = byMonth.values().stream()
                .flatMap(List::stream)
                .collect(Collectors.toMap(category -> Map.entry(category.categoryId(), category.kind()),
                        category -> category,
                        (a, b) -> new CategoryTotal(a.categoryId(), a.kind(), Math.addExact(a.total(), b.total()))))
                .values().stream()
                .filter(category -> category.total() != 0)
                .sorted(Comparator.comparing(CategoryTotal::kind).thenComparing(MonthlySummary.LARGEST_FIRST))
                .toList();
        return new YearlySummary(year, months, sum(months, MonthTotals::income), sum(months, MonthTotals::expense),
                categories);
    }

    /** 연 차액(수입 - 지출). long을 넘으면 틀린 값 대신 ArithmeticException이다. */
    public long net() {
        return Math.subtractExact(income, expense);
    }

    /** LongStream.sum()은 넘치면 조용히 틀린 값이 되므로 쓰지 않는다. */
    private static long sum(List<MonthTotals> months, ToLongFunction<MonthTotals> value) {
        return months.stream().mapToLong(value).reduce(0L, Math::addExact);
    }
}
