package app.accountbook;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.catchThrowable;

import app.accountbook.account.Account;
import app.accountbook.account.AccountRepository;
import app.accountbook.account.AccountType;
import app.accountbook.ledger.Ledger;
import app.accountbook.ledger.LedgerRepository;
import app.accountbook.support.CapturedLogs;
import app.accountbook.support.IntegrationTest;
import app.accountbook.transaction.Transaction;
import app.accountbook.transaction.TransactionRepository;
import app.accountbook.transaction.TransactionType;
import app.accountbook.user.User;
import app.accountbook.user.UserRepository;
import com.zaxxer.hikari.HikariDataSource;
import java.io.PrintWriter;
import java.io.StringWriter;
import java.sql.Connection;
import java.sql.DriverManager;
import java.sql.PreparedStatement;
import java.sql.SQLException;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import org.assertj.core.api.ThrowableAssert.ThrowingCallable;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.autoconfigure.AutoConfigurations;
import org.springframework.boot.jdbc.autoconfigure.DataSourceAutoConfiguration;
import org.springframework.boot.test.context.ConfigDataApplicationContextInitializer;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.dao.DataIntegrityViolationException;

/**
 * DB 제약 위반이 나도 로그와 예외에 값(이메일, 비밀번호 해시, 이름, 메모)이 남지 않는다(#20).
 * PostgreSQL은 위반한 행의 값을 오류의 상세로 보내고, 드라이버는 기본으로 그것을 예외 문구에 싣는다.
 * application.yml의 logServerErrorDetail: false가 막는다. 제약 이름은 남는다.
 */
@IntegrationTest
class DbErrorLogTest {

    private static final String EMAIL = "marker-user@example.com";
    private static final String HASH = "$argon2id$marker-hash";
    private static final String NAME = "표식이름";
    private static final String PAYEE = "표식가맹점";
    private static final String MEMO = "표식메모";

    @Autowired UserRepository userRepository;
    @Autowired LedgerRepository ledgerRepository;
    @Autowired AccountRepository accountRepository;
    @Autowired TransactionRepository transactionRepository;
    @Autowired HikariDataSource dataSource;

    private CapturedLogs logs;

    @BeforeEach
    void captureLogs() {
        logs = CapturedLogs.start();
    }

    @AfterEach
    void stopCapturingLogs() {
        logs.close();
    }

    @Test
    void uniqueViolationLeavesNoValues() {
        userRepository.saveAndFlush(User.of(EMAIL, HASH, NAME));

        assertNoValuesLeft("users_email_key", () -> userRepository.saveAndFlush(User.of(EMAIL, HASH, NAME)));
    }

    @Test
    void checkViolationOfUserLeavesNoValues() {
        // 뒤에 공백이 있는 이름. 앱 검사를 거치지 않고 엔터티로 바로 저장한다.
        assertNoValuesLeft("ck_users_display_name_trimmed",
                () -> userRepository.saveAndFlush(User.of(EMAIL, HASH, NAME + " ")));
    }

    @Test
    void checkViolationOfTransactionLeavesNoValues() {
        User user = userRepository.save(User.of("writer@example.com", "hash", "작성자"));
        Ledger ledger = ledgerRepository.save(Ledger.personal());

        assertNoValuesLeft("ck_transaction_occurred_on_min", () -> transactionRepository.saveAndFlush(
                transaction(user, ledger, LocalDate.of(1999, 12, 31))));
    }

    @Test
    void foreignKeyViolationLeavesNoValues() {
        User user = userRepository.save(User.of("writer@example.com", "hash", "작성자"));
        Ledger ledger = ledgerRepository.save(Ledger.personal());
        Ledger other = ledgerRepository.save(Ledger.personal());
        Account otherAccount = accountRepository.saveAndFlush(
                Account.of(other.getId(), "표식계좌", AccountType.CASH, 0, LocalDate.of(2026, 11, 1)));
        Transaction tx = transaction(user, ledger, LocalDate.of(2026, 11, 18));
        tx.addLine(otherAccount.getId(), null, -1_000);

        // 다른 장부의 계좌를 가리키는 라인. 오류의 상세에는 그 계좌와 장부의 id가 들어 있다.
        assertNoValuesLeft("fk_transaction_line_account", () -> transactionRepository.saveAndFlush(tx),
                otherAccount.getId().toString(), other.getId().toString(), ledger.getId().toString());
    }

