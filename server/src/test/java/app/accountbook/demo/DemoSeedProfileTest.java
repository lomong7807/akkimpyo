package app.accountbook.demo;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.List;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.config.BeanDefinition;
import org.springframework.context.annotation.ClassPathScanningCandidateComponentProvider;
import org.springframework.core.env.StandardEnvironment;

/** 시드 빈의 프로파일 조건과 쓰기 직전의 프로파일 검사(#349). 운영은 프로파일이 없다(빈 값). DB를 쓰지 않는다. */
class DemoSeedProfileTest {

    @ParameterizedTest
    @CsvSource({"local, true", "'', false", "prod, false", "test, false"})
    void 컴포넌트_스캔은_local_프로파일에서만_시드_빈을_만든다(String profile, boolean created) {
        StandardEnvironment environment = new StandardEnvironment();
        environment.setActiveProfiles(profile.isEmpty() ? new String[0] : new String[] {profile});

        assertThat(new ClassPathScanningCandidateComponentProvider(true, environment)
                .findCandidateComponents("app.accountbook.demo"))
                .extracting(BeanDefinition::getBeanClassName)
                .containsExactlyElementsOf(created ? List.of(DemoSeed.class.getName()) : List.of());
    }

    @ParameterizedTest
    @ValueSource(strings = {"", "default", "prod", "local,prod", "prod,local", "local,default", "test"})
    void 운영이거나_다른_프로파일이_섞이면_거부한다(String profiles) {
        String[] active = profiles.isEmpty() ? new String[0] : profiles.split(",");

        assertThatThrownBy(() -> DemoSeed.requireAllowedProfiles(active))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("local 프로파일에서만");
    }
}
