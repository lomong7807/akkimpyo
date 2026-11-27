package app.accountbook.api;

import static org.assertj.core.api.Assertions.assertThat;

import app.accountbook.account.AccountType;
import app.accountbook.api.ServerClient.Reply;
import app.accountbook.ledger.LedgerRole;
import app.accountbook.support.Fixtures;
import app.accountbook.support.StoppedClockConfig.StoppedClock;
import app.accountbook.transaction.TransactionService;
import app.accountbook.user.User;
import java.time.Duration;
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
 * {@code DELETE /api/v1/ledgers/{ledgerId}/transactions/{id}?version=N}과
 * {@code POST .../transactions/{id}/restore}(#38 삭제·복원 계약).
 */
@LedgerApiTest
class TransactionDeleteRestoreTest {

    private static final Instant NOW = Instant.parse("2026-11-27T03:00:00Z");
    private static final LocalDate DAY = LocalDate.of(2026, 11, 18);
    private static final String DEVICE = "X-Akkimpyo-Device";

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
    void 지우면_200이고_휴지통에_들어가_잔액에서_빠지며_되살리면_지우기_전으로_돌아간다() throws Exception {
        JsonNode created = create();
        assertThat(cashBalance()).isEqualTo(-12_000);

        Reply deleted = delete(created, "1", DEVICE, "iphone.safari");

        assertThat(deleted.status()).as(deleted.body()).isEqualTo(200);
        assertThat(deleted.header("Content-Type")).isEqualTo("application/json");
        JsonNode trashed = deleted.json();
        assertThat(trashed.get("version").asLong()).isEqualTo(2);
        Instant deletedAt = Instant.parse(trashed.get("deletedAt").asString());
        assertThat(Instant.parse(trashed.get("purgeAt").asString())).isEqualTo(deletedAt.plus(Duration.ofDays(30)));
        assertThat(withoutChange(trashed)).isEqualTo(withoutChange(created));
        assertThat(cashBalance()).isZero();

        Reply restored = restore(created, "{\"version\":2}");

        assertThat(restored.status()).as(restored.body()).isEqualTo(200);
        JsonNode back = restored.json();
        assertThat(back.get("version").asLong()).isEqualTo(3);
        assertThat(List.of(back.get("deletedAt"), back.get("purgeAt"))).allMatch(JsonNode::isNull);
        assertThat(withoutChange(back)).isEqualTo(withoutChange(created));
        assertThat(cashBalance()).isEqualTo(-12_000);
        assertThat(history(created)).containsExactly("CREATE unknown", "DELETE iphone.safari", "RESTORE unknown");
    }

    @Test
    void version이_다르면_최신_거래가_든_409이고_맞으면_상태를_본다() throws Exception {
        JsonNode created = create();

        restore(created, "{\"version\":1}").assertProblem(409, "Conflict", "INVALID_STATE");
        JsonNode posted = delete(created, "7").assertProblem(409, "Conflict", "STALE_VERSION").json().get("current");
        assertThat(posted).isEqualTo(created);
        JsonNode trashed = delete(created, "1").json();
        delete(created, "2").assertProblem(409, "Conflict", "INVALID_STATE");
        for (Reply stale : List.of(delete(created, "1"), restore(created, "{\"version\":1}"))) {
            JsonNode current = stale.assertProblem(409, "Conflict", "STALE_VERSION").json().get("current");
            assertThat(current).as("휴지통이면 deletedAt이 있다").isEqualTo(trashed);
        }

        assertThat(history(created)).containsExactly("CREATE unknown", "DELETE unknown");
    }

    @Test
    void version과_기기_값의_형식이_틀리면_400이고_바꾸지_않는다() throws Exception {
        JsonNode created = create();

        client.send("DELETE", path(id(created)), null).assertFieldErrors("version:REQUIRED");
        delete(created, "").assertFieldErrors("version:REQUIRED");
        for (String query : List.of("x", "1.0", "0x1", "%201", "1&version=1", "99999999999999999999")) {
            delete(created, query).assertFieldErrors("version:INVALID_FORMAT");
        }
        delete(created, "1", DEVICE, "a b").assertFieldErrors("X-Akkimpyo-Device:INVALID_FORMAT");
        // 목록(ADR 007 결정 10)에 있는 기기 값이라 이력에 그대로 남는다.
        transactionService.delete(owner.getId(), id(created), 1, "mac.chrome");
        restore(created, "{}").assertFieldErrors("version:REQUIRED");
        restore(created, "{\"version\":null}").assertFieldErrors("version:REQUIRED");
        restore(created, "{\"version\":\"2\"}").assertFieldErrors("version:INVALID_FORMAT");
        restore(created, "{\"version\":2.0}").assertFieldErrors("version:INVALID_FORMAT");
        restore(created, "{\"version\":2}", DEVICE, "a b").assertFieldErrors("X-Akkimpyo-Device:INVALID_FORMAT");

        assertThat(history(created)).containsExactly("CREATE unknown", "DELETE mac.chrome");
    }

    /** 내가 구성원인 다른 장부의 거래, 남의 거래, 완전히 지운 거래, 없는 거래는 version이 틀려도 같은 404다. */
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
        UUID ofStranger = fixtures.delete(stranger,
                fixtures.expense(stranger, strangers, strangerCash, null, DAY, 7_000)).id();
        UUID purged = id(create());
        transactionService.delete(owner.getId(), purged, 1, "test-device");
        fixtures.purge(purged, owner.getId());
        UUID missingId = UUID.randomUUID();
        Reply missing = client.send("DELETE", path(missingId) + "?version=1", null);

        for (UUID target : List.of(inShared, ofStranger, purged, missingId)) {
            for (Reply reply : List.of(client.send("DELETE", path(target) + "?version=1", null),
                    client.send("DELETE", path(target), null),
                    client.send("POST", path(target) + "/restore", "{\"version\":2}", "Content-Type", "application/json"),
                    client.send("POST", path(target) + "/restore", "{}", "Content-Type", "application/json"))) {
                reply.assertProblem(404, "Not Found", "NOT_FOUND");
                assertThat(withoutRequestId(reply)).isEqualTo(withoutRequestId(missing));
            }
        }
        assertThat(jdbc.queryForList("select version from transaction where id in (?, ?)", Long.class, inShared,
                ofStranger)).containsExactlyInAnyOrder(1L, 2L);
    }

    /** 413 → 401 → 415 → 404다. 만들기·고치기와 같다. 지우기는 본문을 받지 않아 415가 없다. */
    @Test
    void 본문_상한과_인증과_Content_Type이_구성원_확인보다_먼저다() throws Exception {
        String path = "/api/v1/ledgers/" + ledgerId + "/transactions/" + UUID.randomUUID();
        ServerClient anyone = ServerClient.anonymous(port);
        ServerClient outsider = ServerClient.signedIn(port, user().getId(), NOW);
        String big = "{}" + " ".repeat(64 * 1024);

        anyone.rawReply("POST " + path + "/restore HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n"
                        + "Content-Type: text/plain\r\nContent-Length: " + big.length() + "\r\n\r\n" + big)
                .assertProblem(413, "Content Too Large", "PAYLOAD_TOO_LARGE");
        anyone.send("POST", path + "/restore", "x", "Content-Type", "text/plain")
                .assertProblem(401, "Unauthorized", "UNAUTHENTICATED");
        anyone.send("DELETE", path + "?version=1", null).assertProblem(401, "Unauthorized", "UNAUTHENTICATED");
        outsider.send("POST", path + "/restore", "x", "Content-Type", "text/plain")
                .assertProblem(415, "Unsupported Media Type", "UNSUPPORTED_MEDIA_TYPE");
        outsider.send("POST", path + "/restore", "{", "Content-Type", "application/json")
                .assertProblem(404, "Not Found", "NOT_FOUND");
        outsider.send("DELETE", path, null).assertProblem(404, "Not Found", "NOT_FOUND");
        client.send("DELETE", path + "?version=1", null, "Accept", "text/html")
                .assertProblem(400, "Bad Request", "MALFORMED_REQUEST");
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

    /** @param version 쿼리에 그대로 붙는 글자 */
    private Reply delete(JsonNode tx, String version, String... headers) throws Exception {
        return client.send("DELETE", path(id(tx)) + "?version=" + version, null, headers);
    }

    private Reply restore(JsonNode tx, String json, String... headers) throws Exception {
        String[] all = new String[headers.length + 2];
        all[0] = "Content-Type";
        all[1] = "application/json";
        System.arraycopy(headers, 0, all, 2, headers.length);
        return client.send("POST", path(id(tx)) + "/restore", json, all);
    }

    private String path(UUID id) {
        return "/api/v1/ledgers/" + ledgerId + "/transactions/" + id;
    }

    private long cashBalance() throws Exception {
        return client.get("/api/v1/ledgers/" + ledgerId + "/accounts").json().get("items").valueStream()
                .filter(item -> item.get("id").asString().equals(cash.toString()))
                .findFirst().orElseThrow().get("balance").asLong();
    }

    /** 이력의 "동작 기기", version 순. */
    private List<String> history(JsonNode tx) {
        return jdbc.queryForList("select action || ' ' || device_id from change_log where transaction_id = ?"
                + " order by version", String.class, id(tx));
    }

    /** 지우기와 되살리기가 바꾸는 칸을 뺀 나머지. 내용과 만든 기록은 그대로여야 한다. */
    private static JsonNode withoutChange(JsonNode tx) {
        ObjectNode rest = (ObjectNode) tx.deepCopy();
        rest.remove(List.of("version", "updatedAt", "updatedBy", "deletedAt", "purgeAt"));
        return rest;
    }

    private static UUID id(JsonNode tx) {
        return UUID.fromString(tx.get("id").asString());
    }

    private static String withoutRequestId(Reply reply) {
        return reply.body().replace(reply.header("X-Request-Id"), "");
    }
}
