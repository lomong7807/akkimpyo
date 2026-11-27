package app.accountbook.stats;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import app.accountbook.account.Account;
import app.accountbook.account.AccountType;
import app.accountbook.category.Category;
import app.accountbook.category.CategoryCommand;
import app.accountbook.category.CategoryKind;
import app.accountbook.category.CategoryService;
import app.accountbook.common.NotLedgerMemberException;
import app.accountbook.support.Fixtures;
import app.accountbook.support.IntegrationTest;
import app.accountbook.user.User;
import java.time.LocalDate;
import java.time.YearMonth;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

@IntegrationTest
class MonthlyStatsQueryTest {

    static final YearMonth NOVEMBER = YearMonth.of(2026, 11);
    static final LocalDate NOV_18 = LocalDate.of(2026, 11, 18);

    @Autowired MonthlyStatsQuery monthlyStatsQuery;
    @Autowired CategoryService categoryService;
    @Autowired Fixtures fixtures;

    User owner;
    UUID ledgerId;
    Account bank;
    Account cash;
    Category food;
    Category salary;

    @BeforeEach
    void setUp() {
        owner = fixtures.user("owner@example.com");
        ledgerId = fixtures.personalLedgerId(owner);
        bank = fixtures.account(owner, ledgerId, "국민은행", AccountType.BANK, 100_000, LocalDate.of(2026, 10, 1));
        cash = fixtures.account(owner, ledgerId, "현금", AccountType.CASH, 0, LocalDate.of(2026, 10, 1));
        food = category("식비", CategoryKind.EXPENSE);
        salary = category("급여", CategoryKind.INCOME);
    }

    private Category category(String name, CategoryKind kind) {
        return categoryService.create(owner.getId(), ledgerId, new CategoryCommand(name, kind, null));
    }

    private Category subcategory(String name, Category parent) {
        return categoryService.create(owner.getId(), ledgerId,
                new CategoryCommand(name, CategoryKind.EXPENSE, parent.getId()));
    }

    private MonthlySummary november() {
        return monthlyStatsQuery.monthly(owner.getId(), ledgerId, NOVEMBER);
    }

    @Test
    void monthly_excludesTransfers() {
        fixtures.transfer(owner, ledgerId, bank.getId(), cash.getId(), NOV_18, 30_000);

        MonthlySummary summary = november();

        assertThat(summary.income()).isZero();
        assertThat(summary.expense()).isZero();
        assertThat(summary.categories()).isEmpty();
    }

    @Test
    void monthly_refundReducesExpense() {
        fixtures.expense(owner, ledgerId, cash.getId(), food.getId(), NOV_18, 12_000);
        fixtures.refund(owner, ledgerId, cash.getId(), food.getId(), NOV_18, 2_000);
        // 지출과 환불이 같아 합계가 0인 카테고리는 결과에 넣지 않는다.
        Category cafe = category("카페", CategoryKind.EXPENSE);
        fixtures.expense(owner, ledgerId, cash.getId(), cafe.getId(), NOV_18, 4_500);
        fixtures.refund(owner, ledgerId, cash.getId(), cafe.getId(), NOV_18, 4_500);

        MonthlySummary summary = november();

        assertThat(summary.expense()).isEqualTo(10_000);
        assertThat(summary.income()).isZero();
        assertThat(summary.categories()).containsExactly(
                new CategoryTotal(food.getId(), CategoryKind.EXPENSE, 10_000));
    }

    @Test
    void monthly_includesTransactionsBeforeOpeningDate() {
        Account late = fixtures.account(owner, ledgerId, "새 카드", AccountType.CARD, 0, LocalDate.of(2026, 11, 10));
        fixtures.expense(owner, ledgerId, late.getId(), food.getId(), LocalDate.of(2026, 11, 9), 5_000);

        MonthlySummary summary = november();

        assertThat(summary.expense()).isEqualTo(5_000);
        assertThat(summary.categories()).containsExactly(
                new CategoryTotal(food.getId(), CategoryKind.EXPENSE, 5_000));
    }

    @Test
    void monthly_excludesCanceledAndDeleted() {
        fixtures.cancel(owner, fixtures.expense(owner, ledgerId, cash.getId(), food.getId(), NOV_18, 12_000));
        fixtures.delete(owner, fixtures.expense(owner, ledgerId, cash.getId(), food.getId(), NOV_18, 3_000));
        fixtures.delete(owner, fixtures.income(owner, ledgerId, bank.getId(), salary.getId(), NOV_18, 50_000));
        fixtures.expense(owner, ledgerId, cash.getId(), food.getId(), NOV_18, 1_000);

        MonthlySummary summary = november();

        assertThat(summary.expense()).isEqualTo(1_000);
        assertThat(summary.income()).isZero();
        assertThat(summary.categories()).containsExactly(
                new CategoryTotal(food.getId(), CategoryKind.EXPENSE, 1_000));
    }

    @Test
    void monthly_groupsUncategorizedUnderDefaultCategory() {
        fixtures.expense(owner, ledgerId, cash.getId(), null, NOV_18, 7_000);
        fixtures.income(owner, ledgerId, bank.getId(), null, NOV_18, 3_000);
        fixtures.income(owner, ledgerId, bank.getId(), salary.getId(), NOV_18, 50_000);

        MonthlySummary summary = november();

        UUID uncategorizedExpense = categoryService.uncategorized(ledgerId, CategoryKind.EXPENSE).getId();
        UUID uncategorizedIncome = categoryService.uncategorized(ledgerId, CategoryKind.INCOME).getId();
        assertThat(summary.expense()).isEqualTo(7_000);
        assertThat(summary.income()).isEqualTo(53_000);
        assertThat(summary.categories()).containsExactlyInAnyOrder(
                new CategoryTotal(uncategorizedExpense, CategoryKind.EXPENSE, 7_000),
                new CategoryTotal(uncategorizedIncome, CategoryKind.INCOME, 3_000),
                new CategoryTotal(salary.getId(), CategoryKind.INCOME, 50_000));
    }

