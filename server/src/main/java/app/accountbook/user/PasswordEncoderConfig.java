package app.accountbook.user;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.crypto.argon2.Argon2PasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;

/**
 * 비밀번호 해시는 Argon2id 하나로 고정한다(ADR 001 결정 7). 가입과 로그인이 같은 {@link PasswordHasher} 빈을 쓴다.
 * {@code PasswordEncoder}는 빈으로 두지 않는다. 주입받아 쓰면 정규화와 저장값 판정을 거치지 않기 때문이다.
 * 매개변수는 라이브러리 기본값(메모리 16MiB)에 맡기지 않고 OWASP Password Storage Cheat Sheet의 최소로 직접 정한다.
 */
@Configuration(proxyBeanMethods = false)
public class PasswordEncoderConfig {

    static final int SALT_LENGTH_BYTES = 16;
    static final int HASH_LENGTH_BYTES = 32;
    static final int PARALLELISM = 1;
    /** 19MiB. */
    static final int MEMORY_KIB = 19_456;
    static final int ITERATIONS = 2;

    @Bean
    PasswordHasher passwordHasher() {
        return new PasswordHasher(argon2id());
    }

    static PasswordEncoder argon2id() {
        return new Argon2PasswordEncoder(SALT_LENGTH_BYTES, HASH_LENGTH_BYTES, PARALLELISM, MEMORY_KIB, ITERATIONS);
    }
}
