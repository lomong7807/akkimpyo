package app.accountbook.stats;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import app.accountbook.category.CategoryKind;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/**
 * 지출 합계의 부호를 뒤집을 때 값이 돌아가지 않는지(이슈 #21), 라인의 카테고리별 합계를 최상위로 모으는지(F-302, #48) 본다.
 * DB와 스프링 없이 돈다.
 */
class CategoryTotalTest {

    static final UUID CATEGORY_ID = UUID.randomUUID();
    static final UUID FOOD = UUID.fromString("00000000-0000-4000-8000-000000000001");
    static final UUID LUNCH = UUID.fromString("00000000-0000-4000-8000-000000000002");
    static final UUID DINNER = UUID.fromString("00000000-0000-4000-8000-000000000003");
    static final UUID SNACK = UUID.fromString("00000000-0000-4000-8000-000000000004");
    static final UUID CAFE = UUID.fromString("00000000-0000-4000-8000-000000000005");
    static final UUID COFFEE = UUID.fromString("00000000-0000-4000-8000-000000000006");

    /** 지출 라인의 합(음수)인 한 행. */
    private static CategoryTotal spent(UUID top, UUID line, long amount) {
        return CategoryTotal.ofLine(top, line, CategoryKind.EXPENSE, -amount);
    }

    private static CategoryTotal expense(UUID categoryId, long total) {
        return new CategoryTotal(categoryId, CategoryKind.EXPENSE, total);
    }

    /**
     * 하위는 상위에 더하고 펼친 금액에 큰 순으로 둔다(음수는 끝). 상위에 바로 넣은 금액은 상위 id로 맨 뒤다(E-02 (7)).
     * 같은 하위의 행(그해의 여러 달)은 더하고, 더해 0이 된 하위는 뺀다.
     */
    @Test
    void rollUp_putsNonZeroSubcategoriesLargestFirst_thenTheDirectAmount() {
        List<CategoryTotal> rolled = CategoryTotal.rollUp(List.of(spent(FOOD, FOOD, 1_000), spent(FOOD, LUNCH, 3_000),
                spent(FOOD, DINNER, 6_000), spent(FOOD, DINNER, -1_000), spent(FOOD, SNACK, -700)));

        assertThat(rolled).containsExactly(new CategoryTotal(FOOD, CategoryKind.EXPENSE, 8_300, List.of(
                expense(DINNER, 5_000), expense(LUNCH, 3_000), expense(SNACK, -700), expense(FOOD, 1_000))));
    }

    /** 0이 아닌 하위가 없으면 펼친 금액이 없다. 하위와 상위에 바로 넣은 금액이 지워져 0이 된 최상위는 뺀다. */
    @Test
    void rollUp_hasNoChildrenWithoutANonZeroSubcategory() {
        assertThat(CategoryTotal.rollUp(List.of(spent(FOOD, FOOD, 2_000), spent(FOOD, LUNCH, 500),
                spent(FOOD, LUNCH, -500), spent(CAFE, COFFEE, 2_000), spent(CAFE, CAFE, -2_000))))
                .containsExactly(expense(FOOD, 2_000));
        assertThat(CategoryTotal.rollUp(List.of(spent(FOOD, LUNCH, 3_000))))
                .as("하위만 있으면 상위에 바로 넣은 줄이 없다")
                .containsExactly(new CategoryTotal(FOOD, CategoryKind.EXPENSE, 3_000, List.of(expense(LUNCH, 3_000))));
    }

    @Test
    void rollUp_failsWhenASubcategoryTotalIsAboveLong() {
        assertThatThrownBy(() -> CategoryTotal.rollUp(List.of(
                spent(FOOD, LUNCH, Long.MAX_VALUE), spent(FOOD, LUNCH, 1), spent(FOOD, FOOD, -1))))
                .isInstanceOf(ArithmeticException.class);
    }

    @Test
    void of_flipsSignOfExpenseUpToTheLongRange() {
        assertThat(CategoryTotal.of(CATEGORY_ID, CategoryKind.EXPENSE, -Long.MAX_VALUE).total())
                .isEqualTo(Long.MAX_VALUE);
        assertThat(CategoryTotal.of(CATEGORY_ID, CategoryKind.EXPENSE, Long.MAX_VALUE).total())
                .isEqualTo(-Long.MAX_VALUE);
    }

    /** Long.MIN_VALUE의 부호를 뒤집은 값은 long에 없다. 그냥 뒤집으면 음수 그대로 남는다. */
    @Test
    void of_failsWhenFlippedExpenseDoesNotFitInLong() {
        assertThatThrownBy(() -> CategoryTotal.of(CATEGORY_ID, CategoryKind.EXPENSE, Long.MIN_VALUE))
                .isInstanceOf(ArithmeticException.class);
    }

    @Test
    void of_keepsSignOfIncome() {
        assertThat(CategoryTotal.of(CATEGORY_ID, CategoryKind.INCOME, Long.MIN_VALUE).total())
                .isEqualTo(Long.MIN_VALUE);
    }
}
