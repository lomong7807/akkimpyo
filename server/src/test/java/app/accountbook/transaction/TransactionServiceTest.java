package app.accountbook.transaction;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import app.accountbook.account.Account;
import app.accountbook.account.AccountCommand;
import app.accountbook.account.AccountService;
import app.accountbook.account.AccountType;
import app.accountbook.category.Category;
import app.accountbook.category.CategoryCommand;
import app.accountbook.category.CategoryKind;
import app.accountbook.category.CategoryService;
import app.accountbook.common.InvalidRequestException;
import app.accountbook.common.NotFoundException;
import app.accountbook.common.NotLedgerMemberException;
import app.accountbook.common.StaleVersionException;
import app.accountbook.ledger.LedgerRole;
import app.accountbook.support.Fixtures;
import app.accountbook.support.IntegrationTest;
import app.accountbook.transaction.TransactionCommand.Entry;
import app.accountbook.transaction.TransactionCommand.Transfer;
import app.accountbook.transaction.TransactionView.Line;
import app.accountbook.user.User;
import jakarta.persistence.EntityManager;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;

@IntegrationTest
class TransactionServiceTest {

    static final LocalDate DAY = LocalDate.of(2026, 11, 18);
    static final String DEVICE = "iphone-1";

    @Autowired TransactionService transactionService;
    @Autowired TransactionRepository transactionRepository;
    @Autowired AccountService accountService;
    @Autowired CategoryService categoryService;
    @Autowired Fixtures fixtures;
    @Autowired EntityManager entityManager;
    @Autowired JdbcTemplate jdbc;

    User owner;
    UUID ledgerId;
    Account cash;
    Account bank;
    Category food;
    Category salary;

    @BeforeEach
    void setUp() {
        owner = fixtures.user("owner@example.com");
        ledgerId = fixtures.personalLedgerId(owner);
        cash = account(owner, ledgerId, "현금", AccountType.CASH);
        bank = account(owner, ledgerId, "국민은행", AccountType.BANK);
        food = category(owner, ledgerId, "식비", CategoryKind.EXPENSE);
        salary = category(owner, ledgerId, "급여", CategoryKind.INCOME);
    }

    private Account account(User user, UUID ledger, String name, AccountType type) {
        return accountService.create(user.getId(), ledger,
                new AccountCommand(name, type, 0, LocalDate.of(2026, 11, 1)));
    }

    private Category category(User user, UUID ledger, String name, CategoryKind kind) {
        return categoryService.create(user.getId(), ledger, new CategoryCommand(name, kind, null));
    }

    private Entry expense(UUID id, long amount) {
        return expense(id, amount, null);
    }

    private Entry expense(UUID id, long amount, UUID categoryId) {
        return new Entry(id, TransactionType.EXPENSE, DAY, LocalTime.of(12, 30), cash.getId(), categoryId,
                amount, false, "김밥천국", "점심", null);
    }

    private TransactionView create(TransactionCommand cmd) {
        return transactionService.create(owner.getId(), ledgerId, cmd, DEVICE);
    }

    /** 영속성 컨텍스트를 비워 다음 조회가 DB에 저장된 값을 읽게 한다. */
    private void flushAndClear() {
        entityManager.flush();
        entityManager.clear();
    }

    @Test
    void create_expense_storesNegativeLineAndDefaults() {
        UUID id = UUID.randomUUID();

        TransactionView created = create(expense(id, 12_000));
        flushAndClear();
        TransactionView stored = transactionService.get(owner.getId(), id);

        UUID uncategorized = categoryService.uncategorized(ledgerId, CategoryKind.EXPENSE).getId();
        assertThat(List.of(created, stored)).allSatisfy(view -> {
            assertThat(view.id()).isEqualTo(id);
            assertThat(view.ledgerId()).isEqualTo(ledgerId);
            assertThat(view.type()).isEqualTo(TransactionType.EXPENSE);
            assertThat(view.status()).isEqualTo(TransactionStatus.POSTED);
            assertThat(view.version()).isEqualTo(1);
            assertThat(view.deleted()).isFalse();
            assertThat(view.createdBy()).isEqualTo(owner.getId());
            assertThat(view.paidBy()).isEqualTo(owner.getId());
            assertThat(view.occurredOn()).isEqualTo(DAY);
            assertThat(view.occurredTime()).isEqualTo(LocalTime.of(12, 30));
            assertThat(view.payee()).isEqualTo("김밥천국");
            assertThat(view.memo()).isEqualTo("점심");
            assertThat(view.lines()).containsExactly(new Line(cash.getId(), uncategorized, -12_000));
        });
    }

