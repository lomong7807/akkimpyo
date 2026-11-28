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
import app.accountbook.transaction.TransactionView;
import app.accountbook.user.User;
import app.accountbook.user.UserService;
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
import tools.jackson.databind.json.JsonMapper;

/**
 * {@code GET /api/v1/ledgers/{ledgerId}/transactions/{transactionId}/history}(#47 응답 계약): 순서, 항목 모양, 그 거래의
 * 이력만 오는 것, 404·401. 칸 비교의 규칙은 {@code HistoryResponseTest}가 본다.
 */
@LedgerApiTest
class TransactionHistoryHttpTest {

    private static final Instant NOW = Instant.parse("2026-11-27T03:00:00Z");
    private static final LocalDate DAY = LocalDate.of(2026, 11, 18);
    private static final JsonMapper JSON = new JsonMapper();

    @LocalServerPort int port;
    @Autowired StoppedClock clock;
    @Autowired Fixtures fixtures;
    @Autowired TransactionService transactionService;
    @Autowired UserService userService;
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
    void 이력은_오래된_순이고_휴지통의_거래도_200이다() throws Exception {
        User member = user();
        fixtures.addMember(ledgerId, member, LedgerRole.MEMBER);
        UUID id = UUID.randomUUID();
        transactionService.create(owner.getId(), ledgerId, expense(id, 12_000), "iphone.safari");
        transactionService.update(member.getId(), id, 1, expense(id, 15_000), "mac.chrome");
        transactionService.cancel(owner.getId(), id, 2, "x-y");
        transactionService.delete(owner.getId(), id, 3, "iphone.safari");

        Reply reply = history(ledgerId, id);

        assertThat(reply.status()).as(reply.body()).isEqualTo(200);
        assertThat(reply.header("Content-Type")).isEqualTo("application/json");
        JsonNode body = reply.json();
        assertThat(body.propertyNames()).containsExactly("items");
        List<JsonNode> items = body.get("items").valueStream().toList();
        assertThat(items).extracting(item -> item.get("action").asString())
                .containsExactly("CREATE", "UPDATE", "CANCEL", "DELETE");
        assertThat(items).extracting(item -> item.get("deviceId").asString())
                .containsExactly("iphone.safari", "mac.chrome", "unknown", "iphone.safari");
        assertThat(items).allSatisfy(item -> {
            assertThat(item.propertyNames()).containsExactlyInAnyOrder("action", "actor", "deviceId", "at", "changes");
            assertThat(item.get("at").asString()).matches("\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}\\.\\d{3}Z");
        });
        assertThat(items).extracting(item -> item.get("at").asString()).isSorted();
        assertThat(items.get(1).get("actor")).isEqualTo(json("{\"id\":\"" + member.getId() + "\",\"displayName\":\""
                + userService.memberDisplayNames(owner.getId(), ledgerId).get(member.getId()) + "\"}"));
        assertThat(items.get(0).get("changes")).extracting(change -> change.get("field").asString())
                .containsExactly("type", "occurredOn", "accountId", "categoryId", "amount", "paidBy", "status");
        assertThat(items.get(1).get("changes")).isEqualTo(json("[{\"field\":\"amount\",\"before\":12000,\"after\":15000}]"));
        assertThat(items.get(2).get("changes"))
                .isEqualTo(json("[{\"field\":\"status\",\"before\":\"POSTED\",\"after\":\"CANCELED\"}]"));
        assertThat(items.get(3).get("changes")).isEqualTo(json("[]"));
    }

