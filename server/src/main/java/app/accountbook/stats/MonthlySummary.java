package app.accountbook.stats;

import app.accountbook.category.CategoryKind;
import java.util.Comparator;
import java.util.List;

/**
 * 월별 수입·지출 합계와 최상위 카테고리별 합계. 지출은 양수로 표시하고, 환불이 더 크면 음수 그대로다(P-205, F-302).
 *
 * @param categories 합계가 0이 아닌 최상위 카테고리. 하위 카테고리는 상위에 들어 있다
 */
public record MonthlySummary(long income, long expense, List<CategoryTotal> categories) {

    /** 월별 통계 화면의 "지출이 큰 카테고리" 수(F-301). */
    public static final int TOP_EXPENSE_LIMIT = 5;

    /**
     * 금액이 큰 순, 같으면 categoryId의 36자 표기 순(PostgreSQL uuid 순서와 같다). UUID.compareTo는 부호 있는 비교라
     * 이 순서와 다르므로 쓰지 않는다.
     */
    private static final Comparator<CategoryTotal> LARGEST_FIRST = Comparator
            .comparingLong(CategoryTotal::total).reversed()
            .thenComparing(category -> category.categoryId().toString());

    /** DB가 카테고리별로 집계한 결과에서 수입·지출 합계를 만든다. */
    public static MonthlySummary of(List<CategoryTotal> categories) {
        return new MonthlySummary(sum(categories, CategoryKind.INCOME), sum(categories, CategoryKind.EXPENSE),
                List.copyOf(categories));
    }

    /** 차액(수입 - 지출, F-301). long을 넘으면 틀린 값 대신 ArithmeticException이다. */
    public long net() {
        return Math.subtractExact(income, expense);
    }

    /**
     * 지출이 큰 최상위 카테고리 {@value #TOP_EXPENSE_LIMIT}개까지(F-301, E-01 (6)). 0원 이하인 카테고리는 넣지 않는다.
     * 미분류도 카테고리다.
     */
    public List<CategoryTotal> topExpenses() {
        return categories.stream()
                .filter(category -> category.kind() == CategoryKind.EXPENSE && category.total() > 0)
                .sorted(LARGEST_FIRST)
                .limit(TOP_EXPENSE_LIMIT)
                .toList();
    }

    /** LongStream.sum()은 넘치면 조용히 틀린 값이 되므로 쓰지 않는다. */
    private static long sum(List<CategoryTotal> categories, CategoryKind kind) {
        return categories.stream()
                .filter(category -> category.kind() == kind)
                .mapToLong(CategoryTotal::total)
                .reduce(0L, Math::addExact);
    }
}
