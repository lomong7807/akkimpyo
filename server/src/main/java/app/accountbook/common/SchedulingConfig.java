package app.accountbook.common;

import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableScheduling;

/** 매일 도는 정리 작업(휴지통 30일 자동 삭제, #9)을 켠다. 작업마다 cron 설정을 {@code -}로 두면 그 작업만 꺼진다. */
@Configuration(proxyBeanMethods = false)
@EnableScheduling
public class SchedulingConfig {
}
