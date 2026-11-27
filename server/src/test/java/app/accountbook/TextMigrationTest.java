package app.accountbook;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import app.accountbook.support.IntegrationTest;
import com.zaxxer.hikari.HikariDataSource;
import java.sql.SQLException;
import java.text.Normalizer;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import javax.sql.DataSource;
import org.flywaydb.core.Flyway;
import org.flywaydb.core.api.FlywayException;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * V17(이름 NFC 채우기)과 V18(글자 제약)을 V16까지 적용된 데이터 위에 올려 본다(이슈 #123).
 * 테스트 DB 안에 따로 만든 스키마에 실제 마이그레이션 파일을 V16까지 적용하고, 그 위에 행을 넣은 뒤 나머지를 적용한다.
 * 적용 전 확인 쿼리(PR 본문에 같은 쿼리를 적는다)가 실패할 행을 찾는지도 본다.
 * 마이그레이션이 커밋해야 보이므로 테스트 트랜잭션 없이 돌고, 끝나면 스키마를 지운다.
 */
@IntegrationTest
@Transactional(propagation = Propagation.NOT_SUPPORTED)
class TextMigrationTest {

    private static final String SCHEMA = "text_migration_check";

    private static final String SPACES =
            "U&'\\0020\\00A0\\1680\\2000\\2001\\2002\\2003\\2004\\2005\\2006\\2007\\2008\\2009\\200A\\202F\\205F\\3000'";

    /** 확인 1: NFC로 바꾸면 유니크(uq_account_name, uq_category_name)에 걸리는 이름. V17이 실패한다. */
    static final String COLLIDING_AFTER_NFC = """
            select 'account' as tbl, ledger_id::text as scope, normalize(name, NFC) as nfc_name, count(*) as n
              from account
             group by ledger_id, normalize(name, NFC)
            having count(*) > 1
            union all
            select 'category', ledger_id::text || '/' || kind || '/' || coalesce(parent_id::text, '-'),
                   normalize(name, NFC), count(*)
              from category
             group by ledger_id, kind, parent_id, normalize(name, NFC)
            having count(*) > 1
            """;

    /** 확인 2: NFC로 바꾸면 글자 수 상한을 넘는 이름. V17이 실패한다. */
    static final String TOO_LONG_AFTER_NFC = """
            select 'account' as tbl, id from account where char_length(normalize(name, NFC)) > 50
            union all
            select 'category', id from category where char_length(normalize(name, NFC)) > 20
            union all
            select 'users', id from users where char_length(normalize(display_name, NFC)) > 20
            """;

    /** 확인 3: V18에 걸리는 행(앞뒤 공백류, 제어 문자, 맞추지 않은 가맹점·메모). 채우지 않으므로 먼저 고친다. */
    static final String REJECTED_BY_V18 = """
            select 'account' as tbl, id from account
             where name <> btrim(name, %1$s) or (name collate "C") ~ '[\\x01-\\x1F\\x7F-\\x9F]'
            union all
            select 'category', id from category
             where name <> btrim(name, %1$s) or (name collate "C") ~ '[\\x01-\\x1F\\x7F-\\x9F]'
            union all
            select 'users', id from users
             where display_name <> btrim(display_name, %1$s)
                or (display_name collate "C") ~ '[\\x01-\\x1F\\x7F-\\x9F]'
            union all
            select 'transaction', id from transaction
             where payee is not nfc normalized or payee <> btrim(payee, %1$s) or payee = ''
                or (payee collate "C") ~ '[\\x01-\\x1F\\x7F-\\x9F]'
                or memo is not nfc normalized or (memo collate "C") ~ '[\\x01-\\x09\\x0B-\\x1F\\x7F-\\x9F]'
            """.formatted(SPACES);

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
        migrate("16");
    }

    @AfterEach
    void tearDown() {
        dropSchema();
    }

    @Test
    void decomposedNamesBecomeComposedAndConstraintsApply() {
        UUID user = insertUser(nfd("아낌이"));
        UUID ledger = insertLedger();
        UUID account = insertAccount(ledger, nfd("생활비"));
        UUID category = insertCategory(ledger, nfd("간식"));
        // 다른 장부의 같은 이름은 겹치지 않는다.
        UUID otherAccount = insertAccount(insertLedger(), "생활비");
        insertTransaction(ledger, user, "김밥천국", "점심\n저녁");
        assertThat(problems()).isEmpty();

        migrate("latest");

        assertThat(schemaVersion()).isEqualTo("18");
        assertThat(jdbc.queryForObject("select display_name from users where id = ?", String.class, user))
                .isEqualTo("아낌이");
        assertThat(jdbc.queryForObject("select name from account where id = ?", String.class, account))
                .isEqualTo("생활비");
        assertThat(jdbc.queryForObject("select name from account where id = ?", String.class, otherAccount))
                .isEqualTo("생활비");
        assertThat(jdbc.queryForObject("select name from category where id = ?", String.class, category))
                .isEqualTo("간식");
        assertThatThrownBy(() -> insertAccount(ledger, nfd("비상금"))).hasMessageContaining("ck_account_name_nfc");
    }

    @Test
    void namesCollidingAfterComposingAreFoundAndStopTheFillWithoutChangingAnything() {
        UUID ledger = insertLedger();
        insertAccount(ledger, "생활비");
        UUID decomposed = insertAccount(ledger, nfd("생활비"));
        insertCategory(ledger, "간식");
        insertCategory(ledger, nfd("간식"));

        assertThat(jdbc.queryForList(COLLIDING_AFTER_NFC)).extracting(row -> row.get("tbl"))
                .containsExactlyInAnyOrder("account", "category");
        assertThatThrownBy(() -> migrate("latest")).isInstanceOf(FlywayException.class)
                .hasStackTraceContaining("uq_account_name");
        assertThat(schemaVersion()).isEqualTo("16");
        assertThat(jdbc.queryForObject("select name from account where id = ?", String.class, decomposed))
                .isEqualTo(nfd("생활비"));
    }

    @Test
    void namesTooLongAfterComposingAreFound() {
        // U+0958은 NFC에서 두 글자가 된다(조합 제외 글자). 50자 계좌 이름이 51자가 된다.
        UUID ledger = insertLedger();
        insertAccount(ledger, "가".repeat(49) + "\u0958");

        assertThat(jdbc.queryForList(TOO_LONG_AFTER_NFC)).extracting(row -> row.get("tbl")).containsExactly("account");
        assertThatThrownBy(() -> migrate("latest")).isInstanceOf(FlywayException.class)
                .hasStackTraceContaining("ck_account_name_length");
        assertThat(schemaVersion()).isEqualTo("16");
    }

    @Test
    void rowsRejectedByTheNewConstraintsAreFoundAndStopTheSchemaChange() {
        UUID user = insertUser("아낌이");
        UUID ledger = insertLedger();
        insertAccount(ledger, "\u00A0생활비");
        insertTransaction(ledger, user, "", null);
        insertTransaction(ledger, user, null, "점심\r\n");

        assertThat(jdbc.queryForList(REJECTED_BY_V18)).extracting(row -> row.get("tbl"))
                .containsExactlyInAnyOrder("account", "transaction", "transaction");
        assertThatThrownBy(() -> migrate("latest")).isInstanceOf(FlywayException.class)
                .hasStackTraceContaining("ck_account_name_trimmed");
        // V17은 따로 커밋된다. 행을 고친 뒤 다시 적용하면 V18만 남는다.
        assertThat(schemaVersion()).isEqualTo("17");
    }

    // ---------------------------------------------------------------- 도우미

    private List<Map<String, Object>> problems() {
        return List.of(COLLIDING_AFTER_NFC, TOO_LONG_AFTER_NFC, REJECTED_BY_V18).stream()
                .flatMap(query -> jdbc.queryForList(query).stream())
                .toList();
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

    private String schemaVersion() {
        return jdbc.queryForObject(
                "select version from flyway_schema_history where success order by installed_rank desc limit 1",
                String.class);
    }

    private void dropSchema() {
        jdbc.execute("drop schema if exists " + SCHEMA + " cascade");
    }

    private UUID insertUser(String displayName) {
        UUID id = UUID.randomUUID();
        jdbc.update("insert into users (id, email, password_hash, display_name, created_at) values (?, ?, 'hash', ?, now())",
                id, id + "@example.com", displayName);
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

    private UUID insertCategory(UUID ledger, String name) {
        UUID id = UUID.randomUUID();
        jdbc.update("""
                insert into category (id, ledger_id, kind, name, system, created_at)
                values (?, ?, 'EXPENSE', ?, false, now())
                """, id, ledger, name);
        return id;
    }

    private void insertTransaction(UUID ledger, UUID user, String payee, String memo) {
        jdbc.update("""
                insert into transaction (id, ledger_id, type, occurred_on, payee, memo, status, created_by, version,
                                         created_at, updated_at)
                values (?, ?, 'EXPENSE', DATE '2026-11-18', ?, ?, 'POSTED', ?, 1, now(), now())
                """, UUID.randomUUID(), ledger, payee, memo, user);
    }

    private static String nfd(String text) {
        return Normalizer.normalize(text, Normalizer.Form.NFD);
    }
}
