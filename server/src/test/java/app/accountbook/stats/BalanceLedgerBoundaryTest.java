package app.accountbook.stats;

import static org.assertj.core.api.Assertions.assertThat;

import app.accountbook.account.Account;
import app.accountbook.account.AccountType;
import app.accountbook.support.Fixtures;
import app.accountbook.support.IntegrationTest;
import app.accountbook.transaction.TransactionView;
import app.accountbook.user.User;
import java.time.LocalDate;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.transaction.AfterTransaction;

/**
 * 잔액 쿼리가 라인과 거래를 각각 장부 조건으로 읽는지 본다(이슈 #58).
 *
 * <p>다른 장부의 라인이 내 계좌에 붙는 일은 복합 FK(V12)가 막으므로 실제 데이터로는 만들 수 없다. 그래서 테스트
 * 트랜잭션 안에서만 그 FK를 지우고 어긋난 라인을 넣는다. PostgreSQL의 DDL은 트랜잭션을 따르므로 테스트가 끝나
 * 롤백되면 제약도 돌아온다.
 */
@IntegrationTest
class BalanceLedgerBoundaryTest {

    static final LocalDate NOV_1 = LocalDate.of(2026, 11, 1);
    static final LocalDate NOV_18 = LocalDate.of(2026, 11, 18);

    @Autowired BalanceQuery balanceQuery;
    @Autowired Fixtures fixtures;
    @Autowired JdbcTemplate jdbc;

    User owner;
    UUID ledgerId;
    UUID bank;
    TransactionView expense;
    User other;
    UUID otherLedgerId;
    UUID othersBank;
    TransactionView othersExpense;

    @BeforeEach
    void setUp() {
        owner = fixtures.user("owner@example.com");
        ledgerId = fixtures.personalLedgerId(owner);
        bank = account(owner, ledgerId, 100_000);
        expense = fixtures.expense(owner, ledgerId, bank, null, NOV_18, 1_000);
        other = fixtures.user("other@example.com");
        otherLedgerId = fixtures.personalLedgerId(other);
        othersBank = account(other, otherLedgerId, 200_000);
        othersExpense = fixtures.expense(other, otherLedgerId, othersBank, null, NOV_18, 2_000);
    }

    /** 컨테이너를 모든 테스트가 함께 쓰므로, 지운 제약이 롤백으로 돌아왔는지 테스트마다 확인한다. */
    @AfterTransaction
    void constraintsAreBack() {
        assertThat(jdbc.queryForObject("""
                select count(*) from pg_constraint
                 where conname in ('fk_transaction_line_transaction', 'fk_transaction_line_account')
                """, Long.class)).isEqualTo(2);
    }

    private UUID account(User user, UUID ledger, long openingBalance) {
        Account account = fixtures.account(user, ledger, "국민은행", AccountType.BANK, openingBalance, NOV_1);
        return account.getId();
    }

    private void assertBalancesOfBothLedgers() {
        assertThat(balanceQuery.balance(owner.getId(), bank)).isEqualTo(99_000);
        assertThat(balanceQuery.balances(owner.getId(), ledgerId)).isEqualTo(Map.of(bank, 99_000L));
        assertThat(balanceQuery.balance(other.getId(), othersBank)).isEqualTo(198_000);
        assertThat(balanceQuery.balances(other.getId(), otherLedgerId)).isEqualTo(Map.of(othersBank, 198_000L));
    }

    @Test
    void balancesOfTwoLedgersAreSeparate() {
        assertBalancesOfBothLedgers();
    }

    /** 내 계좌를 가리키는 라인이 있어도 라인이나 거래가 다른 장부의 것이면 내 잔액에 넣지 않는다. */
    @ParameterizedTest
    @CsvSource({"true, true", "true, false", "false, true"})
    void lineOrTransactionOfAnotherLedgerIsNotCounted(boolean lineInOtherLedger, boolean transactionInOtherLedger) {
        jdbc.execute("""
                ALTER TABLE transaction_line
                    DROP CONSTRAINT fk_transaction_line_transaction,
                    DROP CONSTRAINT fk_transaction_line_account
                """);
        jdbc.update("""
                insert into transaction_line (id, transaction_id, ledger_id, account_id, amount, created_at)
                values (?, ?, ?, ?, -50000, now())
                """, UUID.randomUUID(), (transactionInOtherLedger ? othersExpense : expense).id(),
                lineInOtherLedger ? otherLedgerId : ledgerId, bank);

        assertBalancesOfBothLedgers();
    }
}
