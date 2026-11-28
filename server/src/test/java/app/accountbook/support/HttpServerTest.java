package app.accountbook.support;

import app.accountbook.user.TestPasswordHasherConfig;
import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.context.SpringBootTest.WebEnvironment;
import org.springframework.context.annotation.Import;

/**
 * 실제 Tomcat을 빈 포트에 띄우고 HTTP로 부르는 테스트용 메타 어노테이션. 필터와 Tomcat이 직접 내는 응답까지 본다.
 * 요청은 다른 스레드에서 처리되므로 {@link IntegrationTest}와 달리 롤백되지 않는다. {@link SignedInUser}로 로그인해 부른다.
 * 테스트 컨텍스트마다 연결 풀이 따로 생겨 PostgreSQL의 연결 상한에 가까워지므로 풀을 작게 둔다.
 */
@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
@Documented
@SpringBootTest(webEnvironment = WebEnvironment.RANDOM_PORT,
        properties = {"spring.datasource.hikari.maximum-pool-size=2", "WEB_ORIGIN=" + HttpServerTest.ORIGIN,
                HttpServerTest.SIGNUP_ALLOWLIST, HttpServerTest.NO_SCHEDULED_JOBS})
@Import({PostgresContainerConfig.class, TestPasswordHasherConfig.class, TestAccessTokens.KeyConfig.class,
        SignedInUser.class})
public @interface HttpServerTest {

    /** 운영에서 환경 변수로 받는 우리 출처. */
    String ORIGIN = "https://app.example.com";

    /** 가입 허용 목록(P-102). 테스트용 도메인은 테스트 설정에만 있고 운영 기본값에는 없다(SignupAllowlistTest). */
    String SIGNUP_ALLOWLIST = "SIGNUP_ALLOWLIST=@example.com";

    /** 매일 도는 작업(30일 자동 삭제)을 끈다. 테스트는 작업 메서드를 직접 부른다(TrashAutoPurgeTest). */
    String NO_SCHEDULED_JOBS = "accountbook.trash-purge.cron=-";
}
