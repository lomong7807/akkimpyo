package app.accountbook.support;

import java.time.Clock;
import java.time.Instant;
import java.time.ZoneId;
import java.time.ZoneOffset;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Primary;

/** 운영 시계 대신 테스트가 정한 시각에 멈춘 시계를 쓰게 한다. */
@TestConfiguration(proxyBeanMethods = false)
public class StoppedClockConfig {

    @Bean
    @Primary
    StoppedClock stoppedClock() {
        return new StoppedClock();
    }

    public static final class StoppedClock extends Clock {

        private volatile Instant now = Instant.EPOCH;

        public void stopAt(Instant instant) {
            now = instant;
        }

        @Override
        public Instant instant() {
            return now;
        }

        @Override
        public ZoneId getZone() {
            return ZoneOffset.UTC;
        }

        @Override
        public Clock withZone(ZoneId zone) {
            return this;
        }
    }
}