    @Test
    void monthly_boundaries() {
        fixtures.expense(owner, ledgerId, cash.getId(), food.getId(), LocalDate.of(2026, 10, 31), 4_000);
        fixtures.expense(owner, ledgerId, cash.getId(), food.getId(), LocalDate.of(2026, 12, 1), 8_000);
        assertThat(november().categories()).isEmpty();

        fixtures.expense(owner, ledgerId, cash.getId(), food.getId(), LocalDate.of(2026, 11, 1), 1_000);
        fixtures.expense(owner, ledgerId, cash.getId(), food.getId(), LocalDate.of(2026, 11, 30), 2_000);

        MonthlySummary summary = november();
        assertThat(summary.expense()).isEqualTo(3_000);
        assertThat(summary.categories()).containsExactly(
                new CategoryTotal(food.getId(), CategoryKind.EXPENSE, 3_000));
        assertThat(monthlyStatsQuery.monthly(owner.getId(), ledgerId, YearMonth.of(2026, 10)).expense())
                .isEqualTo(4_000);
    }

    /** 윤년과 평년의 2월. 1일과 말일은 들고, 앞 달의 말일과 다음 달 1일은 들지 않는다. */
    @Test
    void monthly_februaryBoundaries() {
        for (String day : List.of("2024-01-31", "2024-02-01", "2024-02-29", "2024-03-01", "2025-02-28", "2025-03-01")) {
            fixtures.expense(owner, ledgerId, cash.getId(), food.getId(), LocalDate.parse(day),
                    LocalDate.parse(day).getDayOfMonth());
        }

        assertThat(monthlyStatsQuery.monthly(owner.getId(), ledgerId, YearMonth.of(2024, 2)).expense())
                .as("1일 + 29일").isEqualTo(30);
        assertThat(monthlyStatsQuery.monthly(owner.getId(), ledgerId, YearMonth.of(2025, 2)).expense())
                .as("28일").isEqualTo(28);
    }

    /** 하위 카테고리의 지출은 상위 카테고리 하나로 모인다. 하위끼리 지워져 0이 된 상위는 넣지 않는다. */
    @Test
    void monthly_addsSubcategoriesToTheirTopLevelCategory() {
        Category lunch = subcategory("점심", food);
        Category cafe = category("카페", CategoryKind.EXPENSE);
        Category coffee = subcategory("커피", cafe);
        fixtures.expense(owner, ledgerId, cash.getId(), lunch.getId(), NOV_18, 3_000);
        fixtures.expense(owner, ledgerId, cash.getId(), food.getId(), NOV_18, 1_000);
        fixtures.expense(owner, ledgerId, cash.getId(), coffee.getId(), NOV_18, 2_000);
        fixtures.refund(owner, ledgerId, cash.getId(), cafe.getId(), NOV_18, 2_000);

        MonthlySummary summary = november();

        assertThat(summary.expense()).isEqualTo(4_000);
        assertThat(summary.categories()).containsExactly(
                new CategoryTotal(food.getId(), CategoryKind.EXPENSE, 4_000));
    }

    /** 환불이 지출보다 큰 카테고리는 음수 그대로 합계에 든다(P-205, F-302). 지출이 큰 카테고리에는 없다(F-301). */
    @Test
    void monthly_keepsNegativeCategoryWhenRefundIsLarger() {
        Category cafe = category("카페", CategoryKind.EXPENSE);
        fixtures.expense(owner, ledgerId, cash.getId(), food.getId(), NOV_18, 10_000);
        fixtures.expense(owner, ledgerId, cash.getId(), cafe.getId(), NOV_18, 1_000);
        fixtures.refund(owner, ledgerId, cash.getId(), cafe.getId(), NOV_18, 3_000);
        fixtures.refund(owner, ledgerId, cash.getId(), food.getId(), LocalDate.of(2026, 10, 5), 5_000);

        MonthlySummary summary = november();

        assertThat(summary.categories()).containsExactly(
                new CategoryTotal(food.getId(), CategoryKind.EXPENSE, 10_000),
                new CategoryTotal(cafe.getId(), CategoryKind.EXPENSE, -2_000));
        assertThat(summary.expense()).isEqualTo(8_000);
        assertThat(summary.topExpenses()).containsExactly(
                new CategoryTotal(food.getId(), CategoryKind.EXPENSE, 10_000));
        MonthlySummary october = monthlyStatsQuery.monthly(owner.getId(), ledgerId, YearMonth.of(2026, 10));
        assertThat(List.of(october.expense(), october.net())).as("환불만 있는 달").containsExactly(-5_000L, 5_000L);
        assertThat(october.topExpenses()).isEmpty();
    }

    @Test
    void monthly_rejectsOutsider() {
        User outsider = fixtures.user("outsider@example.com");

        assertThatThrownBy(() -> monthlyStatsQuery.monthly(outsider.getId(), ledgerId, NOVEMBER))
                .isInstanceOf(NotLedgerMemberException.class);
    }
}
