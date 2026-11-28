package app.accountbook.api;

import static org.assertj.core.api.Assertions.assertThat;

import app.accountbook.account.AccountType;
import app.accountbook.api.ServerClient.Reply;
import app.accountbook.ledger.LedgerRole;
import app.accountbook.support.Fixtures;
import app.accountbook.support.StoppedClockConfig.StoppedClock;
import app.accountbook.transaction.TransactionService;
import app.accountbook.user.User;
import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.jdbc.core.JdbcTemplate;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.node.ObjectNode;

/**
 * {@code POST /api/v1/ledgers/{ledgerId}/transactions/{id}/cancel}과 {@code POST .../uncancel}, 본문
 * {@code { "version": N }}(#37 승인취소·되돌리기 계약, F-225, F-226). 요청 모양과 오류는 되살리기(#38)와 같다.
 */
@LedgerApiTest
class TransactionCancelTest {

    private static final Instant NOW = Instant.parse("2026-11-27T03:00:00Z");
    private static final LocalDate DAY = LocalDate.of(2026, 11, 18);
    private static final String DEVICE = "X-Akkimpyo-Device";
    private static final List<String> ACTIONS = List.of("/cancel", "/uncancel");

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
        cash = fixtures.account(owner, ledgerId, "현금", AccountType.CASH, 0, LocalDate.of(2026, 11, 1)).getId();
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
    void 승인취소하면_200이고_CANCELED로_잔액에서_빠지며_되돌리면_POSTED로_다시_든다() throws Exception {
        JsonNode created = create();
        assertThat(cashBalance()).isEqualTo(-12_000);

        Reply canceled = send(created, "/cancel", "{\"version\":1}", DEVICE, "iphone.safari");

        assertThat(canceled.status()).as(canceled.body()).isEqualTo(200);
        assertThat(canceled.header("Content-Type")).isEqualTo("application/json");
        JsonNode cancel = canceled.json();
        assertThat(cancel.get("status").asString()).isEqualTo("CANCELED");
        assertThat(cancel.get("version").asLong()).isEqualTo(2);
        assertThat(withoutChange(cancel)).isEqualTo(withoutChange(created));
        assertThat(cashBalance()).isZero();

        Reply uncanceled = send(created, "/uncancel", "{\"version\":2}");

        assertThat(uncanceled.status()).as(uncanceled.body()).isEqualTo(200);
        JsonNode back = uncanceled.json();
        assertThat(back.get("status").asString()).isEqualTo("POSTED");
        assertThat(back.get("version").asLong()).isEqualTo(3);
        assertThat(withoutChange(back)).isEqualTo(withoutChange(created));
        assertThat(cashBalance()).isEqualTo(-12_000);
        assertThat(history(created)).containsExactly("CREATE unknown", "CANCEL iphone.safari", "UNCANCEL unknown");
    }

    @Test
    void 승인취소한_거래는_월_통계에서_빠지고_되돌리면_다시_든다() throws Exception {
        JsonNode created = create();
        assertThat(monthly()).isEqualTo(List.of(0L, 12_000L, -12_000L));

        send(created, "/cancel", "{\"version\":1}").json();
        assertThat(monthly()).isEqualTo(List.of(0L, 0L, 0L));

        send(created, "/uncancel", "{\"version\":2}").json();
        assertThat(monthly()).isEqualTo(List.of(0L, 12_000L, -12_000L));
    }

    /** 이미 취소한 거래의 승인취소, 취소가 아닌 거래의 되돌리기, 휴지통의 거래는 version이 맞아도 바꾸지 않는다. */
    @Test
    void 지금_상태로_할_수_없으면_409_INVALID_STATE이고_바꾸지_않는다() throws Exception {
        JsonNode posted = create();
        send(posted, "/uncancel", "{\"version\":1}").assertProblem(409, "Conflict", "INVALID_STATE");
        send(posted, "/cancel", "{\"version\":1}").json();
        send(posted, "/cancel", "{\"version\":2}").assertProblem(409, "Conflict", "INVALID_STATE");
        transactionService.delete(owner.getId(), id(posted), 2, "mac.chrome");
        JsonNode trashedPosted = create();
        transactionService.delete(owner.getId(), id(trashedPosted), 1, "mac.chrome");

        for (String action : ACTIONS) {
            send(posted, action, "{\"version\":3}").assertProblem(409, "Conflict", "INVALID_STATE");
            send(trashedPosted, action, "{\"version\":2}").assertProblem(409, "Conflict", "INVALID_STATE");
        }

        assertThat(history(posted)).containsExactly("CREATE unknown", "CANCEL unknown", "DELETE mac.chrome");
        assertThat(history(trashedPosted)).containsExactly("CREATE unknown", "DELETE mac.chrome");
    }

