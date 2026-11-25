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

/** 카테고리 합계를 더해 수입·지출 합계를 만들 때 값이 돌아가지 않는지 본다(이슈 #21). DB와 스프링 없이 돈다. */
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
}
