package app.accountbook.user;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.params.provider.Arguments.argumentSet;

import java.util.Arrays;
import java.util.Base64;
import java.util.Map;
import java.util.stream.Collectors;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.security.crypto.argon2.Argon2PasswordEncoder;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.factory.PasswordEncoderFactories;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.crypto.password.Pbkdf2PasswordEncoder;
import org.springframework.security.crypto.scrypt.SCryptPasswordEncoder;
import org.springframework.util.ClassUtils;

/** 운영 인코더 빈이 만드는 값으로 방식과 매개변수를 고정한다(ADR 001 결정 7). 스프링 컨텍스트 없이 돈다. */
class PasswordEncoderConfigTest {

    private final PasswordEncoder encoder = new PasswordEncoderConfig().passwordEncoder();

    @Test
    void encoderIsArgon2idOnlyNotDelegating() {
        assertThat(encoder).isExactlyInstanceOf(Argon2PasswordEncoder.class);
        // 위임 인코더는 "{id}" 접두어를 붙인다. 접두어 없이 Argon2id 형식 그대로여야 한다.
        assertThat(encoder.encode("password1")).startsWith("$argon2id$v=19$");
    }

    @Test
    void parametersAreAtLeastTheFloor() {
        // 형식: $argon2id$v=19$m=<KiB>,t=<반복>,p=<병렬>$<salt>$<hash>
        String[] parts = encoder.encode("password1").split("\\$");
        Map<String, Integer> parameters = Arrays.stream(parts[3].split(","))
                .map(pair -> pair.split("="))
                .collect(Collectors.toMap(pair -> pair[0], pair -> Integer.parseInt(pair[1])));

        assertThat(parameters.get("m")).isGreaterThanOrEqualTo(19_456);
        assertThat(parameters.get("t")).isGreaterThanOrEqualTo(2);
        assertThat(parameters.get("p")).isGreaterThanOrEqualTo(1);
        assertThat(Base64.getDecoder().decode(parts[4])).hasSize(16);
        assertThat(Base64.getDecoder().decode(parts[5])).hasSize(32);
    }

    @Test
    void sameInputGivesDifferentHashesThatBothVerify() {
        String first = encoder.encode("password1");
        String second = encoder.encode("password1");

        assertThat(first).isNotEqualTo(second);
        assertThat(encoder.matches("password1", first)).isTrue();
        assertThat(encoder.matches("password1", second)).isTrue();
        assertThat(encoder.matches("password2", first)).isFalse();
    }

    @Test
    void doesNotTruncateLongPasswordWithHangul() {
        // 72자, UTF-8로 212바이트. bcrypt라면 72바이트 뒤가 잘려 마지막 글자만 다른 비밀번호가 같아진다.
        String common = "a1" + "가".repeat(69);
        String encoded = encoder.encode(common + "나");

        assertThat(encoder.matches(common + "나", encoded)).isTrue();
        assertThat(encoder.matches(common + "다", encoded)).isFalse();
    }

    /** 다른 방식으로 저장한 "password1". 위임 인코더는 일치로 판정하는 값이다. */
    static Stream<Arguments> valuesWithOtherMethodPrefix() {
        return Stream.of(
                argumentSet("noop", "{noop}password1"),
                argumentSet("bcrypt", "{bcrypt}" + new BCryptPasswordEncoder(4).encode("password1")),
                argumentSet("pbkdf2", "{pbkdf2@SpringSecurity_v5_8}"
                        + Pbkdf2PasswordEncoder.defaultsForSpringSecurity_v5_8().encode("password1")),
                argumentSet("scrypt", "{scrypt@SpringSecurity_v5_8}"
                        + SCryptPasswordEncoder.defaultsForSpringSecurity_v5_8().encode("password1")));
    }

    @ParameterizedTest
    @MethodSource("valuesWithOtherMethodPrefix")
    void doesNotMatchValueWithOtherMethodPrefix(String stored) {
        assertThat(PasswordEncoderFactories.createDelegatingPasswordEncoder().matches("password1", stored)).isTrue();

        // 예외가 새어 나오면 실패한다.
        assertThat(encoder.matches("password1", stored)).isFalse();
    }

    /** 접두어 없이 저장한 "password1"(평문, bcrypt)과 빈 값. */
    static Stream<Arguments> valuesWithoutPrefix() {
        String bcrypt = new BCryptPasswordEncoder(4).encode("password1");
        return Stream.of(
                argumentSet("평문", "password1"),
                argumentSet("bcrypt $2a$", bcrypt),
                argumentSet("bcrypt $2b$", bcrypt.replace("$2a$", "$2b$")),
                argumentSet("빈 값", ""),
                argumentSet("null", (Object) null));
    }

    @ParameterizedTest
    @MethodSource("valuesWithoutPrefix")
    void doesNotMatchValueStoredByOtherMethodWithoutPrefix(String stored) {
        assertThat(encoder.matches("password1", stored)).isFalse();
    }

    /** crypto 모듈만 들어왔다. 필터 체인을 만드는 Spring Security 모듈이 클래스패스에 없어야 자동 설정이 켜지지 않는다. */
    @Test
    void springSecurityWebAndConfigAreNotOnClasspath() {
        ClassLoader loader = getClass().getClassLoader();

        assertThat(ClassUtils.isPresent("org.springframework.security.web.SecurityFilterChain", loader)).isFalse();
        assertThat(ClassUtils.isPresent(
                "org.springframework.security.config.annotation.web.configuration.EnableWebSecurity", loader))
                .isFalse();
    }
}
