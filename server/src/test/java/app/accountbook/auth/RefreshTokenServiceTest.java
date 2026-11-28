package app.accountbook.auth;

import static app.accountbook.auth.RefreshTokenRows.familyOf;
import static app.accountbook.auth.RefreshTokenRows.sha256;
import static app.accountbook.auth.RefreshTokenRows.tokenId;
import static java.time.Duration.ofDays;
import static java.time.Duration.ofSeconds;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import app.accountbook.support.CapturedLogs;
import app.accountbook.support.IntegrationTest;
import app.accountbook.support.StoppedClockConfig;
import app.accountbook.support.StoppedClockConfig.StoppedClock;
import ch.qos.logback.classic.Level;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.HexFormat;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.NullAndEmptySource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Import;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;

/** 발급, 회전, 기한, 허용 시간, 재사용 감지, 폐기(#26, ADR 001 결정 3). 겹친 트랜잭션은 RefreshTokenRaceTest가 본다. */
@IntegrationTest
@Import(StoppedClockConfig.class)
class RefreshTokenServiceTest {

    private static final Instant T0 = Instant.parse("2030-01-01T00:00:00Z");

    @Autowired RefreshTokenService service;
    @Autowired StoppedClock clock;
    @Autowired JdbcTemplate jdbc;

    private UUID userId;
    private IssuedRefreshToken first;

    @BeforeEach
    void setUp() {
        clock.stopAt(T0);
        userId = RefreshTokenRows.insertUser(jdbc);
        first = service.issue(userId);
    }

    @Test
    void 발급한_값은_32바이트_난수이고_DB에는_그_SHA_256만_있다() {
        assertThat(Base64.getUrlDecoder().decode(first.value())).hasSize(32);
        assertThat(service.issue(userId).value()).isNotEqualTo(first.value());
        assertThat(first.userId()).isEqualTo(userId);
        assertThat(first.expiresAt()).isEqualTo(T0.plus(ofDays(30)));
        assertThat(jdbc.queryForObject("select token_hash from refresh_token where id = ?", byte[].class,
                tokenId(jdbc, first.value()))).isEqualTo(sha256(first.value()));
        assertThat(family(first, "absolute_expires_at")).isEqualTo(T0.plus(ofDays(180)));
        assertThat(first.toString()).doesNotContain(first.value());
    }

    @Test
    void 회전하면_같은_사용자의_새_값을_주고_받은_값이_바로_앞_토큰이_된다() {
        clock.stopAt(T0.plusSeconds(3600));
        IssuedRefreshToken second = rotate(first);

        assertThat(second.value()).isNotEqualTo(first.value());
        assertThat(second.userId()).isEqualTo(userId);
        assertThat(second.expiresAt()).isEqualTo(T0.plusSeconds(3600).plus(ofDays(30)));
        assertThat(familyOf(jdbc, second.value())).containsEntry("current_token_id", tokenId(jdbc, second.value()))
                .containsEntry("previous_token_id", tokenId(jdbc, first.value()));
        assertThat(family(second, "rotated_at")).isEqualTo(T0.plusSeconds(3600));
    }

    /** 29일 23시간 59분은 통과, 30일과 30일 1분은 거부. 기한이 지난 것은 재사용이 아니라 계열을 폐기하지 않는다. */
    @ParameterizedTest
    @CsvSource({"PT719H59M, true", "PT720H, false", "PT720H1M, false"})
    void 마지막_갱신부터_30일이_지나면_거부한다(Duration after, boolean accepted) {
        clock.stopAt(T0.plus(after));

        assertThat(service.rotate(first.value()).isPresent()).isEqualTo(accepted);
        assertThat(family(first, "revoked_at")).isNull();
    }

    @Test
    void 갱신할_때마다_기한이_30일로_다시_잡히고_180일_절대_만료는_바뀌지_않는다() {
        IssuedRefreshToken token = first;
        for (int days = 29; days <= 174; days += 29) {
            clock.stopAt(T0.plus(ofDays(days)));
            token = rotate(token);
        }
        assertThat(token.expiresAt()).as("174일에 받은 토큰의 기한은 절대 만료다").isEqualTo(T0.plus(ofDays(180)));
        clock.stopAt(T0.plus(ofDays(180)).minusSeconds(60));
        token = rotate(token);
        clock.stopAt(T0.plus(ofDays(180)).plusSeconds(60));

        assertThat(service.rotate(token.value())).isEmpty();
        assertThat(family(token, "absolute_expires_at")).isEqualTo(T0.plus(ofDays(180)));
    }

    @Test
    void 허용_시간_안의_바로_앞_토큰은_같은_계열의_새_토큰을_받고_그_전에_준_토큰은_재사용이_된다() {
        IssuedRefreshToken rotated = rotate(first);
        clock.stopAt(T0.plus(ofSeconds(9)));

        IssuedRefreshToken reissued = rotate(first);

        assertThat(reissued.value()).isNotIn(first.value(), rotated.value());
        assertThat(reissued.userId()).isEqualTo(userId);
        assertThat(familyOf(jdbc, reissued.value()).get("id")).isEqualTo(familyOf(jdbc, first.value()).get("id"));
        assertThat(family(reissued, "rotated_at")).as("재발급은 회전으로 세지 않는다").isEqualTo(T0);
        assertThat(service.rotate(rotated.value())).isEmpty();
        assertThat(service.rotate(reissued.value())).as("재사용 감지로 계열이 폐기됐다").isEmpty();
    }

