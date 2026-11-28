package app.accountbook.stats;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatNoException;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.catchThrowableOfType;

import app.accountbook.account.Account;
import app.accountbook.account.AccountType;
import app.accountbook.category.Category;
import app.accountbook.category.CategoryCommand;
import app.accountbook.category.CategoryKind;
import app.accountbook.category.CategoryService;
import app.accountbook.common.FieldErrorCode;
import app.accountbook.common.InvalidRequestException;
import app.accountbook.common.NotLedgerMemberException;
import app.accountbook.stats.YearlySummary.MonthTotals;
import app.accountbook.support.Fixtures;
import app.accountbook.support.IntegrationTest;
import app.accountbook.support.StoppedClockConfig;
import app.accountbook.support.StoppedClockConfig.StoppedClock;
import app.accountbook.user.User;
import java.time.Instant;
import java.time.LocalDate;
import java.time.Month;
import java.time.Year;
import java.time.YearMonth;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;

/** 연 단위 통계(#10, F-304, P-224). 규칙은 월별 통계(#16)와 같고 범위만 한 해다. */
@IntegrationTest
@Import(StoppedClockConfig.class)
class YearlyStatsQueryTest {

    static final Year YEAR = Year.of(2025);

    @Autowired YearlyStatsQuery yearlyStatsQuery;
    @Autowired MonthlyStatsQuery monthlyStatsQuery;
    @Autowired CategoryService categoryService;
    @Autowired Fixtures fixtures;
    @Autowired StoppedClock clock;

    User owner;
    UUID ledgerId;
    Account bank;
    Account cash;
    Category food;
    Category salary;

    @BeforeEach
    void setUp() {
        clock.stopAt(Instant.parse("2026-11-27T03:00:00Z"));
        owner = fixtures.user("owner@example.com");
        ledgerId = fixtures.personalLedgerId(owner);
        bank = fixtures.account(owner, ledgerId, "국민은행", AccountType.BANK, 100_000, LocalDate.of(2024, 1, 1));
        cash = fixtures.account(owner, ledgerId, "현금", AccountType.CASH, 0, LocalDate.of(2024, 1, 1));
        food = category("식비", CategoryKind.EXPENSE);
        salary = category("급여", CategoryKind.INCOME);
    }

    private Category category(String name, CategoryKind kind) {
        return categoryService.create(owner.getId(), ledgerId, new CategoryCommand(name, kind, null));
    }

    private YearlySummary yearly(Year year) {
        return yearlyStatsQuery.yearly(owner.getId(), ledgerId, year);
    }

    private void expense(String day, long amount) {
        fixtures.expense(owner, ledgerId, cash.getId(), food.getId(), LocalDate.parse(day), amount);
    }

    private void income(String day, long amount) {
        fixtures.income(owner, ledgerId, bank.getId(), salary.getId(), LocalDate.parse(day), amount);
    }

    @Test
    void yearly_addsUpEachMonthAndTheYear() {
        income("2025-01-25", 3_000_000);
        expense("2025-01-10", 12_000);
        expense("2025-03-05", 5_000);
        fixtures.refund(owner, ledgerId, cash.getId(), food.getId(), LocalDate.of(2025, 3, 6), 1_000);
        income("2025-11-25", 3_100_000);
        expense("2025-11-30", 4_000_000);

        YearlySummary summary = yearly(YEAR);

        assertThat(summary.year()).isEqualTo(YEAR);
        assertThat(summary.months()).hasSize(12);
        assertThat(summary.months().get(0)).isEqualTo(new MonthTotals(YearMonth.of(2025, 1), 3_000_000, 12_000));
        assertThat(summary.months().get(2)).isEqualTo(new MonthTotals(YearMonth.of(2025, 3), 0, 4_000));
        assertThat(summary.months().get(10).net()).as("지출이 더 큰 달").isEqualTo(-900_000);
        assertThat(List.of(summary.income(), summary.expense(), summary.net()))
                .containsExactly(6_100_000L, 4_016_000L, 2_084_000L);
    }

    @Test
    void yearly_hasTwelveZeroMonthsWithoutTransactions() {
        expense("2024-06-01", 1_000);

        YearlySummary summary = yearly(YEAR);

        assertThat(summary.months()).extracting(MonthTotals::month)
                .containsExactlyElementsOf(Arrays.stream(Month.values()).map(YEAR::atMonth).toList());
        assertThat(summary.months()).allSatisfy(month ->
                assertThat(List.of(month.income(), month.expense(), month.net())).containsOnly(0L));
        assertThat(List.of(summary.income(), summary.expense(), summary.net())).containsOnly(0L);
        assertThat(summary.categories()).isEmpty();
    }

