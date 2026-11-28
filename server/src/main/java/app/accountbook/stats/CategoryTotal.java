package app.accountbook.stats;

import app.accountbook.category.CategoryKind;
import java.util.Collection;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;
import java.util.stream.Stream;

/**
 * 한 기간 동안 카테고리 1개의 합계. 지출은 양수로 표시한다(환불은 지출을 줄인다).
 *
 * @param children 최상위 카테고리를 펼친 금액(F-302, E-02 (7)). 합계가 0이 아닌 하위 카테고리가 금액이 큰 순으로 오고,
 *                 상위에 바로 넣은 금액이 0이 아니면 그 상위 자신의 id로 맨 뒤에 온다. 0이 아닌 하위가 없으면 빈 목록이다.
 *                 비어 있지 않으면 합이 {@code total}이다. 하위 항목 자신은 늘 빈 목록이다
 */
public record CategoryTotal(UUID categoryId, CategoryKind kind, long total, List<CategoryTotal> children) {

    public CategoryTotal {
        children = List.copyOf(children);
    }

    /** 펼친 금액이 없는 합계(하위 항목, 또는 하위가 없는 최상위). */
    public CategoryTotal(UUID categoryId, CategoryKind kind, long total) {
        this(categoryId, kind, total, List.of());
    }

    /** 라인 amount의 합(지출은 음수)을 표시용 합계로 바꾼다. */
    public static CategoryTotal of(UUID categoryId, CategoryKind kind, long lineSum) {
        return new CategoryTotal(categoryId, kind,
                kind == CategoryKind.EXPENSE ? Math.negateExact(lineSum) : lineSum);
    }

    /** DB가 라인의 카테고리별로 묶은 한 행을 그 최상위 카테고리의 합계로 바꾼다. 하위의 행이면 펼친 금액이 그 하위 하나다. */
    static CategoryTotal ofLine(UUID topCategoryId, UUID lineCategoryId, CategoryKind kind, long lineSum) {
        CategoryTotal line = of(lineCategoryId, kind, lineSum);
        return new CategoryTotal(topCategoryId, kind, line.total(),
                lineCategoryId.equals(topCategoryId) ? List.of() : List.of(line));
    }

    /**
     * 라인의 카테고리별 합계({@link #ofLine})를 최상위 카테고리마다 하나로 더한다(한 달, 또는 그해의 모든 달). 합계가 0인
     * 최상위와 하위는 뺀다. 0이 된 최상위를 뺀 결과를 다시 더하면 그 하위별 금액이 빠지므로 결과끼리 더하지 않는다. 수입, 지출
     * 순이고 같은 구분 안에서는 {@link MonthlySummary#LARGEST_FIRST}다. 더한 값이 long을 넘으면 {@link ArithmeticException}이다.
     */
    static List<CategoryTotal> rollUp(Collection<CategoryTotal> totals) {
        return totals.stream()
                .collect(Collectors.groupingBy(total -> Map.entry(total.categoryId(), total.kind())))
                .values().stream()
                .map(CategoryTotal::merged)
                .filter(total -> total.total() != 0)
                .sorted(Comparator.comparing(CategoryTotal::kind).thenComparing(MonthlySummary.LARGEST_FIRST))
                .toList();
    }

    /** 같은 최상위 카테고리의 합계들. 펼친 금액이 빈 합계는 모두 상위에 바로 넣은 금액이다. */
    private static CategoryTotal merged(List<CategoryTotal> same) {
        CategoryTotal first = same.getFirst();
        Map<UUID, Long> parts = same.stream()
                .flatMap(total -> total.children().isEmpty()
                        ? Stream.of(new CategoryTotal(first.categoryId(), first.kind(), total.total()))
                        : total.children().stream())
                .collect(Collectors.toMap(CategoryTotal::categoryId, CategoryTotal::total, Math::addExact));
        long direct = parts.getOrDefault(first.categoryId(), 0L);
        List<CategoryTotal> subcategories = parts.entrySet().stream()
                .filter(part -> !part.getKey().equals(first.categoryId()) && part.getValue() != 0)
                .map(part -> new CategoryTotal(part.getKey(), first.kind(), part.getValue()))
                .sorted(MonthlySummary.LARGEST_FIRST)
                .toList();
        List<CategoryTotal> children = subcategories.isEmpty() || direct == 0 ? subcategories
                : Stream.concat(subcategories.stream(),
                        Stream.of(new CategoryTotal(first.categoryId(), first.kind(), direct))).toList();
        return new CategoryTotal(first.categoryId(), first.kind(),
                parts.values().stream().reduce(0L, Math::addExact), children);
    }
}
