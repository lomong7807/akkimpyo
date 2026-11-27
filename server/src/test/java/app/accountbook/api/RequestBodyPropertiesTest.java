package app.accountbook.api;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.core.env.SystemEnvironmentPropertySource;
import org.springframework.util.unit.DataSize;

/** 요청 본문 상한의 설정(#21). 설정이 없으면 64KB이고, 잘못된 값이면 서버가 뜨지 않는다. DB 없이 돈다. */
class RequestBodyPropertiesTest {

    private final ApplicationContextRunner runner =
            new ApplicationContextRunner().withUserConfiguration(RequestBodyConfig.class);

    @Test
    void 설정이_없으면_64KB다() {
        runner.run(context -> assertThat(context.getBean(RequestBodyProperties.class).maxSize().toBytes())
                .isEqualTo(65_536));
    }

    /** 환경변수를 비워 둔 것은 설정하지 않은 것이다. 상한이 꺼지지 않는다. */
    @Test
    void 빈_값도_64KB다() {
        runner.withPropertyValues("accountbook.request-body.max-size=")
                .run(context -> assertThat(context.getBean(RequestBodyProperties.class).maxSize())
                        .isEqualTo(DataSize.ofKilobytes(64)));
    }

    @ParameterizedTest
    @CsvSource({"1KB, 1024", "1024, 1024", "32KB, 32768", "1MB, 1048576", "1048576B, 1048576"})
    void 속성으로_바꿀_수_있다(String value, long bytes) {
        runner.withPropertyValues("accountbook.request-body.max-size=" + value)
                .run(context -> assertThat(context.getBean(RequestBodyProperties.class).maxSize().toBytes())
                        .isEqualTo(bytes));
    }

    @Test
    void 환경변수로_바꿀_수_있다() {
        Map<String, Object> variables = Map.of("ACCOUNTBOOK_REQUESTBODY_MAXSIZE", "128KB");
        runner.withInitializer(context -> context.getEnvironment().getPropertySources()
                        .addFirst(new SystemEnvironmentPropertySource("test-systemEnvironment", variables)))
                .run(context -> assertThat(context.getBean(RequestBodyProperties.class).maxSize())
                        .isEqualTo(DataSize.ofKilobytes(128)));
    }

    /** 64는 단위를 빠뜨린 64바이트다. 큰 값은 요청마다 그만큼을 메모리에 담는다. */
    @ParameterizedTest
    @ValueSource(strings = {"0", "-1", "-64KB", "64", "1023", "1048577", "2MB", "1GB", "9223372036854775807",
            "many", "64 kilo", "1.5MB"})
    void 잘못된_값이면_뜨지_않는다(String value) {
        runner.withPropertyValues("accountbook.request-body.max-size=" + value)
                .run(context -> assertThat(context).hasFailed());
    }

    @Test
    void 범위_밖이면_속성_이름과_범위를_알린다() {
        runner.withPropertyValues("accountbook.request-body.max-size=64")
                .run(context -> assertThat(context.getStartupFailure())
                        .rootCause()
                        .hasMessageContaining("accountbook.request-body.max-size")
                        .hasMessageContaining("1KB")
                        .hasMessageContaining("1MB"));
    }
}
