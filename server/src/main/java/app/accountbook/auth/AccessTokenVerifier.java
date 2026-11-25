package app.accountbook.auth;

import app.accountbook.user.UserService;
import java.time.Clock;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import org.springframework.security.oauth2.core.DelegatingOAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2TokenValidator;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.BadJwtException;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtAudienceValidator;
import org.springframework.security.oauth2.jwt.JwtClaimNames;
import org.springframework.security.oauth2.jwt.JwtClaimValidator;
import org.springframework.security.oauth2.jwt.JwtIssuerValidator;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.stereotype.Component;

/** access token으로 사용자를 알아낸다(ADR 001 결정 1, 2). */
@Component
public class AccessTokenVerifier {

    static final String ISSUER = "account-book";
    static final String AUDIENCE = "account-book-api";

    private final NimbusJwtDecoder decoder;
    private final UserService userService;

    AccessTokenVerifier(AccessTokenKey key, Clock clock, UserService userService) {
        this.decoder = NimbusJwtDecoder.withSecretKey(key.value()).macAlgorithm(MacAlgorithm.HS256).build();
        this.decoder.setJwtValidator(new DelegatingOAuth2TokenValidator<>(new JwtIssuerValidator(ISSUER),
                new JwtAudienceValidator(AUDIENCE), notExpired(clock), userIdInSubject()));
        this.userService = userService;
    }

    /**
     * 유효한 토큰이고 그 사용자가 있으면 사용자 id. 왜 유효하지 않은지는 나누지 않는다.
     * 사용자가 있는지 알 수 없으면(DB 오류) 예외를 그대로 던진다. 로그인이 풀린 것이 아니기 때문이다.
     */
    public Optional<UUID> verify(String token) {
        return decode(token)
                .map(jwt -> UUID.fromString(jwt.getSubject()))
                .filter(userService::exists);
    }

    private Optional<Jwt> decode(String token) {
        try {
            return Optional.of(decoder.decode(token));
        } catch (BadJwtException e) {
            return Optional.empty();
        }
    }

    /**
     * 만료 시각부터 통하지 않는다(RFC 7519 4.1.4절). 라이브러리의 JwtTimestampValidator는 허용 오차를 0으로 해도
     * 만료 시각과 같은 순간을 받고, 만료가 없는 토큰을 받는 것이 기본이라 쓰지 않는다.
     */
    private static OAuth2TokenValidator<Jwt> notExpired(Clock clock) {
        return new JwtClaimValidator<Instant>(JwtClaimNames.EXP,
                expiresAt -> expiresAt != null && clock.instant().isBefore(expiresAt));
    }

    /** id는 소문자 UUID다(ADR 002 2절). UUID.fromString은 줄인 표기도 읽으므로 다시 적어 비교한다. */
    private static OAuth2TokenValidator<Jwt> userIdInSubject() {
        return new JwtClaimValidator<String>(JwtClaimNames.SUB, AccessTokenVerifier::isUserId);
    }

    private static boolean isUserId(String subject) {
        try {
            return subject != null && UUID.fromString(subject).toString().equals(subject);
        } catch (IllegalArgumentException e) {
            return false;
        }
    }
}
