package app.accountbook.user;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.NullSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.boot.test.context.ConfigDataApplicationContextInitializer;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.mock.env.MockEnvironment;

/** 가입 허용 목록의 설정(P-102, F-003). DB를 쓰지 않는다. 환경 변수 SIGNUP_ALLOWLIST가 없는 셸(CI, 평소 개발 환경)을 전제로 한다. */
class SignupAllowlistTest {

    /** 도메인 항목은 그 도메인 그대로만 받는다. */
    @Test
    void 이메일과_도메인_항목을_맞춘_값으로_비교한다() {
        SignupAllowlist allowlist = of(" Owner@Example.COM ,@Family.Example\t");

        assertThat(List.of("owner@example.com", "anyone@family.example")).allMatch(allowlist::allows);
        assertThat(List.of("other@example.com", "anyone@sub.family.example", "anyone@family.example.org",
                "family.example@other.example", "anyone@xfamily.example")).noneMatch(allowlist::allows);
    }

    @ParameterizedTest
    @NullSource
    @ValueSource(strings = {"", "   "})
    void 없거나_비었으면_아무도_가입할_수_없다(String value) {
        assertThat(of(value).allows("owner@example.com")).isFalse();
    }

    @ParameterizedTest
    @ValueSource(strings = {"*", "@", "marker", "marker@", "@marker@marker.example", "marker@marker.example,",
            "marker@marker.example,,marker2@marker.example", "marker@exam ple.example", "@마커.example"})
    void 이메일도_도메인도_아닌_항목이_있으면_뜨지_않고_값을_알리지_않는다(String value) {
        assertThatThrownBy(() -> of(value))
                .isExactlyInstanceOf(IllegalStateException.class)
                .hasNoCause()
                .hasMessageContaining(SignupAllowlist.VARIABLE)
                .hasMessageNotContaining("marker")
                .hasMessageNotContaining("마커");
    }

    /** 운영(프로파일 없음)과 local의 설정 파일에는 기본값이 없다. 테스트용 도메인은 테스트 설정(HttpServerTest)에만 있다. */
    @ParameterizedTest
    @ValueSource(strings = {"default", "local"})
    void 레포의_설정에는_기본값이_없어_아무도_가입할_수_없다(String profile) {
        new ApplicationContextRunner()
                .withInitializer(new ConfigDataApplicationContextInitializer())
                .withPropertyValues("spring.profiles.active=" + profile)
                .withUserConfiguration(SignupAllowlist.class)
                .run(context -> {
                    assertThat(context).hasNotFailed();
                    assertThat(context.getEnvironment().getProperty(SignupAllowlist.VARIABLE)).isNull();
                    assertThat(context.getBean(SignupAllowlist.class).allows("owner@example.com")).isFalse();
                });
    }

    private static SignupAllowlist of(String value) {
        MockEnvironment environment = new MockEnvironment();
        if (value != null) {
            environment.setProperty(SignupAllowlist.VARIABLE, value);
        }
        return new SignupAllowlist(environment);
    }
}
