package app.accountbook.user;

import java.time.Duration;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;
import org.springframework.security.crypto.argon2.Argon2PasswordEncoder;

/**
 * 통합 테스트용 비밀번호 입구. 운영과 같은 Argon2id이고 메모리와 반복만 가볍게 했다(테스트마다 사용자를 만들기 때문이다).
 * 운영 빈({@code passwordHasher})은 그대로 컨텍스트에 있고, 그 매개변수는 PasswordEncoderConfigTest와
 * UserServiceTest가 고정한다. 평문이나 다른 방식으로 저장하는 경로는 테스트에도 두지 않는다.
 */
@TestConfiguration(proxyBeanMethods = false)
public class TestPasswordHasherConfig {

    @Bean
    @Primary
    PasswordHasher lightPasswordHasher() {
        return new PasswordHasher(new Argon2PasswordEncoder(16, 32, 1, 256, 1),
                new PasswordHashProperties(4, Duration.ofSeconds(2)));
    }
}
