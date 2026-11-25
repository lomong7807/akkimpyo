package app.accountbook.common;

import java.time.Clock;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * 운영용 시계. "오늘"이 필요한 코드는 이 빈을 주입받아 쓰고 시계를 직접 읽지 않는다.
 * 시계의 시간대(UTC)에는 뜻이 없다. 날짜는 쓰는 쪽이 장부 시간대로 바꿔 구한다.
 */
@Configuration(proxyBeanMethods = false)
public class ClockConfig {

    @Bean
    Clock clock() {
        return Clock.systemUTC();
    }
}
