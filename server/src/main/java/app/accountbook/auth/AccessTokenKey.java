package app.accountbook.auth;

import java.util.Base64;
import javax.crypto.SecretKey;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.core.env.Environment;
import org.springframework.stereotype.Component;

/**
 * access token의 서명 키(ADR 001 결정 2). 환경 변수로만 받고 기본값이 없다.
 * 없거나 256비트보다 짧으면 서버가 뜨지 않는다. 오류의 문구와 원인에 값을 싣지 않는다.
 */
@Component
final class AccessTokenKey {

    static final String VARIABLE = "ACCESS_TOKEN_SIGNING_KEY";
    /** HS256 키의 하한(RFC 7518 3.2절). */
    private static final int MIN_BYTES = 32;

    private final SecretKey key;

    AccessTokenKey(Environment environment) {
        byte[] decoded = decode(environment);
        if (decoded == null || decoded.length < MIN_BYTES) {
            throw new IllegalStateException("환경 변수 " + VARIABLE
                    + "에 256비트(32바이트) 이상의 난수를 Base64로 넣어야 한다. 예: openssl rand -base64 32");
        }
        this.key = new SecretKeySpec(decoded, "HmacSHA256");
    }

    SecretKey value() {
        return key;
    }

    /** 읽을 수 없으면 null. 설정을 푸는 예외와 해독 예외의 문구에는 값이 들어 있어 넘기지 않는다. */
    private static byte[] decode(Environment environment) {
        try {
            String encoded = environment.getProperty(VARIABLE);
            return encoded == null ? null : Base64.getDecoder().decode(encoded);
        } catch (IllegalArgumentException e) {
            return null;
        }
    }
}
