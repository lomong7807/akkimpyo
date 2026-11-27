package app.accountbook.transaction;

import static org.assertj.core.api.Assertions.assertThat;

import app.accountbook.account.AccountType;
import app.accountbook.ledger.LedgerRole;
import app.accountbook.support.Fixtures;
import app.accountbook.support.IntegrationTest;
import app.accountbook.transaction.TransactionCommand.Entry;
import app.accountbook.user.User;
import java.time.LocalDate;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * 거래의 고친 사람({@code updatedBy})과 휴지통 시각({@code deletedAt}). 거래 테이블에는 고친 사람이 없어 이력의 마지막 행을
 * 남긴 사람이다(ADR 002 2절). 만들기의 응답과 재전송, 409의 {@code current}가 이 값을 쓴다(#14).
 */
@IntegrationTest
class TransactionUpdatedByTest {

    static final LocalDate DAY = LocalDate.of(2026, 11, 18);
    static final String DEVICE = "iphone.safari";

    @Autowired TransactionService transactionService;
    @Autowired Fixtures fixtures;

    User owner;
    User member;
    UUID ledgerId;
    UUID cash;

    @BeforeEach
    void setUp() {
        owner = fixtures.user("owner@example.com");
        member = fixtures.user("member@example.com");
        ledgerId = fixtures.personalLedgerId(owner);
        fixtures.addMember(ledgerId, member, LedgerRole.MEMBER);
        cash = fixtures.account(owner, ledgerId, "현금", AccountType.CASH, 0, DAY).getId();
    }

    @Test
    void 만든_거래는_만든_사람이_고친_사람이고_휴지통_시각이_없다() {
        TransactionView created = transactionService.createOrReplay(owner.getId(), ledgerId, expense(1_000), DEVICE)
                .transaction();

        assertThat(created.updatedBy()).isEqualTo(owner.getId());
        assertThat(created.deletedAt()).isNull();
        assertThat(created.deleted()).isFalse();
        assertThat(transactionService.get(owner.getId(), created.id())).isEqualTo(created);
    }

    @Test
    void 다른_구성원이_고치고_지운_거래의_재전송은_마지막에_고친_사람과_지운_시각을_담는다() {
        Entry cmd = expense(1_000);
        TransactionView created = transactionService.createOrReplay(owner.getId(), ledgerId, cmd, DEVICE)
                .transaction();
        TransactionView updated = transactionService.update(member.getId(), created.id(), created.version(),
                expense(cmd.id(), 2_000), DEVICE);
        assertThat(updated.updatedBy()).isEqualTo(member.getId());

        TransactionView deleted = transactionService.delete(member.getId(), created.id(), updated.version(), DEVICE);
        CreateResult resent = transactionService.createOrReplay(owner.getId(), ledgerId, cmd, DEVICE);

        assertThat(resent.created()).isFalse();
        assertThat(resent.transaction()).isEqualTo(deleted);
        assertThat(resent.transaction().updatedBy()).isEqualTo(member.getId());
        assertThat(resent.transaction().deletedAt()).isNotNull().isEqualTo(deleted.updatedAt());
        assertThat(transactionService.listDeleted(owner.getId(), ledgerId)).containsExactly(deleted);
    }

    private Entry expense(long amount) {
        return expense(UUID.randomUUID(), amount);
    }

    private Entry expense(UUID id, long amount) {
        return new Entry(id, TransactionType.EXPENSE, DAY, null, cash, null, amount, false, null, null, null);
    }
}
