package app.accountbook.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.awaitility.Awaitility.await;

import app.accountbook.common.FieldErrorCode;
import app.accountbook.common.InvalidRequestException;
import app.accountbook.support.IntegrationTest;
import app.accountbook.user.PasswordChange;
import app.accountbook.user.UserService;
import java.time.Duration;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 비밀번호 바꾸기(FOR NO KEY UPDATE)와 로그인(FOR SHARE)이 사용자 행을 잠그고 저장값을 다시 본다(#31, ADR 001 결정 7).
 * 실제로 커밋해야 하므로 테스트 트랜잭션 없이 돌고 커밋한 행은 끝에 지운다.
 */
@IntegrationTest
@Transactional(propagation = Propagation.NOT_SUPPORTED)
@Timeout(60)
class PasswordChangeRaceTest {

    private static final String PASSWORD = "password1";
    /** PASSWORD의 저장값(LoginTest와 같다). */
    private static final String STORED = "$argon2id$v=19$m=256,t=1,p=1$YWNjb3VudC1ib29rLXRzdA"
            + "$vHygWA0jNvBLxOELjrkU6R1OAPyuN/Ro9FrihcYD2KI";
    private static final Duration TIMEOUT = Duration.ofSeconds(10);
    /** 이 트랜잭션을 기다리는 연결이 있다. 아래는 그 연결을 또 기다리는 연결이 있다. */
    private static final String BLOCKED_BY_THIS = """
            select exists (select 1 from pg_locks where not granted and pg_backend_pid() = any (pg_blocking_pids(pid)))
            """;
    private static final String BLOCKED_BY_WAITER = """
            select exists (select 1 from pg_locks w join pg_locks c on c.pid = any (pg_blocking_pids(w.pid))
                            where not w.granted and not c.granted and pg_backend_pid() = any (pg_blocking_pids(c.pid)))
            """;

    @Autowired PasswordChangeService passwordChangeService;
    @Autowired UserService userService;
    @Autowired LoginService loginService;
    @Autowired RefreshTokenService refreshTokens;
    @Autowired JdbcTemplate jdbc;
    @Autowired TransactionTemplate transactionTemplate;

    private final UUID userId = UUID.randomUUID();
    private final String email = "marker-password-race-" + userId + "@example.com";
    private CompletableFuture<Void> change;
    private CompletableFuture<LoginTokens> login;

    @BeforeEach
    void insertUser() {
        jdbc.update("insert into users (id, email, password_hash, display_name, created_at) values (?, ?, ?, 'race', now())",
                userId, email, STORED);
    }

    /** 다른 스레드가 끝난 뒤 지운다. 남은 스레드가 잠금을 쥐면 다른 테스트가 멈춘다. */
    @AfterEach
    void deleteCommittedRows() {
        for (CompletableFuture<?> running : new CompletableFuture<?>[] {change, login}) {
            if (running != null) {
                running.handle((result, error) -> null).orTimeout(TIMEOUT.toSeconds(), TimeUnit.SECONDS).join();
            }
        }
        RefreshTokenRows.deleteUser(jdbc, userId);
    }

    /**
     * security 권고(#31). 테스트가 계열 표를 잠가 먼저 잠근 쪽을 계열 쓰기에, 다른 쪽을 사용자 행 잠금에 세운 뒤 놓는다.
     * 바꾸기가 먼저면 옛 저장값으로 확인을 마친 로그인이 실패하고, 로그인이 먼저면 바꾸기가 그 계열까지 폐기한다.
     */
    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void 바꾸는_중에_끝난_옛_비밀번호_로그인의_계열은_남지_않는다(boolean loginLocksFirst) {
        IssuedRefreshToken here = refreshTokens.issue(userId);

        transactionTemplate.executeWithoutResult(status -> {
            jdbc.execute("lock table refresh_token_family in share mode");
            if (loginLocksFirst) {
                login = CompletableFuture.supplyAsync(() -> loginService.login(email, PASSWORD, null));
            } else {
                change = CompletableFuture.runAsync(() -> changePassword(here));
            }
            awaitTrue(BLOCKED_BY_THIS);
            if (loginLocksFirst) {
                change = CompletableFuture.runAsync(() -> changePassword(here));
            } else {
                login = CompletableFuture.supplyAsync(() -> loginService.login(email, PASSWORD, null));
            }
            awaitTrue(BLOCKED_BY_WAITER);
        });

        change.orTimeout(TIMEOUT.toSeconds(), TimeUnit.SECONDS).join();
        login.orTimeout(TIMEOUT.toSeconds(), TimeUnit.SECONDS).handle((tokens, error) -> null).join();
        if (loginLocksFirst) {
            assertThat(login.join().refreshToken().userId()).isEqualTo(userId);
        } else {
            assertThatThrownBy(login::join).hasCauseInstanceOf(InvalidCredentialsException.class);
        }
        assertThat(jdbc.queryForList("select id from refresh_token_family where user_id = ? and revoked_at is null",
                UUID.class, userId)).as("지금 기기의 계열만 남는다").containsExactly(
                (UUID) RefreshTokenRows.familyOf(jdbc, here.value()).get("id"));
    }

    /** 같은 사용자가 두 기기에서 거의 같이 바꾼 경우다. 확인할 때 본 저장값이 그대로인지 잠근 뒤 다시 본다(ADR 001 결정 7). */
    @Test
    void 확인한_뒤_다른_바꾸기가_커밋됐으면_현재_비밀번호_오류이고_저장하지_않는다() {
        PasswordChange late = userService.checkPasswordChange(userId, PASSWORD, "password3");
        changePassword(refreshTokens.issue(userId));
        String stored = jdbc.queryForObject("select password_hash from users where id = ?", String.class, userId);

        assertThatThrownBy(() -> transactionTemplate.executeWithoutResult(status -> userService.changePassword(late)))
                .isInstanceOfSatisfying(InvalidRequestException.class, e -> {
                    assertThat(e.field()).isEqualTo("currentPassword");
                    assertThat(e.code()).isEqualTo(FieldErrorCode.INCORRECT);
                });
        assertThat(jdbc.queryForObject("select password_hash from users where id = ?", String.class, userId))
                .isEqualTo(stored);
    }

    private void changePassword(IssuedRefreshToken here) {
        passwordChangeService.changePassword(userId, PASSWORD, "password2", here.value());
    }

    /** 같은 스레드에서 물어야 이 트랜잭션의 연결을 기준으로 본다. */
    private void awaitTrue(String sql) {
        await().pollInSameThread().pollInterval(Duration.ofMillis(20)).atMost(TIMEOUT)
                .until(() -> jdbc.queryForObject(sql, Boolean.class));
    }
}