    @Test
    void 허용_시간은_정상_회전부터_재고_재발급으로_늘어나지_않는다() {
        rotate(first);
        clock.stopAt(T0.plus(ofSeconds(9)));
        IssuedRefreshToken reissued = rotate(first);
        clock.stopAt(T0.plus(ofSeconds(11)));

        assertThat(service.rotate(first.value())).isEmpty();
        assertThat(family(first, "revoked_at")).isEqualTo(T0.plus(ofSeconds(11)));
        assertThat(service.rotate(reissued.value())).isEmpty();
    }

    @Test
    void 바로_앞_토큰은_가장_최근_정상_회전에서_바뀐_토큰_하나다() {
        rotate(first);
        clock.stopAt(T0.plus(ofSeconds(5)));
        IssuedRefreshToken reissued = rotate(first);
        clock.stopAt(T0.plus(ofSeconds(6)));
        IssuedRefreshToken next = rotate(reissued); // 재발급한 토큰은 지금 토큰이라 정상 회전이다.
        clock.stopAt(T0.plus(ofSeconds(7)));

        assertThat(service.rotate(first.value())).as("첫 회전부터 10초 안이지만 바로 앞 토큰이 아니다").isEmpty();
        assertThat(service.rotate(next.value())).isEmpty();
    }

    @ParameterizedTest
    @NullAndEmptySource
    @ValueSource(strings = {"short", "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA", "a+b/AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"})
    void 모르는_값은_거부하고_아무것도_바꾸지_않는다(String unknown) {
        assertThat(service.rotate(unknown)).isEmpty();
        service.revokeFamily(unknown);
        assertThat(service.rotate(first.value())).isPresent();
    }

    @ParameterizedTest
    @ValueSource(booleans = {true, false})
    void 로그아웃은_지금_토큰이든_이미_회전된_토큰이든_그_계열만_폐기한다(boolean withCurrent) {
        IssuedRefreshToken current = rotate(first);
        IssuedRefreshToken otherDevice = service.issue(userId);

        service.revokeFamily(withCurrent ? current.value() : first.value());

        assertThat(service.rotate(current.value())).isEmpty();
        assertThat(service.rotate(otherDevice.value())).isPresent();
    }

    @Test
    void 비밀번호_바꾸기는_지금_기기의_계열만_남기고_다른_사용자는_건드리지_않는다() {
        IssuedRefreshToken otherDevice = service.issue(userId);
        IssuedRefreshToken someoneElse = service.issue(RefreshTokenRows.insertUser(jdbc));

        service.revokeOthers(userId, first.value());

        assertThat(service.rotate(otherDevice.value())).isEmpty();
        assertThat(service.rotate(first.value())).isPresent();
        assertThat(service.rotate(someoneElse.value())).isPresent();
    }

    /** 쿠키가 없거나, 다른 사용자의 값이거나, 허용 시간이 지난 회전된 값이면 지금 기기의 계열도 폐기한다. */
    @ParameterizedTest
    @CsvSource(nullValues = "none", value = {"none", "someone-else", "rotated"})
    void 비밀번호_바꾸기에_지금_기기의_유효한_값이_없으면_모든_계열을_폐기한다(String keep) {
        IssuedRefreshToken current = rotate(first);
        IssuedRefreshToken someoneElse = service.issue(RefreshTokenRows.insertUser(jdbc));
        clock.stopAt(T0.plus(ofSeconds(11)));

        service.revokeOthers(userId, keep == null ? null : keep.equals("rotated") ? first.value() : someoneElse.value());

        assertThat(service.rotate(current.value())).isEmpty();
        assertThat(service.rotate(someoneElse.value())).isPresent();
    }

    @Test
    void 사용자를_지우려면_토큰을_먼저_지워야_하고_지운_사용자의_값은_모르는_값이다() {
        jdbc.execute("savepoint before_delete"); // 실패한 문장이 테스트 트랜잭션을 못 쓰게 하지 않게 되돌린다.
        assertThatThrownBy(() -> jdbc.update("delete from users where id = ?", userId))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("fk_refresh_token_family_user");
        jdbc.execute("rollback to savepoint before_delete");
        RefreshTokenRows.deleteUser(jdbc, userId);

        assertThat(service.rotate(first.value())).isEmpty();
    }

    @Test
    void 재사용_감지는_사용자와_계열을_경고로_남기고_값과_해시는_로그에_없다() {
        IssuedRefreshToken current = rotate(first);
        clock.stopAt(T0.plus(ofSeconds(11)));
        String familyId = familyOf(jdbc, first.value()).get("id").toString();

        try (CapturedLogs logs = CapturedLogs.start()) {
            service.rotate(first.value());
            service.revokeOthers(userId, current.value());

            assertThat(logs.events()).anySatisfy(event -> {
                assertThat(event.getLevel()).isEqualTo(Level.WARN);
                assertThat(event.getFormattedMessage()).contains(userId.toString(), familyId);
            });
            for (IssuedRefreshToken token : new IssuedRefreshToken[] {first, current}) {
                byte[] hash = sha256(token.value());
                assertThat(logs.text()).doesNotContain(token.value(), HexFormat.of().formatHex(hash),
                        Base64.getEncoder().encodeToString(hash));
            }
        }
    }

    private IssuedRefreshToken rotate(IssuedRefreshToken token) {
        return service.rotate(token.value()).orElseThrow();
    }

    private Instant family(IssuedRefreshToken token, String column) {
        Object value = familyOf(jdbc, token.value()).get(column);
        return value == null ? null : ((Timestamp) value).toInstant();
    }
}