    /** version을 상태보다 먼저 본다. 취소가 아닌 거래의 되돌리기도 version이 다르면 STALE_VERSION이다. */
    @Test
    void version이_다르면_최신_거래가_든_409_STALE_VERSION이다() throws Exception {
        JsonNode created = create();
        for (String action : ACTIONS) {
            JsonNode current = send(created, action, "{\"version\":7}")
                    .assertProblem(409, "Conflict", "STALE_VERSION").json().get("current");
            assertThat(current).isEqualTo(created);
        }
        JsonNode canceled = send(created, "/cancel", "{\"version\":1}").json();
        for (String action : ACTIONS) {
            JsonNode current = send(created, action, "{\"version\":1}")
                    .assertProblem(409, "Conflict", "STALE_VERSION").json().get("current");
            assertThat(current).isEqualTo(canceled);
        }
        transactionService.delete(owner.getId(), id(created), 2, "mac.chrome");
        JsonNode trashed = client.get(path(id(created))).json();

        JsonNode current = send(created, "/uncancel", "{\"version\":2}")
                .assertProblem(409, "Conflict", "STALE_VERSION").json().get("current");

        assertThat(current).as("휴지통이면 deletedAt이 있다").isEqualTo(trashed);
        assertThat(current.get("deletedAt").isNull()).isFalse();
        assertThat(history(created)).containsExactly("CREATE unknown", "CANCEL unknown", "DELETE mac.chrome");
    }

    @Test
    void version과_기기_값의_형식이_틀리면_400이고_바꾸지_않는다() throws Exception {
        JsonNode created = create();

        for (String action : ACTIONS) {
            send(created, action, "{}").assertFieldErrors("version:REQUIRED");
            send(created, action, "{\"version\":null}").assertFieldErrors("version:REQUIRED");
            send(created, action, "{\"version\":\"1\"}").assertFieldErrors("version:INVALID_FORMAT");
            send(created, action, "{\"version\":1.0}").assertFieldErrors("version:INVALID_FORMAT");
            // 되돌리기는 상태가 맞지 않는 거래지만 기기 값을 먼저 본다.
            send(created, action, "{\"version\":1}", DEVICE, "a b")
                    .assertFieldErrors("X-Akkimpyo-Device:INVALID_FORMAT");
        }

        assertThat(history(created)).containsExactly("CREATE unknown");
    }

    /** 내가 구성원인 다른 장부의 거래, 남의 취소한 거래, 완전히 지운 거래, 없는 거래는 version이 틀려도 같은 404다. */
    @Test
    void 경로의_장부의_거래가_아니면_같은_404이고_바꾸지_않는다() throws Exception {
        User other = user();
        UUID shared = fixtures.personalLedgerId(other);
        ledgers.add(shared);
        fixtures.addMember(shared, owner, LedgerRole.MEMBER);
        UUID sharedCash = fixtures.account(other, shared, "같이쓰는현금", AccountType.CASH, 0, DAY).getId();
        UUID inShared = fixtures.expense(other, shared, sharedCash, null, DAY, 7_000).id();
        User stranger = user();
        UUID strangers = fixtures.personalLedgerId(stranger);
        ledgers.add(strangers);
        UUID strangerCash = fixtures.account(stranger, strangers, "남의현금", AccountType.CASH, 0, DAY).getId();
        UUID ofStranger = fixtures.cancel(stranger,
                fixtures.expense(stranger, strangers, strangerCash, null, DAY, 7_000)).id();
        UUID purged = id(create());
        transactionService.delete(owner.getId(), purged, 1, "mac.chrome");
        fixtures.purge(purged, owner.getId());
        UUID missingId = UUID.randomUUID();
        Reply missing = post(missingId, "/cancel", "{\"version\":1}");

        for (UUID target : List.of(inShared, ofStranger, purged, missingId)) {
            for (String action : ACTIONS) {
                for (String json : List.of("{\"version\":1}", "{\"version\":2}", "{}")) {
                    Reply reply = post(target, action, json);
                    reply.assertProblem(404, "Not Found", "NOT_FOUND");
                    assertThat(withoutRequestId(reply)).isEqualTo(withoutRequestId(missing));
                }
            }
        }
        assertThat(jdbc.queryForList("select status || ' ' || version from transaction where id in (?, ?)",
                String.class, inShared, ofStranger)).containsExactlyInAnyOrder("POSTED 1", "CANCELED 2");
    }

