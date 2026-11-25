package app.accountbook.transaction;

import static org.assertj.core.api.Assertions.assertThat;

import app.accountbook.account.AccountType;
import app.accountbook.support.Fixtures;
import app.accountbook.support.IntegrationTest;
import app.accountbook.transaction.TransactionCommand.Entry;
import app.accountbook.user.User;
import jakarta.persistence.EntityManager;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import java.util.stream.Stream;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * 변경 이력의 번호(version)와 조회(ADR 007 결정 4~7, 이슈 #60).
 * 번호는 그 변경 뒤의 거래 version이다. 전체 복원이 거래의 version을 크게 올리므로(ADR 008 결정 10) 1씩 이어지지 않는다.
 */
@IntegrationTest
class TransactionHistoryTest {

    static final LocalDate DAY = LocalDate.of(2026, 11, 18);
    static final String DEVICE = "iphone.safari";
    /** 전체 복원이 더하는 값(복원하는 시각의 epoch 초)만 한 크기. */
    static final long RESTORE_JUMP = 1_795_000_000L;

    @Autowired TransactionService transactionService;
    @Autowired Fixtures fixtures;
    @Autowired EntityManager entityManager;
    @Autowired JdbcTemplate jdbc;

    final UUID id = UUID.randomUUID();
    UUID owner;
    UUID ledgerId;
    UUID cash;

    @BeforeEach
    void setUp() {
        User user = fixtures.user("owner@example.com");
        owner = user.getId();
        ledgerId = fixtures.personalLedgerId(user);
        cash = fixtures.account(user, ledgerId, "현금", AccountType.CASH, 0, LocalDate.of(2026, 11, 1)).getId();
    }

    // ---------------------------------------------------------------- 저장하는 값

    @Test
    void 이력의_번호는_그_변경_뒤의_거래_version이다() {
        List<Long> versions = Stream.of(
                create(id),
                transactionService.update(owner, id, 1, expense(id, 15_000), DEVICE),
                transactionService.cancel(owner, id, 2, DEVICE),
                transactionService.delete(owner, id, 3, DEVICE),
                transactionService.restore(owner, id, 4, DEVICE)).map(TransactionView::version).toList();
        flushAndClear();

        assertThat(versions).containsExactly(1L, 2L, 3L, 4L, 5L);
        assertThat(storedVersions()).isEqualTo(versions);
        assertThat(jdbc.queryForList("""
                select cast(after_value ->> 'version' as bigint) from change_log where transaction_id = ?
                 order by version
                """, Long.class, id)).isEqualTo(versions);
        assertThat(actions()).containsExactly(ChangeAction.CREATE, ChangeAction.UPDATE, ChangeAction.CANCEL,
                ChangeAction.DELETE, ChangeAction.RESTORE);
    }

    @Test
    void 복원으로_version이_뛴_뒤의_이력도_그_변경_뒤의_거래_version을_적는다() {
        create(id);
        transactionService.update(owner, id, 1, expense(id, 15_000), DEVICE);
        jumpVersion();

        transactionService.delete(owner, id, RESTORE_JUMP + 2, DEVICE);
        transactionService.restore(owner, id, RESTORE_JUMP + 3, DEVICE);
        flushAndClear();

        assertThat(storedVersions()).containsExactly(1L, 2L, RESTORE_JUMP + 3, RESTORE_JUMP + 4);
        assertThat(actions()).containsExactly(ChangeAction.CREATE, ChangeAction.UPDATE, ChangeAction.DELETE,
                ChangeAction.RESTORE);
    }

    @Test
    void 새_이력의_형식_버전은_1이다() {
        create(id);
        transactionService.cancel(owner, id, 1, DEVICE);
        flushAndClear();

        assertThat(jdbc.queryForList("select format_version from change_log where transaction_id = ?", Integer.class,
                id)).containsExactly(1, 1);
    }

    /** 탈퇴한 사람의 자리와 서버가 한 일은 비어 있다(ADR 007 결정 5, 6). */
    @Test
    void 바꾼_사람이_빈_이력도_읽힌다() {
        create(id);
        transactionService.cancel(owner, id, 1, DEVICE);
        flushAndClear();
        jdbc.update("update change_log set actor_id = null where transaction_id = ? and version = 1", id);

        assertThat(history()).extracting(ChangeLogView::actorId).containsExactly(null, owner);
    }

    // ---------------------------------------------------------------- 도우미

    private TransactionView create(UUID txId) {
        return transactionService.create(owner, ledgerId, expense(txId, 12_000), DEVICE);
    }

    private Entry expense(UUID txId, long amount) {
        return new Entry(txId, TransactionType.EXPENSE, DAY, null, cash, null, amount, false, "김밥천국", null, null);
    }

    /** 전체 복원 절차가 하는 일(ADR 008 결정 10). 이력은 남기지 않는다. */
    private void jumpVersion() {
        flushAndClear();
        jdbc.update("update transaction set version = version + ? where id = ?", RESTORE_JUMP, id);
    }

    private List<ChangeLogView> history() {
        return transactionService.history(owner, id);
    }

    private List<ChangeAction> actions() {
        return history().stream().map(ChangeLogView::action).toList();
    }

    private List<Long> storedVersions() {
        return jdbc.queryForList("select version from change_log where transaction_id = ? order by version",
                Long.class, id);
    }

    /** 영속성 컨텍스트를 비워 다음 요청과 조회가 DB에 저장된 값을 읽게 한다. */
    private void flushAndClear() {
        entityManager.flush();
        entityManager.clear();
    }
}
