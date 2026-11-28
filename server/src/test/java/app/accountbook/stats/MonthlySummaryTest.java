package app.accountbook.stats;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import app.accountbook.category.CategoryKind;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;

/**
 * 카테고리 합계를 더해 수입·지출 합계를 만들 때 값이 돌아가지 않는지(이슈 #21), 차액과 지출이 큰 카테고리(F-301, #16)를
 * 본다. DB와 스프링 없이 돈다.
 */
class MonthlySummaryTest {

    private static List<CategoryTotal> totals(CategoryKind kind, long... totals) {
        return Arrays.stream(totals)
                .mapToObj(total -> new CategoryTotal(UUID.randomUUID(), kind, total))
                .toList();
    }

    @Test
    void of_addsUpToTheLongRange() {
        MonthlySummary summary = MonthlySummary.of(Stream.concat(
                totals(CategoryKind.INCOME, Long.MAX_VALUE - 1, 1).stream(),
                totals(CategoryKind.EXPENSE, Long.MIN_VALUE + 1, -1).stream()).toList());

        assertThat(summary.income()).isEqualTo(Long.MAX_VALUE);
        assertThat(summary.expense()).isEqualTo(Long.MIN_VALUE);
    }

    @ParameterizedTest
    @EnumSource(CategoryKind.class)
    void of_failsWhenTotalIsAboveLong(CategoryKind kind) {
        assertThatThrownBy(() -> MonthlySummary.of(totals(kind, Long.MAX_VALUE, 1)))
                .isInstanceOf(ArithmeticException.class);
    }

    @ParameterizedTest
    @EnumSource(CategoryKind.class)
    void of_failsWhenTotalIsBelowLong(CategoryKind kind) {
        assertThatThrownBy(() -> MonthlySummary.of(totals(kind, Long.MIN_VALUE, -1)))
                .isInstanceOf(ArithmeticException.class);
    }

    /** UUID.compareTo는 부호 있는 비교라 이 둘의 순서가 글자 순과 반대다. 계약은 글자 순(PostgreSQL uuid 순서)이다. */
    private static final UUID TEXT_FIRST = UUID.fromString("7fffffff-ffff-4fff-bfff-ffffffffffff");
    private static final UUID TEXT_SECOND = UUID.fromString("80000000-0000-4000-8000-000000000000");

    private static CategoryTotal expense(UUID categoryId, long total) {
        return new CategoryTotal(categoryId, CategoryKind.EXPENSE, total);
    }

    @Test
    void topExpenses_areTheFiveLargestPositiveExpenses_tiesByCategoryIdText() {
        assertThat(TEXT_SECOND.compareTo(TEXT_FIRST)).as("UUID.compareTo의 순서").isNegative();
        CategoryTotal largest = expense(UUID.randomUUID(), 9_000);
        CategoryTotal third = expense(UUID.randomUUID(), 2_000);
        CategoryTotal fourth = expense(UUID.randomUUID(), 1_000);
        CategoryTotal sixth = expense(UUID.randomUUID(), 500);
        CategoryTotal refundLarger = expense(UUID.randomUUID(), -4_000);
        CategoryTotal salary = new CategoryTotal(UUID.randomUUID(), CategoryKind.INCOME, 50_000);

        MonthlySummary summary = MonthlySummary.of(List.of(salary, refundLarger, sixth, fourth,
                expense(TEXT_SECOND, 3_000), third, expense(TEXT_FIRST, 3_000), largest));

        assertThat(summary.topExpenses()).containsExactly(largest, expense(TEXT_FIRST, 3_000),
                expense(TEXT_SECOND, 3_000), third, fourth);
        // 빼고 보이는 카테고리도 합계에는 든다: 9,000 + 3,000 + 3,000 + 2,000 + 1,000 + 500 - 4,000.
        assertThat(summary.expense()).isEqualTo(14_500);
        assertThat(summary.net()).isEqualTo(35_500);
    }

    @Test
    void topExpenses_isEmptyWhenNoExpenseIsAboveZero_andNetKeepsTheSign() {
        MonthlySummary refundOnly = MonthlySummary.of(List.of(expense(UUID.randomUUID(), -4_000)));
        MonthlySummary empty = MonthlySummary.of(List.of());

        assertThat(refundOnly.topExpenses()).isEmpty();
        assertThat(refundOnly.expense()).isEqualTo(-4_000);
        assertThat(refundOnly.net()).isEqualTo(4_000);
        assertThat(empty.topExpenses()).isEmpty();
        assertThat(List.of(empty.income(), empty.expense(), empty.net())).containsOnly(0L);
    }

    @Test
    void net_failsWhenItDoesNotFitInLong() {
        MonthlySummary summary = MonthlySummary.of(List.of(
                new CategoryTotal(UUID.randomUUID(), CategoryKind.INCOME, Long.MAX_VALUE),
                expense(UUID.randomUUID(), -1)));

        assertThatThrownBy(summary::net).isInstanceOf(ArithmeticException.class);
    }
}