    @Test
    void 그_거래의_이력만_오고_바꾼_사람이_비었으면_actor가_null이다() throws Exception {
        TransactionView once = fixtures.expense(owner, ledgerId, cash, null, DAY, 1_000);
        TransactionView twice = fixtures.expense(owner, ledgerId, cash, null, DAY, 2_000);
        transactionService.update(owner.getId(), twice.id(), 1, expense(twice.id(), 3_000), "iphone.safari");
        User other = user();
        UUID otherLedger = fixtures.personalLedgerId(other);
        ledgers.add(otherLedger);
        UUID otherCash = fixtures.account(other, otherLedger, "남의 현금", AccountType.CASH, 0, DAY).getId();
        fixtures.expense(other, otherLedger, otherCash, null, DAY, 4_000);
        // 탈퇴 정리가 하는 일(ADR 007 결정 5): 바꾼 사람과 기기 값을 비운다.
        jdbc.update("update change_log set actor_id = null, device_id = null where transaction_id = ?", once.id());

        List<JsonNode> onceItems = history(ledgerId, once.id()).json().get("items").valueStream().toList();
        List<JsonNode> twiceItems = history(ledgerId, twice.id()).json().get("items").valueStream().toList();

        assertThat(onceItems).hasSize(1);
        assertThat(onceItems.getFirst().get("actor").isNull()).isTrue();
        assertThat(onceItems.getFirst().get("deviceId").isNull()).isTrue();
        assertThat(onceItems.getFirst().get("changes").toString()).contains("\"after\":1000")
                .doesNotContain("\"after\":2000", "\"after\":3000", "\"after\":4000");
        assertThat(twiceItems).extracting(item -> item.get("action").asString()).containsExactly("CREATE", "UPDATE");
        assertThat(twiceItems.getFirst().get("actor").get("id").asString()).isEqualTo(owner.getId().toString());
        assertThat(twiceItems.toString()).doesNotContain("\"after\":1000", "\"after\":4000");
    }

    /** 없는 거래, 내가 구성원인 다른 장부의 거래, 완전히 지운 거래는 같은 404다. 구성원이 아닌 장부도 404, 토큰이 없으면 401. */
    @Test
    void 이_장부에_없는_거래는_404이고_토큰이_없으면_401이다() throws Exception {
        User other = user();
        UUID otherLedger = fixtures.personalLedgerId(other);
        ledgers.add(otherLedger);
        fixtures.addMember(otherLedger, owner, LedgerRole.MEMBER);
        UUID otherCash = fixtures.account(other, otherLedger, "남의 현금", AccountType.CASH, 0, DAY).getId();
        UUID elsewhere = fixtures.expense(other, otherLedger, otherCash, null, DAY, 4_000).id();
        UUID purged = fixtures.delete(owner, fixtures.expense(owner, ledgerId, cash, null, DAY, 1_000)).id();
        fixtures.purge(purged, owner.getId());
        UUID stranger = fixtures.personalLedgerId(user());

        assertThat(history(otherLedger, elsewhere).status()).as("대조: 그 장부의 경로").isEqualTo(200);
        Reply missing = history(ledgerId, UUID.randomUUID());
        missing.assertProblem(404, "Not Found", "NOT_FOUND");
        for (Reply reply : List.of(history(ledgerId, elsewhere), history(ledgerId, purged), history(stranger, elsewhere),
                client.get("/api/v1/ledgers/" + ledgerId + "/transactions/not-a-uuid/history"))) {
            reply.assertProblem(404, "Not Found", "NOT_FOUND");
            assertThat(reply.body().replace(reply.header("X-Request-Id"), ""))
                    .isEqualTo(missing.body().replace(missing.header("X-Request-Id"), ""));
        }
        ServerClient.anonymous(port).get(path(ledgerId, purged)).assertProblem(401, "Unauthorized", "UNAUTHENTICATED");
    }

    private Entry expense(UUID id, long amount) {
        return new Entry(id, TransactionType.EXPENSE, DAY, null, cash, null, amount, null, null, null, null);
    }

    private Reply history(UUID ledger, UUID transaction) throws Exception {
        return client.get(path(ledger, transaction));
    }

    private static String path(UUID ledger, UUID transaction) {
        return "/api/v1/ledgers/" + ledger + "/transactions/" + transaction + "/history";
    }

    private static JsonNode json(String text) {
        return JSON.readTree(text);
    }

    private User user() {
        return fixtures.user(UUID.randomUUID().toString().substring(0, 18) + "@example.com");
    }
}
