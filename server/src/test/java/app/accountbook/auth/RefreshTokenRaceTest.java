package app.accountbook.auth;

import static app.accountbook.auth.RefreshTokenRows.familyOf;
import static app.accountbook.auth.RefreshTokenRows.tokenId;
import static org.assertj.core.api.Assertions.assertThat;
import static org.awaitility.Awaitility.await;

import app.accountbook.support.IntegrationTest;
import app.accountbook.support.StoppedClockConfig;
import app.accountbook.support.StoppedClockConfig.StoppedClock;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import java.util.concurrent.CompletableFuture;
import java.util.concurrent.TimeUnit;
import java.util.function.Supplier;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 회전과 폐기가 겹쳐도 폐기 뒤에 쓸 수 있는 토큰이 남지 않는다(#26, security 기준). 한쪽이 계열 행을 잠근 채 커밋하지 않은
 * 사이 다른 스레드가 같은 계열에 닿고, 그 스레드가 이 트랜잭션을 기다리는 것을 pg_locks로 본 뒤 커밋한다. 두 트랜잭션이
 * 실제로 커밋해야 하므로 테스트 트랜잭션 없이 돌고 커밋한 행은 끝에 지운다.
 * 준비: 지금 토큰 {@code current}, 허용 시간이 지나 다시 오면 재사용인 {@code rotated}, 같은 사용자의 다른 기기 계열.
 */
@IntegrationTest
@Import(StoppedClockConfig.class)
@Transactional(propagation = Propagation.NOT_SUPPORTED)
@Timeout(60)
class RefreshTokenRaceTest {

    private static final Instant NOW = Instant.parse("2030-01-01T00:01:00Z");
    private static final Duration TIMEOUT = Duration.ofSeconds(10);

    @Autowired RefreshTokenService service;
    @Autowired StoppedClock clock;
    @Autowired JdbcTemplate jdbc;
    @Autowired TransactionTemplate transactionTemplate;

    private UUID userId;
    private IssuedRefreshToken rotated;
    private IssuedRefreshToken current;
    private IssuedRefreshToken otherDevice;

    @BeforeEach
    void setUp() {
        clock.stopAt(NOW.minusSeconds(60));
        userId = RefreshTokenRows.insertUser(jdbc);
        rotated = service.issue(userId);
        current = service.rotate(rotated.value()).orElseThrow();
        otherDevice = service.issue(userId);
        clock.stopAt(NOW);
    }

    @AfterEach
    void deleteCommittedRows() {
        RefreshTokenRows.deleteUser(jdbc, userId);
    }

    /** security 기준의 (가) 비밀번호 바꾸기의 다른 계열 폐기, (나) 로그아웃, (다) 재사용 감지. */
    enum Revocation {
        OTHERS_ON_PASSWORD_CHANGE, LOGOUT, REUSE_DETECTED;

        Object run(RefreshTokenRaceTest test) {
            switch (this) {
                case OTHERS_ON_PASSWORD_CHANGE -> test.service.revokeOthers(test.userId, test.otherDevice.value());
                case LOGOUT -> test.service.revokeFamily(test.current.value());
                case REUSE_DETECTED -> test.service.rotate(test.rotated.value());
            }
            return null;
        }
    }

    @ParameterizedTest
    @EnumSource
    void 회전이_잠근_사이_온_폐기는_회전이_커밋된_뒤_폐기하고_회전이_준_토큰도_거부된다(Revocation revocation) {
        IssuedRefreshToken[] next = new IssuedRefreshToken[1];

        whileLocked(() -> next[0] = service.rotate(current.value()).orElseThrow(), () -> revocation.run(this), () -> { });

        assertThat(familyOf(jdbc, current.value()).get("revoked_at")).isNotNull();
        assertThat(service.rotate(next[0].value())).isEmpty();
        assertThat(service.rotate(otherDevice.value())).as("다른 기기의 계열은 어느 폐기에도 남는다").isPresent();
    }

    @ParameterizedTest
    @EnumSource
    void 폐기가_잠근_사이_온_회전은_폐기가_커밋된_뒤_아무것도_만들지_않는다(Revocation revocation) {
        Optional<IssuedRefreshToken> result =
                whileLocked(() -> revocation.run(this), () -> service.rotate(current.value()), () -> { });

        assertThat(result).isEmpty();
        assertThat(jdbc.queryForObject("select count(*) from refresh_token where family_id = ?", Long.class,
                familyOf(jdbc, current.value()).get("id"))).as("처음 발급과 회전의 두 토큰뿐이다").isEqualTo(2);
    }

    /**
     * 먼저 잠근 갱신이 회전하고, 기다린 갱신은 5초 뒤(허용 시간 안)에 그 결과를 보고 재발급을 받는다. 회전은 한 번이라
     * 회전 시각과 바로 앞 토큰은 먼저 온 갱신의 것이고, 지금 토큰은 기다린 갱신이 받은 것이다.
     */
    @Test
    void 같은_값으로_겹친_두_갱신은_하나만_회전하고_다른_하나는_같은_계열의_새_토큰을_받는다() {
        IssuedRefreshToken[] first = new IssuedRefreshToken[1];

        IssuedRefreshToken second = whileLocked(() -> first[0] = service.rotate(current.value()).orElseThrow(),
                () -> service.rotate(current.value()), () -> clock.stopAt(NOW.plusSeconds(5))).orElseThrow();

        assertThat(second.userId()).isEqualTo(userId);
        assertThat(second.value()).isNotEqualTo(first[0].value());
        var family = familyOf(jdbc, second.value());
        assertThat(family.get("id")).isEqualTo(familyOf(jdbc, current.value()).get("id"));
        assertThat(((Timestamp) family.get("rotated_at")).toInstant()).isEqualTo(NOW);
        assertThat(family).containsEntry("previous_token_id", tokenId(jdbc, current.value()))
                .containsEntry("current_token_id", tokenId(jdbc, second.value()));
    }

    /**
     * locking을 한 트랜잭션에서 하고, 커밋하기 전에 다른 스레드에서 waiting을 시작한다. waiting이 이 트랜잭션의 잠금을
     * 기다리는 것을 본 뒤 beforeCommit을 하고 커밋한다. pg_locks는 같은 스레드에서 물어야 이 연결을 기준으로 본다.
     */
    private <T> T whileLocked(Runnable locking, Supplier<T> waiting, Runnable beforeCommit) {
        CompletableFuture<T> started = transactionTemplate.execute(status -> {
            locking.run();
            CompletableFuture<T> future = CompletableFuture.supplyAsync(waiting);
            await().pollInSameThread().pollInterval(Duration.ofMillis(20)).atMost(TIMEOUT)
                    .until(() -> jdbc.queryForObject("""
                            select exists (select 1 from pg_locks
                                            where not granted and pg_backend_pid() = any (pg_blocking_pids(pid)))
                            """, Boolean.class));
            beforeCommit.run();
            return future;
        });
        return started.orTimeout(TIMEOUT.toSeconds(), TimeUnit.SECONDS).join();
    }
}
