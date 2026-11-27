package app.accountbook.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.awaitility.Awaitility.await;

import app.accountbook.support.IntegrationTest;
import java.sql.SQLException;
import java.time.Duration;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.CompletionException;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.springframework.beans.factory.annotation.Autowired;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 로그인이 계열을 만드는 트랜잭션은 사용자 행을 FOR SHARE로 잠그고 확인한 저장값을 다시 본다(ADR 001 결정 7, dba와 정함).
 * 비밀번호 바꾸기(#31)는 아직 없어, 같은 잠금(FOR NO KEY UPDATE)과 UPDATE를 테스트 트랜잭션이 직접 한다. 두 트랜잭션이
 * 실제로 커밋해야 하므로 테스트 트랜잭션 없이 돌고 커밋한 행은 끝에 지운다.
 */
@IntegrationTest
@Transactional(propagation = Propagation.NOT_SUPPORTED)
@Timeout(60)
class LoginRaceTest {

    private static final String PASSWORD = "password1";
    /** PASSWORD의 저장값(LoginTest와 같다). */
    private static final String STORED = "$argon2id$v=19$m=256,t=1,p=1$YWNjb3VudC1ib29rLXRzdA"
            + "$vHygWA0jNvBLxOELjrkU6R1OAPyuN/Ro9FrihcYD2KI";
    private static final Duration TIMEOUT = Duration.ofSeconds(10);

    @Autowired LoginService loginService;
    @Autowired RefreshTokenService refreshTokens;
    @Autowired JdbcTemplate jdbc;
    @Autowired TransactionTemplate transactionTemplate;

    private final UUID userId = UUID.randomUUID();
    /** 테스트마다 다르게 해, 한 테스트가 남긴 행이 다음 테스트의 준비를 막지 않게 한다. */
    private final String email = "marker-login-race-" + userId + "@example.com";
    /** 다른 스레드의 로그인. 테스트가 중간에 실패해도 끝을 기다린 뒤 지운다. */
    private CompletableFuture<LoginTokens> login;

    @BeforeEach
    void insertUser() {
        jdbc.update("insert into users (id, email, password_hash, display_name, created_at) values (?, ?, ?, 'race', now())",
                userId, email, STORED);
    }

    @AfterEach
    void deleteCommittedRows() {
        if (login != null) {
            login.handle((tokens, error) -> null).orTimeout(TIMEOUT.toSeconds(), TimeUnit.SECONDS).join();
        }
        RefreshTokenRows.deleteUser(jdbc, userId);
    }

    @Test
    void 확인한_뒤_비밀번호가_바뀌어_커밋되면_로그인은_실패하고_아무것도_폐기하거나_만들지_않는다() {
        IssuedRefreshToken cookie = refreshTokens.issue(userId);

        transactionTemplate.executeWithoutResult(status -> {
            jdbc.queryForObject("select id from users where id = ? for no key update", UUID.class, userId);
            jdbc.update("update users set password_hash = 'changed' where id = ?", userId);
            // 로그인은 커밋 전의 저장값으로 확인을 통과한 뒤 사용자 행 잠금에서 기다린다.
            login = CompletableFuture.supplyAsync(() -> loginService.login(email, PASSWORD, cookie.value()));
            awaitAnotherConnectionBlockedByThisTransaction();
        });

        assertThatThrownBy(() -> login.orTimeout(TIMEOUT.toSeconds(), TimeUnit.SECONDS).join())
                .isInstanceOf(CompletionException.class).hasCauseInstanceOf(InvalidCredentialsException.class);
        assertThat(jdbc.queryForObject("select count(*) from refresh_token_family where user_id = ?", Long.class, userId))
                .isOne();
        assertThat(refreshTokens.rotate(cookie.value())).as("실패한 로그인은 쿠키의 계열을 폐기하지 않는다").isPresent();
    }

    /** 사용자 행 잠금은 계열을 넣는 같은 트랜잭션에서 잡아 커밋까지 쥔다. 계열 표를 막아 로그인을 그 INSERT에 세워 두고 본다. */
    @Test
    void 로그인은_사용자_행_잠금을_계열을_넣을_때까지_쥔다() {
        transactionTemplate.executeWithoutResult(status -> {
            jdbc.execute("lock table refresh_token_family in share mode");
            login = CompletableFuture.supplyAsync(() -> loginService.login(email, PASSWORD, null));
            awaitAnotherConnectionBlockedByThisTransaction();
            jdbc.execute("savepoint probe");
            // 55P03 lock_not_available: 로그인이 쥔 FOR SHARE와 부딪힌다. 예외의 형은 번역기에 따라 달라 SQLSTATE로 본다.
            assertThatThrownBy(() -> jdbc.queryForObject(
                    "select id from users where id = ? for no key update nowait", UUID.class, userId))
                    .rootCause().isInstanceOfSatisfying(SQLException.class,
                            cause -> assertThat(cause.getSQLState()).isEqualTo("55P03"));
            jdbc.execute("rollback to savepoint probe");
        });

        assertThat(login.orTimeout(TIMEOUT.toSeconds(), TimeUnit.SECONDS).join().refreshToken().userId())
                .isEqualTo(userId);
    }

    /** 다른 연결이 이 트랜잭션이 쥔 잠금을 기다린다. 같은 스레드에서 물어야 이 트랜잭션의 연결을 기준으로 본다. */
    private void awaitAnotherConnectionBlockedByThisTransaction() {
        await().pollInSameThread().pollInterval(Duration.ofMillis(20)).atMost(TIMEOUT)
                .until(() -> jdbc.queryForObject("""
                        select exists (select 1 from pg_locks
                                        where not granted and pg_backend_pid() = any (pg_blocking_pids(pid)))
                        """, Boolean.class));
    }
}