    @Test
    void sameViolationShowsValuesWhenTheDriverIsNotTold() throws SQLException {
        // 대조: 같은 DB에 설정 없이 드라이버로 바로 붙으면 값이 예외에 실린다. 위 테스트가 헛돌지 않는다는 확인이다.
        try (Connection plain = DriverManager.getConnection(
                dataSource.getJdbcUrl(), dataSource.getUsername(), dataSource.getPassword())) {
            plain.setAutoCommit(false);
            assertThatThrownBy(() -> insertUserWithBadName(plain))
                    .hasMessageContaining(EMAIL)
                    .hasMessageContaining(HASH)
                    .hasMessageContaining(NAME);
        }
        // 풀에서 받은 연결은 같은 문장에서 값을 싣지 않는다. 설정이 드라이버까지 닿는다.
        try (Connection pooled = dataSource.getConnection()) {
            pooled.setAutoCommit(false);
            Throwable thrown = catchThrowable(() -> insertUserWithBadName(pooled));
            assertThat(stackTrace(thrown)).contains("ck_users_display_name_trimmed");
            assertNoMarkerIn(stackTrace(thrown));
            pooled.rollback();
        }
    }

    @Test
    void settingIsTheSameWithAndWithoutTestcontainers() {
        // 테스트는 @ServiceConnection으로 접속 정보(주소, 계정)만 바꾼다. 운영처럼 환경 변수로 접속해도 같은 설정이 붙는다.
        assertThat(dataSource.getDataSourceProperties().getProperty("logServerErrorDetail")).isEqualTo("false");
        new ApplicationContextRunner()
                .withInitializer(new ConfigDataApplicationContextInitializer())
                .withConfiguration(AutoConfigurations.of(DataSourceAutoConfiguration.class))
                .withPropertyValues("DB_URL=jdbc:postgresql://localhost:1/none", "DB_USERNAME=u", "DB_PASSWORD=p")
                .run(context -> assertThat(context.getBean(HikariDataSource.class).getDataSourceProperties()
                        .getProperty("logServerErrorDetail")).isEqualTo("false"));
    }

    /** 위반은 나고(제약이 드러난다), 예외의 원인 사슬과 모든 로그에 표식 값이 없다. */
    private void assertNoValuesLeft(String violation, ThrowingCallable action, String... moreMarkers) {
        Throwable thrown = catchThrowable(action);

        assertThat(thrown).isInstanceOf(DataIntegrityViolationException.class);
        assertThat(stackTrace(thrown)).contains(violation);
        assertNoMarkerIn(stackTrace(thrown), moreMarkers);
        // 로그에 위반이 남아 있어야 로그를 실제로 모은 것이다.
        assertThat(logs.text()).contains(violation);
        assertNoMarkerIn(logs.text(), moreMarkers);
    }

    private static void assertNoMarkerIn(String text, String... moreMarkers) {
        assertThat(text).doesNotContain(EMAIL, HASH, NAME, PAYEE, MEMO);
        List.of(moreMarkers).forEach(marker -> assertThat(text).doesNotContain(marker));
    }

    private static Transaction transaction(User user, Ledger ledger, LocalDate occurredOn) {
        return Transaction.of(UUID.randomUUID(), ledger.getId(), TransactionType.EXPENSE, occurredOn, null, PAYEE, MEMO,
                user.getId(), user.getId());
    }

    private static void insertUserWithBadName(Connection connection) throws SQLException {
        try (PreparedStatement insert = connection.prepareStatement("""
                insert into users (id, email, password_hash, display_name, created_at)
                values (gen_random_uuid(), ?, ?, ?, now())
                """)) {
            insert.setString(1, EMAIL);
            insert.setString(2, HASH);
            insert.setString(3, NAME + " ");
            insert.executeUpdate();
        }
    }

    private static String stackTrace(Throwable thrown) {
        StringWriter writer = new StringWriter();
        thrown.printStackTrace(new PrintWriter(writer, true));
        return writer.toString();
    }
}
