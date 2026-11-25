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

/** 동시 해시 상한의 설정(#20). 설정이 없으면 4개와 2초이고, 잘못된 값이면 서버가 뜨지 않는다. DB 없이 돈다. */
class PasswordHashPropertiesTest {

    private final ApplicationContextRunner runner =
            new ApplicationContextRunner().withUserConfiguration(PasswordEncoderConfig.class);

    @Test
    void defaultsAreFourAndTwoSeconds() {
        runner.run(context -> assertThat(context.getBean(PasswordHashProperties.class))
                .isEqualTo(new PasswordHashProperties(4, Duration.ofSeconds(2))));
    }

    @Test
    void valuesCanBeChangedByProperty() {
        runner.withPropertyValues("accountbook.password-hash.max-concurrent=2",
                        "accountbook.password-hash.max-wait=500ms")
                .run(context -> assertThat(context.getBean(PasswordHashProperties.class))
                        .isEqualTo(new PasswordHashProperties(2, Duration.ofMillis(500))));
    }

    @Test
    void valuesCanBeChangedByEnvironmentVariable() {
        Map<String, Object> variables = Map.of(
                "ACCOUNTBOOK_PASSWORDHASH_MAXCONCURRENT", "3",
                "ACCOUNTBOOK_PASSWORDHASH_MAXWAIT", "1s");
        runner.withInitializer(context -> context.getEnvironment().getPropertySources()
                        .addFirst(new SystemEnvironmentPropertySource("test-systemEnvironment", variables)))
                .run(context -> assertThat(context.getBean(PasswordHashProperties.class))
                        .isEqualTo(new PasswordHashProperties(3, Duration.ofSeconds(1))));
    }

    @Test
    void hasherUsesTheSettings() {
        runner.withPropertyValues("accountbook.password-hash.max-concurrent=2",
                        "accountbook.password-hash.max-wait=500ms")
                .run(context -> {
                    PasswordHasher hasher = context.getBean(PasswordHasher.class);
                    Semaphore slots = (Semaphore) ReflectionTestUtils.getField(hasher, "slots");

                    assertThat(slots.availablePermits()).isEqualTo(2);
                    assertThat(ReflectionTestUtils.getField(hasher, "maxWait")).isEqualTo(Duration.ofMillis(500));
                });
    }

    @ParameterizedTest
    @ValueSource(strings = {"max-concurrent=0", "max-concurrent=-1", "max-concurrent=many", "max-concurrent=",
            "max-wait=0s", "max-wait=-1s", "max-wait=soon"})
    void invalidValueFailsStartup(String setting) {
        runner.withPropertyValues("accountbook.password-hash." + setting)
                .run(context -> assertThat(context).hasFailed());
    }
}
