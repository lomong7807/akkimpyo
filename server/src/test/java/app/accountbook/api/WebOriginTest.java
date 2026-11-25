package app.accountbook.api;

import static java.nio.charset.StandardCharsets.UTF_8;
import static org.assertj.core.api.Assertions.assertThat;

import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.core.env.MapPropertySource;

/** 우리 출처는 환경 변수로만 받고, 없거나 브라우저가 보내는 모양이 아니면 서버가 뜨지 않는다(ADR 001 결정 5). */
class WebOriginTest {

    private static final String VARIABLE = "WEB_ORIGIN";

    @ParameterizedTest
    @ValueSource(strings = {"https://akkimpyo.example.com", "https://example.com:8443", "https://a-b.example.com:1",
            "https://example.com:65535", "https://xn--o39an51b.example", "https://192.0.2.1", "https://localhost:5173",
            "http://localhost", "http://localhost:5173"})
    void 브라우저가_보내는_모양의_출처를_받는다(String value) {
        withVariable(value).run(context -> {
            assertThat(context).hasNotFailed();
            assertThat(context.getBean(WebOrigin.class).matches(value)).isTrue();
        });
    }

    @Test
    void 글자_그대로_같은_값만_우리_출처다() {
        withVariable("https://example.com").run(context -> {
            WebOrigin origin = context.getBean(WebOrigin.class);

            assertThat(new String[] {"https://example.com:443", "https://EXAMPLE.com", "HTTPS://example.com",
                    "https://example.com/", "https://example.com ", " https://example.com", "http://example.com",
                    "https://example.com.", "https://www.example.com", "https://example.com.evil.example",
                    "https://evil.example/https://example.com", "null", "*", "", "example.com"})
                    .noneMatch(origin::matches);
            assertThat(origin.matches("https://example.com")).isTrue();
        });
    }

    @Test
    void 환경_변수가_없으면_뜨지_않고_이름을_알려_준다() {
        new ApplicationContextRunner().withUserConfiguration(WebOrigin.class).run(context ->
                assertThat(context).getFailure().rootCause()
                        .isExactlyInstanceOf(IllegalStateException.class).hasMessageContaining(VARIABLE));
    }

    @Test
    void 레포의_설정에는_기본값이_없다() {
        assertThat(WebOriginTest.class.getResourceAsStream("/application.yml"))
                .asString(UTF_8).doesNotContain(VARIABLE);
    }

    @ParameterizedTest
    @ValueSource(strings = {"", " ", "null", "*", "example.com", "//example.com",
            // 글자 그대로 비교하므로 브라우저가 보내지 않는 모양이면 모든 요청이 거절된다
            "https://", "https://example.com/", "https://example.com/app", "https://example.com?x", "https://example.com#x",
            "https://Example.com", "HTTPS://example.com", "https://example.com.", "https://.example.com",
            "https://example..com", "https://-a.example.com", "https://a-.example.com", "https://a_b.example.com",
            "https://아낌표.example", "https://user@example.com", "https://*.example.com", "https://[::1]",
            "https://example.com ", " https://example.com", "https://example.com\n",
            "https://example.com,https://b.example.com", "https://example.com https://b.example.com",
            // 포트
            "https://example.com:", "https://example.com:443", "https://example.com:0", "https://example.com:08443",
            "https://example.com:65536", "https://example.com:99999", "https://example.com:x", "http://localhost:80",
            // 평문은 로컬 개발의 localhost뿐이다
            "http://example.com", "http://127.0.0.1:5173", "http://localhost.example.com", "http://localhost:5173/",
            "http://LOCALHOST:5173", "ws://example.com", "file://"})
    void 출처가_아닌_값이면_뜨지_않는다(String value) {
        withVariable(value).run(context -> assertThat(context).getFailure().rootCause()
                .isExactlyInstanceOf(IllegalStateException.class).hasMessageContaining(VARIABLE));
    }

    private static ApplicationContextRunner withVariable(String value) {
        return new ApplicationContextRunner()
                .withUserConfiguration(WebOrigin.class)
                .withInitializer(context -> context.getEnvironment().getPropertySources()
                        .addFirst(new MapPropertySource("variables", Map.of(VARIABLE, value))));
    }
}
