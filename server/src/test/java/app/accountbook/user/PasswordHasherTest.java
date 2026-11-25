package app.accountbook.user;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.junit.jupiter.params.provider.Arguments.argumentSet;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.spy;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;

import app.accountbook.common.InvalidRequestException;
import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import java.text.Normalizer;
import java.text.Normalizer.Form;
import java.util.List;
import java.util.stream.IntStream;
import java.util.stream.Stream;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.slf4j.LoggerFactory;
import org.springframework.security.crypto.argon2.Argon2PasswordEncoder;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.factory.PasswordEncoderFactories;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.crypto.password.Pbkdf2PasswordEncoder;
import org.springframework.security.crypto.scrypt.SCryptPasswordEncoder;

/** 비밀번호를 해시하고 비교하는 입구(ADR 001 결정 7). 스프링 컨텍스트 없이 돈다. */
class PasswordHasherTest {

    private static final String PASSWORD = "password1";
    private static final String SALT = "YWNjb3VudC1ib29rLXRzdA";
    private static final String HASH = "vHygWA0jNvBLxOELjrkU6R1OAPyuN/Ro9FrihcYD2KI";

    /** "password1"이 맞는 저장값. 매개변수는 가볍게 했다. */
    private static final String STORED = "$argon2id$v=19$m=256,t=1,p=1$" + SALT + "$" + HASH;
    /** 같은 비밀번호를 같은 매개변수로 다른 변형으로 해시한 값. */
    private static final String STORED_ARGON2D =
            "$argon2d$v=19$m=256,t=1,p=1$" + SALT + "$A5xtGUlzwuMKGHe2EF1hfd1B5kiQSxGzfRjFHhybYqg";
    private static final String STORED_ARGON2I =
            "$argon2i$v=19$m=256,t=1,p=1$" + SALT + "$8SajVwRO0S1qukeO0LXK2HT8KsMIF6BEUKY98i9FEqg";

    private final PasswordEncoder encoder = spy(new Argon2PasswordEncoder(16, 32, 1, 256, 1));
    private final PasswordHasher hasher = new PasswordHasher(encoder);

    /** 우리 코드와 해시 라이브러리의 로그. 다른 로거(JUnit 등)는 실행 순서에 따라 섞여 들어와 보지 않는다. */
    private static final List<Logger> WATCHED_LOGGERS = Stream.of("app.accountbook", "org.springframework.security")
            .map(name -> (Logger) LoggerFactory.getLogger(name))
            .toList();

    private final ListAppender<ILoggingEvent> logs = new ListAppender<>();

    @BeforeEach
    void collectLogs() {
        logs.start();
        WATCHED_LOGGERS.forEach(logger -> {
            logger.addAppender(logs);
            logger.setLevel(Level.TRACE);
        });
    }

    @AfterEach
    void stopCollectingLogs() {
        WATCHED_LOGGERS.forEach(logger -> {
            logger.setLevel(null);
            logger.detachAppender(logs);
        });
    }

    // --- 입구: 입력한 그대로 받아 정규화하고 규칙을 본다 ---

    @Test
    void hash_passesNormalizedPasswordToEncoder() {
        String stored = hasher.hash("ａｂｃｄ１２３４");

        verify(encoder).encode("abcd1234");
        assertThat(stored).startsWith("$argon2id$v=19$");
    }

    @Test
    void hash_rejectsPasswordOutsideRuleWithoutHashing() {
        assertThatThrownBy(() -> hasher.hash("abc1234")).isInstanceOf(InvalidRequestException.class);
        assertThatThrownBy(() -> hasher.hash("a1" + "x".repeat(511))).isInstanceOf(InvalidRequestException.class);

        verifyNoInteractions(encoder);
    }

    @Test
    void matches_normalizesInputLikeHash() {
        String stored = hasher.hash("비밀번호abc1");

        assertThat(hasher.matches(Normalizer.normalize("비밀번호abc1", Form.NFD), stored)).isTrue();
        assertThat(hasher.matches("비밀번호ａｂｃ１", stored)).isTrue();
        assertThat(hasher.matches("비밀번호abc2", stored)).isFalse();
    }

    @Test
    void matches_isFalseWithoutComparingWhenInputCannotBeNormalized() {
        assertThat(hasher.matches(null, STORED)).isFalse();
        assertThat(hasher.matches("a".repeat(513), STORED)).isFalse();
        assertThat(hasher.matches("password1\uD800", STORED)).isFalse();

        verifyNoInteractions(encoder);
    }

    @Test
    void matches_acceptsValueHashedWithProductionParameters() {
        PasswordHasher production = new PasswordHasher(PasswordEncoderConfig.argon2id());
        String stored = production.hash(PASSWORD);

        assertThat(stored).startsWith("$argon2id$v=19$m=19456,t=2,p=1$");
        assertThat(production.matches(PASSWORD, stored)).isTrue();
        assertThat(production.matches("password2", stored)).isFalse();
    }

    // --- 저장값 판정: 정확한 Argon2id 형식이고 매개변수가 상한 안일 때만 비교한다 ---

    @Test
    void matches_comparesWellFormedArgon2idValue() {
        assertThat(hasher.matches(PASSWORD, STORED)).isTrue();
        assertThat(hasher.matches("password2", STORED)).isFalse();
    }

