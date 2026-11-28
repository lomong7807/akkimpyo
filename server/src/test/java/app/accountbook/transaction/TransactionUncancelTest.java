package app.accountbook.transaction;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import app.accountbook.account.Account;
import app.accountbook.account.AccountType;
import app.accountbook.common.InvalidStateException;
import app.accountbook.ledger.LedgerRole;
import app.accountbook.stats.BalanceQuery;
import app.accountbook.stats.MonthlyStatsQuery;
import app.accountbook.support.Fixtures;
import app.accountbook.support.IntegrationTest;
import app.accountbook.transaction.TransactionPage.DayTotals;
import app.accountbook.user.User;
import jakarta.persistence.EntityManager;
import java.time.LocalDate;
import java.time.YearMonth;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * 승인취소 되돌리기(F-226, P-208, P-217, 이슈 #7). 취소 직전 상태는 지금 완료(POSTED)뿐이다. 승인 대기(PENDING)를 만드는
 * 문자 입력(P-503)은 3단계다. 그래서 되돌리면 완료이고, 취소 직전 상태는 취소 이력의 전 값에 남는다.
 */
@IntegrationTest
class TransactionUncancelTest {

    /** 달의 마지막 날. 되돌린 거래가 다음 달이 아니라 그 달에 다시 든다. */
    static final LocalDate NOV_30 = LocalDate.of(2026, 11, 30);
    static final YearMonth NOVEMBER = YearMonth.of(2026, 11);
    static final YearMonth DECEMBER = YearMonth.of(2026, 12);
    static final String DEVICE = "iphone.safari";
    static final String OTHER_DEVICE = "mac.chrome";

    @Autowired TransactionService transactionService;
    @Autowired TransactionHistoryQuery transactionHistoryQuery;
    @Autowired TransactionListQuery transactionListQuery;
    @Autowired BalanceQuery balanceQuery;
    @Autowired MonthlyStatsQuery monthlyStatsQuery;
    @Autowired Fixtures fixtures;
    @Autowired EntityManager entityManager;

    User owner;
    User member;
    UUID ledgerId;
    Account bank;

    @BeforeEach
    void setUp() {
        owner = fixtures.user("owner@example.com");
        member = fixtures.user("member@example.com");
        ledgerId = fixtures.personalLedgerId(owner);
        fixtures.addMember(ledgerId, member, LedgerRole.MEMBER);
        bank = fixtures.account(owner, ledgerId, "국민은행", AccountType.BANK, 100_000, LocalDate.of(2026, 11, 1));
    }

    @Test
    void 되돌리면_완료로_돌아가고_version을_올리며_이력에_상태의_전후_값이_남는다() {
        TransactionView canceled = fixtures.cancel(owner, expense(12_000));

        TransactionView reverted = transactionService.uncancel(member.getId(), canceled.id(), 2, OTHER_DEVICE);
        flushAndClear();
        TransactionView stored = transactionService.get(owner.getId(), canceled.id());

        assertThat(List.of(reverted, stored)).allSatisfy(view -> {
            assertThat(view.status()).isEqualTo(TransactionStatus.POSTED);
            assertThat(view.version()).isEqualTo(3);
            assertThat(view.deleted()).isFalse();
            assertThat(view.updatedBy()).isEqualTo(member.getId());
            assertThat(view.lines()).isEqualTo(canceled.lines());
        });
        List<TransactionChange> history = transactionHistoryQuery.history(owner.getId(), ledgerId, canceled.id());
        assertThat(history).extracting(TransactionChange::action)
                .containsExactly(ChangeAction.CREATE, ChangeAction.CANCEL, ChangeAction.UNCANCEL);
        TransactionChange cancel = history.get(1);
        assertThat(cancel.before().status()).as("취소 직전 상태").isEqualTo(TransactionStatus.POSTED);
        TransactionChange uncancel = history.get(2);
        assertThat(List.of(uncancel.actorId(), uncancel.deviceId())).containsExactly(member.getId(), OTHER_DEVICE);
        assertThat(uncancel.before()).isEqualTo(cancel.after());
        assertThat(uncancel.after()).isEqualTo(cancel.before());
    }

    @Test
    void 되돌리면_잔액과_월_통계와_날짜별_합계에_다시_든다() {
        TransactionView canceled = fixtures.cancel(owner, expense(12_000));
        assertCounted(false);

        transactionService.uncancel(owner.getId(), canceled.id(), 2, DEVICE);

        assertCounted(true);
        assertThat(monthlyStatsQuery.monthly(owner.getId(), ledgerId, DECEMBER).expense()).isZero();
        assertThat(transactionListQuery.dailyTotals(owner.getId(), ledgerId, DECEMBER)).isEmpty();
    }

    @Test
    void 취소하지_않은_거래는_되돌릴_수_없다() {
        TransactionView posted = expense(12_000);

        assertThatThrownBy(() -> transactionService.uncancel(owner.getId(), posted.id(), 1, DEVICE))
                .isInstanceOf(InvalidStateException.class);

        assertUnchanged(posted.id(), 1, TransactionStatus.POSTED, false);
    }

    @Test
    void 휴지통의_거래는_취소했든_안_했든_되돌릴_수_없다() {
        TransactionView canceledThenDeleted = fixtures.delete(owner, fixtures.cancel(owner, expense(12_000)));
        TransactionView deleted = fixtures.delete(owner, expense(3_000));

        assertThatThrownBy(() -> transactionService.uncancel(owner.getId(), canceledThenDeleted.id(), 3, DEVICE))
                .isInstanceOf(InvalidStateException.class);
        assertThatThrownBy(() -> transactionService.uncancel(owner.getId(), deleted.id(), 2, DEVICE))
                .isInstanceOf(InvalidStateException.class);

        assertUnchanged(canceledThenDeleted.id(), 3, TransactionStatus.CANCELED, true);
        assertUnchanged(deleted.id(), 2, TransactionStatus.POSTED, true);
    }

    /** version이 상태보다 먼저다. 취소하지 않은 거래여도 낡은 version이면 충돌이다(ADR 002 5절). */
    @Test
    void version이_다르면_충돌이고_최신_내용을_담으며_아무것도_바꾸지_않는다() {
        TransactionView canceled = fixtures.cancel(owner, expense(12_000));
        TransactionView posted = expense(3_000);

        assertThatThrownBy(() -> transactionService.uncancel(owner.getId(), canceled.id(), 1, DEVICE))
                .isInstanceOfSatisfying(StaleVersionException.class, e -> {
                    assertThat(e.current().version()).isEqualTo(2);
                    assertThat(e.current().status()).isEqualTo(TransactionStatus.CANCELED);
                });
        assertThatThrownBy(() -> transactionService.uncancel(owner.getId(), posted.id(), 2, DEVICE))
                .isInstanceOf(StaleVersionException.class);

        assertUnchanged(canceled.id(), 2, TransactionStatus.CANCELED, false);
        assertUnchanged(posted.id(), 1, TransactionStatus.POSTED, false);
    }

    @Test
    void 되돌린_거래는_다시_취소하고_되돌릴_수_있다() {
        TransactionView canceled = fixtures.cancel(owner, expense(12_000));
        transactionService.uncancel(owner.getId(), canceled.id(), 2, DEVICE);

        transactionService.cancel(owner.getId(), canceled.id(), 3, DEVICE);
        TransactionView again = transactionService.uncancel(owner.getId(), canceled.id(), 4, DEVICE);

        assertThat(again.status()).isEqualTo(TransactionStatus.POSTED);
        assertThat(again.version()).isEqualTo(5);
        assertThat(transactionHistoryQuery.history(owner.getId(), ledgerId, canceled.id()))
                .extracting(TransactionChange::action).containsExactly(ChangeAction.CREATE, ChangeAction.CANCEL,
                        ChangeAction.UNCANCEL, ChangeAction.CANCEL, ChangeAction.UNCANCEL);
    }

    /** 미분류 지출. */
    private TransactionView expense(long amount) {
        return fixtures.expense(owner, ledgerId, bank.getId(), null, NOV_30, amount);
    }

    /** 12,000원 지출이 11월 30일의 잔액, 11월 통계, 11월 날짜별 합계에 드는가. */
    private void assertCounted(boolean counted) {
        entityManager.flush();
        long expense = counted ? 12_000 : 0;
        assertThat(balanceQuery.balances(owner.getId(), ledgerId)).containsEntry(bank.getId(), 100_000 - expense);
        assertThat(monthlyStatsQuery.monthly(owner.getId(), ledgerId, NOVEMBER).expense()).isEqualTo(expense);
        assertThat(transactionListQuery.dailyTotals(owner.getId(), ledgerId, NOVEMBER))
                .isEqualTo(counted ? List.of(new DayTotals(NOV_30, 0, 12_000)) : List.of());
    }

    private void assertUnchanged(UUID id, long version, TransactionStatus status, boolean deleted) {
        flushAndClear();
        TransactionView stored = transactionService.get(owner.getId(), id);
        assertThat(stored.version()).isEqualTo(version);
        assertThat(stored.status()).isEqualTo(status);
        assertThat(stored.deleted()).isEqualTo(deleted);
        assertThat(transactionHistoryQuery.history(owner.getId(), ledgerId, id)).hasSize((int) version);
    }

    /** 영속성 컨텍스트를 비워 다음 조회가 DB에 저장된 값을 읽게 한다. */
    private void flushAndClear() {
        entityManager.flush();
        entityManager.clear();
    }
}
