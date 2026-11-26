package app.accountbook.transaction;

import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;

import app.accountbook.account.AccountType;
import app.accountbook.common.NotFoundException;
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
import org.junit.jupiter.api.RepeatedTest;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 재전송 판정과 조회는 거래와 라인을 한 시점의 값으로 본다(#202). 거래를 읽은 뒤 라인을 읽기 전에 다른 트랜잭션이 그
 * 거래를 완전히 지우거나 고쳐 커밋해도, 라인이 0개인 거래나 존재한 적 없는 내용(고치기 전 거래 + 고친 뒤 라인)을 답하지
 * 않는다.
 *
 * <p>순서는 라인 표 잠금으로 정한다. 지우거나 고치는 트랜잭션이 라인 표를 잠근 채 커밋하지 않고 있으면, 읽는 쪽은 라인을
 * 읽는 문장에서 그 커밋을 기다린다. PostgreSQL은 잠금을 얻은 뒤에 그 문장의 스냅숏을 잡으므로 그 문장은 커밋 뒤의 값을
 * 본다. 거래를 그보다 앞의 문장에서 따로 읽었다면 거래는 커밋 전, 라인은 커밋 뒤의 값이 된다. 두 트랜잭션이 실제로
 * 겹쳐야 하므로 테스트 트랜잭션 없이 돌고, 커밋한 데이터는 끝날 때 지운다.
 */
@IntegrationTest
@Transactional(propagation = Propagation.NOT_SUPPORTED)
class TransactionReadRaceTest {

    static final LocalDate DAY = LocalDate.of(2026, 11, 18);
    static final Duration TIMEOUT = Duration.ofSeconds(10);
    static final String DEVICE = "iphone.safari";

    @Autowired TransactionService transactionService;
    @Autowired TransactionTemplate transactionTemplate;
    @Autowired Fixtures fixtures;
    @Autowired EntityManager entityManager;
    @Autowired JdbcTemplate jdbc;

    final UUID id = UUID.randomUUID();
    User owner;
    UUID ledgerId;
    UUID cash;

    @BeforeEach
    void setUp() {
        owner = fixtures.user("read-race-owner@example.com");
        ledgerId = fixtures.personalLedgerId(owner);
        cash = fixtures.account(owner, ledgerId, "현금", AccountType.CASH, 0, DAY).getId();
        transactionService.create(owner.getId(), ledgerId, expense(12_000), DEVICE);
    }

    /** 참조하는 쪽부터 지운다. 라인은 거래를 지우면 같이 지워진다. */
    @AfterEach
    void removeCommittedData() {
        Stream.of("change_log", "transaction", "account", "category", "ledger_member").forEach(table ->
                jdbc.update("delete from " + table + " where ledger_id = ?", ledgerId));
        jdbc.update("delete from ledger where id = ?", ledgerId);
        jdbc.update("delete from users where id = ?", owner.getId());
    }

    // ---------------------------------------------------------------- 재전송 판정

    /** 완전 삭제는 휴지통에서 한다(version 2 이상). 고쳐진 거래라 내용을 비교하지 않는 줄이다. */
    @RepeatedTest(20)
    void 휴지통의_거래를_재전송_판정하는_사이_완전히_지워지면_쓸_수_없는_id다() {
        transactionService.delete(owner.getId(), id, 1, DEVICE);

        CompletableFuture<CreateResult> resent = readWhile(this::purge, this::resend);

        assertThat(outcome(resent)).isInstanceOfSatisfying(IdConflictException.class,
                conflict -> assertThat(conflict.current()).isEmpty());
    }

    /** 고친 적 없는 거래(version 1)는 내용을 비교하는 줄이다. 비교할 라인이 비어 내용이 다르다고 보면 안 된다. */
    @RepeatedTest(20)
    void 고친_적_없는_거래를_재전송_판정하는_사이_완전히_지워지면_쓸_수_없는_id다() {
        CompletableFuture<CreateResult> resent = readWhile(this::purge, this::resend);

        assertThat(outcome(resent)).isInstanceOfSatisfying(IdConflictException.class,
                conflict -> assertThat(conflict.current()).isEmpty());
    }

    @RepeatedTest(20)
    void 재전송_판정하는_사이_고쳐지면_고친_거래로_답한다() {
        CompletableFuture<CreateResult> resent = readWhile(this::update, this::resend);

        TransactionView updated = stored();
        assertThat(updated.version()).isEqualTo(2);
        assertThat(outcome(resent)).isEqualTo(new CreateResult(updated, false));
    }

    // ---------------------------------------------------------------- 조회

    @RepeatedTest(20)
    void 조회하는_사이_완전히_지워지면_없는_거래다() {
        transactionService.delete(owner.getId(), id, 1, DEVICE);

        CompletableFuture<TransactionView> read = readWhile(this::purge, this::stored);

        assertThat(outcome(read)).isInstanceOf(NotFoundException.class);
    }

    @RepeatedTest(20)
    void 조회하는_사이_고쳐지면_고친_거래를_준다() {
        CompletableFuture<TransactionView> read = readWhile(this::update, this::stored);

        TransactionView updated = stored();
        assertThat(updated.version()).isEqualTo(2);
        assertThat(outcome(read)).isEqualTo(updated);
    }

    // ---------------------------------------------------------------- 도우미

    /**
     * 라인 표를 잠근 트랜잭션에서 change를 하고, 커밋하기 전에 다른 스레드에서 read를 시작한다. read가 그 잠금을 기다리게
     * 된 것을 본 뒤 커밋한다.
     */
    private <T> CompletableFuture<T> readWhile(Runnable change, Supplier<T> read) {
        return transactionTemplate.execute(status -> {
            jdbc.execute("lock table transaction_line in access exclusive mode");
            change.run();
            entityManager.flush();
            CompletableFuture<T> reading = CompletableFuture.supplyAsync(read)
                    .orTimeout(2 * TIMEOUT.toSeconds(), TimeUnit.SECONDS);
            // 같은 스레드에서 물어야 이 트랜잭션의 연결(pg_backend_pid)을 기준으로 본다.
            await().pollInSameThread().atMost(TIMEOUT).until(() -> jdbc.queryForObject("""
                    select exists (select 1 from pg_locks
                                    where not granted and pg_backend_pid() = any (pg_blocking_pids(pid)))
                    """, Boolean.class));
            return reading;
        });
    }

    private void purge() {
        fixtures.purge(id, owner.getId());
    }

    /** 금액을 고친다. 라인이 통째로 바뀌고 version이 2가 된다. */
    private void update() {
        transactionService.update(owner.getId(), id, 1, expense(15_000), DEVICE);
    }

    /** 처음 만든 것과 같은 요청을 다시 보낸다. */
    private CreateResult resend() {
        return transactionService.createOrReplay(owner.getId(), ledgerId, expense(12_000), DEVICE);
    }

    private TransactionView stored() {
        return transactionService.get(owner.getId(), id);
    }

    private Entry expense(long amount) {
        return new Entry(id, TransactionType.EXPENSE, DAY, null, cash, null, amount, false, "김밥천국", null, null);
    }

    /** 받은 값이나 던진 예외. 실패 메시지에 실제로 받은 답이 보이게 한다. */
    private static Object outcome(CompletableFuture<?> future) {
        try {
            return future.join();
        } catch (CompletionException e) {
            return e.getCause();
        }
    }
}
