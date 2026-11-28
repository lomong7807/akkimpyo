package app.accountbook.api;

import static org.assertj.core.api.Assertions.assertThat;

import app.accountbook.account.AccountType;
import app.accountbook.api.ServerClient.Reply;
import app.accountbook.ledger.LedgerRole;
import app.accountbook.support.Fixtures;
import app.accountbook.support.StoppedClockConfig.StoppedClock;
import app.accountbook.transaction.TransactionService;
import app.accountbook.transaction.TransactionView;
import app.accountbook.transaction.TrashPage;
import app.accountbook.user.User;
import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.jdbc.core.JdbcTemplate;
import tools.jackson.databind.JsonNode;

/**
 * {@code GET /api/v1/ledgers/{ledgerId}/transactions/trash}(#47 응답 계약): 응답 모양, 순서, cursor, 오류. 지운 시각은
 * 순서를 정하려고 DB에 바로 적는다. 시계는 서울 2026-11-27 12:00이다.
 */
@LedgerApiTest
class TransactionTrashTest {

    private static final Instant NOW = Instant.parse("2026-11-27T03:00:00Z");
    private static final LocalDate DAY = LocalDate.of(2026, 11, 18);
    /** 서울 2026-12-01 00:00. 달이 바뀌는 때 지운 거래다. */
    private static final Instant MONTH_START = Instant.parse("2026-11-30T15:00:00Z");

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
    void 이_장부에서_지운_거래만_지운_시각_역순으로_오고_거래는_상세와_같은_모양이다() throws Exception {
        User member = user();
        fixtures.addMember(ledgerId, member, LedgerRole.MEMBER);
        TransactionView kept = expense();
        UUID byMember = deletedAt(fixtures.delete(member, expense()), "2026-11-20T01:00:00.123456Z");
        UUID latest = deletedAt(fixtures.delete(owner, expense()), MONTH_START.toString());
        UUID middle = deletedAt(fixtures.delete(owner, expense()), "2026-11-25T09:00:00Z");
        TransactionView restored = fixtures.delete(owner, expense());
        transactionService.restore(owner.getId(), restored.id(), restored.version(), "test-device");
        UUID purged = fixtures.delete(owner, expense()).id();
        fixtures.purge(purged, owner.getId());
        User other = user();
        UUID otherLedger = fixtures.personalLedgerId(other);
        ledgers.add(otherLedger);
        fixtures.addMember(otherLedger, owner, LedgerRole.MEMBER);
        UUID otherCash = fixtures.account(other, otherLedger, "남의 현금", AccountType.CASH, 0, DAY).getId();
        fixtures.delete(other, fixtures.expense(other, otherLedger, otherCash, null, DAY, 2_000));

        Reply reply = trash("");

        assertThat(reply.status()).as(reply.body()).isEqualTo(200);
        assertThat(reply.header("Content-Type")).isEqualTo("application/json");
        JsonNode page = reply.json();
        assertThat(page.propertyNames()).containsExactlyInAnyOrder("items", "nextCursor");
        assertThat(page.get("nextCursor").isNull()).isTrue();
        assertThat(ids(page)).as("남은 거래 %s, 되살린 거래, 완전히 지운 거래, 다른 장부의 거래는 빠진다", kept.id())
                .containsExactly(latest, middle, byMember);
        for (JsonNode item : page.get("items")) {
            assertThat(item).isEqualTo(client.get(path() + "/" + item.get("id").asString()).json());
        }
        JsonNode first = page.get("items").get(0);
        assertThat(first.get("deletedAt").asString()).isEqualTo("2026-11-30T15:00:00.000Z");
        assertThat(first.get("purgeAt").asString()).as("지운 때 + 30일").isEqualTo("2026-12-30T15:00:00.000Z");
        JsonNode last = page.get("items").get(2);
        assertThat(last.get("purgeAt").asString()).isEqualTo("2026-12-20T01:00:00.123Z");
        assertThat(last.get("updatedBy").get("id").asString()).as("지운 사람").isEqualTo(member.getId().toString());
    }

