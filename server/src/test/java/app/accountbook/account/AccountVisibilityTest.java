package app.accountbook.account;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import app.accountbook.category.CategoryKind;
import app.accountbook.category.CategoryService;
import app.accountbook.common.AccountHasTransactionsException;
import app.accountbook.common.FieldErrorCode;
import app.accountbook.common.InvalidRequestException;
import app.accountbook.common.NotLedgerMemberException;
import app.accountbook.stats.BalanceQuery;
import app.accountbook.stats.MonthlyStatsQuery;
import app.accountbook.support.Fixtures;
import app.accountbook.support.IntegrationTest;
import app.accountbook.transaction.TransactionCommand;
import app.accountbook.transaction.TransactionCommand.Entry;
import app.accountbook.transaction.TransactionCommand.Transfer;
import app.accountbook.transaction.TransactionListQuery;
import app.accountbook.transaction.TransactionPage.DayTotals;
import app.accountbook.transaction.TransactionService;
import app.accountbook.transaction.TransactionType;
import app.accountbook.transaction.TransactionView;
import app.accountbook.user.User;
import java.time.LocalDate;
import java.time.YearMonth;
import java.util.UUID;
import org.assertj.core.api.ThrowableAssert.ThrowingCallable;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/** 계좌 숨기기와 다시 보이기(#42, P-220, F-506, F-507). */
@IntegrationTest
class AccountVisibilityTest {

    static final LocalDate OPENING = LocalDate.of(2026, 11, 1);
    static final LocalDate DAY = LocalDate.of(2026, 11, 18);
    /** 11월의 마지막 날. 숨겨도 거래가 그 달에 남는지 본다. */
    static final LocalDate LAST_DAY = LocalDate.of(2026, 11, 30);
    static final String DEVICE = "a-phone";

    @Autowired AccountService accountService;
    @Autowired AccountRepository accountRepository;
    @Autowired CategoryService categoryService;
    @Autowired TransactionService transactionService;
    @Autowired TransactionListQuery transactionListQuery;
    @Autowired BalanceQuery balanceQuery;
    @Autowired MonthlyStatsQuery monthlyStatsQuery;
    @Autowired Fixtures fixtures;

    User owner;
    UUID actor;
    UUID ledgerId;
    UUID bank;
    UUID cash;
    UUID food;

    @BeforeEach
    void setUp() {
        owner = fixtures.user("owner@example.com");
        actor = owner.getId();
        ledgerId = fixtures.personalLedgerId(owner);
        bank = fixtures.account(owner, ledgerId, "국민은행", AccountType.BANK, 100_000, OPENING).getId();
        cash = fixtures.account(owner, ledgerId, "현금", AccountType.CASH, 0, OPENING).getId();
        food = categoryService.uncategorized(ledgerId, CategoryKind.EXPENSE).getId();
    }

    @Test
    void newAccountIsVisible() {
        assertThat(accountRepository.findById(bank).orElseThrow().isHidden()).isFalse();
    }

    @Test
    void setHidden_hidesAndShowsAgain() {
        Account hidden = accountService.setHidden(actor, ledgerId, bank, true);

        assertThat(hidden.isHidden()).isTrue();
        assertThat(accountRepository.findById(bank).orElseThrow().isHidden()).isTrue();

        Account shown = accountService.setHidden(actor, ledgerId, bank, false);

        assertThat(shown.isHidden()).isFalse();
        assertThat(accountRepository.findById(bank).orElseThrow().isHidden()).isFalse();
    }

    @Test
    void setHidden_isIdempotent() {
        accountService.setHidden(actor, ledgerId, bank, true);

        assertThat(accountService.setHidden(actor, ledgerId, bank, true).isHidden()).isTrue();
        assertThat(accountService.setHidden(actor, ledgerId, cash, false).isHidden()).isFalse();
    }

    @Test
    void setHidden_keepsOtherFields() {
        accountService.setHidden(actor, ledgerId, bank, true);

        Account stored = accountRepository.findById(bank).orElseThrow();
        assertThat(stored.getName()).isEqualTo("국민은행");
        assertThat(stored.getType()).isEqualTo(AccountType.BANK);
        assertThat(stored.getOpeningBalance()).isEqualTo(100_000);
        assertThat(stored.getOpeningDate()).isEqualTo(OPENING);
    }

    @Test
    void list_includesHiddenAccounts() {
        accountService.setHidden(actor, ledgerId, bank, true);

        assertThat(accountService.list(actor, ledgerId)).extracting(Account::getId).containsExactly(bank, cash);
    }

