package app.accountbook;

import static org.assertj.core.api.Assertions.assertThat;

import app.accountbook.common.RequiredDbSettings;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.boot.autoconfigure.AutoConfigurations;
import org.springframework.boot.jdbc.autoconfigure.DataSourceAutoConfiguration;
import org.springframework.boot.test.context.ConfigDataApplicationContextInitializer;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

/**
 * 프로파일별 설정 파일(application.yml, application-local.yml)이 정한 동작.
 * DB에 접속하지 않는다: 설정 파일을 읽고 DataSource 자동 설정까지만 올린다.
 * 환경 변수 DB_URL, DB_USERNAME, DB_PASSWORD, WEB_ORIGIN, ACCESS_TOKEN_SIGNING_KEY가 없는 환경(CI와 평소 개발 환경)을
 * 전제로 한다.
 */
class ProfileConfigTest {

    private static final String LOCAL_DB_URL = "jdbc:postgresql://localhost:5433/accountbook";
    /** web/vite.config.ts의 개발 서버 포트. */
    private static final String LOCAL_WEB_ORIGIN = "http://localhost:5173";

    private final ApplicationContextRunner runner = new ApplicationContextRunner()
            .withInitializer(new ConfigDataApplicationContextInitializer())
            .withConfiguration(AutoConfigurations.of(DataSourceAutoConfiguration.class))
            .withUserConfiguration(RequiredDbSettings.class);

    @Test
    void defaultProfileFailsToStartAndNamesTheMissingVariables() {
        runner.run(context -> assertThat(context).getFailure().rootCause()
                .hasMessageContaining("DB_URL")
                .hasMessageContaining("DB_USERNAME")
                .hasMessageContaining("DB_PASSWORD"));
    }

    @Test
    void failureNamesOnlyWhatIsMissingAndShowsNoValues() {
        runner.withPropertyValues("DB_URL=" + LOCAL_DB_URL, "DB_USERNAME=someone")
                .run(context -> assertThat(context).getFailure().rootCause()
                        .hasMessageContaining("DB_PASSWORD")
                        .hasMessageNotContaining("DB_URL")
                        .hasMessageNotContaining("DB_USERNAME")
                        .hasMessageNotContaining(LOCAL_DB_URL)
                        .hasMessageNotContaining("someone"));
    }

    /** Docker compose는 env 파일에 없는 변수를 빈 문자열로 넘긴다. 빈 값도 빠진 것으로 본다. */
    @ParameterizedTest
    @CsvSource({
            "DB_URL,      ''",
            "DB_URL,      '   '",
            "DB_USERNAME, ''",
            "DB_USERNAME, '   '",
            "DB_PASSWORD, ''",
            "DB_PASSWORD, '   '",
    })
    void blankValueCountsAsMissingAndIsNamedWithoutShowingValues(String blankVariable, String blankValue) {
        Map<String, String> given = new LinkedHashMap<>();
        given.put("DB_URL", LOCAL_DB_URL);
        given.put("DB_USERNAME", "someone");
        given.put("DB_PASSWORD", "secret");
        given.put(blankVariable, blankValue);
        String[] pairs = given.entrySet().stream()
                .map(entry -> entry.getKey() + "=" + entry.getValue())
                .toArray(String[]::new);
        List<String> others = given.keySet().stream().filter(name -> !name.equals(blankVariable)).toList();

        runner.withPropertyValues(pairs).run(context -> assertThat(context).getFailure().rootCause()
                .hasMessageContaining(blankVariable)
                .hasMessageNotContaining(others.get(0))
                .hasMessageNotContaining(others.get(1))
                .hasMessageNotContaining(LOCAL_DB_URL)
                .hasMessageNotContaining("someone")
                .hasMessageNotContaining("secret"));
    }

    @Test
    void defaultProfileStartsWhenAllThreeAreGivenAndLeavesTheBindAddressUnset() {
        runner.withPropertyValues("DB_URL=" + LOCAL_DB_URL, "DB_USERNAME=someone", "DB_PASSWORD=secret")
                .run(context -> {
                    assertThat(context).hasNotFailed();
                    assertThat(context.getEnvironment().getProperty("server.address")).isNull();
                });
    }

    @Test
    void localProfileSuppliesDbDefaultsAndBindsToLoopback() {
        runner.withPropertyValues("spring.profiles.active=local").run(context -> {
            assertThat(context).hasNotFailed();
            var env = context.getEnvironment();
            assertThat(env.getProperty("spring.datasource.url")).isEqualTo(LOCAL_DB_URL);
            assertThat(env.getProperty("spring.datasource.username")).isEqualTo("accountbook");
            assertThat(env.getProperty("spring.datasource.password")).isEqualTo("accountbook");
            assertThat(env.getProperty("server.address")).isEqualTo("127.0.0.1");
        });
    }

    @Test
    void localProfileSuppliesTheWebDevServerOriginButNoSigningKey() {
        runner.withPropertyValues("spring.profiles.active=local").run(context -> {
            var env = context.getEnvironment();
            assertThat(env.getProperty("WEB_ORIGIN")).isEqualTo(LOCAL_WEB_ORIGIN);
            assertThat(env.getProperty("ACCESS_TOKEN_SIGNING_KEY")).isNull();
        });
    }

    @Test
    void localProfileLetsTheVariableOverrideTheWebOrigin() {
        runner.withPropertyValues("spring.profiles.active=local", "WEB_ORIGIN=http://localhost:4173")
                .run(context -> assertThat(context.getEnvironment().getProperty("WEB_ORIGIN"))
                        .isEqualTo("http://localhost:4173"));
    }

    @Test
    void defaultProfileHasNoWebOriginOrSigningKey() {
        runner.withPropertyValues("DB_URL=" + LOCAL_DB_URL, "DB_USERNAME=someone", "DB_PASSWORD=secret")
                .run(context -> {
                    var env = context.getEnvironment();
                    assertThat(env.getProperty("WEB_ORIGIN")).isNull();
                    assertThat(env.getProperty("ACCESS_TOKEN_SIGNING_KEY")).isNull();
                });
    }
}
