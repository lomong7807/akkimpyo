package app.accountbook;

import static org.assertj.core.api.Assertions.assertThat;

import app.accountbook.common.RequiredDbSettings;
import org.junit.jupiter.api.Test;
import org.springframework.boot.autoconfigure.AutoConfigurations;
import org.springframework.boot.jdbc.autoconfigure.DataSourceAutoConfiguration;
import org.springframework.boot.test.context.ConfigDataApplicationContextInitializer;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

/**
 * 프로파일별 설정 파일(application.yml, application-local.yml)이 정한 동작.
 * DB에 접속하지 않는다: 설정 파일을 읽고 DataSource 자동 설정까지만 올린다.
 * 환경 변수 DB_URL, DB_USERNAME, DB_PASSWORD가 없는 환경(CI와 평소 개발 환경)을 전제로 한다.
 */
class ProfileConfigTest {

    private static final String LOCAL_DB_URL = "jdbc:postgresql://localhost:5433/accountbook";

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
}