    @Test
    void setHidden_rejectsOutsiderAndAccountOfAnotherLedger() {
        User other = fixtures.user("other@example.com");
        UUID otherLedger = fixtures.personalLedgerId(other);
        UUID otherAccount = fixtures.account(other, otherLedger, "남의계좌", AccountType.CASH, 0, OPENING).getId();

        assertThatThrownBy(() -> accountService.setHidden(other.getId(), ledgerId, bank, true))
                .isInstanceOf(NotLedgerMemberException.class);
        assertThatThrownBy(() -> accountService.setHidden(actor, ledgerId, otherAccount, true))
                .isInstanceOf(NotLedgerMemberException.class);
        assertThatThrownBy(() -> accountService.setHidden(actor, ledgerId, UUID.randomUUID(), true))
                .isInstanceOf(NotLedgerMemberException.class);
        assertThat(accountRepository.findById(bank).orElseThrow().isHidden()).isFalse();
        assertThat(accountRepository.findById(otherAccount).orElseThrow().isHidden()).isFalse();
    }

    @Test
    void create_rejectsHiddenAccount() {
        accountService.setHidden(actor, ledgerId, bank, true);

        assertRejected(() -> transactionService.create(actor, ledgerId, expense(UUID.randomUUID(), bank, 1_000),
                DEVICE), "accountId");
        assertRejected(() -> transactionService.create(actor, ledgerId, transfer(UUID.randomUUID(), bank, cash),
                DEVICE), "fromAccountId");
        assertRejected(() -> transactionService.create(actor, ledgerId, transfer(UUID.randomUUID(), cash, bank),
                DEVICE), "toAccountId");
        assertThat(balanceQuery.balance(actor, bank)).isEqualTo(100_000);
        assertThat(balanceQuery.balance(actor, cash)).isZero();
    }

    @Test
    void create_acceptsAccountShownAgain() {
        accountService.setHidden(actor, ledgerId, bank, true);
        accountService.setHidden(actor, ledgerId, bank, false);

        fixtures.expense(owner, ledgerId, bank, food, DAY, 1_000);
        fixtures.transfer(owner, ledgerId, cash, bank, DAY, 2_000);

        assertThat(balanceQuery.balance(actor, bank)).isEqualTo(101_000);
    }

    @Test
    void create_replaysTransactionSavedBeforeHiding() {
        Entry command = expense(UUID.randomUUID(), bank, 1_000);
        TransactionView saved = transactionService.create(actor, ledgerId, command, DEVICE);
        accountService.setHidden(actor, ledgerId, bank, true);

        // 숨기기 전에 저장된 거래의 재전송은 새 입력이 아니다(ADR 006 결정 4).
        assertThat(transactionService.createOrReplay(actor, ledgerId, command, DEVICE).created()).isFalse();
        assertThat(transactionService.get(actor, saved.id()).version()).isEqualTo(saved.version());
    }

    @Test
    void update_keepsHiddenAccountAlreadyUsed() {
        TransactionView expense = fixtures.expense(owner, ledgerId, bank, food, DAY, 1_000);
        TransactionView transfer = fixtures.transfer(owner, ledgerId, bank, cash, DAY, 2_000);
        accountService.setHidden(actor, ledgerId, bank, true);

        TransactionView updated = transactionService.update(actor, expense.id(), expense.version(),
                expense(expense.id(), bank, 1_500), DEVICE);
        TransactionView updatedTransfer = transactionService.update(actor, transfer.id(), transfer.version(),
                transfer(transfer.id(), bank, cash, 2_500), DEVICE);

        assertThat(updated.version()).isEqualTo(expense.version() + 1);
        assertThat(updatedTransfer.version()).isEqualTo(transfer.version() + 1);
        assertThat(balanceQuery.balance(actor, bank)).isEqualTo(100_000 - 1_500 - 2_500);
    }

