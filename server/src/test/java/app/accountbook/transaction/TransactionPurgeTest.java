package app.accountbook.transaction;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.catchThrowable;
import static org.assertj.core.api.Assertions.tuple;

import app.accountbook.account.AccountType;
import app.accountbook.common.InvalidStateException;
import app.accountbook.common.NotFoundException;
import app.accountbook.ledger.LedgerRole;
import app.accountbook.support.Fixtures;
import app.accountbook.support.IntegrationTest;
import app.accountbook.transaction.TransactionCommand.Entry;
import app.accountbook.transaction.TransactionCommand.Transfer;
import app.accountbook.user.User;
import jakarta.persistence.EntityManager;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * 휴지통에서 완전히 지우기(F-231, #9). 거래, 라인, 그 거래의 이력이 모두 사라지고 "누가 언제 지웠다" 기록 한 행만 남는다.
 * 기록에는 전후 값과 기기 값이 없고 version은 거래 행의 version + 1이다(ADR 007 결정 2, 7, #60).
 */
@IntegrationTest
class TransactionPurgeTest {

    static final LocalDate DAY = LocalDate.of(2026, 11, 18);
    static final String DEVICE = "iphone.safari";
    /** 전체 복원이 더하는 값(복원하는 시각의 epoch 초)만 한 크기(ADR 008 결정 10). */
    static final long RESTORE_JUMP = 1_795_000_000L;

    @Autowired TransactionService transactionService;
    @Autowired Fixtures fixtures;
    @Autowired EntityManager entityManager;
    @Autowired JdbcTemplate jdbc;

    User owner;
    User member;
    UUID ledgerId;
    UUID cash;
    UUID bank;

    @BeforeEach
    void setUp() {
        owner = fixtures.user("owner@example.com");
        ledgerId = fixtures.personalLedgerId(owner);
        member = fixtures.user("member@example.com");
        fixtures.addMember(ledgerId, member, LedgerRole.MEMBER);
        cash = fixtures.account(owner, ledgerId, "현금", AccountType.CASH, 0, DAY).getId();
        bank = fixtures.account(owner, ledgerId, "국민은행", AccountType.BANK, 0, DAY).getId();
    }

    @Test
    void 휴지통의_거래를_지우면_거래와_라인과_이력이_사라지고_기록_한_행만_남는다() {
        TransactionView trashed = trash(fixtures.expense(owner, ledgerId, cash, null, DAY, 12_000));
        TransactionView other = fixtures.expense(owner, ledgerId, cash, null, DAY, 5_000);

        transactionService.purge(member.getId(), trashed.id(), trashed.version());
        flushAndClear();

        assertThat(count("transaction", "id", trashed.id())).isZero();
        assertThat(count("transaction_line", "transaction_id", trashed.id())).isZero();
        assertThat(logs(trashed.id())).singleElement().satisfies(log -> assertThat(log)
                .containsEntry("ledger_id", ledgerId).containsEntry("version", 3L).containsEntry("action", "PURGE")
                .containsEntry("actor_id", member.getId()).containsEntry("device_id", null)
                .containsEntry("before_value", null).containsEntry("after_value", null));
        assertThat(logs(other.id())).extracting(log -> log.get("action")).containsExactly("CREATE");
    }

    /** 전체 복원 뒤에는 거래의 version이 이력보다 크다. 기록의 번호는 이력의 마지막 번호 + 1이 아니다. */
    @Test
    void 기록의_version은_이력의_마지막이_아니라_거래_행의_version_더하기_1이다() {
        TransactionView trashed = trash(fixtures.expense(owner, ledgerId, cash, null, DAY, 12_000));
        flushAndClear();
        jdbc.update("update transaction set version = version + ? where id = ?", RESTORE_JUMP, trashed.id());
        long version = trashed.version() + RESTORE_JUMP;

        transactionService.purge(owner.getId(), trashed.id(), version);
        flushAndClear();

        assertThat(logs(trashed.id())).extracting(log -> log.get("version")).containsExactly(version + 1);
    }

    @Test
    void 휴지통에_없는_거래는_지우지_않는다() {
        TransactionView live = fixtures.expense(owner, ledgerId, cash, null, DAY, 12_000);
        TransactionView canceled = fixtures.cancel(owner, fixtures.expense(owner, ledgerId, cash, null, DAY, 8_000));
        flushAndClear();

        List.of(live, canceled).forEach(tx -> assertThat(catchThrowable(
                () -> transactionService.purge(owner.getId(), tx.id(), tx.version())))
                .isExactlyInstanceOf(InvalidStateException.class)
                .hasMessage("휴지통에 있는 거래만 완전히 지울 수 있습니다."));
        flushAndClear();

        assertThat(count("transaction_line", "transaction_id", live.id())).isOne();
        assertThat(logs(live.id())).hasSize(1);
        assertThat(logs(canceled.id())).hasSize(2);
    }

    @Test
    void 본_version이_지금과_다르면_지우지_않는다() {
        TransactionView trashed = trash(fixtures.expense(owner, ledgerId, cash, null, DAY, 12_000));

        assertThat(catchThrowable(() -> transactionService.purge(owner.getId(), trashed.id(), trashed.version() - 1)))
                .isExactlyInstanceOf(StaleVersionException.class);
        flushAndClear();

        assertThat(count("transaction", "id", trashed.id())).isOne();
        assertThat(logs(trashed.id())).hasSize(2);
    }

    @Test
    void 구성원이_아니거나_없거나_이미_지운_거래는_없는_거래와_같다() {
        User stranger = fixtures.user("stranger@example.com");
        TransactionView trashed = trash(fixtures.expense(owner, ledgerId, cash, null, DAY, 12_000));
        TransactionView purged = trash(fixtures.expense(owner, ledgerId, cash, null, DAY, 3_000));
        transactionService.purge(owner.getId(), purged.id(), purged.version());
        flushAndClear();

        assertThat(List.<Runnable>of(
                () -> transactionService.purge(stranger.getId(), trashed.id(), trashed.version()),
                () -> transactionService.purge(owner.getId(), UUID.randomUUID(), 2),
                () -> transactionService.purge(owner.getId(), purged.id(), purged.version())))
                .allSatisfy(call -> assertThat(catchThrowable(call::run)).isExactlyInstanceOf(NotFoundException.class));
        flushAndClear();

        assertThat(logs(trashed.id())).hasSize(2);
        assertThat(logs(purged.id())).extracting(log -> log.get("action")).containsExactly("PURGE");
    }

    /** qa 보강(PR #175 검증): 세 종류 모두 서비스로 지운 뒤 같은 id로 다시 만들 수 없고 라인도 생기지 않는다. */
    @Test
    void 완전히_지운_id로는_지출_수입_이체_모두_다시_만들_수_없다() {
        Map<String, TransactionCommand> commands = Map.of(
                "지출", new Entry(UUID.randomUUID(), TransactionType.EXPENSE, DAY, null, cash, null, 12_000, null,
                        "김밥천국", null, null),
                "수입", new Entry(UUID.randomUUID(), TransactionType.INCOME, DAY, null, bank, null, 3_000_000, null,
                        null, null, null),
                "이체", new Transfer(UUID.randomUUID(), DAY, null, bank, cash, 50_000, null));

        commands.forEach((label, command) -> {
            TransactionView created = transactionService.create(owner.getId(), ledgerId, command, DEVICE);
            assertThat(count("transaction_line", "transaction_id", created.id())).as(label)
                    .isEqualTo(command instanceof Transfer ? 2 : 1);
            TransactionView trashed = transactionService.delete(owner.getId(), created.id(), created.version(), DEVICE);
            transactionService.purge(owner.getId(), trashed.id(), trashed.version());
            flushAndClear();

            assertThat(catchThrowable(() -> transactionService.create(owner.getId(), ledgerId, command, DEVICE)))
                    .as(label).isExactlyInstanceOf(IdConflictException.class).hasMessage("이 id는 쓸 수 없습니다.");
            flushAndClear();

            assertThat(count("transaction", "id", created.id())).as(label).isZero();
            assertThat(count("transaction_line", "transaction_id", created.id())).as(label).isZero();
            assertThat(logs(created.id())).as(label).extracting(log -> log.get("version"), log -> log.get("action"))
                    .containsExactly(tuple(3L, "PURGE"));
        });
    }

    // ---------------------------------------------------------------- 도우미

    private TransactionView trash(TransactionView tx) {
        return fixtures.delete(owner, tx);
    }

    private int count(String table, String column, UUID id) {
        return jdbc.queryForObject("select count(*) from " + table + " where " + column + " = ?", Integer.class, id);
    }

    private List<Map<String, Object>> logs(UUID txId) {
        return jdbc.queryForList("""
                select ledger_id, version, action, actor_id, device_id, before_value, after_value
                  from change_log where transaction_id = ? order by version
                """, txId);
    }

    /** 영속성 컨텍스트를 비워 다음 요청과 조회가 DB에 저장된 값을 읽게 한다. */
    private void flushAndClear() {
        entityManager.flush();
        entityManager.clear();
    }
}
