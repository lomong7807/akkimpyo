package app.accountbook.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.catchThrowable;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import app.accountbook.support.CapturedLogs;
import app.accountbook.support.SignedInUser;
import app.accountbook.support.StoppedClockConfig.StoppedClock;
import app.accountbook.support.TestAccessTokens;
import app.accountbook.user.UserService;
import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.spi.ILoggingEvent;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.env.MockEnvironment;

/** 로그인: user가 확인하고 auth가 토큰을 발급한다(#12, ADR 004 결정 6). */
class LoginServiceTest {

    private static final Instant NOW = Instant.parse("2030-01-01T00:00:00Z");
    private static final String EMAIL = "marker-user@example.com";
    private static final String PASSWORD = "marker-Password1";

    private final StoppedClock clock = new StoppedClock();
    private final AccessTokenKey key = new AccessTokenKey(
            new MockEnvironment().withProperty("ACCESS_TOKEN_SIGNING_KEY", TestAccessTokens.encodedKey()));
    private final UserService users = mock();
    private final LoginService service = new LoginService(users, new AccessTokenIssuer(key, clock));

    @BeforeEach
    void setUp() {
        clock.stopAt(NOW);
        when(users.exists(SignedInUser.ID)).thenReturn(true);
    }

    @Test
    void 맞으면_그_사용자의_토큰을_주고_사용자_id로_한_줄_남긴다() {
        when(users.authenticate(EMAIL, PASSWORD)).thenReturn(Optional.of(SignedInUser.ID));

        try (CapturedLogs logs = CapturedLogs.start()) {
            String token = service.login(EMAIL, PASSWORD);

            assertThat(new AccessTokenVerifier(key, clock, users).verify(token)).contains(SignedInUser.ID);
            assertThat(mine(logs)).singleElement().satisfies(event -> {
                assertThat(event.getLevel()).isEqualTo(Level.INFO);
                assertThat(event.getFormattedMessage()).isEqualTo("로그인 성공: 사용자 " + SignedInUser.ID);
            });
            assertThat(logs.text()).doesNotContain("marker", "eyJ");
        }
    }

    @Test
    void 맞지_않으면_예외이고_입력한_값이_들어_있지_않다() {
        when(users.authenticate(any(), any())).thenReturn(Optional.empty());

        try (CapturedLogs logs = CapturedLogs.start()) {
            Throwable thrown = catchThrowable(() -> service.login(EMAIL, PASSWORD));

            assertThat(thrown).isInstanceOf(InvalidCredentialsException.class);
            assertThat(thrown.toString()).doesNotContain("marker");
            // 실패는 사용자를 아는 user가 남긴다.
            assertThat(mine(logs)).isEmpty();
        }
        verify(users).authenticate(EMAIL, PASSWORD);
    }

    @Test
    void user의_예외는_그대로_나간다() {
        when(users.authenticate(any(), any())).thenThrow(new IllegalStateException("DB에 닿지 못함"));

        assertThatThrownBy(() -> service.login(EMAIL, PASSWORD)).isInstanceOf(IllegalStateException.class);
    }

    private static List<ILoggingEvent> mine(CapturedLogs logs) {
        return logs.events().stream()
                .filter(event -> event.getThreadName().equals(Thread.currentThread().getName()))
                .toList();
    }
}
