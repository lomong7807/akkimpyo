package app.accountbook.stats;

import app.accountbook.category.CategoryKind;
import java.util.List;

/** 월별 수입·지출 합계와 카테고리별 합계. 지출은 양수로 표시한다. */
public record MonthlySummary(long income, long expense, List<CategoryTotal> categories) {

    /** DB가 카테고리별로 집계한 결과에서 수입·지출 합계를 만든다. */
    public static MonthlySummary of(List<CategoryTotal> categories) {
        return new MonthlySummary(sum(categories, CategoryKind.INCOME), sum(categories, CategoryKind.EXPENSE),
                List.copyOf(categories));
    }

    private static long sum(List<CategoryTotal> categories, CategoryKind kind) {
        return categories.stream()
                .filter(category -> category.kind() == kind)
                .mapToLong(CategoryTotal::total)
                .sum();
    }
}
