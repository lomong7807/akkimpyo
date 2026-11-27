package app.accountbook.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import app.accountbook.support.BadAccessTokens;
import app.accountbook.support.CapturedLogs;
import app.accountbook.support.SignedInUser;
import app.accountbook.support.StoppedClockConfig.StoppedClock;
import app.accountbook.support.TestAccessTokens;
import app.accountbook.user.UserService;
import com.nimbusds.jwt.JWTClaimsSet;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.stream.Stream;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.mock.env.MockEnvironment;

/** access token의 검증(#12, ADR 001 결정 1, 2). 시계는 실제보다 몇 년 뒤에 멈춰 있다. */
class AccessTokenVerifierTest {

    private static final Instant NOW = Instant.parse("2030-01-01T00:00:00Z");

    private final StoppedClock clock = new StoppedClock();
    private final UserService users = mock();
    private final AccessTokenVerifier verifier = new AccessTokenVerifier(
            new AccessTokenKey(new MockEnvironment()
                    .withProperty("ACCESS_TOKEN_SIGNING_KEY", TestAccessTokens.encodedKey())), clock, users);

    @BeforeEach
    void setUp() {
        clock.stopAt(NOW);
        when(users.exists(SignedInUser.ID)).thenReturn(true);
    }

    @Test
    void 유효한_토큰이면_사용자_id를_준다() {
        assertThat(verifier.verify(TestAccessTokens.valid(SignedInUser.ID, NOW))).contains(SignedInUser.ID);
    }

    @Test
    void 대상이_여럿이면_서버가_그_안에_있으면_된다() {
        assertThat(verifier.verify(sign(claims().audience(List.of("other", "account-book-api")))))
                .contains(SignedInUser.ID);
    }

    @Test
    void 모르는_값이_더_있어도_쓰지_않는다() {
        assertThat(verifier.verify(sign(claims().claim("userId", UUID.randomUUID().toString())
                .claim("email", "other@example.com").claim("scope", "admin")))).contains(SignedInUser.ID);
    }

    static Stream<Arguments> badTokens() {
        return BadAccessTokens.at(NOW);
    }

    @ParameterizedTest
    @MethodSource("badTokens")
    void 유효하지_않은_토큰은_빈_값이고_로그에_남지_않는다(String token) {
        try (CapturedLogs logs = CapturedLogs.start()) {
            assertThat(verifier.verify(token)).isEmpty();
            assertThat(logs.events())
                    .filteredOn(event -> event.getThreadName().equals(Thread.currentThread().getName())).isEmpty();
        }
    }

    @Test
    void 만료_직전까지_통하고_만료_시각부터_통하지_않는다() {
        String token = TestAccessTokens.valid(SignedInUser.ID, NOW);
        Instant expiry = Instant.parse("2030-01-01T00:15:00Z");

        clock.stopAt(expiry.minusNanos(1));
        assertThat(verifier.verify(token)).contains(SignedInUser.ID);
        for (Instant expired : List.of(expiry, expiry.plusNanos(1), expiry.plusSeconds(59))) {
            clock.stopAt(expired);
            assertThat(verifier.verify(token)).as(expired.toString()).isEmpty();
        }
    }

    @Test
    void 서명과_값이_맞지_않으면_사용자를_조회하지_않는다() {
        verifier.verify("x");
        verifier.verify(TestAccessTokens.valid(SignedInUser.ID, NOW.minusSeconds(900)));
        verifier.verify(sign(claims().issuer("other")));
        verifier.verify(sign(claims().audience("other")));
        verifier.verify(sign(claims().subject("user")));

        verifyNoInteractions(users);
    }

    @Test
    void 사용자를_조회하지_못하면_빈_값이_아니라_예외다() {
        when(users.exists(any())).thenThrow(new DataAccessResourceFailureException("DB에 닿지 못함"));

        assertThatThrownBy(() -> verifier.verify(TestAccessTokens.valid(SignedInUser.ID, NOW)))
                .isInstanceOf(DataAccessResourceFailureException.class);
    }

    private static JWTClaimsSet.Builder claims() {
        return TestAccessTokens.claims(SignedInUser.ID, NOW);
    }

    private static String sign(JWTClaimsSet.Builder claims) {
        return TestAccessTokens.sign(claims.build());
    }
}
