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
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

@IntegrationTest
class BalanceQueryTest {

    static final LocalDate NOV_1 = LocalDate.of(2026, 11, 1);
    static final LocalDate NOV_18 = LocalDate.of(2026, 11, 18);

    @Autowired BalanceQuery balanceQuery;
    @Autowired CategoryService categoryService;
    @Autowired Fixtures fixtures;

    User owner;
    UUID ledgerId;
    Category food;
    Category salary;

    @BeforeEach
    void setUp() {
        owner = fixtures.user("owner@example.com");
        ledgerId = fixtures.personalLedgerId(owner);
        food = categoryService.create(owner.getId(), ledgerId, new CategoryCommand("식비", CategoryKind.EXPENSE, null));
        salary = categoryService.create(owner.getId(), ledgerId, new CategoryCommand("급여", CategoryKind.INCOME, null));
    }

    private Account account(String name, AccountType type, long openingBalance, LocalDate openingDate) {
        return fixtures.account(owner, ledgerId, name, type, openingBalance, openingDate);
    }

    @Test
    void balance_isOpeningPlusLines() {
        Account bank = account("국민은행", AccountType.BANK, 100_000, NOV_1);
        fixtures.expense(owner, ledgerId, bank.getId(), food.getId(), NOV_18, 12_000);
        fixtures.income(owner, ledgerId, bank.getId(), salary.getId(), NOV_18, 50_000);

        assertThat(balanceQuery.balance(owner.getId(), bank.getId())).isEqualTo(138_000);
    }

    @Test
    void balance_transferMovesBetweenAccounts() {
        Account bank = account("국민은행", AccountType.BANK, 100_000, NOV_1);
        Account cash = account("현금", AccountType.CASH, 0, NOV_1);
        Account untouched = account("비상금", AccountType.CASH, 5_000, NOV_1);

        fixtures.transfer(owner, ledgerId, bank.getId(), cash.getId(), NOV_18, 30_000);

        assertThat(balanceQuery.balance(owner.getId(), bank.getId())).isEqualTo(70_000);
        assertThat(balanceQuery.balance(owner.getId(), cash.getId())).isEqualTo(30_000);
        assertThat(balanceQuery.balances(owner.getId(), ledgerId)).isEqualTo(Map.of(
                bank.getId(), 70_000L,
                cash.getId(), 30_000L,
                untouched.getId(), 5_000L));
    }

    @Test
    void balance_cardIsLiability() {
        Account card = account("신한카드", AccountType.CARD, 0, NOV_1);
        Account bank = account("국민은행", AccountType.BANK, 100_000, NOV_1);

        fixtures.expense(owner, ledgerId, card.getId(), food.getId(), NOV_18, 20_000);
        assertThat(balanceQuery.balance(owner.getId(), card.getId())).isEqualTo(-20_000);

        // 카드대금 납부 = 은행에서 카드로 이체
        fixtures.transfer(owner, ledgerId, bank.getId(), card.getId(), NOV_18, 20_000);
        assertThat(balanceQuery.balance(owner.getId(), card.getId())).isZero();
        assertThat(balanceQuery.balance(owner.getId(), bank.getId())).isEqualTo(80_000);
    }

    @Test
    void balance_ignoresTransactionsBeforeOpeningDate() {
        Account bank = account("국민은행", AccountType.BANK, 100_000, LocalDate.of(2026, 11, 10));

        fixtures.expense(owner, ledgerId, bank.getId(), food.getId(), LocalDate.of(2026, 11, 9), 5_000);
        assertThat(balanceQuery.balance(owner.getId(), bank.getId())).isEqualTo(100_000);

        fixtures.expense(owner, ledgerId, bank.getId(), food.getId(), LocalDate.of(2026, 11, 10), 3_000);
        assertThat(balanceQuery.balance(owner.getId(), bank.getId())).isEqualTo(97_000);
        assertThat(balanceQuery.balances(owner.getId(), ledgerId)).containsEntry(bank.getId(), 97_000L);
    }

    @Test
    void balance_excludesCanceledAndDeleted() {
        Account bank = account("국민은행", AccountType.BANK, 100_000, NOV_1);
        fixtures.cancel(owner, fixtures.expense(owner, ledgerId, bank.getId(), food.getId(), NOV_18, 12_000));
        fixtures.delete(owner, fixtures.expense(owner, ledgerId, bank.getId(), food.getId(), NOV_18, 3_000));
        fixtures.expense(owner, ledgerId, bank.getId(), food.getId(), NOV_18, 1_000);

        assertThat(balanceQuery.balance(owner.getId(), bank.getId())).isEqualTo(99_000);
        assertThat(balanceQuery.balances(owner.getId(), ledgerId)).containsEntry(bank.getId(), 99_000L);
    }

    @Test
    void balance_rejectsOutsider() {
        Account bank = account("국민은행", AccountType.BANK, 100_000, NOV_1);
        User outsider = fixtures.user("outsider@example.com");

        assertThatThrownBy(() -> balanceQuery.balance(outsider.getId(), bank.getId()))
                .isInstanceOf(NotLedgerMemberException.class);
        assertThatThrownBy(() -> balanceQuery.balances(outsider.getId(), ledgerId))
                .isInstanceOf(NotLedgerMemberException.class);
    }
}
