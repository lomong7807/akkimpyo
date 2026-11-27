package app.accountbook.api;

import static org.assertj.core.api.Assertions.assertThat;

import app.accountbook.account.AccountType;
import app.accountbook.api.ServerClient.Reply;
import app.accountbook.ledger.LedgerRole;
import app.accountbook.support.Fixtures;
import app.accountbook.support.StoppedClockConfig.StoppedClock;
import app.accountbook.transaction.TransactionCommand.Entry;
import app.accountbook.transaction.TransactionService;
import app.accountbook.transaction.TransactionType;
import app.accountbook.user.User;
import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.jdbc.core.JdbcTemplate;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * {@code GET /api/v1/ledgers/{ledgerId}/transactions}(#15 응답 계약)의 HTTP 쪽: 응답 모양, cursor, 쿼리 값의 오류.
 * 순서·다음 쪽·범위의 규칙 자체는 {@code TransactionListQueryTest}가 본다. 시계는 서울 2026-11-27 12:00이다.
 */
@LedgerApiTest
class TransactionListTest {

    private static final Instant NOW = Instant.parse("2026-11-27T03:00:00Z");
    private static final LocalDate DAY = LocalDate.of(2026, 11, 18);
    private static final JsonMapper JSON = new JsonMapper();

    @LocalServerPort int port;
    @Autowired StoppedClock clock;
    @Autowired Fixtures fixtures;
    @Autowired TransactionService transactionService;
    @Autowired JdbcTemplate jdbc;

    private User owner;
    private UUID ledgerId;
    private UUID cash;
    private ServerClient client;
    /** HTTP 테스트는 롤백되지 않는다. 거래를 만든 장부를 적어 두고 끝나면 지운다. */
    private final List<UUID> ledgers = new ArrayList<>();

    @BeforeEach
    void setUp() {
        clock.stopAt(NOW);
        owner = user();
        ledgerId = fixtures.personalLedgerId(owner);
        ledgers.add(ledgerId);
        cash = fixtures.account(owner, ledgerId, "현금", AccountType.CASH, 0, DAY).getId();
        client = ServerClient.signedIn(port, owner.getId(), NOW);
    }

    @AfterEach
    void removeTransactions() {
        ledgers.forEach(ledger -> {
            jdbc.update("delete from change_log where ledger_id = ?", ledger);
            jdbc.update("delete from transaction where ledger_id = ?", ledger);
        });
    }

    @Test
    void 목록은_items와_nextCursor이고_거래는_상세와_같은_모양이다() throws Exception {
        UUID bank = fixtures.account(owner, ledgerId, "은행", AccountType.BANK, 0, DAY).getId();
        UUID transfer = fixtures.transfer(owner, ledgerId, bank, cash, DAY, 50_000).id();
        UUID timed = expense(DAY, "08:05");
        UUID income = fixtures.income(owner, ledgerId, bank, null, DAY.plusDays(1), 3_000_000).id();
        UUID future = expense(LocalDate.of(2026, 11, 28), null);

        Reply month = list("month=2026-11");

        assertThat(month.status()).as(month.body()).isEqualTo(200);
        assertThat(month.header("Content-Type")).isEqualTo("application/json");
        JsonNode page = month.json();
        assertThat(page.propertyNames()).containsExactlyInAnyOrder("items", "nextCursor", "totals", "days");
        assertThat(page.get("nextCursor").isNull()).isTrue();
        assertThat(ids(page)).containsExactly(future, income, timed, transfer);
        for (JsonNode item : page.get("items")) {
            assertThat(item).isEqualTo(client.get(path() + "/" + item.get("id").asString()).json());
        }
        assertThat(page.get("totals")).isEqualTo(json("{\"income\":3000000,\"expense\":2000}"));
        assertThat(page.get("days")).isEqualTo(json("[{\"date\":\"2026-11-28\",\"income\":0,\"expense\":1000},"
                + "{\"date\":\"2026-11-19\",\"income\":3000000,\"expense\":0},"
                + "{\"date\":\"2026-11-18\",\"income\":0,\"expense\":1000}]"));
        JsonNode whole = list("").json();
        assertThat(ids(whole)).as("장부 전체는 오늘까지").containsExactly(income, timed, transfer);
        assertThat(whole.get("totals").isNull()).isTrue();
        JsonNode day = list("date=2026-11-18").json();
        assertThat(ids(day)).containsExactly(timed, transfer);
        assertThat(day.get("totals")).isEqualTo(json("{\"income\":0,\"expense\":1000}"));
    }

    /** 이름과 고친 사람을 쪽마다 한 번에 읽는다(docs/perf/README.md 점검표 1번). 거래·날짜·고친 사람이 늘어도 같다. */
    @Test
    void 호출당_SQL_수는_쪽의_거래_수와_무관하다() throws Exception {
        expense(DAY, null);
        int one = sqlCount("month=2026-11");
        User member = user();
        fixtures.addMember(ledgerId, member, LedgerRole.MEMBER);
        for (int i = 0; i < 30; i++) {
            UUID id = expense(DAY.minusDays(i % 10), i % 2 == 0 ? null : "12:00");
            if (i % 3 == 0) {
                fixtures.cancel(member, transactionService.get(owner.getId(), id));
            }
        }

        int many = sqlCount("month=2026-11");

        assertThat(many).as("거래 1건일 때 %d", one).isEqualTo(one);
        assertThat(sqlCount("month=2026-11&limit=5&cursor="
                + list("month=2026-11&limit=5").json().get("nextCursor").asString()))
                .as("다음 쪽은 범위 합계를 읽지 않는다").isEqualTo(one - 1);
    }

    @Test
    void 거래가_51건이면_첫_요청에_50건과_cursor가_오고_그_cursor로_1건이_온다() throws Exception {
        List<UUID> made = new ArrayList<>();
        for (int i = 0; i < 51; i++) {
            made.add(expense(DAY, "%02d:%02d".formatted(i / 60, i % 60)));
        }

        JsonNode first = list("month=2026-11").json();
        String cursor = first.get("nextCursor").asString();
        JsonNode second = list("month=2026-11&cursor=" + cursor).json();

        assertThat(ids(first)).hasSize(50).containsExactlyElementsOf(made.reversed().subList(0, 50));
        assertThat(cursor).matches("[A-Za-z0-9_-]+");
        assertThat(ids(second)).containsExactly(made.getFirst());
        assertThat(second.get("nextCursor").isNull()).isTrue();
        JsonNode recent = list("limit=10").json();
        assertThat(ids(recent)).as("홈의 최근 10건").containsExactlyElementsOf(made.reversed().subList(0, 10));
        assertThat(ids(list("limit=10&cursor=" + recent.get("nextCursor").asString()).json()))
                .containsExactlyElementsOf(made.reversed().subList(10, 20));
    }

    /** 다른 달·다른 범위·다른 장부의 cursor, 바뀐 cursor는 모두 cursor의 INVALID_FORMAT이다. */
    @Test
    void 이_목록에서_받은_cursor가_아니면_400이다() throws Exception {
        expense(DAY, null);
        expense(DAY, null);
        User other = user();
        UUID otherLedger = fixtures.personalLedgerId(other);
        ledgers.add(otherLedger);
        fixtures.addMember(otherLedger, owner, LedgerRole.MEMBER);
        String month = list("month=2026-11&limit=1").json().get("nextCursor").asString();
        String whole = list("limit=1").json().get("nextCursor").asString();
        String day = list("date=2026-11-18&limit=1").json().get("nextCursor").asString();

        assertThat(list("month=2026-11&cursor=" + month).status()).as("대조").isEqualTo(200);
        for (String query : List.of("month=2026-10&cursor=" + month, "cursor=" + month, "date=2026-11-18&cursor=" + month,
                "month=2026-11&cursor=" + whole, "month=2026-11&cursor=" + day, "date=2026-11-19&cursor=" + day,
                "month=2026-11&cursor=" + month + "A", "month=2026-11&cursor=abc", "month=2026-11&cursor=")) {
            list(query).assertFieldErrors("cursor:INVALID_FORMAT");
        }
        client.get("/api/v1/ledgers/" + otherLedger + "/transactions?month=2026-11&cursor=" + month)
                .assertFieldErrors("cursor:INVALID_FORMAT");
    }

    @Test
    void 쿼리_값의_형식과_범위가_틀리면_그_입력란의_400이고_여럿이면_모두_알린다() throws Exception {
        Map<String, String> rejected = Map.ofEntries(
                Map.entry("month=2026-1", "month:INVALID_FORMAT"),
                Map.entry("month=2026-13", "month:INVALID_FORMAT"),
                Map.entry("month=", "month:INVALID_FORMAT"),
                Map.entry("month=2026-11&month=2026-12", "month:INVALID_FORMAT"),
                Map.entry("month=1999-12", "month:OUT_OF_RANGE"),
                Map.entry("month=2027-12", "month:OUT_OF_RANGE"),
                Map.entry("date=2026-02-29", "date:INVALID_FORMAT"),
                Map.entry("date=2026-11-1", "date:INVALID_FORMAT"),
                Map.entry("date=1999-12-31", "date:OUT_OF_RANGE"),
                Map.entry("date=2027-11-28", "date:OUT_OF_RANGE"),
                Map.entry("month=2026-11&date=2026-11-18", "date:NOT_ALLOWED"),
                Map.entry("limit=0", "limit:OUT_OF_RANGE"),
                Map.entry("limit=51", "limit:OUT_OF_RANGE"),
                Map.entry("limit=-1", "limit:OUT_OF_RANGE"),
                Map.entry("limit=abc", "limit:INVALID_FORMAT"),
                Map.entry("limit=1.5", "limit:INVALID_FORMAT"),
                Map.entry("limit=0x10", "limit:INVALID_FORMAT"),
                Map.entry("limit=%D9%A5", "limit:INVALID_FORMAT"), // 아랍 숫자 5
                Map.entry("limit=", "limit:INVALID_FORMAT"));
        for (Map.Entry<String, String> query : rejected.entrySet()) {
            list(query.getKey()).assertFieldErrors(query.getValue());
        }
        list("month=2026-13&limit=abc").assertFieldErrors("month:INVALID_FORMAT", "limit:INVALID_FORMAT");
        for (String accepted : List.of("month=2000-01", "month=2027-11", "date=2027-11-27", "limit=1", "limit=50",
                "sort=amount")) {
            assertThat(list(accepted).status()).as(accepted).isEqualTo(200);
        }
    }

    /** 필터(#62)는 같은 이름을 여러 번 보내면 또는이다. cursor는 같은 필터(값의 순서와 반복은 상관없다)에서만 받는다. */
    @Test
    void 필터를_켜면_목록과_합계가_그_결과이고_cursor는_같은_필터에서만_받는다() throws Exception {
        UUID bank = fixtures.account(owner, ledgerId, "은행", AccountType.BANK, 0, DAY).getId();
        UUID transfer = fixtures.transfer(owner, ledgerId, bank, cash, DAY, 50_000).id();
        UUID early = expense(DAY, "08:00");
        UUID late = expense(DAY, "09:00");
        fixtures.income(owner, ledgerId, bank, null, DAY, 3_000);
        String filter = "&accountId=" + cash + "&accountId=" + bank + "&type=EXPENSE&type=TRANSFER&status=POSTED";

        JsonNode first = list("month=2026-11&limit=2" + filter).json();

        assertThat(ids(first)).containsExactly(late, early);
        assertThat(first.get("totals")).isEqualTo(json("{\"income\":0,\"expense\":2000}"));
        assertThat(first.get("days")).isEqualTo(json("[{\"date\":\"2026-11-18\",\"income\":0,\"expense\":2000}]"));
        String cursor = "&cursor=" + first.get("nextCursor").asString();
        JsonNode second = list("month=2026-11&limit=2" + cursor + "&status=POSTED&type=TRANSFER&accountId=" + bank
                + "&type=EXPENSE&accountId=" + cash.toString().toUpperCase() + "&accountId=" + bank).json();
        assertThat(ids(second)).containsExactly(transfer);
        assertThat(second.get("totals").isNull()).isTrue();
        for (String other : List.of("", filter.replace("&accountId=" + bank, ""), filter + "&type=INCOME",
                filter.replace("POSTED", "CANCELED"), filter + "&categoryId=" + UUID.randomUUID())) {
            list("month=2026-11&limit=2" + cursor + other).assertFieldErrors("cursor:INVALID_FORMAT");
        }
    }

    /** 형식은 입력란마다 모두 알리고, 이 장부에 없는 계좌·카테고리(다른 장부의 것 포함)는 형식이 맞을 때 NOT_FOUND다. */
    @Test
    void 필터_값이_틀리면_그_입력란의_400이다() throws Exception {
        User stranger = user();
        UUID strangerCash = fixtures.account(stranger, fixtures.personalLedgerId(stranger), "남의현금", AccountType.CASH,
                0, DAY).getId();
        Map<String, String> rejected = Map.ofEntries(
                Map.entry("accountId=abc", "accountId:INVALID_FORMAT"),
                Map.entry("accountId=", "accountId:INVALID_FORMAT"),
                Map.entry("accountId=" + cash + "," + cash, "accountId:INVALID_FORMAT"),
                Map.entry("accountId=" + UUID.randomUUID(), "accountId:NOT_FOUND"),
                Map.entry("accountId=" + strangerCash, "accountId:NOT_FOUND"),
                Map.entry("accountId=" + cash + ("&accountId=" + cash).repeat(20), "accountId:OUT_OF_RANGE"),
                Map.entry("categoryId=x", "categoryId:INVALID_FORMAT"),
                Map.entry("categoryId=" + UUID.randomUUID(), "categoryId:NOT_FOUND"),
                Map.entry("type=expense", "type:INVALID_FORMAT"),
                Map.entry("type=REFUND", "type:INVALID_FORMAT"),
                Map.entry("type=EXPENSE" + "&type=EXPENSE".repeat(20), "type:OUT_OF_RANGE"),
                Map.entry("status=COMPLETED", "status:INVALID_FORMAT"),
                Map.entry("status=PENDING", "status:INVALID_FORMAT"),
                Map.entry("status=", "status:INVALID_FORMAT"),
                Map.entry("status=POSTED&status=CANCELED", "status:INVALID_FORMAT"));
        for (Map.Entry<String, String> query : rejected.entrySet()) {
            list("month=2026-11&" + query.getKey()).assertFieldErrors(query.getValue());
        }
        list("month=2026-11&accountId=abc&categoryId=&type=x&status=y&limit=abc").assertFieldErrors(
                "accountId:INVALID_FORMAT", "categoryId:INVALID_FORMAT", "type:INVALID_FORMAT", "status:INVALID_FORMAT",
                "limit:INVALID_FORMAT");
        list("month=2026-11&accountId=" + strangerCash + "&categoryId=" + UUID.randomUUID())
                .assertFieldErrors("accountId:NOT_FOUND", "categoryId:NOT_FOUND");
        assertThat(list("month=2026-11" + ("&accountId=" + cash).repeat(20)).status()).isEqualTo(200);
    }

    @Test
    void 구성원이_아닌_장부는_쿼리_값이_틀려도_404이고_토큰이_없으면_401이다() throws Exception {
        User stranger = user();
        UUID strangerLedger = fixtures.personalLedgerId(stranger);

        Reply reply = client.get("/api/v1/ledgers/" + strangerLedger + "/transactions?month=bad&cursor=bad");

        reply.assertProblem(404, "Not Found", "NOT_FOUND");
        client.get("/api/v1/ledgers/" + strangerLedger + "/transactions?accountId=bad&type=x&status=y")
                .assertProblem(404, "Not Found", "NOT_FOUND");
        ServerClient.anonymous(port).get(path() + "?month=2026-11&accountId=" + cash + "&type=EXPENSE")
                .assertProblem(401, "Unauthorized", "UNAUTHENTICATED");
    }

    private UUID expense(LocalDate on, String time) {
        UUID id = UUID.randomUUID();
        transactionService.create(owner.getId(), ledgerId, new Entry(id, TransactionType.EXPENSE, on,
                time == null ? null : LocalTime.parse(time), cash, null, 1_000, false, null, null, null), "test-device");
        return id;
    }

    private Reply list(String query) throws Exception {
        return client.get(path() + "?" + query);
    }

    /** 요청 하나에 Hibernate가 보낸 문장 수(인증 필터와 구성원 확인 포함). 요청은 서버 스레드에서 돈다. */
    private int sqlCount(String query) throws Exception {
        Logger sqlLog = (Logger) LoggerFactory.getLogger("org.hibernate.SQL");
        Level level = sqlLog.getLevel();
        ListAppender<ILoggingEvent> appender = new ListAppender<>();
        appender.start();
        sqlLog.addAppender(appender);
        sqlLog.setLevel(Level.DEBUG);
        try {
            assertThat(list(query).status()).isEqualTo(200);
        } finally {
            sqlLog.setLevel(level);
            sqlLog.detachAppender(appender);
        }
        appender.list.forEach(event -> System.out.println("[plan] " + query + ": " + event.getFormattedMessage()));
        return appender.list.size();
    }

    private static JsonNode json(String text) {
        return JSON.readTree(text);
    }

    private User user() {
        return fixtures.user(UUID.randomUUID().toString().substring(0, 18) + "@example.com");
    }

    private String path() {
        return "/api/v1/ledgers/" + ledgerId + "/transactions";
    }

    private static List<UUID> ids(JsonNode page) {
        return page.get("items").valueStream().map(item -> UUID.fromString(item.get("id").asString())).toList();
    }
}
