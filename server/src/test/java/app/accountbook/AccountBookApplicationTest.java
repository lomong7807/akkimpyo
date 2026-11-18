package app.accountbook;

import static org.assertj.core.api.Assertions.assertThat;

import app.accountbook.support.IntegrationTest;
import javax.sql.DataSource;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

@IntegrationTest
class AccountBookApplicationTest {

    @Autowired
    DataSource dataSource;

    @Test
    void contextLoadsAgainstPostgres() throws Exception {
        try (var c = dataSource.getConnection()) {
            assertThat(c.getMetaData().getDatabaseProductName()).isEqualTo("PostgreSQL");
        }
    }
}