    /** 413 → 401 → 415 → 404다. 되살리기와 같다. */
    @Test
    void 본문_상한과_인증과_Content_Type이_구성원_확인보다_먼저다() throws Exception {
        String transaction = "/api/v1/ledgers/" + ledgerId + "/transactions/" + UUID.randomUUID();
        ServerClient anyone = ServerClient.anonymous(port);
        ServerClient outsider = ServerClient.signedIn(port, user().getId(), NOW);
        String big = "{}" + " ".repeat(64 * 1024);

        for (String action : ACTIONS) {
            String path = transaction + action;
            anyone.rawReply("POST " + path + " HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n"
                            + "Content-Type: text/plain\r\nContent-Length: " + big.length() + "\r\n\r\n" + big)
                    .assertProblem(413, "Content Too Large", "PAYLOAD_TOO_LARGE");
            anyone.send("POST", path, "x", "Content-Type", "text/plain")
                    .assertProblem(401, "Unauthorized", "UNAUTHENTICATED");
            anyone.send("POST", path, "{\"version\":1}", "Content-Type", "application/json")
                    .assertProblem(401, "Unauthorized", "UNAUTHENTICATED");
            outsider.send("POST", path, "x", "Content-Type", "text/plain")
                    .assertProblem(415, "Unsupported Media Type", "UNSUPPORTED_MEDIA_TYPE");
            outsider.send("POST", path, "{", "Content-Type", "application/json")
                    .assertProblem(404, "Not Found", "NOT_FOUND");
            client.send("POST", path, "{\"version\":1}", "Content-Type", "application/json", "Accept", "text/html")
                    .assertProblem(400, "Bad Request", "MALFORMED_REQUEST");
        }
    }

    // ---------------------------------------------------------------- 도우미

    private User user() {
        return fixtures.user(UUID.randomUUID().toString().substring(0, 18) + "@example.com");
    }

    /** 현금 계좌의 12,000원 지출을 만들고 응답의 거래를 돌려준다. */
    private JsonNode create() throws Exception {
        Reply created = client.send("POST", "/api/v1/ledgers/" + ledgerId + "/transactions", "{\"id\":\""
                + UUID.randomUUID() + "\",\"type\":\"EXPENSE\",\"occurredOn\":\"2026-11-18\",\"accountId\":\"" + cash
                + "\",\"amount\":12000,\"payee\":\"김밥천국\"}", "Content-Type", "application/json");
        assertThat(created.status()).as(created.body()).isEqualTo(201);
        return created.json();
    }

    /** @param action {@code /cancel} 또는 {@code /uncancel} */
    private Reply send(JsonNode tx, String action, String json, String... headers) throws Exception {
        return post(id(tx), action, json, headers);
    }

    private Reply post(UUID id, String action, String json, String... headers) throws Exception {
        String[] all = new String[headers.length + 2];
        all[0] = "Content-Type";
        all[1] = "application/json";
        System.arraycopy(headers, 0, all, 2, headers.length);
        return client.send("POST", path(id) + action, json, all);
    }

    private String path(UUID id) {
        return "/api/v1/ledgers/" + ledgerId + "/transactions/" + id;
    }

    private long cashBalance() throws Exception {
        return client.get("/api/v1/ledgers/" + ledgerId + "/accounts").json().get("items").valueStream()
                .filter(item -> item.get("id").asString().equals(cash.toString()))
                .findFirst().orElseThrow().get("balance").asLong();
    }

    /** 2026년 11월의 수입, 지출, 순액. */
    private List<Long> monthly() throws Exception {
        Reply reply = client.get("/api/v1/ledgers/" + ledgerId + "/stats/monthly?month=2026-11");
        assertThat(reply.status()).as(reply.body()).isEqualTo(200);
        JsonNode stats = reply.json();
        return List.of(stats.get("income").asLong(), stats.get("expense").asLong(), stats.get("net").asLong());
    }

    /** 이력의 "동작 기기", version 순. */
    private List<String> history(JsonNode tx) {
        return jdbc.queryForList("select action || ' ' || device_id from change_log where transaction_id = ?"
                + " order by version", String.class, id(tx));
    }

    /** 승인취소와 되돌리기가 바꾸는 칸을 뺀 나머지. 내용과 만든 기록은 그대로여야 한다. */
    private static JsonNode withoutChange(JsonNode tx) {
        ObjectNode rest = (ObjectNode) tx.deepCopy();
        rest.remove(List.of("status", "version", "updatedAt", "updatedBy"));
        return rest;
    }

    private static UUID id(JsonNode tx) {
        return UUID.fromString(tx.get("id").asString());
    }

    private static String withoutRequestId(Reply reply) {
        return reply.body().replace(reply.header("X-Request-Id"), "");
    }
}
