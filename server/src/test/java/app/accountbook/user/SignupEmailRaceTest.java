package app.accountbook.user;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.awaitility.Awaitility.await;

import app.accountbook.common.DuplicateEmailException;
import app.accountbook.support.IntegrationTest;
import java.time.Duration;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 동시 가입: 두 가입이 모두 "같은 이메일 없음"을 본 뒤 저장하는 경우.
 * 먼저 온 가입을 커밋하지 않은 채 두고, 나중 가입이 유일 제약(users_email_key)에서 그 끝을 기다리는 것을 확인한 뒤 커밋한다.
 * 두 트랜잭션이 실제로 커밋하고 롤백해야 하므로 테스트 트랜잭션 없이 돌고, 커밋된 가입은 끝에 지운다.
 */
@IntegrationTest
@Transactional(propagation = Propagation.NOT_SUPPORTED)
class SignupEmailRaceTest {

    private static final String EMAIL = "race@example.com";
    private static final List<String> TABLES = List.of("users", "ledger", "ledger_member", "category");

    @Autowired UserService userService;
    @Autowired JdbcTemplate jdbc;
    @Autowired TransactionTemplate transactionTemplate;

    @AfterEach
    void deleteCommittedSignup() {
        List<UUID> ledgerIds = jdbc.queryForList("""
                select m.ledger_id from ledger_member m join users u on u.id = m.user_id where u.email = ?
                """, UUID.class, EMAIL);
        ledgerIds.forEach(ledgerId -> {
            jdbc.update("delete from category where ledger_id = ?", ledgerId);
            jdbc.update("delete from ledger_member where ledger_id = ?", ledgerId);
            jdbc.update("delete from ledger where id = ?", ledgerId);
        });
        jdbc.update("delete from users where email = ?", EMAIL);
    }

    @Test
    @Timeout(60)
    void createUser_letsOnlyOneOfTwoOverlappingSignupsSucceed() {
        List<Long> before = rowCounts();
        try (ExecutorService executor = Executors.newSingleThreadExecutor()) {
            Future<User> second = transactionTemplate.execute(status -> {
                userService.createUser(EMAIL, "password1", "먼저");
                Future<User> overlapping = executor.submit(
                        () -> userService.createUser(" RACE@Example.com ", "password2", "나중"));
                awaitAnotherConnectionBlockedByThisTransaction();
                return overlapping;
            });

            // 여기서는 먼저 온 가입이 커밋된 뒤다.
            assertThatThrownBy(() -> second.get(10, TimeUnit.SECONDS))
                    .hasCauseExactlyInstanceOf(DuplicateEmailException.class);
        }

        assertThat(jdbc.queryForList("select display_name from users where email = ?", String.class, EMAIL))
                .containsExactly("먼저");
        // 먼저 온 가입의 사용자, 장부, 구성원, 카테고리 17개만 늘었다. 나중 가입은 아무것도 남기지 않는다.
        assertThat(rowCounts()).containsExactly(
                before.get(0) + 1, before.get(1) + 1, before.get(2) + 1, before.get(3) + 17);
    }

    /**
     * 나중 가입이 앱의 중복 확인을 지나 INSERT까지 와서 이 트랜잭션의 끝을 기다린다는 뜻이다.
     * 중복 확인은 읽기라 기다리지 않는다. pg_locks는 트랜잭션 안에서도 매번 지금 상태를 읽는다(pg_stat_activity와 다르다).
     */
    private void awaitAnotherConnectionBlockedByThisTransaction() {
        await().pollInSameThread().pollInterval(Duration.ofMillis(20)).atMost(Duration.ofSeconds(10))
                .until(() -> jdbc.queryForObject("""
                        select exists (select 1 from pg_locks
                                        where not granted and pg_backend_pid() = any (pg_blocking_pids(pid)))
                        """, Boolean.class));
    }

    private List<Long> rowCounts() {
        return TABLES.stream()
                .map(table -> jdbc.queryForObject("select count(*) from " + table, Long.class))
                .toList();
    }
}
