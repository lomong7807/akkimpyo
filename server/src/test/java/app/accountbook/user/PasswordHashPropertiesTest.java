package app.accountbook.user;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.Duration;
import java.util.Map;
import java.util.concurrent.Semaphore;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.core.env.SystemEnvironmentPropertySource;
import org.springframework.test.util.ReflectionTestUtils;

/** 동시 해시 상한의 설정(#20). 설정이 없으면 동시 4개, 대기 16개, 2초이고, 잘못된 값이면 서버가 뜨지 않는다. DB 없이 돈다. */
class PasswordHashPropertiesTest {

    private final ApplicationContextRunner runner =
            new ApplicationContextRunner().withUserConfiguration(PasswordEncoderConfig.class);

    @Test
    void defaultsAreFourSixteenAndTwoSeconds() {
        runner.run(context -> assertThat(context.getBean(PasswordHashProperties.class))
                .isEqualTo(new PasswordHashProperties(4, 16, Duration.ofSeconds(2))));
    }

    @Test
    void valuesCanBeChangedByProperty() {
        runner.withPropertyValues("accountbook.password-hash.max-concurrent=2",
                        "accountbook.password-hash.max-waiting=8",
                        "accountbook.password-hash.max-wait=500ms")
                .run(context -> assertThat(context.getBean(PasswordHashProperties.class))
                        .isEqualTo(new PasswordHashProperties(2, 8, Duration.ofMillis(500))));
    }

    @Test
    void valuesCanBeChangedByEnvironmentVariable() {
        Map<String, Object> variables = Map.of(
                "ACCOUNTBOOK_PASSWORDHASH_MAXCONCURRENT", "3",
                "ACCOUNTBOOK_PASSWORDHASH_MAXWAITING", "5",
                "ACCOUNTBOOK_PASSWORDHASH_MAXWAIT", "1s");
        runner.withInitializer(context -> context.getEnvironment().getPropertySources()
                        .addFirst(new SystemEnvironmentPropertySource("test-systemEnvironment", variables)))
                .run(context -> assertThat(context.getBean(PasswordHashProperties.class))
                        .isEqualTo(new PasswordHashProperties(3, 5, Duration.ofSeconds(1))));
    }

    @Test
    void hasherUsesTheSettings() {
        runner.withPropertyValues("accountbook.password-hash.max-concurrent=2",
                        "accountbook.password-hash.max-waiting=8",
                        "accountbook.password-hash.max-wait=500ms")
                .run(context -> {
                    PasswordHasher hasher = context.getBean(PasswordHasher.class);
                    Semaphore slots = (Semaphore) ReflectionTestUtils.getField(hasher, "slots");
                    Semaphore entries = (Semaphore) ReflectionTestUtils.getField(hasher, "entries");

                    assertThat(slots.availablePermits()).isEqualTo(2);
                    assertThat(entries.availablePermits()).isEqualTo(2 + 8);
                    assertThat(ReflectionTestUtils.getField(hasher, "maxWait")).isEqualTo(Duration.ofMillis(500));
                });
    }

    @Test
    void zeroWaitingIsAllowed() {
        // 기다리지 않고 바로 거절한다는 뜻이다.
        runner.withPropertyValues("accountbook.password-hash.max-waiting=0")
                .run(context -> assertThat(context.getBean(PasswordHashProperties.class).maxWaiting()).isZero());
    }

    @ParameterizedTest
    @ValueSource(strings = {"max-concurrent=0", "max-concurrent=-1", "max-concurrent=many", "max-concurrent=",
            "max-waiting=-1", "max-waiting=many", "max-waiting=2147483647", // 마지막은 동시 해시 수와 더하면 int를 넘는다
            "max-wait=0s", "max-wait=-1s", "max-wait=soon"})
    void invalidValueFailsStartup(String setting) {
        runner.withPropertyValues("accountbook.password-hash." + setting)
                .run(context -> assertThat(context).hasFailed());
    }
}
