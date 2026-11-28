package app.accountbook.api;

import app.accountbook.support.HttpServerTest;
import app.accountbook.support.StoppedClockConfig;
import app.accountbook.user.UserService;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;

/** 접근 제한 테스트들이 시계가 멈춘 서버 하나를 나눠 쓰게 한다. */
@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
@HttpServerTest
@MockitoSpyBean(types = UserService.class)
@Import({AccessProbeController.class, SessionCounter.class, HttpsRequestFilter.class, ThrowingFilter.class,
        StoppedClockConfig.class})
@interface AccessTest {
}
