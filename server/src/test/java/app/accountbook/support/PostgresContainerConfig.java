package app.accountbook.support;

import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.boot.testcontainers.service.connection.ServiceConnection;
import org.springframework.context.annotation.Bean;
import org.testcontainers.postgresql.PostgreSQLContainer;
import org.testcontainers.utility.DockerImageName;

/**
 * 테스트 JVM 전체가 PostgreSQL 17 컨테이너 1개를 공유한다.
 * 컨테이너는 static 필드라서 스프링 컨텍스트가 여러 개 생겨도 하나뿐이다.
 * 컨텍스트가 닫힐 때 멈추지 않도록 destroyMethod를 비우고, 정리는 JVM 종료 시 Testcontainers(Ryuk)가 한다.
 */
@TestConfiguration(proxyBeanMethods = false)
class PostgresContainerConfig {

    private static final PostgreSQLContainer POSTGRES =
            new PostgreSQLContainer(DockerImageName.parse("postgres:17"));

    @Bean(destroyMethod = "")
    @ServiceConnection
    PostgreSQLContainer postgresContainer() {
        return POSTGRES;
    }
}