    /** 같은 시각에 지운 거래는 id 역순(DB의 uuid 순서는 소문자 16진 글자의 순서와 같다)이고, 쪽의 경계에서도 그렇다. */
    @Test
    void 지운_거래가_51건이면_첫_요청에_50건과_cursor가_오고_그_cursor로_1건이_온다() throws Exception {
        List<UUID> made = new ArrayList<>();
        for (int i = 0; i < 51; i++) {
            made.add(fixtures.delete(owner, expense()).id());
        }
        jdbc.update("update transaction set deleted_at = ? where ledger_id = ?", Timestamp.from(MONTH_START), ledgerId);
        List<UUID> expected = made.stream().sorted(Comparator.comparing(UUID::toString).reversed()).toList();

        JsonNode first = trash("").json();
        String cursor = first.get("nextCursor").asString();
        JsonNode second = trash("?cursor=" + cursor).json();

        assertThat(ids(first)).containsExactlyElementsOf(expected.subList(0, 50));
        assertThat(cursor).matches("[A-Za-z0-9_-]+");
        assertThat(ids(second)).containsExactly(expected.get(50));
        assertThat(second.get("nextCursor").isNull()).isTrue();
    }

    /** 다른 장부의 cursor, 거래 목록의 cursor, 바뀐 cursor는 모두 cursor의 INVALID_FORMAT이다. */
    @Test
    void 이_휴지통에서_받은_cursor가_아니면_400이다() throws Exception {
        expense();
        expense();
        String listCursor = client.get(path() + "?limit=1").json().get("nextCursor").asString();
        TrashPage.Key key = new TrashPage.Key(MONTH_START, UUID.randomUUID());
        String mine = TrashCursor.encode(ledgerId, key);

        assertThat(trash("?cursor=" + mine).status()).as("대조").isEqualTo(200);
        for (String cursor : List.of(TrashCursor.encode(UUID.randomUUID(), key), listCursor, mine + "A", "abc", "")) {
            trash("?cursor=" + cursor).assertFieldErrors("cursor:INVALID_FORMAT");
        }
    }

    @Test
    void 구성원이_아닌_장부는_cursor가_틀려도_404이고_토큰이_없으면_401이다() throws Exception {
        UUID strangerLedger = fixtures.personalLedgerId(user());

        client.get("/api/v1/ledgers/" + strangerLedger + "/transactions/trash?cursor=bad")
                .assertProblem(404, "Not Found", "NOT_FOUND");
        ServerClient.anonymous(port).get(path() + "/trash").assertProblem(401, "Unauthorized", "UNAUTHENTICATED");
    }

    /** 이름과 고친 사람을 쪽마다 한 번에 읽는다(docs/perf/README.md 점검표 1번). 거래와 지운 사람이 늘어도 같다. */
    @Test
    void 호출당_SQL_수는_쪽의_거래_수와_무관하다() throws Exception {
        fixtures.delete(owner, expense());
        int one = sqlCount();
        User member = user();
        fixtures.addMember(ledgerId, member, LedgerRole.MEMBER);
        for (int i = 0; i < 30; i++) {
            fixtures.delete(i % 2 == 0 ? owner : member, expense());
        }

        assertThat(sqlCount()).as("거래 1건일 때 %d", one).isEqualTo(one);
    }

    private TransactionView expense() {
        return fixtures.expense(owner, ledgerId, cash, null, DAY, 1_000);
    }

    private UUID deletedAt(TransactionView deleted, String at) {
        jdbc.update("update transaction set deleted_at = ? where id = ?", Timestamp.from(Instant.parse(at)),
                deleted.id());
        return deleted.id();
    }

    private Reply trash(String query) throws Exception {
        return client.get(path() + "/trash" + query);
    }

    /** 요청 하나에 Hibernate가 보낸 문장 수(인증 필터와 구성원 확인 포함). 요청은 서버 스레드에서 돈다. */
    private int sqlCount() throws Exception {
        Logger sqlLog = (Logger) LoggerFactory.getLogger("org.hibernate.SQL");
        Level level = sqlLog.getLevel();
        ListAppender<ILoggingEvent> appender = new ListAppender<>();
        appender.start();
        sqlLog.addAppender(appender);
        sqlLog.setLevel(Level.DEBUG);
        try {
            assertThat(trash("").status()).isEqualTo(200);
        } finally {
            sqlLog.setLevel(level);
            sqlLog.detachAppender(appender);
        }
        return appender.list.size();
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