    @Test
    void create_refund_storesPositiveLineWithExpenseCategory() {
        UUID id = UUID.randomUUID();

        TransactionView view = create(new Entry(id, TransactionType.EXPENSE, DAY, null, cash.getId(),
                food.getId(), 2_000, true, "김밥천국", "환불", null));

        assertThat(view.type()).isEqualTo(TransactionType.EXPENSE);
        assertThat(view.lines()).containsExactly(new Line(cash.getId(), food.getId(), 2_000));
    }

    @Test
    void create_income_storesPositiveLine() {
        UUID id = UUID.randomUUID();

        TransactionView view = create(new Entry(id, TransactionType.INCOME, DAY, null, bank.getId(),
                salary.getId(), 50_000, false, "회사", null, null));

        assertThat(view.type()).isEqualTo(TransactionType.INCOME);
        assertThat(view.paidBy()).isEqualTo(owner.getId());
        assertThat(view.lines()).containsExactly(new Line(bank.getId(), salary.getId(), 50_000));
    }

    @Test
    void create_transfer_storesTwoLinesWithoutCategory() {
        UUID id = UUID.randomUUID();

        TransactionView view = create(new Transfer(id, DAY, null, bank.getId(), cash.getId(), 30_000, "인출"));

        assertThat(view.type()).isEqualTo(TransactionType.TRANSFER);
        assertThat(view.paidBy()).isNull();
        assertThat(view.payee()).isNull();
        assertThat(view.lines()).containsExactlyInAnyOrder(
                new Line(bank.getId(), null, -30_000),
                new Line(cash.getId(), null, 30_000));
        assertThat(view.lines().stream().mapToLong(Line::amount).sum()).isZero();
    }

    @Test
    void create_isIdempotentForSameIdAndContent() {
        UUID id = UUID.randomUUID();
        Entry cmd = expense(id, 12_000);

        TransactionView first = create(cmd);
        flushAndClear();
        TransactionView second = transactionService.create(owner.getId(), ledgerId, cmd, "macbook-1");

        assertThat(transactionRepository.count()).isEqualTo(1);
        assertThat(transactionService.history(owner.getId(), id)).hasSize(1);
        assertThat(first.version()).isEqualTo(1);
        assertThat(second.version()).isEqualTo(1);
        assertThat(second).isEqualTo(first);
    }

    @Test
    void create_rejectsSameIdWithDifferentContent() {
        UUID id = UUID.randomUUID();
        create(expense(id, 12_000));

        assertThatThrownBy(() -> create(expense(id, 13_000)))
                .isInstanceOf(IdConflictException.class);

        // 다른 장부에서 같은 id를 쓰는 것도 충돌이다.
        User other = fixtures.user("other@example.com");
        UUID otherLedgerId = fixtures.personalLedgerId(other);
        Account otherCash = account(other, otherLedgerId, "현금", AccountType.CASH);
        assertThatThrownBy(() -> transactionService.create(other.getId(), otherLedgerId,
                new Entry(id, TransactionType.EXPENSE, DAY, LocalTime.of(12, 30), otherCash.getId(), null,
                        12_000, false, "김밥천국", "점심", null), DEVICE))
                .isInstanceOf(IdConflictException.class);

        TransactionView stored = transactionService.get(owner.getId(), id);
        assertThat(stored.lines()).extracting(Line::amount).containsExactly(-12_000L);
        assertThat(stored.version()).isEqualTo(1);
        assertThat(transactionService.history(owner.getId(), id)).hasSize(1);
    }

    @Test
    void create_rejectsNonPositiveAmount() {
        assertThatThrownBy(() -> create(expense(UUID.randomUUID(), 0)))
                .isInstanceOf(InvalidRequestException.class);
        assertThatThrownBy(() -> create(expense(UUID.randomUUID(), -1)))
                .isInstanceOf(InvalidRequestException.class);
        assertThatThrownBy(() -> create(new Transfer(UUID.randomUUID(), DAY, null, bank.getId(), cash.getId(), 0, null)))
                .isInstanceOf(InvalidRequestException.class);
        assertThat(transactionRepository.count()).isZero();
    }

    @Test
    void create_rejectsTransferToSameAccount() {
        assertThatThrownBy(() -> create(new Transfer(UUID.randomUUID(), DAY, null, cash.getId(), cash.getId(),
                10_000, null)))
                .isInstanceOf(InvalidRequestException.class);
    }

