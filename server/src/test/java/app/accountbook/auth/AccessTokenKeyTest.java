package app.accountbook.auth;

import static java.nio.charset.StandardCharsets.UTF_8;
import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.params.provider.Arguments.argumentSet;

import app.accountbook.support.TestAccessTokens;
import java.io.PrintWriter;
import java.io.StringWriter;
import java.util.Base64;
import java.util.Map;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.core.env.MapPropertySource;

/** 서명 키는 환경 변수로만 받고, 없거나 256비트보다 짧으면 서버가 뜨지 않는다(ADR 001 결정 2). */
class AccessTokenKeyTest {

    private static final String VARIABLE = "ACCESS_TOKEN_SIGNING_KEY";

    @ParameterizedTest
    @ValueSource(ints = {32, 33, 48, 64})
    void 키가_256비트_이상이면_그대로_쓴다(int bytes) {
        byte[] key = TestAccessTokens.randomKey(bytes);

        withVariable(Base64.getEncoder().encodeToString(key)).run(context -> {
            assertThat(context).hasNotFailed();
            assertThat(context.getBean(AccessTokenKey.class).value().getEncoded()).isEqualTo(key);
        });
    }

    @Test
    void 환경_변수가_없으면_뜨지_않고_이름을_알려_준다() {
        new ApplicationContextRunner().withUserConfiguration(AccessTokenKey.class).run(context ->
                assertThat(context).getFailure().rootCause()
                        .isExactlyInstanceOf(IllegalStateException.class).hasMessageContaining(VARIABLE));
    }

    @Test
    void 레포의_설정에는_기본값이_없다() {
        assertThat(AccessTokenKeyTest.class.getResourceAsStream("/application.yml"))
                .asString(UTF_8).doesNotContain(VARIABLE);
    }

    static Stream<Arguments> badKeys() {
        return Stream.of(
                argumentSet("빈 값", ""),
                argumentSet("공백", "   "),
                argumentSet("한 바이트", "QQ=="),
                argumentSet("128비트", base64(16)),
                argumentSet("248비트", base64(31)),
                argumentSet("Base64가 아니다", "marker-plain-text-signing-key-that-is-long-enough!"),
                argumentSet("16진수는 길어도 Base64로 읽으면 192비트다", "0123456789abcdef0123456789abcdef"),
                argumentSet("URL용 Base64", "-_" + base64(40)),
                argumentSet("뒤에 줄바꿈", base64(32) + "\n"),
                argumentSet("가운데 줄바꿈", base64(32) + "\n" + base64(32)),
                argumentSet("따옴표", "\"" + base64(32) + "\""),
                argumentSet("풀 수 없는 자리표시", "marker${marker-inside}marker"),
                argumentSet("식", "#{marker.inside}marker"));
    }

    @ParameterizedTest
    @MethodSource("badKeys")
    void 쓸_수_없는_키면_뜨지_않고_값은_오류에_없다(String value) {
        withVariable(value).run(context -> {
            assertThat(context).hasFailed();
            StringWriter trace = new StringWriter();
            context.getStartupFailure().printStackTrace(new PrintWriter(trace, true));
            assertThat(trace.toString()).contains(VARIABLE).doesNotContain("marker");
            if (value.strip().length() > 8) {
                assertThat(trace.toString()).doesNotContain(value.strip());
            }
        });
    }

    private static ApplicationContextRunner withVariable(String value) {
        return new ApplicationContextRunner()
                .withUserConfiguration(AccessTokenKey.class)
                .withInitializer(context -> context.getEnvironment().getPropertySources()
                        .addFirst(new MapPropertySource("variables", Map.of(VARIABLE, value))));
    }

    private static String base64(int bytes) {
        return Base64.getEncoder().encodeToString(TestAccessTokens.randomKey(bytes));
    }
}
