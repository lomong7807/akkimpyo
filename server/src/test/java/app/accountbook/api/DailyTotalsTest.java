package app.accountbook.api;

import static org.assertj.core.api.Assertions.assertThat;

import app.accountbook.account.AccountType;
import app.accountbook.api.ServerClient.Reply;
import app.accountbook.support.Fixtures;
import app.accountbook.support.StoppedClockConfig.StoppedClock;
import app.accountbook.user.User;
import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import java.time.Instant;
import java.time.LocalDate;
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
import tools.jackson.databind.json.JsonMapper;

/**
 * {@code GET /api/v1/ledgers/{ledgerId}/stats/daily}(#66 응답 계약)의 HTTP 쪽: 응답 모양, month의 오류, 404와 401.
 * 합계 규칙과 달 경계는 {@code TransactionListQueryTest}가 본다. 시계는 서울 2026-11-27 12:00이다.
 */
@LedgerApiTest
class DailyTotalsTest {

    private static final Instant NOW = Instant.parse("2026-11-27T03:00:00Z");
    private static final LocalDate DAY = LocalDate.of(2026, 11, 18);
    private static final JsonMapper JSON = new JsonMapper();

    @LocalServerPort int port;
    @Autowired StoppedClock clock;
    @Autowired Fixtures fixtures;
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
    void 응답은_month와_거래가_있는_날만의_days이고_날짜_순이며_지출은_양수다() throws Exception {
        UUID bank = fixtures.account(owner, ledgerId, "은행", AccountType.BANK, 0, DAY).getId();
        fixtures.expense(owner, ledgerId, cash, null, DAY, 16_500);
        fixtures.income(owner, ledgerId, bank, null, DAY, 3_200_000);
        fixtures.transfer(owner, ledgerId, bank, cash, DAY.plusDays(1), 50_000);
        fixtures.expense(owner, ledgerId, cash, null, LocalDate.of(2026, 11, 1), 1_000);
        fixtures.expense(owner, ledgerId, cash, null, LocalDate.of(2026, 12, 1), 1_000);

        Reply reply = daily("month=2026-11");

        assertThat(reply.status()).as(reply.body()).isEqualTo(200);
        assertThat(reply.header("Content-Type")).isEqualTo("application/json");
        assertThat(reply.json()).isEqualTo(JSON.readTree("{\"month\":\"2026-11\",\"days\":["
                + "{\"date\":\"2026-11-01\",\"income\":0,\"expense\":1000},"
                + "{\"date\":\"2026-11-18\",\"income\":3200000,\"expense\":16500}]}"));
        assertThat(daily("month=2026-10").json())
                .isEqualTo(JSON.readTree("{\"month\":\"2026-10\",\"days\":[]}"));
    }

    /** 날마다 합계는 한 문장이다(docs/perf/README.md 점검표 1번). 거래가 있는 날이 늘어도 문장 수가 같다. */
    @Test
    void 호출당_SQL_수는_거래가_있는_날의_수와_무관하다() throws Exception {
        fixtures.expense(owner, ledgerId, cash, null, DAY, 1_000);
        int one = sqlCount("month=2026-11");
        for (int day = 1; day <= 30; day++) {
            fixtures.expense(owner, ledgerId, cash, null, LocalDate.of(2026, 11, day), 1_000);
        }

        assertThat(sqlCount("month=2026-11")).as("거래가 있는 날이 하루일 때 %d", one).isEqualTo(one);
    }

    /** 형식과 범위는 거래 목록(#15)의 month와 같은 입력란·코드다. */
    @Test
    void month가_없거나_형식이나_범위가_틀리면_month의_400이다() throws Exception {
        Map<String, String> rejected = Map.of(
                "", "month:REQUIRED",
                "month=2026-1", "month:INVALID_FORMAT",
                "month=2026-13", "month:INVALID_FORMAT",
                "month=", "month:INVALID_FORMAT",
                "month=2026-11&month=2026-12", "month:INVALID_FORMAT",
                "month=1999-12", "month:OUT_OF_RANGE",
                "month=2027-12", "month:OUT_OF_RANGE");
        for (Map.Entry<String, String> query : rejected.entrySet()) {
            daily(query.getKey()).assertFieldErrors(query.getValue());
        }
        for (String accepted : List.of("month=2000-01", "month=2027-11", "month=2026-11&date=2026-11-18")) {
            assertThat(daily(accepted).status()).as(accepted).isEqualTo(200);
        }
    }

    @Test
    void 구성원이_아닌_장부는_month가_틀려도_404이고_토큰이_없으면_401이다() throws Exception {
        User stranger = user();
        UUID strangerLedger = fixtures.personalLedgerId(stranger);
        String path = "/api/v1/ledgers/" + strangerLedger + "/stats/daily";

        client.get(path + "?month=2026-11").assertProblem(404, "Not Found", "NOT_FOUND");
        client.get(path + "?month=bad").assertProblem(404, "Not Found", "NOT_FOUND");
        ServerClient.anonymous(port).get(path() + "?month=2026-11")
                .assertProblem(401, "Unauthorized", "UNAUTHENTICATED");
    }

    private Reply daily(String query) throws Exception {
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
            assertThat(daily(query).status()).isEqualTo(200);
        } finally {
            sqlLog.setLevel(level);
            sqlLog.detachAppender(appender);
        }
        appender.list.forEach(event -> System.out.println("[plan] " + query + ": " + event.getFormattedMessage()));
        return appender.list.size();
    }

    private User user() {
        return fixtures.user(UUID.randomUUID().toString().substring(0, 18) + "@example.com");
    }

    private String path() {
        return "/api/v1/ledgers/" + ledgerId + "/stats/daily";
    }
}
