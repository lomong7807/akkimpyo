package app.accountbook.stats;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import app.accountbook.category.CategoryKind;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/** 지출 합계의 부호를 뒤집을 때 값이 돌아가지 않는지 본다(이슈 #21). DB와 스프링 없이 돈다. */
class CategoryTotalTest {

    static final UUID CATEGORY_ID = UUID.randomUUID();

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