    /** 비교하지 않는 저장값. 이 가운데 라이브러리가 일치로 판정하거나 예외를 던지는 것이 있다. */
    static Stream<Arguments> valuesNotCompared() {
        String bcrypt = new BCryptPasswordEncoder(4).encode(PASSWORD);
        return Stream.of(
                argumentSet("null", (Object) null),
                argumentSet("빈 값", ""),
                argumentSet("평문", PASSWORD),
                argumentSet("$가 든 평문", "pass$word$1$x"),
                argumentSet("{noop}", "{noop}" + PASSWORD),
                argumentSet("bcrypt", bcrypt),
                argumentSet("{bcrypt}", "{bcrypt}" + bcrypt),
                argumentSet("{noop} 뒤의 Argon2id 값", "{noop}" + STORED),
                argumentSet("{argon2} 뒤의 Argon2id 값", "{argon2@SpringSecurity_v5_8}" + STORED),
                argumentSet("앞에 공백", " " + STORED),
                argumentSet("argon2d", STORED_ARGON2D),
                argumentSet("argon2i", STORED_ARGON2I),
                argumentSet("대문자", STORED.replace("argon2id", "ARGON2ID")),
                argumentSet("버전 없음", STORED.replace("v=19$", "")),
                argumentSet("다른 버전", STORED.replace("v=19", "v=16")),
                argumentSet("모르는 버전", STORED.replace("v=19", "v=99")),
                argumentSet("뒤에 조각이 더 있음", STORED + "$x"),
                argumentSet("뒤에 줄바꿈", STORED + "\n"),
                argumentSet("base64 채움 글자", STORED + "="),
                argumentSet("base64가 아닌 글자", STORED.replace(SALT, "!" + SALT.substring(1))),
                argumentSet("빈 salt", STORED.replace(SALT, "")),
                argumentSet("짧은 해시", STORED.replace(HASH, "AA")),
                argumentSet("한 글자 긴 해시", STORED + "A"),
                argumentSet("매개변수 순서", withParameters("t=1,m=256,p=1")),
                argumentSet("매개변수 빠짐", withParameters("m=256,t=1")),
                argumentSet("매개변수 더 있음", withParameters("m=256,t=1,p=1,x=1")),
                argumentSet("숫자가 아님", withParameters("m=abc,t=1,p=1")),
                argumentSet("부호", withParameters("m=+256,t=1,p=1")),
                argumentSet("음수", withParameters("m=-1,t=1,p=1")),
                argumentSet("메모리 0", withParameters("m=0,t=1,p=1")),
                argumentSet("반복 0", withParameters("m=256,t=0,p=1")),
                argumentSet("병렬 0", withParameters("m=256,t=1,p=0")),
                argumentSet("메모리 상한 + 1", withParameters("m=19457,t=2,p=1")),
                argumentSet("반복 상한 + 1", withParameters("m=19456,t=3,p=1")),
                argumentSet("병렬 상한 + 1", withParameters("m=19456,t=2,p=2")),
                argumentSet("메모리 2GiB", withParameters("m=2097152,t=1,p=1")),
                argumentSet("반복 20만", withParameters("m=256,t=200000,p=1")),
                argumentSet("int를 넘는 메모리", withParameters("m=99999999999,t=1,p=1")));
    }

    @ParameterizedTest
    @MethodSource("valuesNotCompared")
    void matches_isFalseWithoutComparingOrLoggingOtherValues(String stored) {
        assertThat(hasher.matches(PASSWORD, stored)).isFalse();

        // 라이브러리에 넘기지 않으므로 예외도, 큰 매개변수로 도는 해시도, 라이브러리가 남기는 로그도 없다.
        verify(encoder, never()).matches(any(), any());
        assertThat(logs.list).isEmpty();
    }

    @Test
    void libraryLogsMalformedValueWhenCalledDirectly() {
        // 위 테스트의 "로그 없음"이 로그를 못 모아서가 아님을 확인한다.
        encoder.matches(PASSWORD, "{noop}" + PASSWORD);

        assertThat(logs.list).isNotEmpty();
    }

    @Test
    void matches_isFalseForValueCutAtAnyPosition() {
        IntStream.range(0, STORED.length()).forEach(length ->
                assertThat(hasher.matches(PASSWORD, STORED.substring(0, length))).isFalse());

        verify(encoder, never()).matches(any(), any());
        assertThat(logs.list).isEmpty();
    }

    /** 다른 방식으로 저장한 "password1". 위임 인코더는 일치로 판정하는 값이다. */
    static Stream<Arguments> valuesMatchedByDelegatingEncoder() {
        return Stream.of(
                argumentSet("noop", "{noop}" + PASSWORD),
                argumentSet("bcrypt", "{bcrypt}" + new BCryptPasswordEncoder(4).encode(PASSWORD)),
                argumentSet("pbkdf2", "{pbkdf2@SpringSecurity_v5_8}"
                        + Pbkdf2PasswordEncoder.defaultsForSpringSecurity_v5_8().encode(PASSWORD)),
                argumentSet("scrypt", "{scrypt@SpringSecurity_v5_8}"
                        + SCryptPasswordEncoder.defaultsForSpringSecurity_v5_8().encode(PASSWORD)));
    }

    @ParameterizedTest
    @MethodSource("valuesMatchedByDelegatingEncoder")
    void matches_isFalseForValueStoredByOtherMethod(String stored) {
        assertThat(PasswordEncoderFactories.createDelegatingPasswordEncoder().matches(PASSWORD, stored)).isTrue();

        assertThat(hasher.matches(PASSWORD, stored)).isFalse();
    }

    private static String withParameters(String parameters) {
        return STORED.replace("m=256,t=1,p=1", parameters);
    }
}
