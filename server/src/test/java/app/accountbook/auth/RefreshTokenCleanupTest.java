package app.accountbook.auth;

import static app.accountbook.auth.RefreshTokenRows.familyOf;
import static app.accountbook.auth.RefreshTokenRows.sha256;
import static java.time.Duration.ofDays;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatNoException;

import app.accountbook.support.CapturedLogs;
import app.accountbook.support.IntegrationTest;
import app.accountbook.support.StoppedClockConfig;
import app.accountbook.support.StoppedClockConfig.StoppedClock;
import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.spi.ILoggingEvent;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.Base64;
import java.util.HexFormat;
import java.util.List;
import java.util.UUID;
import java.util.stream.IntStream;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.transaction.CannotCreateTransactionException;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.TransactionStatus;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 절대 만료가 지난 refresh token 계열의 매일 정리(#132, ADR 001 결정 3). 절대 만료는 계열의 시작(처음 로그인)부터 180일이고
 * 그 시각부터 갱신이 거부된다. 정리도 그 시각부터 대상으로 본다. 만료되거나 폐기된 계열도 절대 만료 전이면 재사용 감지에
 * 쓰이므로 남긴다. 로그인 시각은 다른 테스트가 커밋한 계열(2026년 이후)과 겹치지 않게 2021년으로 둔다.
 */
@IntegrationTest
@Import(StoppedClockConfig.class)
class RefreshTokenCleanupTest {

    private static final Instant LOGIN = Instant.parse("2021-01-10T03:00:00Z"); // 서울 12:00
    private static final Instant ABSOLUTE_EXPIRY = LOGIN.plus(ofDays(180));
    private static final Duration MICRO = Duration.of(1, ChronoUnit.MICROS);
    private static final int BATCH = RefreshTokenCleanup.BATCH_SIZE;

    @Autowired RefreshTokenCleanup cleanup;
    @Autowired RefreshTokenService service;
    @Autowired StoppedClock clock;
    @Autowired JdbcTemplate jdbc;
    @Autowired JdbcClient jdbcClient;

    private UUID userId;

    @BeforeEach
    void setUp() {
        clock.stopAt(LOGIN);
        userId = RefreshTokenRows.insertUser(jdbc);
    }

    @Test
    void 절대_만료_직전에는_계열과_토큰을_남기고_직후에는_지운다() {
        IssuedRefreshToken first = service.issue(userId);
        clock.stopAt(LOGIN.plus(ofDays(29)));
        IssuedRefreshToken second = service.rotate(first.value()).orElseThrow();
        UUID family = familyId(first);
        assertThat(((Timestamp) familyOf(jdbc, second.value()).get("absolute_expires_at")).toInstant())
                .as("처음 로그인부터 180일이고 회전해도 그대로다").isEqualTo(ABSOLUTE_EXPIRY);

        cleanup.deleteExpired(ABSOLUTE_EXPIRY.minus(MICRO), BATCH);
        assertThat(familyExists(family)).as("직전").isTrue();
        assertThat(tokenCount(family)).as("직전, 처음 토큰과 회전한 토큰").isEqualTo(2);

        cleanup.deleteExpired(ABSOLUTE_EXPIRY.plus(MICRO), BATCH);
        assertThat(familyExists(family)).as("직후").isFalse();
        assertThat(tokenCount(family)).as("직후").isZero();
        assertThat(jdbc.queryForObject("select count(*) from users where id = ?", Integer.class, userId))
                .as("사용자는 지우지 않는다").isOne();
    }

    /** 갱신이 거부되기 시작하는 시각(절대 만료)과 정리 대상이 되는 시각이 같다. */
    @Test
    void 정확히_절대_만료_시각부터_대상이고_그_시각부터_갱신도_거부된다() {
        IssuedRefreshToken token = service.issue(userId);
        UUID family = familyId(token);
        clock.stopAt(ABSOLUTE_EXPIRY);
        assertThat(service.rotate(token.value())).isEmpty();

        cleanup.deleteExpired(ABSOLUTE_EXPIRY, BATCH);

        assertThat(familyExists(family)).isFalse();
        assertThat(service.rotate(token.value())).as("지운 뒤에도 거부").isEmpty();
    }

    /**
     * 30일 동안 갱신하지 않아 만료된 계열, 로그아웃으로 폐기된 계열, 재사용 감지로 폐기된 계열은 절대 만료 전이면 남는다.
     * 같은 실행에서 절대 만료가 지난 계열(100일 일찍 로그인)은 지운다. 남은 만료 계열은 재사용 감지에 쓰인다.
     */
    @Test
    void 만료됐거나_폐기됐어도_절대_만료_전이면_남기고_재사용_감지에_쓰인다() {
        clock.stopAt(LOGIN.minus(ofDays(100)));
        UUID older = familyId(service.issue(userId));
        clock.stopAt(LOGIN);
        IssuedRefreshToken idleFirst = service.issue(userId);
        service.rotate(idleFirst.value()).orElseThrow();
        IssuedRefreshToken loggedOut = service.issue(userId);
        service.revokeFamily(loggedOut.value());
        IssuedRefreshToken reusedFirst = service.issue(userId);
        clock.stopAt(LOGIN.plusSeconds(60));
        service.rotate(reusedFirst.value()).orElseThrow();
        clock.stopAt(LOGIN.plusSeconds(120)); // 회전 직후 허용 시간(10초)이 지났다
        assertThat(service.rotate(reusedFirst.value())).as("재사용 감지로 폐기").isEmpty();
        assertThat(familyOf(jdbc, reusedFirst.value()).get("revoked_at")).isNotNull();
        List<UUID> kept = List.of(familyId(idleFirst), familyId(loggedOut), familyId(reusedFirst));

        Instant now = LOGIN.plus(ofDays(100));
        cleanup.deleteExpired(now, BATCH);

        assertThat(familyExists(older)).as("절대 만료가 지난 계열").isFalse();
        assertThat(kept).allSatisfy(family -> assertThat(familyExists(family)).isTrue());
        assertThat(tokenCount(kept.get(0)) + tokenCount(kept.get(1)) + tokenCount(kept.get(2))).isEqualTo(5);
        assertThat(familyOf(jdbc, loggedOut.value()).get("revoked_at")).isNotNull();

        clock.stopAt(now);
        assertThat(service.rotate(idleFirst.value())).as("만료된 계열의 회전된 토큰").isEmpty();
        assertThat(familyOf(jdbc, idleFirst.value()).get("revoked_at")).as("재사용으로 보고 계열을 폐기").isNotNull();
    }

    @Test
    void 정해진_계열_수씩_나눠_남김없이_지우고_두_번_돌아도_결과가_같다() {
        List<UUID> families = IntStream.range(0, 5).mapToObj(i -> familyId(service.issue(userId))).toList();

        RefreshTokenCleanup.Deleted deleted = cleanup.deleteExpired(ABSOLUTE_EXPIRY, 2);

        assertThat(families).noneMatch(this::familyExists);
        assertThat(deleted.families()).isGreaterThanOrEqualTo(5);
        assertThat(deleted.tokens()).isGreaterThanOrEqualTo(5);
        assertThat(cleanup.deleteExpired(ABSOLUTE_EXPIRY, 2)).isEqualTo(new RefreshTokenCleanup.Deleted(0, 0));
    }

    @Test
    void 매일_도는_작업은_지운_건수만_로그에_남기고_토큰_값_해시_사용자_id는_남기지_않는다() {
        IssuedRefreshToken first = service.issue(userId);
        IssuedRefreshToken second = service.rotate(first.value()).orElseThrow();
        UUID family = familyId(first);
        clock.stopAt(ABSOLUTE_EXPIRY);

        try (CapturedLogs logs = CapturedLogs.start()) {
            cleanup.run();

            assertThat(familyExists(family)).isFalse();
            assertThat(cleanupEvents(logs)).singleElement().satisfies(event -> {
                assertThat(event.getLevel()).isEqualTo(Level.INFO);
                assertThat(event.getFormattedMessage()).matches("refresh token cleanup: \\d+ families, \\d+ tokens");
            });
            assertThat(logs.text()).doesNotContain(userId.toString(), family.toString());
            for (IssuedRefreshToken token : new IssuedRefreshToken[] {first, second}) {
                byte[] hash = sha256(token.value());
                assertThat(logs.text()).doesNotContain(token.value(), HexFormat.of().formatHex(hash),
                        Base64.getEncoder().encodeToString(hash));
            }
        }
    }

    /** DB에 닿지 못해 정리가 실패해도 예외를 스케줄러 밖으로 내지 않고 로그만 남긴다. 로그인과 갱신은 그대로 된다. */
    @Test
    void 정리가_실패해도_예외를_내지_않고_로그를_남기며_로그인과_갱신은_계속_된다() {
        RefreshTokenCleanup failing = new RefreshTokenCleanup(jdbcClient, new TransactionTemplate(new DatabaseDown()),
                clock);

        try (CapturedLogs logs = CapturedLogs.start()) {
            assertThatNoException().isThrownBy(failing::run);

            assertThat(cleanupEvents(logs)).singleElement().satisfies(event -> {
                assertThat(event.getLevel()).isEqualTo(Level.ERROR);
                assertThat(event.getFormattedMessage()).isEqualTo("refresh token cleanup failed");
                assertThat(event.getThrowableProxy().getClassName())
                        .isEqualTo(CannotCreateTransactionException.class.getName());
            });
        }
        IssuedRefreshToken login = service.issue(userId);
        clock.stopAt(LOGIN.plusSeconds(60));
        assertThat(service.rotate(login.value())).as("갱신").isPresent();
    }

    // ---------------------------------------------------------------- 도우미

    private UUID familyId(IssuedRefreshToken token) {
        return (UUID) familyOf(jdbc, token.value()).get("id");
    }

    private boolean familyExists(UUID family) {
        return jdbc.queryForObject("select count(*) from refresh_token_family where id = ?", Integer.class, family) == 1;
    }

    private int tokenCount(UUID family) {
        return jdbc.queryForObject("select count(*) from refresh_token where family_id = ?", Integer.class, family);
    }

    private static List<ILoggingEvent> cleanupEvents(CapturedLogs logs) {
        return logs.events().stream().filter(event -> event.getLoggerName().equals(RefreshTokenCleanup.class.getName()))
                .toList();
    }

    /** 트랜잭션을 시작할 수 없는(DB에 닿지 않는) 트랜잭션 관리자. */
    private static final class DatabaseDown implements PlatformTransactionManager {

        @Override
        public TransactionStatus getTransaction(TransactionDefinition definition) {
            throw new CannotCreateTransactionException("DB에 닿지 않는다");
        }

        @Override
        public void commit(TransactionStatus status) {
        }

        @Override
        public void rollback(TransactionStatus status) {
        }
    }
}
