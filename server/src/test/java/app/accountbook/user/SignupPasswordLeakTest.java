package app.accountbook.user;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.catchThrowable;
import static org.junit.jupiter.params.provider.Arguments.argumentSet;

import app.accountbook.common.DuplicateEmailException;
import app.accountbook.common.InvalidRequestException;
import app.accountbook.support.IntegrationTest;
import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.classic.spi.ThrowableProxyUtil;
import ch.qos.logback.core.read.ListAppender;
import java.io.PrintWriter;
import java.io.StringWriter;
import java.util.List;
import java.util.stream.Collectors;
import java.util.stream.Stream;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * 평문 비밀번호(입력한 값과 NFKC로 맞춘 값)가 예외와 로그에 나오지 않는다(ADR 001 결정 10).
 * 우리 코드와 인코더의 로그는 TRACE까지, 나머지는 기본 수준으로 모아서 본다.
 */
@IntegrationTest
class SignupPasswordLeakTest {

    /** 표식. 앞의 것을 NFKC로 맞추면 뒤의 것이 된다. */
    private static final String RAW_MARKER = "ｓｅｃｒｅｔ－ｍａｒｋｅｒ";
    private static final String NORMALIZED_MARKER = "secret-marker";
    private static final String VALID_PASSWORD = RAW_MARKER + "42";

    private static final List<Logger> DETAILED_LOGGERS = List.of(
            logger("app.accountbook"), logger("org.springframework.security"));

    @Autowired UserService userService;
    @Autowired JdbcTemplate jdbc;

    private final ListAppender<ILoggingEvent> logs = new ListAppender<>();

    @BeforeEach
    void collectLogs() {
        logs.start();
        logger(Logger.ROOT_LOGGER_NAME).addAppender(logs);
        DETAILED_LOGGERS.forEach(logger -> logger.setLevel(Level.TRACE));
        logger(UserService.class.getName()).trace("로그 수집 확인");
    }

    @AfterEach
    void stopCollectingLogs() {
        DETAILED_LOGGERS.forEach(logger -> logger.setLevel(null));
        logger(Logger.ROOT_LOGGER_NAME).detachAppender(logs);
        logs.stop();
    }

    @Test
    void successfulSignupDoesNotLogPassword() {
        userService.createUser("leak@example.com", VALID_PASSWORD, "주인");

        assertNoPasswordIn(collectedLogs());
    }

    static Stream<Arguments> rejectedPasswords() {
        return Stream.of(
                argumentSet("숫자가 없다", RAW_MARKER),
                argumentSet("정규화한 뒤 72자를 넘는다", VALID_PASSWORD.repeat(5)),
                argumentSet("정규화 전에 512자를 넘는다", VALID_PASSWORD.repeat(40)),
                argumentSet("짝 없는 서로게이트", VALID_PASSWORD + "\uD800"));
    }

    @ParameterizedTest
    @MethodSource("rejectedPasswords")
    void rejectedPasswordIsNotInExceptionOrLog(String password) {
        Throwable thrown = catchThrowable(() -> userService.createUser("leak@example.com", password, "주인"));

        assertThat(thrown).isInstanceOf(InvalidRequestException.class);
        assertNoPasswordIn(stackTrace(thrown));
        assertNoPasswordIn(collectedLogs());
    }

    @Test
    void duplicateEmailDoesNotLeakPassword() {
        userService.createUser("leak@example.com", "password1", "처음");

        Throwable thrown = catchThrowable(() -> userService.createUser("leak@example.com", VALID_PASSWORD, "두번째"));

        assertThat(thrown).isInstanceOf(DuplicateEmailException.class);
        assertNoPasswordIn(stackTrace(thrown));
        assertNoPasswordIn(collectedLogs());
    }

    @Test
    void databaseFailureAfterHashingDoesNotLeakPassword() {
        // DB가 거부하면 드라이버의 상세가 예외와 로그에 실린다. 거기에도 평문은 없다. 제약은 테스트와 함께 롤백된다.
        jdbc.execute("ALTER TABLE users ADD CONSTRAINT ck_test_users_leak CHECK (display_name <> '막힌이름')");

        Throwable thrown = catchThrowable(() -> userService.createUser("leak@example.com", VALID_PASSWORD, "막힌이름"));

        assertThat(thrown).isInstanceOf(DataIntegrityViolationException.class);
        assertNoPasswordIn(stackTrace(thrown));
        assertThat(collectedLogs()).contains("ck_test_users_leak");
        assertNoPasswordIn(collectedLogs());
    }

    private static void assertNoPasswordIn(String text) {
        assertThat(text).doesNotContain(RAW_MARKER).doesNotContain(NORMALIZED_MARKER);
    }

    /** 모은 로그 전부(문구와 예외). TRACE까지 실제로 모였는지도 확인한다. */
    private String collectedLogs() {
        String text = logs.list.stream()
                .map(event -> event.getFormattedMessage() + "\n" + ThrowableProxyUtil.asString(event.getThrowableProxy()))
                .collect(Collectors.joining("\n"));
        assertThat(text).contains("로그 수집 확인");
        return text;
    }

    private static String stackTrace(Throwable thrown) {
        StringWriter writer = new StringWriter();
        thrown.printStackTrace(new PrintWriter(writer, true));
        return writer.toString();
    }

    private static Logger logger(String name) {
        return (Logger) LoggerFactory.getLogger(name);
    }
}
