package app.accountbook.demo;

import static org.assertj.core.api.Assertions.assertThat;

import app.accountbook.support.IntegrationTest;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.ApplicationContext;

/** 운영(프로파일 없음)으로 띄운 컨텍스트에는 시드 빈이 없어 {@code demo.seed}를 줘도 아무것도 하지 않는다(#349). */
@IntegrationTest
class DemoSeedProductionTest {

    @Autowired
    ApplicationContext context;

    @Test
    void 운영_프로파일로_띄운_컨텍스트에는_시드_빈이_없다() {
        assertThat(context.getEnvironment().getActiveProfiles()).isEmpty();
        assertThat(context.getBeanNamesForType(DemoSeed.class)).isEmpty();
    }
}