    @Test
    void create_rejectsAccountFromOtherLedger() {
        User other = fixtures.user("other@example.com");
        Account othersCash = account(other, fixtures.personalLedgerId(other), "현금", AccountType.CASH);

        assertThatThrownBy(() -> create(new Entry(UUID.randomUUID(), TransactionType.EXPENSE, DAY, null,
                othersCash.getId(), null, 12_000, false, null, null, null)))
                .isInstanceOf(InvalidRequestException.class);
        assertThatThrownBy(() -> create(new Transfer(UUID.randomUUID(), DAY, null, bank.getId(),
                othersCash.getId(), 10_000, null)))
                .isInstanceOf(InvalidRequestException.class);
        assertThat(transactionRepository.count()).isZero();
    }

    @Test
    void create_rejectsCategoryFromOtherLedger() {
        User other = fixtures.user("other@example.com");
        Category othersFood = category(other, fixtures.personalLedgerId(other), "식비", CategoryKind.EXPENSE);

        assertThatThrownBy(() -> create(expense(UUID.randomUUID(), 12_000, othersFood.getId())))
                .isInstanceOf(InvalidRequestException.class);
    }

    @Test
    void create_rejectsIncomeCategoryOnExpense() {
        assertThatThrownBy(() -> create(expense(UUID.randomUUID(), 12_000, salary.getId())))
                .isInstanceOf(InvalidRequestException.class);
    }

    @Test
    void create_rejectsRefundOnIncomeAndTooLongText() {
        assertThatThrownBy(() -> create(new Entry(UUID.randomUUID(), TransactionType.INCOME, DAY, null,
                bank.getId(), salary.getId(), 1_000, true, null, null, null)))
                .isInstanceOf(InvalidRequestException.class);
        assertThatThrownBy(() -> create(new Entry(UUID.randomUUID(), TransactionType.EXPENSE, DAY, null,
                cash.getId(), null, 1_000, false, "가".repeat(101), null, null)))
                .isInstanceOf(InvalidRequestException.class);
        assertThatThrownBy(() -> create(new Entry(UUID.randomUUID(), TransactionType.EXPENSE, DAY, null,
                cash.getId(), null, 1_000, false, null, "가".repeat(501), null)))
                .isInstanceOf(InvalidRequestException.class);
        assertThatCode(() -> create(new Entry(UUID.randomUUID(), TransactionType.EXPENSE, DAY, null,
                cash.getId(), null, 1_000, false, "가".repeat(100), "가".repeat(500), null)))
                .doesNotThrowAnyException();
    }

    @Test
    void create_rejectsOutsider() {
        User outsider = fixtures.user("outsider@example.com");

        assertThatThrownBy(() -> transactionService.create(outsider.getId(), ledgerId,
                expense(UUID.randomUUID(), 12_000), DEVICE))
                .isInstanceOf(NotLedgerMemberException.class);
        assertThat(transactionRepository.count()).isZero();
    }

    @Test
    void create_rejectsPaidByNonMember() {
        User outsider = fixtures.user("outsider@example.com");
        User member = fixtures.user("member@example.com");
        fixtures.addMember(ledgerId, member, LedgerRole.MEMBER);

        assertThatThrownBy(() -> create(new Entry(UUID.randomUUID(), TransactionType.EXPENSE, DAY, null,
                cash.getId(), null, 12_000, false, null, null, outsider.getId())))
                .isInstanceOf(InvalidRequestException.class);

        TransactionView paidByMember = create(new Entry(UUID.randomUUID(), TransactionType.EXPENSE, DAY, null,
                cash.getId(), null, 12_000, false, null, null, member.getId()));
        assertThat(paidByMember.paidBy()).isEqualTo(member.getId());
        assertThat(paidByMember.createdBy()).isEqualTo(owner.getId());
    }

    @Test
    void update_replacesLinesAndBumpsVersion() {
        UUID id = UUID.randomUUID();
        create(expense(id, 12_000));

        TransactionView updated = transactionService.update(owner.getId(), id, 1, expense(id, 15_000), DEVICE);
        flushAndClear();
        TransactionView stored = transactionService.get(owner.getId(), id);

        UUID uncategorized = categoryService.uncategorized(ledgerId, CategoryKind.EXPENSE).getId();
        assertThat(List.of(updated, stored)).allSatisfy(view -> {
            assertThat(view.version()).isEqualTo(2);
            assertThat(view.lines()).containsExactly(new Line(cash.getId(), uncategorized, -15_000));
        });
    }