    /** 장부 시간대의 날짜로 나눈다. 12월 31일은 그해의 12월에, 다음 날 1월 1일은 다음 해의 1월에 든다. */
    @Test
    void yearly_boundaries() {
        expense("2024-12-31", 1);
        expense("2025-01-01", 20);
        expense("2025-12-31", 300);
        expense("2026-01-01", 4_000);

        assertThat(yearly(YEAR).expense()).isEqualTo(320);
        assertThat(yearly(YEAR).months().get(0).expense()).isEqualTo(20);
        assertThat(yearly(YEAR).months().get(11).expense()).isEqualTo(300);
        assertThat(yearly(Year.of(2024)).months().get(11).expense()).isEqualTo(1);
        assertThat(yearly(Year.of(2026)).months().get(0).expense()).isEqualTo(4_000);
        assertThat(yearly(Year.of(2026)).expense()).isEqualTo(4_000);
    }

    @Test
    void yearly_excludesTransfersCanceledAndDeleted() {
        fixtures.transfer(owner, ledgerId, bank.getId(), cash.getId(), LocalDate.of(2025, 4, 1), 30_000);
        fixtures.cancel(owner, fixtures.expense(owner, ledgerId, cash.getId(), food.getId(),
                LocalDate.of(2025, 4, 2), 12_000));
        fixtures.delete(owner, fixtures.income(owner, ledgerId, bank.getId(), salary.getId(),
                LocalDate.of(2025, 4, 3), 50_000));
        expense("2025-04-04", 1_000);

        YearlySummary summary = yearly(YEAR);

        assertThat(summary.months().get(3)).isEqualTo(new MonthTotals(YearMonth.of(2025, 4), 0, 1_000));
        assertThat(List.of(summary.income(), summary.expense())).containsExactly(0L, 1_000L);
        assertThat(summary.categories()).containsExactly(new CategoryTotal(food.getId(), CategoryKind.EXPENSE, 1_000));
    }

    /**
     * 그해의 최상위 카테고리별 합계(F-304, F-302와 같은 구성): 하위는 상위에 들고, 수입도 있고, 개수 제한이 없다. 달마다는
     * 0이 아니어도 연 합계가 0인 카테고리는 없고, 환불이 더 큰 카테고리는 음수 그대로다.
     */
    @Test
    void yearly_listsEveryTopLevelCategoryOfTheYear() {
        Category lunch = categoryService.create(owner.getId(), ledgerId,
                new CategoryCommand("점심", CategoryKind.EXPENSE, food.getId()));
        Category cafe = category("카페", CategoryKind.EXPENSE);
        Category gift = category("선물", CategoryKind.EXPENSE);
        fixtures.expense(owner, ledgerId, cash.getId(), lunch.getId(), LocalDate.of(2025, 2, 1), 3_000);
        expense("2025-08-01", 1_000);
        fixtures.expense(owner, ledgerId, cash.getId(), cafe.getId(), LocalDate.of(2025, 2, 2), 4_500);
        fixtures.refund(owner, ledgerId, cash.getId(), cafe.getId(), LocalDate.of(2025, 9, 2), 4_500);
        fixtures.refund(owner, ledgerId, cash.getId(), gift.getId(), LocalDate.of(2025, 5, 5), 2_000);
        fixtures.expense(owner, ledgerId, cash.getId(), null, LocalDate.of(2025, 6, 6), 700);
        income("2025-07-25", 10_000);
        for (int n = 1; n <= 6; n++) {
            Category extra = category("기타 " + n, CategoryKind.EXPENSE);
            fixtures.expense(owner, ledgerId, cash.getId(), extra.getId(), LocalDate.of(2025, n, 10), 100 * n);
        }

        List<CategoryTotal> categories = yearly(YEAR).categories();

        UUID uncategorized = categoryService.uncategorized(ledgerId, CategoryKind.EXPENSE).getId();
        assertThat(categories).hasSize(10);
        assertThat(categories.subList(0, 3)).containsExactly(
                new CategoryTotal(salary.getId(), CategoryKind.INCOME, 10_000),
                new CategoryTotal(food.getId(), CategoryKind.EXPENSE, 4_000,
                        List.of(new CategoryTotal(lunch.getId(), CategoryKind.EXPENSE, 3_000),
                                new CategoryTotal(food.getId(), CategoryKind.EXPENSE, 1_000))),
                new CategoryTotal(uncategorized, CategoryKind.EXPENSE, 700));
        assertThat(categories.getLast()).isEqualTo(new CategoryTotal(gift.getId(), CategoryKind.EXPENSE, -2_000));
        assertThat(categories).extracting(CategoryTotal::categoryId).doesNotContain(lunch.getId(), cafe.getId());
    }

