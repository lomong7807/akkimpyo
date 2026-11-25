package app.accountbook.transaction;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import app.accountbook.account.AccountType;
import app.accountbook.common.InvalidRequestException;
import app.accountbook.support.Fixtures;
import app.accountbook.support.IntegrationTest;
import app.accountbook.transaction.TransactionCommand.Entry;
import app.accountbook.user.User;
import jakarta.persistence.EntityManager;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.time.LocalDate;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Stream;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.MethodSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * 기기 값의 형식 검증이 거래를 바꾸는 모든 메서드에 걸려 있다(이슈 #21).
 * 형식 자체는 {@link DeviceIdsTest}가, 권한 확인이 먼저인 것은 CrossLedgerAccessTest가, 같은 id 조회보다 먼저인 것은
 * {@link TransactionCreateOrderTest}가 본다.
 */
@IntegrationTest
class TransactionDeviceIdTest {

    static final LocalDate DAY = LocalDate.of(2026, 11, 18);
    static final String MALFORMED = "내 iPhone";
    static final String MESSAGE = "기기 값은 영문, 숫자와 . _ : - 만 쓴 1~64자여야 합니다.";

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
    }

    @ParameterizedTest
    @MethodSource("methodsWithDeviceId")
    void 형식이_틀린_기기_값은_거부하고_아무것도_바꾸지_않는다(String method) {
        List<List<Map<String, Object>>> before = snapshot();

        assertThatThrownBy(() -> call(method, MALFORMED, 0))
                .isExactlyInstanceOf(InvalidRequestException.class)
                .hasMessage(MESSAGE);

        assertThat(snapshot()).isEqualTo(before);
    }

    @ParameterizedTest
    @ValueSource(strings = {"update", "cancel", "delete", "restore"})
    void 기기_값의_형식은_version보다_먼저_본다(String method) {
        assertThatThrownBy(() -> call(method, MALFORMED, 1))
                .isExactlyInstanceOf(InvalidRequestException.class)
                .hasMessage(MESSAGE);
    }

    @ParameterizedTest
    @ValueSource(strings = {"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._", ":-"})
    void 허용하는_글자와_가장_긴_값은_그대로_이력에_남는다(String deviceId) {
        UUID id = UUID.randomUUID();
        transactionService.create(owner, ledgerId, expense(id), deviceId);

        assertThat(historyOf(id)).extracting(ChangeLogView::deviceId).containsExactly(deviceId);
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

    /** 기기 값만 맞으면 통과하는 요청이다. staleBy가 0이 아니면 version도 틀리다. */
    private void call(String method, String deviceId, long staleBy) {
        switch (method) {
            case "create" -> transactionService.create(owner, ledgerId, expense(UUID.randomUUID()), deviceId);
            case "createOrReplay" ->
                    transactionService.createOrReplay(owner, ledgerId, expense(UUID.randomUUID()), deviceId);
            case "update" -> transactionService.update(owner, posted.id(), posted.version() + staleBy,
                    expense(posted.id()), deviceId);
            case "cancel" -> transactionService.cancel(owner, posted.id(), posted.version() + staleBy, deviceId);
            case "delete" -> transactionService.delete(owner, posted.id(), posted.version() + staleBy, deviceId);
            case "restore" -> transactionService.restore(owner, trashed.id(), trashed.version() + staleBy, deviceId);
            default -> throw new IllegalArgumentException("이 테스트에 없는 메서드: " + method);
        }
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