    @Test
    void update_rejectsStaleVersion() {
        UUID id = UUID.randomUUID();
        create(expense(id, 12_000));
        transactionService.update(owner.getId(), id, 1, expense(id, 15_000), DEVICE);

        assertThatThrownBy(() -> transactionService.update(owner.getId(), id, 1, expense(id, 20_000), DEVICE))
                .isInstanceOf(StaleVersionException.class);

        flushAndClear();
        TransactionView stored = transactionService.get(owner.getId(), id);
        assertThat(stored.version()).isEqualTo(2);
        assertThat(stored.lines()).extracting(Line::amount).containsExactly(-15_000L);
        assertThat(transactionService.history(owner.getId(), id)).hasSize(2);
    }

    @Test
    void update_rejectsVersionChangedByConcurrentWriter() {
        UUID id = UUID.randomUUID();
        create(expense(id, 12_000));
        entityManager.flush();
        // 다른 요청이 먼저 커밋한 상황: 메모리의 엔터티는 version 1인데 DB는 이미 2다.
        // 메모리 비교는 통과하므로 조건부 UPDATE의 영향 행 수(0)가 막아야 한다.
        jdbc.update("update transaction set version = 2 where id = ?", id);

        assertThatThrownBy(() -> transactionService.update(owner.getId(), id, 1, expense(id, 15_000), DEVICE))
                .isInstanceOf(StaleVersionException.class);

        flushAndClear();
        TransactionView stored = transactionService.get(owner.getId(), id);
        assertThat(stored.version()).isEqualTo(2);
        assertThat(stored.lines()).extracting(Line::amount).containsExactly(-12_000L);
        assertThat(transactionService.history(owner.getId(), id)).hasSize(1);
    }

    @Test
    void update_rejectsTypeChange() {
        UUID id = UUID.randomUUID();
        create(expense(id, 12_000));

        assertThatThrownBy(() -> transactionService.update(owner.getId(), id, 1,
                new Entry(id, TransactionType.INCOME, DAY, null, cash.getId(), salary.getId(), 12_000, false,
                        null, null, null), DEVICE))
                .isInstanceOf(InvalidRequestException.class);
        assertThatThrownBy(() -> transactionService.update(owner.getId(), id, 1,
                new Transfer(id, DAY, null, cash.getId(), bank.getId(), 12_000, null), DEVICE))
                .isInstanceOf(InvalidRequestException.class);

        TransactionView stored = transactionService.get(owner.getId(), id);
        assertThat(stored.type()).isEqualTo(TransactionType.EXPENSE);
        assertThat(stored.version()).isEqualTo(1);
    }

    @Test
    void cancel_setsStatusCanceled() {
        UUID id = UUID.randomUUID();
        create(expense(id, 12_000));

        TransactionView canceled = transactionService.cancel(owner.getId(), id, 1, DEVICE);
        flushAndClear();
        TransactionView stored = transactionService.get(owner.getId(), id);

        assertThat(List.of(canceled, stored)).allSatisfy(view -> {
            assertThat(view.status()).isEqualTo(TransactionStatus.CANCELED);
            assertThat(view.version()).isEqualTo(2);
            assertThat(view.deleted()).isFalse();
            assertThat(view.lines()).extracting(Line::amount).containsExactly(-12_000L);
        });
    }

    @Test
    void delete_thenRestore_roundTrips() {
        UUID id = UUID.randomUUID();
        create(expense(id, 12_000));
        assertThatThrownBy(() -> transactionService.restore(owner.getId(), id, 1, DEVICE))
                .isInstanceOf(InvalidRequestException.class);

        TransactionView deleted = transactionService.delete(owner.getId(), id, 1, DEVICE);
        assertThat(deleted.deleted()).isTrue();
        assertThat(deleted.version()).isEqualTo(2);
        assertThat(transactionService.listDeleted(owner.getId(), ledgerId)).extracting(TransactionView::id)
                .containsExactly(id);

        TransactionView restored = transactionService.restore(owner.getId(), id, 2, DEVICE);
        assertThat(restored.deleted()).isFalse();
        assertThat(restored.version()).isEqualTo(3);
        assertThat(transactionService.listDeleted(owner.getId(), ledgerId)).isEmpty();
        flushAndClear();
        assertThat(transactionService.get(owner.getId(), id).lines()).extracting(Line::amount)
                .containsExactly(-12_000L);
    }

