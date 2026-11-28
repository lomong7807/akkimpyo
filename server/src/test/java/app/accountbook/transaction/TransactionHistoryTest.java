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
    void 새_이력의_형식_버전은_2이다() {
        create(id);
        transactionService.cancel(owner, id, 1, DEVICE);
        flushAndClear();

        assertThat(jdbc.queryForList("select format_version from change_log where transaction_id = ?", Integer.class,
                id)).containsExactly(2, 2);
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

    // ---------------------------------------------------------------- 조회 순서

    /** 넣은 순서를 번호와 반대로 해서, 시각이 같을 때 DB가 우연히 맞는 순서로 돌려주는 경우를 없앤다. */
    @Test
    void 시각이_같은_이력은_몇_번을_읽어도_번호_순서다() {
        create(id);
        flushAndClear();
        insertLog(4, ChangeAction.RESTORE, "created_at");
        insertLog(3, ChangeAction.DELETE, "created_at");
        insertLog(2, ChangeAction.UPDATE, "created_at");
        assertThat(jdbc.queryForObject("select count(distinct created_at) from change_log where transaction_id = ?",
                Integer.class, id)).isEqualTo(1);

        for (int read = 1; read <= 3; read++) {
            assertThat(actions()).as("%d번째 조회", read).containsExactly(ChangeAction.CREATE, ChangeAction.UPDATE,
                    ChangeAction.DELETE, ChangeAction.RESTORE);
            entityManager.clear();
        }
    }

    /** 서버 시계가 뒤로 가서 나중 변경의 시각이 앞선 경우다. 번호가 크게 뛰어 있어도 같다. */
    @Test
    void 시각이_거꾸로여도_구멍이_있어도_번호_순서다() {
        create(id);
        flushAndClear();
        insertLog(2, ChangeAction.UPDATE, "created_at - interval '1 hour'");
        insertLog(RESTORE_JUMP + 3, ChangeAction.DELETE, "created_at - interval '2 hours'");
        insertLog(RESTORE_JUMP + 9, ChangeAction.RESTORE, "created_at - interval '3 hours'");

        assertThat(actions()).containsExactly(ChangeAction.CREATE, ChangeAction.UPDATE, ChangeAction.DELETE,
                ChangeAction.RESTORE);
    }

    /** 새 이력의 시각은 마지막 이력보다 뒤다. 마지막 이력은 시각이 아니라 번호가 가장 큰 행이다. */
    @Test
    void 새_이력의_시각은_번호가_가장_큰_이력의_시각_바로_뒤다() {
        create(id);
        transactionService.cancel(owner, id, 1, DEVICE);
        flushAndClear();
        // 앞으로 간 시계로 쓴 이력 둘. 시각은 번호 1이 더 늦지만 마지막 이력은 번호 2다.
        jdbc.update("update change_log set created_at = now() + interval '2 hours' where transaction_id = ? "
                + "and version = 1", id);
        jdbc.update("update change_log set created_at = now() + interval '1 hour' where transaction_id = ? "
                + "and version = 2", id);

        transactionService.delete(owner, id, 2, DEVICE);
        flushAndClear();

        assertThat(jdbc.queryForObject("""
                select (select created_at from change_log where transaction_id = ? and version = 3)
                     - (select created_at from change_log where transaction_id = ? and version = 2)
                     = interval '1 microsecond'
                """, Boolean.class, id, id)).isTrue();
    }

    @Test
    void 이력_조회는_다른_거래의_이력을_섞지_않는다() {
        UUID otherId = UUID.randomUUID();
        create(id);
        create(otherId);
        transactionService.cancel(owner, otherId, 1, DEVICE);
        transactionService.update(owner, id, 1, expense(id, 15_000), DEVICE);
        transactionService.delete(owner, otherId, 2, DEVICE);
        flushAndClear();

        assertThat(history()).hasSize(2).allSatisfy(entry -> {
            assertThat(entry.transactionId()).isEqualTo(id);
            assertThat(entry.after().at("/id").asString()).isEqualTo(id.toString());
        });
        assertThat(actions()).containsExactly(ChangeAction.CREATE, ChangeAction.UPDATE);
        assertThat(transactionService.history(owner, otherId)).extracting(ChangeLogView::action)
                .containsExactly(ChangeAction.CREATE, ChangeAction.CANCEL, ChangeAction.DELETE);
    }

    // ---------------------------------------------------------------- 도우미

    /** 번호 1의 이력을 본떠 앱을 거치지 않고 넣는다. createdAt은 번호 1의 created_at으로 만드는 식이다. */
    private void insertLog(long version, ChangeAction action, String createdAt) {
        jdbc.update("""
                insert into change_log (id, transaction_id, ledger_id, version, action, actor_id, after_value,
                                        created_at)
                select ?, transaction_id, ledger_id, ?, ?, actor_id, after_value, %s
                  from change_log where transaction_id = ? and version = 1
                """.formatted(createdAt), UUID.randomUUID(), version, action.name(), id);
    }

    private TransactionView create(UUID txId) {
        return transactionService.create(owner, ledgerId, expense(txId, 12_000), DEVICE);
    }

    private Entry expense(UUID txId, long amount) {
        return new Entry(txId, TransactionType.EXPENSE, DAY, null, cash, null, amount, null, "김밥천국", null, null);
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
