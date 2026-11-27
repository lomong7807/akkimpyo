package app.accountbook.stats;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import app.accountbook.account.Account;
import app.accountbook.account.AccountType;
import app.accountbook.category.Category;
import app.accountbook.category.CategoryCommand;
import app.accountbook.category.CategoryKind;
import app.accountbook.category.CategoryService;
import app.accountbook.support.Fixtures;
import app.accountbook.support.IntegrationTest;
import app.accountbook.transaction.Transaction;
import app.accountbook.transaction.TransactionRepository;
import app.accountbook.transaction.TransactionType;
import app.accountbook.user.User;
import java.time.LocalDate;
import java.time.YearMonth;
import java.util.UUID;
import org.assertj.core.api.ThrowableAssert.ThrowingCallable;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.transaction.AfterTransaction;

/**
 * 잔액과 통계 합계가 long을 넘으면 틀린 값 대신 {@link ArithmeticException}이 나고, 그 메시지에 금액이 없는지 본다(이슈 #21).
 *
 * <p>라인 금액의 CHECK(V5) 때문에 실제 데이터로는 넘침을 만들 수 없다. 그래서 테스트 트랜잭션 안에서만 그 제약을 지우고
 * 큰 라인을 넣는다. PostgreSQL의 DDL은 트랜잭션을 따르므로 테스트가 끝나 롤백되면 제약도 돌아온다.
 * DB 없이 부를 수 있는 계산은 {@link CategoryTotalTest}와 {@link MonthlySummaryTest}가 본다.
 */
@IntegrationTest
class TotalOverflowTest {

    static final LocalDate NOV_18 = LocalDate.of(2026, 11, 18);
    static final YearMonth NOVEMBER = YearMonth.of(2026, 11);

    @Autowired BalanceQuery balanceQuery;
    @Autowired MonthlyStatsQuery monthlyStatsQuery;
    @Autowired CategoryService categoryService;
    @Autowired TransactionRepository transactionRepository;
    @Autowired Fixtures fixtures;
    @Autowired JdbcTemplate jdbc;

    User owner;
    UUID ledgerId;
    Category salary;

    @BeforeEach
    void setUp() {
        owner = fixtures.user("owner@example.com");
        ledgerId = fixtures.personalLedgerId(owner);
        salary = categoryService.create(owner.getId(), ledgerId, new CategoryCommand("급여", CategoryKind.INCOME, null));
        jdbc.execute("ALTER TABLE transaction_line DROP CONSTRAINT ck_transaction_line_amount_range");
    }

    /** 컨테이너를 모든 테스트가 함께 쓰므로, 지운 제약이 롤백으로 돌아왔는지 테스트마다 확인한다. */
    @AfterTransaction
    void constraintIsBack() {
        assertThat(jdbc.queryForObject(
                "SELECT count(*) FROM pg_constraint WHERE conname = 'ck_transaction_line_amount_range'", Long.class))
                .isEqualTo(1);
    }

    private Account account(long openingBalance) {
        return fixtures.account(owner, ledgerId, "국민은행", AccountType.BANK, openingBalance, LocalDate.of(2026, 11, 1));
    }

    /** 거래 서비스의 금액 검사(P-201)를 거치지 않고 라인 1줄짜리 거래를 저장한다. */
    private void storeLine(Account account, long amount) {
        Transaction tx = Transaction.of(UUID.randomUUID(), ledgerId, TransactionType.INCOME, NOV_18, null, null, null,
                owner.getId(), owner.getId());
        tx.addLine(account.getId(), salary.getId(), amount);
        transactionRepository.saveAndFlush(tx);
    }

    private static void assertOverflow(ThrowingCallable call) {
        assertThatThrownBy(call)
                .isInstanceOf(ArithmeticException.class)
                .hasNoCause()
                .message().doesNotContainPattern("\\d");
    }

    @ParameterizedTest
    @CsvSource({"1, 9223372036854775807", "-1, -9223372036854775808"})
    void balance_failsWhenOpeningPlusLineSumDoesNotFitInLong(long openingBalance, long lineSum) {
        Account bank = account(openingBalance);
        storeLine(bank, lineSum);

        assertOverflow(() -> balanceQuery.balance(owner.getId(), bank.getId()));
        assertOverflow(() -> balanceQuery.balances(owner.getId(), ledgerId));
    }

    @ParameterizedTest
    @ValueSource(longs = {Long.MAX_VALUE, Long.MIN_VALUE})
    void balance_failsWhenLineSumDoesNotFitInLong(long amount) {
        Account bank = account(0);
        storeLine(bank, amount);
        storeLine(bank, amount);

        assertOverflow(() -> balanceQuery.balance(owner.getId(), bank.getId()));
        assertOverflow(() -> balanceQuery.balances(owner.getId(), ledgerId));
    }

    @ParameterizedTest
    @ValueSource(longs = {Long.MAX_VALUE, Long.MIN_VALUE})
    void monthly_failsWhenLineSumDoesNotFitInLong(long amount) {
        Account bank = account(0);
        storeLine(bank, amount);
        storeLine(bank, amount);

        assertOverflow(() -> monthlyStatsQuery.monthly(owner.getId(), ledgerId, NOVEMBER));
    }

    @ParameterizedTest
    @ValueSource(longs = {Long.MAX_VALUE, Long.MIN_VALUE})
    void totals_areExactAtTheLongRange(long amount) {
        Account bank = account(0);
        storeLine(bank, amount);

        assertThat(balanceQuery.balance(owner.getId(), bank.getId())).isEqualTo(amount);
        assertThat(balanceQuery.balances(owner.getId(), ledgerId)).containsEntry(bank.getId(), amount);
        assertThat(monthlyStatsQuery.monthly(owner.getId(), ledgerId, NOVEMBER).income()).isEqualTo(amount);
    }
}
