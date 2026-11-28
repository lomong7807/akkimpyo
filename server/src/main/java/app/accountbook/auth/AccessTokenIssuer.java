package app.accountbook.auth;

import com.nimbusds.jose.jwk.source.ImmutableSecret;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.JwsHeader;
import org.springframework.security.oauth2.jwt.JwtClaimsSet;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.JwtEncoderParameters;
import org.springframework.security.oauth2.jwt.NimbusJwtEncoder;
import org.springframework.stereotype.Component;

/** access token을 만든다(ADR 001 결정 1, 2). 사용자 id와 정해진 값만 담는다. 확인은 {@link AccessTokenVerifier}가 한다. */
@Component
final class AccessTokenIssuer {

    private static final Duration LIFETIME = Duration.ofMinutes(15);
    private static final JwsHeader HEADER = JwsHeader.with(MacAlgorithm.HS256).build();

    private final JwtEncoder encoder;
    private final Clock clock;

    AccessTokenIssuer(AccessTokenKey key, Clock clock) {
        // NimbusJwtEncoder.withSecretKey는 키의 해시를 kid로 넣는다. 키 식별자는 두지 않는다(ADR 001 결정 2).
        this.encoder = new NimbusJwtEncoder(new ImmutableSecret<>(key.value()));
        this.clock = clock;
    }

    String issue(UUID userId) {
        Instant now = clock.instant();
        JwtClaimsSet claims = JwtClaimsSet.builder()
                .issuer(AccessTokenVerifier.ISSUER)
                .audience(List.of(AccessTokenVerifier.AUDIENCE))
                .subject(userId.toString())
                .issuedAt(now)
                .expiresAt(now.plus(LIFETIME))
                .build();
        return encoder.encode(JwtEncoderParameters.from(HEADER, claims)).getTokenValue();
    }
}