    @Test
    void update_rejectsDeletedTransaction() {
        UUID id = UUID.randomUUID();
        create(expense(id, 12_000));
        transactionService.delete(owner.getId(), id, 1, DEVICE);

        assertThatThrownBy(() -> transactionService.update(owner.getId(), id, 2, expense(id, 15_000), DEVICE))
                .isInstanceOf(InvalidRequestException.class);
        assertThatThrownBy(() -> transactionService.cancel(owner.getId(), id, 2, DEVICE))
                .isInstanceOf(InvalidRequestException.class);

        flushAndClear();
        TransactionView stored = transactionService.get(owner.getId(), id);
        assertThat(stored.version()).isEqualTo(2);
        assertThat(stored.deleted()).isTrue();
        assertThat(stored.status()).isEqualTo(TransactionStatus.POSTED);
        assertThat(stored.lines()).extracting(Line::amount).containsExactly(-12_000L);
    }

    @Test
    void delete_rejectsStaleVersion() {
        UUID id = UUID.randomUUID();
        create(expense(id, 12_000));
        transactionService.update(owner.getId(), id, 1, expense(id, 15_000), DEVICE);

        assertThatThrownBy(() -> transactionService.delete(owner.getId(), id, 1, DEVICE))
                .isInstanceOf(StaleVersionException.class);

        flushAndClear();
        TransactionView stored = transactionService.get(owner.getId(), id);
        assertThat(stored.deleted()).isFalse();
        assertThat(stored.version()).isEqualTo(2);
        assertThat(transactionService.listDeleted(owner.getId(), ledgerId)).isEmpty();
    }

    @Test
    void history_recordsEveryWriteInOrder() {
        UUID id = UUID.randomUUID();
        create(expense(id, 12_000));
        transactionService.update(owner.getId(), id, 1, expense(id, 15_000), DEVICE);
        transactionService.cancel(owner.getId(), id, 2, DEVICE);
        transactionService.delete(owner.getId(), id, 3, DEVICE);
        transactionService.restore(owner.getId(), id, 4, DEVICE);
        flushAndClear();

        List<ChangeLogView> history = transactionService.history(owner.getId(), id);

        assertThat(history).extracting(ChangeLogView::action).containsExactly(
                ChangeAction.CREATE, ChangeAction.UPDATE, ChangeAction.CANCEL, ChangeAction.DELETE,
                ChangeAction.RESTORE);
        assertThat(history).allSatisfy(entry -> {
            assertThat(entry.transactionId()).isEqualTo(id);
            assertThat(entry.actorId()).isEqualTo(owner.getId());
            assertThat(entry.deviceId()).isEqualTo(DEVICE);
            assertThat(entry.after()).isNotNull();
        });
        assertThat(history.get(0).before()).isNull();
        assertThat(history.get(0).after().at("/version").asLong()).isEqualTo(1);
        ChangeLogView update = history.get(1);
        assertThat(update.before().at("/lines/0/amount").asLong()).isEqualTo(-12_000);
        assertThat(update.after().at("/lines/0/amount").asLong()).isEqualTo(-15_000);
        assertThat(history.get(2).after().at("/status").asString()).isEqualTo("CANCELED");
        assertThat(history.get(3).after().at("/deleted").asBoolean()).isTrue();
        assertThat(history.get(4).after().at("/deleted").asBoolean()).isFalse();
        assertThat(history.get(4).after().at("/version").asLong()).isEqualTo(5);
    }

    @Test
    void get_hidesOtherLedgersTransaction() {
        UUID id = UUID.randomUUID();
        create(expense(id, 12_000));
        User other = fixtures.user("other@example.com");

        assertThatThrownBy(() -> transactionService.get(other.getId(), id))
                .isInstanceOf(NotFoundException.class);
        assertThatThrownBy(() -> transactionService.get(owner.getId(), UUID.randomUUID()))
                .isInstanceOf(NotFoundException.class);
        assertThatThrownBy(() -> transactionService.cancel(other.getId(), id, 1, DEVICE))
                .isInstanceOf(NotFoundException.class);
        assertThatThrownBy(() -> transactionService.history(other.getId(), id))
                .isInstanceOf(NotFoundException.class);
        assertThat(transactionService.get(owner.getId(), id).status()).isEqualTo(TransactionStatus.POSTED);
    }
}