    /** 같은 데이터로 월별 통계를 12번 부른 값과 달마다, 그리고 연 합계·카테고리 합계까지 같다. */
    @Test
    void yearly_matchesTwelveMonthlyQueries() {
        Category cafe = category("카페", CategoryKind.EXPENSE);
        Category lunch = categoryService.create(owner.getId(), ledgerId,
                new CategoryCommand("점심", CategoryKind.EXPENSE, food.getId()));
        expense("2024-12-31", 9_999);
        expense("2025-01-01", 1_100);
        income("2025-01-31", 2_500_000);
        fixtures.expense(owner, ledgerId, cash.getId(), lunch.getId(), LocalDate.of(2025, 2, 28), 8_000);
        fixtures.refund(owner, ledgerId, cash.getId(), cafe.getId(), LocalDate.of(2025, 3, 1), 3_000);
        fixtures.transfer(owner, ledgerId, bank.getId(), cash.getId(), LocalDate.of(2025, 5, 15), 50_000);
        fixtures.cancel(owner, fixtures.expense(owner, ledgerId, cash.getId(), cafe.getId(),
                LocalDate.of(2025, 5, 16), 6_000));
        fixtures.expense(owner, ledgerId, cash.getId(), null, LocalDate.of(2025, 7, 7), 7_700);
        fixtures.income(owner, ledgerId, bank.getId(), null, LocalDate.of(2025, 7, 8), 1_000);
        income("2025-12-31", 2_600_000);
        expense("2025-12-31", 45_000);
        expense("2026-01-01", 8_888);

        YearlySummary summary = yearly(YEAR);
        List<MonthlySummary> monthly = Arrays.stream(Month.values())
                .map(month -> monthlyStatsQuery.monthly(owner.getId(), ledgerId, YEAR.atMonth(month)))
                .toList();

        assertThat(summary.months()).containsExactlyElementsOf(Arrays.stream(Month.values())
                .map(month -> new MonthTotals(YEAR.atMonth(month), monthly.get(month.ordinal()).income(),
                        monthly.get(month.ordinal()).expense()))
                .toList());
        assertThat(summary.income()).isEqualTo(monthly.stream().mapToLong(MonthlySummary::income).sum());
        assertThat(summary.expense()).isEqualTo(monthly.stream().mapToLong(MonthlySummary::expense).sum());
        // 하위별 금액은 yearly_listsEveryTopLevelCategoryOfTheYear가 본다.
        assertThat(summary.categories())
                .extracting(category -> new CategoryTotal(category.categoryId(), category.kind(), category.total()))
                .containsExactlyInAnyOrderElementsOf(addUp(monthly));
        assertThat(summary.months()).filteredOn(month -> month.income() != 0 || month.expense() != 0)
                .extracting(month -> month.month().getMonthValue()).containsExactly(1, 2, 3, 7, 12);
    }

    /** 달마다의 월별 통계 카테고리를 그해로 더한 것. 연 합계가 0인 카테고리는 뺀다. */
    private static List<CategoryTotal> addUp(List<MonthlySummary> monthly) {
        return monthly.stream().flatMap(month -> month.categories().stream())
                .collect(Collectors.groupingBy(category -> Map.entry(category.categoryId(), category.kind()),
                        Collectors.summingLong(CategoryTotal::total)))
                .entrySet().stream()
                .filter(entry -> entry.getValue() != 0)
                .map(entry -> new CategoryTotal(entry.getKey().getKey(), entry.getKey().getValue(), entry.getValue()))
                .toList();
    }

    /** 해가 없으면 REQUIRED. 범위는 2000년부터, 장부 시간대(서울)로 오늘로부터 1년 뒤의 날이 속한 해까지다. */
    @Test
    void yearly_requiresAYearInRange() {
        clock.stopAt(Instant.parse("2026-12-31T14:59:59Z")); // 서울 2026-12-31, 1년 뒤는 2027-12-31

        InvalidRequestException missing = catchThrowableOfType(InvalidRequestException.class, () -> yearly(null));
        assertThat(List.of(missing.field(), missing.code())).containsExactly("year", FieldErrorCode.REQUIRED);
        assertOutOfRange(Year.of(1999));
        assertOutOfRange(Year.of(2028));
        assertThatNoException().isThrownBy(() -> yearly(Year.of(2000)));
        assertThatNoException().isThrownBy(() -> yearly(Year.of(2027)));

        clock.stopAt(Instant.parse("2026-12-31T15:00:00Z")); // 서울 2027-01-01, 1년 뒤는 2028-01-01
        assertThatNoException().isThrownBy(() -> yearly(Year.of(2028)));
        assertOutOfRange(Year.of(2029));
    }

    private void assertOutOfRange(Year year) {
        InvalidRequestException rejected = catchThrowableOfType(InvalidRequestException.class, () -> yearly(year));
        assertThat(rejected).as(year.toString()).isNotNull();
        assertThat(List.of(rejected.field(), rejected.code())).containsExactly("year", FieldErrorCode.OUT_OF_RANGE);
    }

    @Test
    void yearly_rejectsOutsiderBeforeCheckingTheYear() {
        User outsider = fixtures.user("outsider@example.com");

        assertThatThrownBy(() -> yearlyStatsQuery.yearly(outsider.getId(), ledgerId, YEAR))
                .isInstanceOf(NotLedgerMemberException.class);
        assertThatThrownBy(() -> yearlyStatsQuery.yearly(outsider.getId(), ledgerId, null))
                .isInstanceOf(NotLedgerMemberException.class);
    }
}
