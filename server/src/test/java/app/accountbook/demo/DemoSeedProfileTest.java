package app.accountbook.demo;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

/** 시드를 쓰기 직전의 프로파일 검사(#349). 운영은 프로파일이 없다(빈 값). DB를 쓰지 않는다. */
class DemoSeedProfileTest {

    @Test
    void local만_켜져_있으면_허용한다() {
        assertThatCode(() -> DemoSeed.requireAllowedProfiles("local")).doesNotThrowAnyException();
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
