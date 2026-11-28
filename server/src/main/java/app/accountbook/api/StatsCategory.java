package app.accountbook.api;

import app.accountbook.category.CategoryKind;
import app.accountbook.stats.CategoryTotal;
import java.util.List;
import java.util.UUID;

/**
 * 카테고리별 통계와 연 단위 통계의 카테고리 항목(#48 응답 계약). 칸은 월별 통계의 {@code topExpenseCategories} 항목(#16)과
 * 같고 {@code kind}와 {@code children}을 더했다.
 *
 * @param amount   그 카테고리의 합계(P-205). 지출은 양수이고 환불이 더 크면 음수다. 최상위는 하위를 포함한다(F-302)
 * @param children 합계가 0이 아닌 하위 카테고리가 금액이 큰 순으로 오고, 상위에 바로 넣은 금액이 0이 아니면 상위 자신의
 *                 {@code categoryId}로 맨 뒤에 온다(E-02 (7)). 0이 아닌 하위가 없으면 빈 목록이다. 비어 있지 않으면 합이
 *                 {@code amount}다
 */
record StatsCategory(UUID categoryId, long amount, CategoryKind kind, List<Child> children) {

    static StatsCategory of(CategoryTotal total) {
        return new StatsCategory(total.categoryId(), total.total(), total.kind(),
                total.children().stream().map(Child::of).toList());
    }

    /** 펼친 줄. 칸은 상위와 같고 {@code children}이 없다. */
    record Child(UUID categoryId, long amount, CategoryKind kind) {

        static Child of(CategoryTotal total) {
            return new Child(total.categoryId(), total.total(), total.kind());
        }
    }
}
