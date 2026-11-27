package app.accountbook.transaction;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.catchThrowable;
import static org.assertj.core.api.Assertions.catchThrowableOfType;
import static org.awaitility.Awaitility.await;

import app.accountbook.account.AccountType;
import app.accountbook.support.Fixtures;
import app.accountbook.support.IntegrationTest;
import app.accountbook.transaction.TransactionCommand.Entry;
import app.accountbook.user.User;
import jakarta.persistence.EntityManager;
import java.time.Duration;
import java.time.LocalDate;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionException;
import java.util.concurrent.TimeUnit;
import java.util.function.Supplier;
import java.util.stream.Stream;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 같은 id의 만들기 요청이 동시에 오면 한 건만 만들어지고 나머지는 판정 표대로 답한다(ADR 006 결정 3).
 *
 * <p>앞 요청을 커밋하지 않은 채 뒤 요청을 다른 스레드에서 보낸다. 뒤 요청은 "같은 id 없음"을 본 뒤 INSERT에서
 * 앞 요청을 기다리고, 앞 요청이 커밋되는 순간 기본키 위반을 만난다. 두 트랜잭션이 실제로 겹쳐야 하므로 테스트
 * 트랜잭션 없이 돌고, 커밋한 데이터는 끝날 때 지운다.
 */
@IntegrationTest
@Transactional(propagation = Propagation.NOT_SUPPORTED)
class TransactionCreateRaceTest {

    static final LocalDate DAY = LocalDate.of(2026, 11, 18);
    static final Duration TIMEOUT = Duration.ofSeconds(10);

    @Autowired TransactionService transactionService;
    @Autowired TransactionTemplate transactionTemplate;
    @Autowired Fixtures fixtures;
    @Autowired EntityManager entityManager;
    @Autowired JdbcTemplate jdbc;

    final UUID id = UUID.randomUUID();
    User owner;
    UUID ledgerId;
    UUID cash;
    User stranger;
    UUID strangerLedgerId;
    UUID strangerCash;

    @BeforeEach
    void setUp() {
        owner = fixtures.user("race-owner@example.com");
        ledgerId = fixtures.personalLedgerId(owner);
        cash = fixtures.account(owner, ledgerId, "현금", AccountType.CASH, 0, DAY).getId();
        stranger = fixtures.user("race-stranger@example.com");
        strangerLedgerId = fixtures.personalLedgerId(stranger);
        strangerCash = fixtures.account(stranger, strangerLedgerId, "남의현금", AccountType.CASH, 0, DAY).getId();
    }

    /** 참조하는 쪽부터 지운다. 라인은 거래를 지우면 같이 지워진다. */
    @AfterEach
    void removeCommittedData() {
        Stream.of("change_log", "transaction", "account", "category", "ledger_member").forEach(table ->
                jdbc.update("delete from " + table + " where ledger_id in (?, ?)", ledgerId, strangerLedgerId));
        jdbc.update("delete from ledger where id in (?, ?)", ledgerId, strangerLedgerId);
        jdbc.update("delete from users where id in (?, ?)", owner.getId(), stranger.getId());
    }

    @Test
    void 내용이_같으면_한_건만_만들고_나머지는_재전송이다() {
        Race race = race(() -> create(owner, ledgerId, cash, 12_000), () -> create(owner, ledgerId, cash, 12_000));

        assertThat(race.first().created()).isTrue();
        assertThat(race.second().join()).isEqualTo(new CreateResult(race.first().transaction(), false));
        assertOnlyFirstIsStored(race);
    }

    @Test
    void 내용이_다르면_먼저_저장된_거래를_담은_충돌이다() {
        Race race = race(() -> create(owner, ledgerId, cash, 12_000), () -> create(owner, ledgerId, cash, 13_000));

        assertThat(conflictOf(race).current()).contains(race.first().transaction());
        assertOnlyFirstIsStored(race);
    }

    @Test
    void 다른_장부에서_먼저_쓴_id면_아무것도_담지_않은_충돌이다() {
        Race race = race(() -> create(owner, ledgerId, cash, 12_000),
                () -> create(stranger, strangerLedgerId, strangerCash, 12_000));

        assertThat(conflictOf(race).current()).isEmpty();
        assertOnlyFirstIsStored(race);
    }

    /**
     * 같은 장부의 같은 id는 기본키와 uq_transaction_id_ledger(V10)에 함께 걸리고, PostgreSQL은 OID가 작은 인덱스의
     * 이름을 알린다. 기본키를 REINDEX CONCURRENTLY로 다시 만들면 OID가 커져 이름이 바뀐다. 끝나면 순서를 되돌린다.
     */
    @Test
    void 기본키보다_장부_유니크가_먼저_걸려도_재전송이다() {
        jdbc.execute("REINDEX INDEX CONCURRENTLY transaction_pkey");
        try {
            Race race = race(() -> create(owner, ledgerId, cash, 12_000),
                    () -> create(owner, ledgerId, cash, 12_000));

            assertThat(race.second().join()).isEqualTo(new CreateResult(race.first().transaction(), false));
            assertOnlyFirstIsStored(race);
        } finally {
            jdbc.execute("REINDEX INDEX CONCURRENTLY uq_transaction_id_ledger");
        }
    }

