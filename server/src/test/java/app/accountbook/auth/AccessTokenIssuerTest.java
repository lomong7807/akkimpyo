package app.accountbook.auth;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import app.accountbook.support.StoppedClockConfig.StoppedClock;
import app.accountbook.support.TestAccessTokens;
import app.accountbook.user.UserService;
import com.nimbusds.jose.crypto.MACVerifier;
import com.nimbusds.jwt.SignedJWT;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.mock.env.MockEnvironment;

/** access token의 발급(#12, ADR 001 결정 1, 2). 시계는 멈춰 있다. */
class AccessTokenIssuerTest {

    private static final Instant NOW = Instant.parse("2030-01-01T00:00:00Z");
    private static final UUID USER_ID = UUID.fromString("0B9F6C1E-3D52-4A7E-9C11-5F2E8A7D4B60");

    private final StoppedClock clock = new StoppedClock();
    private final AccessTokenKey key = new AccessTokenKey(
            new MockEnvironment().withProperty("ACCESS_TOKEN_SIGNING_KEY", TestAccessTokens.encodedKey()));
    private final AccessTokenIssuer issuer = new AccessTokenIssuer(key, clock);

    @Test
    void 정한_값만_담는다() throws Exception {
        clock.stopAt(NOW);

        SignedJWT token = SignedJWT.parse(issuer.issue(USER_ID));

        assertThat(token.getPayload().toJSONObject()).containsExactlyInAnyOrderEntriesOf(Map.of(
                "sub", "0b9f6c1e-3d52-4a7e-9c11-5f2e8a7d4b60",
                "iat", NOW.getEpochSecond(),
                "exp", NOW.getEpochSecond() + 15 * 60,
                "iss", "account-book",
                "aud", "account-book-api"));
    }

    @Test
    void 서명은_HS256이고_머리글에는_알고리즘만_있다() throws Exception {
        clock.stopAt(NOW);

        SignedJWT token = SignedJWT.parse(issuer.issue(USER_ID));

        // 키를 가리키는 값(kid)은 두지 않는다(ADR 001 결정 2).
        assertThat(token.getHeader().toJSONObject()).containsExactlyEntriesOf(Map.of("alg", "HS256"));
        assertThat(token.verify(new MACVerifier(Base64.getDecoder().decode(TestAccessTokens.encodedKey())))).isTrue();
    }

    @Test
    void 발급한_토큰은_검증을_지나고_15분에_끝난다() {
        UserService users = mock();
        when(users.exists(any())).thenReturn(true);
        AccessTokenVerifier verifier = new AccessTokenVerifier(key, clock, users);
        clock.stopAt(NOW);
        String token = issuer.issue(USER_ID);

        assertThat(verifier.verify(token)).contains(USER_ID);
        clock.stopAt(NOW.plus(Duration.ofMinutes(15)).minusNanos(1));
        assertThat(verifier.verify(token)).contains(USER_ID);
        clock.stopAt(NOW.plus(Duration.ofMinutes(15)));
        assertThat(verifier.verify(token)).isEmpty();
    }

    @ParameterizedTest
    @ValueSource(longs = {1, 500_000_000, 999_999_999})
    void 초보다_작은_시각은_버리고_15분을_넘기지_않는다(long nanos) throws Exception {
        clock.stopAt(NOW.plusNanos(nanos));

        Map<String, Object> claims = SignedJWT.parse(issuer.issue(USER_ID)).getPayload().toJSONObject();

        assertThat(claims).containsEntry("iat", NOW.getEpochSecond())
                .containsEntry("exp", NOW.getEpochSecond() + 15 * 60);
    }

    @Test
    void 부를_때마다_지금_시각으로_그_사용자의_토큰을_만든다() throws Exception {
        UUID other = UUID.randomUUID();
        clock.stopAt(NOW);
        issuer.issue(USER_ID);
        clock.stopAt(NOW.plusSeconds(60));

        Map<String, Object> claims = SignedJWT.parse(issuer.issue(other)).getPayload().toJSONObject();

        assertThat(claims).containsEntry("sub", other.toString()).containsEntry("iat", NOW.getEpochSecond() + 60);
    }
}
