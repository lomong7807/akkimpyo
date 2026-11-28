package app.accountbook.category;

import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;

import app.accountbook.account.AccountType;
import app.accountbook.common.FieldErrorCode;
import app.accountbook.common.InvalidRequestException;
import app.accountbook.common.NotLedgerMemberException;
import app.accountbook.support.Fixtures;
import app.accountbook.support.IntegrationTest;
import app.accountbook.transaction.ChangeAction;
import app.accountbook.transaction.TransactionCommand.Entry;
import app.accountbook.transaction.TransactionService;
import app.accountbook.transaction.TransactionType;
import app.accountbook.transaction.TransactionView;
import app.accountbook.user.User;
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
 * 카테고리를 지우는 사이 그 카테고리로 거래가 들어오는 경우(#3). 지우는 쪽은 카테고리를 FOR UPDATE로, 거래 쓰기는 FOR KEY SHARE로
 * 먼저 잠가 나중 쪽이 앞 쪽의 커밋을 기다린다. 두 트랜잭션이 실제로 겹쳐야 하므로 테스트 트랜잭션 없이 돌고, 커밋한 데이터는 끝날 때
 * 지운다(TransactionReadRaceTest와 같다).
 */
@IntegrationTest
@Transactional(propagation = Propagation.NOT_SUPPORTED)
class CategoryDeleteRaceTest {

    static final LocalDate DAY = LocalDate.of(2026, 11, 18);
    static final Duration TIMEOUT = Duration.ofSeconds(10);
    static final String DEVICE = "iphone.safari";

    @Autowired CategoryService categoryService;
    @Autowired TransactionService transactionService;
    @Autowired TransactionTemplate transactionTemplate;
    @Autowired Fixtures fixtures;
    @Autowired JdbcTemplate jdbc;

    User owner;
    UUID ledgerId;
    UUID cash;
    UUID food;
    UUID uncategorized;

    @BeforeEach
    void setUp() {
        owner = fixtures.user("category-race-owner@example.com");
        ledgerId = fixtures.personalLedgerId(owner);
        cash = fixtures.account(owner, ledgerId, "현금", AccountType.CASH, 0, DAY).getId();
        food = categoryService.create(owner.getId(), ledgerId,
                new CategoryCommand("식비", CategoryKind.EXPENSE, null)).getId();
        uncategorized = categoryService.uncategorized(ledgerId, CategoryKind.EXPENSE).getId();
    }

    /** 참조하는 쪽부터 지운다. 라인은 거래를 지우면 같이 지워진다. */
    @AfterEach
    void removeCommittedData() {
        Stream.of("change_log", "transaction", "account", "category", "ledger_member").forEach(table ->
                jdbc.update("delete from " + table + " where ledger_id = ?", ledgerId));
        jdbc.update("delete from ledger where id = ?", ledgerId);
        jdbc.update("delete from users where id = ?", owner.getId());
    }

    @Test
    void 지우는_사이_그_카테고리로_만드는_거래는_삭제를_기다렸다가_없는_카테고리로_거부된다() {
        UUID id = UUID.randomUUID();

        CompletableFuture<TransactionView> creating = whileUncommitted(
                () -> categoryService.delete(owner.getId(), ledgerId, food, null, DEVICE), () -> create(id));

        assertThat(outcome(creating)).isInstanceOfSatisfying(InvalidRequestException.class, error -> {
            assertThat(error.field()).isEqualTo("categoryId");
            assertThat(error.code()).isEqualTo(FieldErrorCode.NOT_FOUND);
        });
        assertThat(count("select count(*) from transaction where id = ?", id)).isZero();
        assertThat(count("select count(*) from category where id = ?", food)).isZero();
    }

    @Test
    void 만들고_커밋하기_전인_거래가_있으면_삭제가_기다렸다가_그_거래도_옮긴다() {
        UUID id = UUID.randomUUID();

        CompletableFuture<Void> deleting = whileUncommitted(() -> create(id),
                () -> {
                    categoryService.delete(owner.getId(), ledgerId, food, null, DEVICE);
                    return null;
                });

        assertThat(outcome(deleting)).isNull();
        assertThat(jdbc.queryForObject("select category_id from transaction_line where transaction_id = ?",
                UUID.class, id)).isEqualTo(uncategorized);
        assertThat(jdbc.queryForList("select action from change_log where transaction_id = ? order by version",
                String.class, id)).containsExactly(ChangeAction.CREATE.name(), ChangeAction.CATEGORY_MOVE.name());
        assertThat(count("select version from transaction where id = ?", id)).isEqualTo(2);
    }

    /**
     * 이름 바꾸기는 카테고리를 잠그지 않고 읽어, 지우는 중인 카테고리도 읽은 뒤 저장(UPDATE)에서 삭제의 커밋을 기다린다. 그때 0행이
     * 되는 것을 500이 아니라 지운 카테고리와 같은 예외(404)로 알린다(#35, PR #370 architect 후속).
     */
    @Test
    void 지우는_사이_이름을_바꾸면_삭제를_기다렸다가_지운_카테고리와_같이_거부된다() {
        CompletableFuture<Category> renaming = whileUncommitted(
                () -> categoryService.delete(owner.getId(), ledgerId, food, null, DEVICE),
                () -> categoryService.rename(owner.getId(), ledgerId, food, "외식"));

        assertThat(outcome(renaming)).isExactlyInstanceOf(NotLedgerMemberException.class);
        assertThat(count("select count(*) from category where id = ?", food)).isZero();
    }

    // ---------------------------------------------------------------- 도우미

    private TransactionView create(UUID id) {
        return transactionService.create(owner.getId(), ledgerId, new Entry(id, TransactionType.EXPENSE, DAY, null,
                cash, food, 12_000, null, null, null, null), DEVICE);
    }

    /**
     * 한 트랜잭션에서 change를 하고, 커밋하기 전에 다른 스레드에서 other를 시작한다. other가 그 트랜잭션의 잠금을 기다리게 된
     * 것을 본 뒤 커밋한다.
     */
    private <T> CompletableFuture<T> whileUncommitted(Runnable change, Supplier<T> other) {
        return transactionTemplate.execute(status -> {
            change.run();
            CompletableFuture<T> waiting = CompletableFuture.supplyAsync(other)
                    .orTimeout(2 * TIMEOUT.toSeconds(), TimeUnit.SECONDS);
            // 같은 스레드에서 물어야 이 트랜잭션의 연결(pg_backend_pid)을 기준으로 본다.
            await().pollInSameThread().atMost(TIMEOUT).until(() -> jdbc.queryForObject("""
                    select exists (select 1 from pg_locks
                                    where not granted and pg_backend_pid() = any (pg_blocking_pids(pid)))
                    """, Boolean.class));
            return waiting;
        });
    }

    /** 끝난 결과. 실패했으면 그 예외다. */
    private static Object outcome(CompletableFuture<?> future) {
        try {
            return future.join();
        } catch (CompletionException e) {
            return e.getCause();
        }
    }

    private long count(String sql, UUID id) {
        return jdbc.queryForObject(sql, Long.class, id);
    }
}