    @Test
    void update_rejectsChangingToHiddenAccount() {
        TransactionView expense = fixtures.expense(owner, ledgerId, cash, food, DAY, 1_000);
        UUID card = fixtures.account(owner, ledgerId, "카드", AccountType.CARD, 0, OPENING).getId();
        TransactionView transfer = fixtures.transfer(owner, ledgerId, cash, card, DAY, 2_000);
        accountService.setHidden(actor, ledgerId, bank, true);

        assertRejected(() -> transactionService.update(actor, expense.id(), expense.version(),
                expense(expense.id(), bank, 1_000), DEVICE), "accountId");
        assertRejected(() -> transactionService.update(actor, transfer.id(), transfer.version(),
                transfer(transfer.id(), bank, card, 2_000), DEVICE), "fromAccountId");
        assertRejected(() -> transactionService.update(actor, transfer.id(), transfer.version(),
                transfer(transfer.id(), cash, bank, 2_000), DEVICE), "toAccountId");
        assertThat(transactionService.get(actor, expense.id()).version()).isEqualTo(expense.version());
        assertThat(transactionService.get(actor, transfer.id()).version()).isEqualTo(transfer.version());
    }

    @Test
    void cancelDeleteAndRestore_workOnTransactionsOfHiddenAccount() {
        TransactionView toCancel = fixtures.expense(owner, ledgerId, bank, food, DAY, 1_000);
        TransactionView toDelete = fixtures.transfer(owner, ledgerId, cash, bank, DAY, 2_000);
        accountService.setHidden(actor, ledgerId, bank, true);

        transactionService.cancel(actor, toCancel.id(), toCancel.version(), DEVICE);
        TransactionView deleted = transactionService.delete(actor, toDelete.id(), toDelete.version(), DEVICE);
        TransactionView restored = transactionService.restore(actor, deleted.id(), deleted.version(), DEVICE);

        assertThat(restored.deleted()).isFalse();
        assertThat(balanceQuery.balance(actor, bank)).isEqualTo(102_000);
    }

    @Test
    void pastTransactionsOfHiddenAccountStayInBalanceStatsAndCalendar() {
        UUID salary = categoryService.uncategorized(ledgerId, CategoryKind.INCOME).getId();
        fixtures.expense(owner, ledgerId, bank, food, DAY, 12_000);
        fixtures.income(owner, ledgerId, bank, salary, LAST_DAY, 50_000);
        fixtures.transfer(owner, ledgerId, bank, cash, DAY, 3_000);
        YearMonth november = YearMonth.of(2026, 11);
        var balancesBefore = balanceQuery.balances(actor, ledgerId);
        var statsBefore = monthlyStatsQuery.monthly(actor, ledgerId, november);
        var daysBefore = transactionListQuery.dailyTotals(actor, ledgerId, november);

        accountService.setHidden(actor, ledgerId, bank, true);

        assertThat(balanceQuery.balance(actor, bank)).isEqualTo(100_000 - 12_000 + 50_000 - 3_000);
        assertThat(balanceQuery.balances(actor, ledgerId)).isEqualTo(balancesBefore);
        assertThat(monthlyStatsQuery.monthly(actor, ledgerId, november)).isEqualTo(statsBefore);
        assertThat(statsBefore.income()).isEqualTo(50_000);
        assertThat(statsBefore.expense()).isEqualTo(12_000);
        assertThat(transactionListQuery.dailyTotals(actor, ledgerId, november)).isEqualTo(daysBefore)
                .containsExactly(new DayTotals(DAY, 0, 12_000), new DayTotals(LAST_DAY, 50_000, 0));
    }

    @Test
    void accountWithTrashedTransactionCannotBeDeletedButCanBeHidden() {
        fixtures.delete(owner, fixtures.expense(owner, ledgerId, bank, food, DAY, 1_000));

        assertThatThrownBy(() -> accountService.delete(actor, ledgerId, bank))
                .isInstanceOf(AccountHasTransactionsException.class);

        assertThat(accountService.setHidden(actor, ledgerId, bank, true).isHidden()).isTrue();
        assertThat(accountRepository.findById(bank)).isPresent();
    }

    private static void assertRejected(ThrowingCallable call, String field) {
        assertThatThrownBy(call)
                .isInstanceOfSatisfying(InvalidRequestException.class, e -> {
                    assertThat(e.field()).isEqualTo(field);
                    assertThat(e.code()).isEqualTo(FieldErrorCode.NOT_ALLOWED);
                });
    }

    private Entry expense(UUID id, UUID accountId, long amount) {
        return new Entry(id, TransactionType.EXPENSE, DAY, null, accountId, food, amount, null, null, null, null);
    }

    private static TransactionCommand transfer(UUID id, UUID fromAccountId, UUID toAccountId) {
        return transfer(id, fromAccountId, toAccountId, 1_000);
    }

    private static TransactionCommand transfer(UUID id, UUID fromAccountId, UUID toAccountId, long amount) {
        return new Transfer(id, DAY, null, fromAccountId, toAccountId, amount, null);
    }
}
