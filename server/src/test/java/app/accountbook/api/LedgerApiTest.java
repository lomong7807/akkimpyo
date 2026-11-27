package app.accountbook.api;

import app.accountbook.account.AccountRepository;
import app.accountbook.account.AccountService;
import app.accountbook.stats.BalanceQuery;
import app.accountbook.support.Fixtures;
import app.accountbook.support.HttpServerTest;
import app.accountbook.support.StoppedClockConfig;
import app.accountbook.user.UserService;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;
import org.springframework.context.annotation.Import;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;

/**
 * 장부 경로 API의 HTTP 테스트들이 시계가 멈춘 서버 하나를 나눠 쓰게 한다. 서비스가 불렸는지 보려고 감싼다.
 * 요청은 롤백되지 않으므로 테스트마다 새 사용자와 장부를 만든다.
 */
@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
@HttpServerTest
@MockitoSpyBean(types = {UserService.class, AccountService.class, AccountRepository.class, BalanceQuery.class})
@Import({Fixtures.class, StoppedClockConfig.class, LedgerProbeController.class})
@interface LedgerApiTest {
}
