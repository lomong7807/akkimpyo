package app.accountbook;

import static org.assertj.core.api.Assertions.assertThat;

import app.accountbook.support.IntegrationTest;
import com.zaxxer.hikari.HikariDataSource;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.ResultSet;
import java.sql.SQLException;
import java.sql.Statement;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.autoconfigure.AutoConfigurations;
import org.springframework.boot.jdbc.autoconfigure.DataSourceAutoConfiguration;
import org.springframework.boot.test.context.ConfigDataApplicationContextInitializer;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

/**
 * 앱의 DB 연결은 실행할 때마다 값에 맞춘 계획을 세운다(#112).
 * 같은 문장을 되풀이하면 드라이버가 서버 쪽 준비된 문장으로 바꾸고, PostgreSQL은 그 뒤 값과 무관한 일반 계획을 고를 수 있다.
 * application.yml의 connection-init-sql이 연결을 만들 때 막는다.
 */
@IntegrationTest
class PlanCacheModeTest {

    private static final String FORCE_CUSTOM_PLAN = "force_custom_plan";

    /** 드라이버는 5번째 실행에서 준비된 문장을 만들고, 서버는 값에 맞춘 계획 5번 뒤인 10번째부터 일반 계획을 쓸 수 있다. */
    private static final int RUNS = 14;

    @Autowired HikariDataSource dataSource;

    @Test
    void connectionOfTheAppPoolForcesCustomPlans() throws SQLException {
        try (Connection pooled = dataSource.getConnection()) {
            assertThat(planCacheMode(pooled)).isEqualTo(FORCE_CUSTOM_PLAN);
        }
        // 대조: 같은 DB에 풀 없이 붙으면 PostgreSQL 기본값이다. 위의 값은 DB 설정이 아니라 풀이 건 것이다.
        try (Connection plain = plainConnection()) {
            assertThat(planCacheMode(plain)).isEqualTo("auto");
        }
    }

    @Test
    void connectionMadeLaterAlsoForcesCustomPlans() {
        withPoolOfOneConnection(pool -> {
            int evicted;
            try (Connection first = pool.getConnection()) {
                evicted = backendPid(first);
                pool.evictConnection(first);
            }
            try (Connection later = pool.getConnection()) {
                assertThat(backendPid(later)).isNotEqualTo(evicted);
                assertThat(planCacheMode(later)).isEqualTo(FORCE_CUSTOM_PLAN);
            }
        });
    }

    @Test
    void settingSurvivesRollbackOfTheFirstTransaction() {
        // 트랜잭션 안에서 실행한 SET은 롤백하면 되돌아간다. 풀이 트랜잭션 밖에서(자동 커밋으로) 실행해야 남는다.
        withPoolOfOneConnection(pool -> {
            try (Connection connection = pool.getConnection()) {
                connection.setAutoCommit(false);
                assertThat(planCacheMode(connection)).isEqualTo(FORCE_CUSTOM_PLAN);
                connection.rollback();

                assertThat(planCacheMode(connection)).isEqualTo(FORCE_CUSTOM_PLAN);
            }
        });
    }

    @Test
    void connectionReturnedToThePoolKeepsTheSetting() {
        withPoolOfOneConnection(pool -> {
            int returned;
            try (Connection connection = pool.getConnection()) {
                returned = backendPid(connection);
            }
            try (Connection reused = pool.getConnection()) {
                assertThat(backendPid(reused)).isEqualTo(returned);
                assertThat(planCacheMode(reused)).isEqualTo(FORCE_CUSTOM_PLAN);
            }
        });
    }

    @Test
    void repeatedStatementNeverGetsAGenericPlan() throws SQLException {
        Plans withoutSetting;
        try (Connection plain = plainConnection()) {
            withoutSetting = plansAfterRepeating(plain);
        }
        // 대조: 설정이 없으면 이만큼 되풀이했을 때 일반 계획으로 바뀐다.
        assertThat(withoutSetting.generic()).isPositive();

        // 준비된 문장으로 바뀐 뒤의 실행이 모두 값에 맞춘 계획이다.
        Plans allCustom = new Plans(withoutSetting.custom() + withoutSetting.generic(), 0);
        withPoolOfOneConnection(pool -> {
            try (Connection connection = pool.getConnection()) {
                assertThat(plansAfterRepeating(connection)).isEqualTo(allCustom);
            }
        });
    }

    /** 운영처럼 DB_URL 등으로 접속하고 application.yml만 읽어 만든, 연결이 하나인 풀. 어느 연결을 받는지 정해져 있다. */
    private void withPoolOfOneConnection(PoolAction action) {
        new ApplicationContextRunner()
                .withInitializer(new ConfigDataApplicationContextInitializer())
                .withConfiguration(AutoConfigurations.of(DataSourceAutoConfiguration.class))
                .withPropertyValues(
                        "DB_URL=" + dataSource.getJdbcUrl(),
                        "DB_USERNAME=" + dataSource.getUsername(),
                        "DB_PASSWORD=" + dataSource.getPassword(),
                        "spring.datasource.hikari.maximum-pool-size=1")
                .run(context -> action.run(context.getBean(HikariDataSource.class)));
    }

    private Connection plainConnection() throws SQLException {
        return DriverManager.getConnection(
                dataSource.getJdbcUrl(), dataSource.getUsername(), dataSource.getPassword());
    }

    /** Hibernate처럼 실행할 때마다 문장을 만들고 닫는다. 표를 읽지 않는 문장이라 어느 계획이 싼지가 통계에 따라 바뀌지 않는다. */
    private static Plans plansAfterRepeating(Connection connection) throws SQLException {
        for (int run = 1; run <= RUNS; run++) {
            try (PreparedStatement statement = connection.prepareStatement("select ?::int as plan_cache_mode_test")) {
                statement.setInt(1, run);
                statement.executeQuery().close();
            }
        }
        try (Statement statement = connection.createStatement();
             ResultSet rows = statement.executeQuery("""
                     select custom_plans, generic_plans from pg_prepared_statements
                     where statement = 'select $1::int as plan_cache_mode_test'
                     """)) {
            assertThat(rows.next()).as("서버 쪽 준비된 문장이 있다").isTrue();
            return new Plans(rows.getLong(1), rows.getLong(2));
        }
    }

    private static String planCacheMode(Connection connection) throws SQLException {
        try (Statement statement = connection.createStatement();
             ResultSet rows = statement.executeQuery("show plan_cache_mode")) {
            rows.next();
            return rows.getString(1);
        }
    }

    private static int backendPid(Connection connection) throws SQLException {
        try (Statement statement = connection.createStatement();
             ResultSet rows = statement.executeQuery("select pg_backend_pid()")) {
            rows.next();
            return rows.getInt(1);
        }
    }

    private record Plans(long custom, long generic) {
    }

    @FunctionalInterface
    private interface PoolAction {
        void run(HikariDataSource pool) throws SQLException;
    }
}
