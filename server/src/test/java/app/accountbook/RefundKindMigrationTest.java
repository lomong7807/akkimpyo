package app.accountbook;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import app.accountbook.support.IntegrationTest;
import com.zaxxer.hikari.HikariDataSource;
import java.sql.SQLException;
import java.util.UUID;
import javax.sql.DataSource;
import org.flywaydb.core.Flyway;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * V24(환불 구분 칸)를 V23까지 적용된 데이터 위에 올려 본다(#8). #8 전에는 양수 지출 라인이 곧 환불이었다.
 * TextMigrationTest와 같이 테스트 DB 안에 따로 만든 스키마에 실제 마이그레이션 파일을 적용하고, 테스트 트랜잭션 없이 돌며
 * 끝나면 스키마를 지운다. 읽을 때 같은 규칙을 쓰는 ChangeLogValue.read의 버전 1 경우는 ChangeLogValueReadTest가 본다.
 */
@IntegrationTest
@Transactional(propagation = Propagation.NOT_SUPPORTED)
class RefundKindMigrationTest {

    private static final String SCHEMA = "refund_kind_migration_check";

    @Autowired DataSource dataSource;

    String url;
    String username;
    String password;
    JdbcTemplate jdbc;

    @BeforeEach
    void setUp() throws SQLException {
        HikariDataSource app = dataSource.unwrap(HikariDataSource.class);
        url = app.getJdbcUrl() + (app.getJdbcUrl().contains("?") ? "&" : "?") + "currentSchema=" + SCHEMA;
        username = app.getUsername();
        password = app.getPassword();
        // 연결 풀을 거치지 않아 search_path가 앱의 연결에 남지 않는다.
        jdbc = new JdbcTemplate(new DriverManagerDataSource(url, username, password));
        dropSchema();
        migrate("23");
    }

    @AfterEach
    void tearDown() {
        dropSchema();
    }

    @Test
    void 양수_지출만_REFUND가_되고_음수_지출과_수입과_이체는_비며_version은_그대로다() {
        UUID user = insertUser();
        UUID ledger = insertLedger();
        UUID cash = insertAccount(ledger, "현금");
        UUID bank = insertAccount(ledger, "은행");
        UUID refund = insertTransaction(ledger, user, "EXPENSE");
        insertLine(refund, ledger, cash, 3_000);
        UUID expense = insertTransaction(ledger, user, "EXPENSE");
        insertLine(expense, ledger, cash, -12_000);
        UUID income = insertTransaction(ledger, user, "INCOME");
        insertLine(income, ledger, bank, 3_200_000);
        UUID transfer = insertTransaction(ledger, user, "TRANSFER");
        insertLine(transfer, ledger, bank, -50_000);
        insertLine(transfer, ledger, cash, 50_000);

        migrate("24");

        assertThat(refundKind(refund)).isEqualTo("REFUND");
        assertThat(refundKind(expense)).isNull();
        assertThat(refundKind(income)).isNull();
        assertThat(refundKind(transfer)).isNull();
        assertThat(jdbc.queryForList("select distinct version from transaction", Long.class)).containsExactly(1L);
        assertThatThrownBy(() -> jdbc.update("update transaction set refund_kind = 'REFUND' where id = ?", income))
                .hasMessageContaining("ck_transaction_refund_kind_expense");
        assertThatThrownBy(() -> jdbc.update("update transaction set refund_kind = 'refund' where id = ?", expense))
                .hasMessageContaining("ck_transaction_refund_kind_values");
    }

    private String refundKind(UUID transaction) {
        return jdbc.queryForObject("select refund_kind from transaction where id = ?", String.class, transaction);
    }

    private void migrate(String target) {
        Flyway.configure()
                .dataSource(url, username, password)
                .schemas(SCHEMA)
                .locations("classpath:db/migration")
                .target(target)
                .load()
                .migrate();
    }

    private void dropSchema() {
        jdbc.execute("drop schema if exists " + SCHEMA + " cascade");
    }

    private UUID insertUser() {
        UUID id = UUID.randomUUID();
        jdbc.update("insert into users (id, email, password_hash, display_name, created_at) values (?, ?, 'hash', ?, now())",
                id, id + "@example.com", "아낌이");
        return id;
    }

    private UUID insertLedger() {
        UUID id = UUID.randomUUID();
        jdbc.update("insert into ledger (id, name, created_at) values (?, '장부', now())", id);
        return id;
    }

    private UUID insertAccount(UUID ledger, String name) {
        UUID id = UUID.randomUUID();
        jdbc.update("""
                insert into account (id, ledger_id, name, type, opening_date, created_at)
                values (?, ?, ?, 'CASH', DATE '2026-11-01', now())
                """, id, ledger, name);
        return id;
    }

    private UUID insertTransaction(UUID ledger, UUID user, String type) {
        UUID id = UUID.randomUUID();
        jdbc.update("""
                insert into transaction (id, ledger_id, type, occurred_on, status, created_by, version, created_at,
                                         updated_at)
                values (?, ?, ?, DATE '2026-11-18', 'POSTED', ?, 1, now(), now())
                """, id, ledger, type, user);
        return id;
    }

    private void insertLine(UUID transaction, UUID ledger, UUID account, long amount) {
        jdbc.update("""
                insert into transaction_line (id, transaction_id, ledger_id, account_id, amount, created_at)
                values (?, ?, ?, ?, ?, now())
                """, UUID.randomUUID(), transaction, ledger, account, amount);
    }
}
