package app.accountbook.support;

import java.lang.annotation.Documented;
import java.lang.annotation.ElementType;
import java.lang.annotation.Retention;
import java.lang.annotation.RetentionPolicy;
import java.lang.annotation.Target;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.transaction.annotation.Transactional;

/**
 * 서비스 통합 테스트용 메타 어노테이션.
 * 실제 PostgreSQL 17(Testcontainers, 테스트 전체가 컨테이너 1개 공유)에 스프링 컨텍스트를 띄우고,
 * 각 테스트를 트랜잭션으로 감싸 끝나면 롤백한다. 테스트 준비용 {@link Fixtures}도 등록한다.
 * 비밀번호 해시는 가벼운 Argon2id 인코더({@link TestPasswordEncoderConfig})로 바꿔 쓴다.
 */
@Target(ElementType.TYPE)
@Retention(RetentionPolicy.RUNTIME)
@Documented
@SpringBootTest
@Import({PostgresContainerConfig.class, TestPasswordEncoderConfig.class, Fixtures.class})
@Transactional
public @interface IntegrationTest {
}