    /**
     * 뒤 요청이 같은 id도 완전 삭제 기록도 없다고 본 뒤 INSERT하기 전에, 그 id가 만들어지고 완전히 지워진 경우다.
     * 부딪힐 행이 지워져 기본키 위반이 나지 않는다.
     */
    @Test
    void 기다리는_사이_만들어지고_완전히_지워진_id면_새로_만들지_않는다() {
        Race race = race(() -> create(owner, ledgerId, cash, 12_000), () -> create(owner, ledgerId, cash, 12_000),
                this::purge);

        assertThat(conflictOf(race).current()).isEmpty();
        assertOnlyPurgeRecordIsStored();
    }

    @Test
    void 완전_삭제가_커밋되기_전의_재전송은_있던_거래로_답하고_커밋된_뒤에는_거부된다() {
        CreateResult stored = create(owner, ledgerId, cash, 12_000);

        CreateResult during = transactionTemplate.execute(status -> {
            purge();
            return CompletableFuture.supplyAsync(() -> create(owner, ledgerId, cash, 12_000))
                    .orTimeout(TIMEOUT.toSeconds(), TimeUnit.SECONDS).join();
        });
        IdConflictException after = catchThrowableOfType(IdConflictException.class,
                () -> create(owner, ledgerId, cash, 12_000));

        assertThat(during).isEqualTo(new CreateResult(stored.transaction(), false));
        assertThat(after.current()).isEmpty();
        assertOnlyPurgeRecordIsStored();
    }

    private Race race(Supplier<CreateResult> first, Supplier<CreateResult> second) {
        return race(first, second, () -> { });
    }

    /**
     * 앞 요청의 트랜잭션을 연 채로 뒤 요청을 보내고, 뒤 요청이 앞 요청을 기다리게 된 것을 본 뒤 앞 요청을 커밋한다.
     * beforeCommit은 뒤 요청이 기다리는 동안 앞 요청의 트랜잭션에서 한다.
     */
    private Race race(Supplier<CreateResult> first, Supplier<CreateResult> second, Runnable beforeCommit) {
        return transactionTemplate.execute(status -> {
            CreateResult result = first.get();
            entityManager.flush();
            CompletableFuture<CreateResult> waiting = CompletableFuture.supplyAsync(second)
                    .orTimeout(2 * TIMEOUT.toSeconds(), TimeUnit.SECONDS);
            // 같은 스레드에서 물어야 이 트랜잭션의 연결(pg_backend_pid)을 기준으로 본다.
            await().pollInSameThread().atMost(TIMEOUT).until(() -> jdbc.queryForObject("""
                    select exists (select 1 from pg_locks
                                    where not granted and pg_backend_pid() = any (pg_blocking_pids(pid)))
                    """, Boolean.class));
            beforeCommit.run();
            return new Race(result, waiting);
        });
    }

    /** 완전 삭제(#9)가 한 트랜잭션에서 할 일. 지우는 거래가 version 1이라 기록의 번호는 2다. */
    private void purge() {
        fixtures.purge(id, owner.getId());
    }

    private CreateResult create(User actor, UUID ledger, UUID account, long amount) {
        return transactionService.createOrReplay(actor.getId(), ledger, new Entry(id, TransactionType.EXPENSE, DAY,
                null, account, null, amount, false, "김밥천국", null, null), "iphone.safari");
    }

    private static IdConflictException conflictOf(Race race) {
        Throwable thrown = catchThrowable(() -> race.second().join());
        assertThat(thrown).isInstanceOf(CompletionException.class);
        assertThat(thrown.getCause()).isExactlyInstanceOf(IdConflictException.class);
        return (IdConflictException) thrown.getCause();
    }

    private void assertOnlyFirstIsStored(Race race) {
        assertThat(transactionService.get(owner.getId(), id)).isEqualTo(race.first().transaction());
        assertThat(transactionService.history(owner.getId(), id)).extracting(ChangeLogView::action)
                .containsExactly(ChangeAction.CREATE);
    }

    private void assertOnlyPurgeRecordIsStored() {
        assertThat(jdbc.queryForObject("select count(*) from transaction where id = ?", Integer.class, id)).isZero();
        assertThat(jdbc.queryForList("select action || ' ' || version from change_log where transaction_id = ?",
                String.class, id)).containsExactly("PURGE 2");
    }

    record Race(CreateResult first, CompletableFuture<CreateResult> second) {
    }
}
