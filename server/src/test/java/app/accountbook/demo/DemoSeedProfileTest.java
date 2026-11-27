package app.accountbook.demo;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;

/** 쓰기 직전의 프로파일·DB 호스트 검사(#349). 운영은 프로파일이 없다(빈 값). DB를 쓰지 않는다. */
class DemoSeedProfileTest {

    @ParameterizedTest
    @ValueSource(strings = {"", "default", "prod", "local,prod", "prod,local", "local,default", "test"})
    void 운영이거나_다른_프로파일이_섞이면_거부한다(String profiles) {
        String[] active = profiles.isEmpty() ? new String[0] : profiles.split(",");

        assertThatThrownBy(() -> DemoSeed.requireAllowedProfiles(active))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("local 프로파일에서만");
    }

    /** 허용: 이 컴퓨터(Testcontainers 주소도 localhost다). 거부: 운영 compose의 호스트(db), 다른 컴퓨터, 섞인 호스트, 호스트 바꾸기. */
    @ParameterizedTest
    @CsvSource({"jdbc:postgresql://localhost:5433/a, true", "jdbc:postgresql://127.0.0.1/a, true", "'', false",
            "jdbc:postgresql://[::1]:5433/a?ssl=false, true", "'jdbc:postgresql://LOCALHOST:5433,127.0.0.1/a', true",
            "jdbc:postgresql://db:5432/accountbook, false", "jdbc:postgresql://marker.example.com/a, false",
            "jdbc:postgresql://10.0.0.5:5432/a, false", "'jdbc:postgresql://localhost,marker.example.com/a', false",
            "jdbc:postgresql://localhost:5433/a?PGHOST=marker.example.com, false", "jdbc:postgresql://[::2]/a, false",
            "jdbc:postgresql://localhost.marker.example/a, false", "jdbc:postgresql:marker, false"})
    void 이_컴퓨터의_DB만_허용하고_거부할_때_주소를_알리지_않는다(String url, boolean allowed) {
        if (allowed) {
            assertThatCode(() -> DemoSeed.requireLocalDatabase(url)).doesNotThrowAnyException();
        } else {
            assertThatThrownBy(() -> DemoSeed.requireLocalDatabase(url)).isInstanceOf(IllegalStateException.class)
                    .hasMessageContaining("이 컴퓨터의 DB").hasMessageNotContaining("marker");
        }
    }
}
