package app.accountbook.support;

import com.nimbusds.jose.JOSEException;
import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.JWSObject;
import com.nimbusds.jose.JWSSigner;
import com.nimbusds.jose.Payload;
import com.nimbusds.jose.crypto.MACSigner;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import java.security.SecureRandom;
import java.time.Duration;
import java.time.Instant;
import java.util.Base64;
import java.util.Date;
import java.util.UUID;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.test.context.DynamicPropertyRegistrar;

/**
 * 테스트용 access token(ADR 001 결정 1, 2)과 그 서명 키. 발급은 아직 없어서(#12의 셋째 PR) 여기서 만든다.
 * 키는 테스트 JVM마다 새로 만든다. 레포에 키를 두지 않는다.
 */
public final class TestAccessTokens {

    public static final String KEY_VARIABLE = "ACCESS_TOKEN_SIGNING_KEY";
    public static final String ISSUER = "account-book";
    public static final String AUDIENCE = "account-book-api";
    public static final Duration LIFETIME = Duration.ofMinutes(15);

    private static final byte[] KEY = randomKey(32);

    private TestAccessTokens() {
    }

    /** 운영에서 환경 변수로 받는 서명 키를 테스트 컨텍스트에 넣는다. */
    @TestConfiguration(proxyBeanMethods = false)
    static class KeyConfig {

        @Bean
        DynamicPropertyRegistrar accessTokenSigningKey() {
            return registry -> registry.add(KEY_VARIABLE, TestAccessTokens::encodedKey);
        }
    }

    /** 환경 변수에 넣는 모양의 서명 키. */
    public static String encodedKey() {
        return Base64.getEncoder().encodeToString(KEY);
    }

    /** 그 시각에 발급해 15분 동안 유효한 토큰. */
    public static String valid(UUID userId, Instant issuedAt) {
        return sign(claims(userId, issuedAt).build());
    }

    public static JWTClaimsSet.Builder claims(UUID userId, Instant issuedAt) {
        return new JWTClaimsSet.Builder()
                .subject(userId.toString())
                .issuer(ISSUER)
                .audience(AUDIENCE)
                .issueTime(Date.from(issuedAt))
                .expirationTime(Date.from(issuedAt.plus(LIFETIME)));
    }

    /** 서버의 키로 서명한다. */
    public static String sign(JWTClaimsSet claims) {
        return sign(JWSAlgorithm.HS256, KEY, claims);
    }

    /** 서버의 키로 다른 알고리즘의 서명을 한다. 키가 짧아도 서명되게 뒤를 0으로 채운다(HMAC은 같은 키로 본다). */
    public static String signWithServerKey(JWSAlgorithm algorithm, JWTClaimsSet claims) {
        byte[] padded = new byte[64];
        System.arraycopy(KEY, 0, padded, 0, KEY.length);
        return sign(algorithm, padded, claims);
    }

    public static String sign(JWSAlgorithm algorithm, byte[] key, JWTClaimsSet claims) {
        try {
            return sign(algorithm, new MACSigner(key), claims);
        } catch (JOSEException e) {
            throw new IllegalStateException(e);
        }
    }

    public static String sign(JWSAlgorithm algorithm, JWSSigner signer, JWTClaimsSet claims) {
        try {
            SignedJWT jwt = new SignedJWT(new JWSHeader(algorithm), claims);
            jwt.sign(signer);
            return jwt.serialize();
        } catch (JOSEException e) {
            throw new IllegalStateException(e);
        }
    }

    /** 본문이 무엇이든 서버의 키로 서명한다. */
    public static String signRaw(String payload) {
        try {
            JWSObject jws = new JWSObject(new JWSHeader(JWSAlgorithm.HS256), new Payload(payload));
            jws.sign(new MACSigner(KEY));
            return jws.serialize();
        } catch (JOSEException e) {
            throw new IllegalStateException(e);
        }
    }

    public static byte[] randomKey(int bytes) {
        byte[] key = new byte[bytes];
        new SecureRandom().nextBytes(key);
        return key;
    }
}
