package app.accountbook.transaction;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.catchThrowable;
import static org.assertj.core.util.Throwables.getStackTrace;

import app.accountbook.account.AccountType;
import app.accountbook.common.InvalidRequestException;
import app.accountbook.common.StaleVersionException;
import app.accountbook.support.Fixtures;
import app.accountbook.support.IntegrationTest;
import app.accountbook.transaction.TransactionCommand.Entry;
import app.accountbook.user.User;
import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import jakarta.persistence.EntityManager;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.time.LocalDate;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import java.util.stream.Stream;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * 기기 값의 형식 검증과 목록(ADR 007 결정 10)이 거래를 바꾸는 모든 메서드에 걸려 있다(이슈 #21).
 * 형식과 목록 자체는 {@link DeviceIdsTest}가, 권한 확인이 먼저인 것은 CrossLedgerAccessTest가, 같은 id 조회보다 먼저인
 * 것은 {@link TransactionCreateOrderTest}가, 목록의 값이 동작마다 이력에 남는 것은 {@link TransactionServiceTest}가 본다.
 */
@IntegrationTest
@ExtendWith(OutputCaptureExtension.class)
class TransactionDeviceIdTest {

    static final LocalDate DAY = LocalDate.of(2026, 11, 18);
    static final String MALFORMED = "내 iPhone";
    static final String MESSAGE = "기기 값은 영문, 숫자와 . _ : - 만 쓴 1~64자여야 합니다.";
    /** 형식에는 맞지만 목록에 없는 값. 기기를 구분하는 식별자처럼 생겼다. */
    static final String NOT_LISTED = "3f0c7a52-9d1e-4b7b-8c55-0e6f1a2b3c4d";

    /** SQL에 넣는 값과 우리 코드의 로그를 모두 남기게 해, 원래 값이 그 어디에 쓰이면 드러나게 한다. */
    static final List<Logger> DETAILED_LOGGERS = Stream.of("org.hibernate.orm.jdbc.bind", "app.accountbook")
            .map(name -> (Logger) LoggerFactory.getLogger(name))
            .toList();

    @Autowired TransactionService transactionService;
    @Autowired Fixtures fixtures;
    @Autowired EntityManager entityManager;
    @Autowired JdbcTemplate jdbc;

    UUID owner;
    UUID ledgerId;
    UUID cash;
    TransactionView posted;
    TransactionView trashed;

    @BeforeEach
    void setUp() {
        User user = fixtures.user("owner@example.com");
        owner = user.getId();
        ledgerId = fixtures.personalLedgerId(user);
        cash = fixtures.account(user, ledgerId, "현금", AccountType.CASH, 0, LocalDate.of(2026, 11, 1)).getId();
        posted = fixtures.expense(user, ledgerId, cash, null, DAY, 12_000);
        trashed = fixtures.delete(user, fixtures.expense(user, ledgerId, cash, null, DAY, 7_300));
        DETAILED_LOGGERS.forEach(logger -> logger.setLevel(Level.TRACE));
    }

    @AfterEach
    void restoreLogLevels() {
        DETAILED_LOGGERS.forEach(logger -> logger.setLevel(null));
    }

    @ParameterizedTest
    @MethodSource("methodsWithDeviceId")
    void 형식이_틀린_기기_값은_거부하고_아무것도_바꾸지_않는다(String method) {
        List<List<Map<String, Object>>> before = snapshot();

        assertThatThrownBy(() -> call(method, MALFORMED, false))
                .isExactlyInstanceOf(InvalidRequestException.class)
                .hasMessage(MESSAGE);

        assertThat(snapshot()).isEqualTo(before);
    }

    @ParameterizedTest
    @ValueSource(strings = {"update", "cancel", "delete", "restore"})
    void 기기_값의_형식은_version보다_먼저_본다(String method) {
        assertThatThrownBy(() -> call(method, MALFORMED, true))
                .isExactlyInstanceOf(InvalidRequestException.class)
                .hasMessage(MESSAGE);
    }

    @Test
    void 화면이_보내는_값은_그대로_이력에_남는다() {
        Map<UUID, String> sent = DeviceIdsTest.SENT_BY_WEB.stream()
                .collect(Collectors.toMap(deviceId -> UUID.randomUUID(), Function.identity()));

        sent.forEach((id, deviceId) -> transactionService.create(owner, ledgerId, expense(id), deviceId));

        sent.forEach((id, deviceId) -> assertThat(historyOf(id)).extracting(ChangeLogView::deviceId)
                .containsExactly(deviceId));
    }

    @ParameterizedTest
    @MethodSource("methodsWithDeviceId")
    void 목록에_없는_기기_값은_unknown으로_남고_원래_값은_어디에도_남지_않는다(String method, CapturedOutput output) {
        UUID id = call(method, NOT_LISTED, false);

        assertThat(historyOf(id).getLast().deviceId()).isEqualTo("unknown");
        assertThat(snapshot().toString()).doesNotContain(NOT_LISTED);
        assertThat(output.getAll()).as("SQL에 넣은 값이 로그에 모였다").contains("<- [unknown]");
        assertThat(output.getAll()).doesNotContain(NOT_LISTED);
    }

    @ParameterizedTest
    @MethodSource("methodsWithDeviceId")
    void 거부된_요청의_예외와_로그에도_목록에_없는_기기_값이_없다(String method, CapturedOutput output) {
        Throwable rejected = catchThrowable(() -> call(method, NOT_LISTED, true));

        assertThat(rejected).isInstanceOfAny(IdConflictException.class, StaleVersionException.class);
        assertThat(getStackTrace(rejected)).doesNotContain(NOT_LISTED);
        assertThat(output.getAll()).doesNotContain(NOT_LISTED);
    }

    @Test
    void 기기_값이_없는_변경은_비운_채로_이력에_남는다() {
        UUID id = UUID.randomUUID();
        transactionService.create(owner, ledgerId, expense(id), null);
        transactionService.update(owner, id, 1, expense(id), null);
        transactionService.cancel(owner, id, 2, null);
        transactionService.delete(owner, id, 3, null);
        transactionService.restore(owner, id, 4, null);

        assertThat(historyOf(id)).hasSize(5).extracting(ChangeLogView::deviceId).containsOnlyNulls();
    }

    /** 기기 값을 받는 공개 메서드 전부. 새로 생기면 {@link #call}에 줄을 더해야 통과한다. */
    static Stream<String> methodsWithDeviceId() {
        return Arrays.stream(TransactionService.class.getDeclaredMethods())
                .filter(method -> Modifier.isPublic(method.getModifiers()))
                .filter(method -> Arrays.stream(method.getParameters())
                        .anyMatch(parameter -> parameter.getName().equals("deviceId")))
                .map(Method::getName)
                .sorted();
    }

    /**
     * 기기 값만 맞으면 통과하는 요청이고, 바꾼 거래의 id를 돌려준다.
     * conflicting이면 기기 값이 맞아도 충돌로 거부된다: 만들기는 같은 id의 다른 내용, 나머지는 다른 version이다.
     */
    private UUID call(String method, String deviceId, boolean conflicting) {
        UUID newId = conflicting ? posted.id() : UUID.randomUUID();
        long staleBy = conflicting ? 1 : 0;
        TransactionView changed = switch (method) {
            case "create" -> transactionService.create(owner, ledgerId, expense(newId), deviceId);
            case "createOrReplay" ->
                    transactionService.createOrReplay(owner, ledgerId, expense(newId), deviceId).transaction();
            case "update" -> transactionService.update(owner, posted.id(), posted.version() + staleBy,
                    expense(posted.id()), deviceId);
            case "cancel" -> transactionService.cancel(owner, posted.id(), posted.version() + staleBy, deviceId);
            case "delete" -> transactionService.delete(owner, posted.id(), posted.version() + staleBy, deviceId);
            case "restore" -> transactionService.restore(owner, trashed.id(), trashed.version() + staleBy, deviceId);
            default -> throw new IllegalArgumentException("이 테스트에 없는 메서드: " + method);
        };
        return changed.id();
    }

    private Entry expense(UUID id) {
        return new Entry(id, TransactionType.EXPENSE, DAY, null, cash, null, 15_000, false, "김밥천국", null, null);
    }

    private List<ChangeLogView> historyOf(UUID id) {
        entityManager.flush();
        entityManager.clear();
        return transactionService.history(owner, id);
    }

    /** 거래, 라인, 이력의 모든 행. version도 거래 행에 있다. */
    private List<List<Map<String, Object>>> snapshot() {
        entityManager.flush();
        return Stream.of("transaction", "transaction_line", "change_log")
                .map(table -> jdbc.queryForList("select * from " + table + " order by id"))
                .toList();
    }
}
