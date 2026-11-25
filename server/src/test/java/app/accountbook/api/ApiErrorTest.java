package app.accountbook.api;

import app.accountbook.support.HttpServerTest;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.TestPropertySource;

/** 공통 오류 처리 테스트들이 서버 하나를 나눠 쓰게 한다. 본문을 기다리는 시간은 시험할 수 있게 줄인다. */
@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
@HttpServerTest
@TestPropertySource(properties = "server.tomcat.connection-timeout=3s")
@Import({ErrorProbeController.class, ThrowingFilter.class})
@interface ApiErrorTest {
}
