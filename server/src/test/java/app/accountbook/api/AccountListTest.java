package app.accountbook.api;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.clearInvocations;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;

import app.accountbook.account.AccountType;
import app.accountbook.api.ServerClient.Reply;
import app.accountbook.stats.BalanceQuery;
import app.accountbook.support.Fixtures;
import app.accountbook.support.StoppedClockConfig.StoppedClock;
import app.accountbook.user.User;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.util.Comparator;
import java.util.List;
import java.util.UUID;
import java.util.stream.Stream;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.jdbc.core.JdbcTemplate;
import tools.jackson.databind.JsonNode;

/** {@code GET /api/v1/ledgers/{ledgerId}/accounts}(#13 응답 계약, F-501). */
@LedgerApiTest
class AccountListTest {

    private static final Instant NOW = Instant.parse("2026-11-27T03:00:00Z");
    private static final LocalDate OPENING = LocalDate.of(2026, 11, 1);

    @LocalServerPort int port;
    @Autowired StoppedClock clock;
    @Autowired Fixtures fixtures;
    @Autowired BalanceQuery balanceQuery;
    @Autowired JdbcTemplate jdbc;

    private User owner;
    private UUID ledgerId;
    private ServerClient client;

    @BeforeEach
    void setUp() {
        clock.stopAt(NOW);
        owner = fixtures.user(UUID.randomUUID().toString().substring(0, 18) + "@example.com");
        ledgerId = fixtures.personalLedgerId(owner);
        client = ServerClient.signedIn(port, owner.getId(), NOW);
    }

    /** HTTP 테스트는 롤백되지 않는다. 거래 수를 DB 전체로 세는 테스트(TransactionServiceTest 등)가 있어 만든 거래를 지운다. */
    @AfterEach
    void removeTransactions() {
        jdbc.update("delete from change_log where ledger_id = ?", ledgerId);
        jdbc.update("delete from transaction where ledger_id = ?", ledgerId);
    }

    @Test
    void 계좌가_없으면_빈_목록이다() throws Exception {
        Reply reply = client.get(path());

        assertThat(reply.status()).isEqualTo(200);
        assertThat(reply.header("Content-Type")).isEqualTo("application/json");
        assertThat(reply.json().propertyNames()).containsExactly("items");
        assertThat(reply.json().get("items").isArray()).isTrue();
        assertThat(reply.json().get("items").isEmpty()).isTrue();
    }

    @Test
    void 만든_순서대로_이름_종류_잔액_시작_잔액_기준일을_돌려준다() throws Exception {
        UUID bank = fixtures.account(owner, ledgerId, "월급통장", AccountType.BANK, 100_000, OPENING).getId();
        UUID card = fixtures.account(owner, ledgerId, "신용카드", AccountType.CARD, -50_000, OPENING).getId();
        UUID cash = fixtures.account(owner, ledgerId, "지갑", AccountType.CASH, 0, LocalDate.of(2026, 11, 20)).getId();
        fixtures.expense(owner, ledgerId, card, null, LocalDate.of(2026, 11, 18), 12_000);
        fixtures.transfer(owner, ledgerId, bank, cash, LocalDate.of(2026, 11, 25), 30_000);
        // 기준일 앞의 거래, 지운 거래, 취소한 거래는 잔액에 들지 않는다(BalanceQuery).
        fixtures.expense(owner, ledgerId, cash, null, LocalDate.of(2026, 11, 19), 5_000);
        fixtures.delete(owner, fixtures.expense(owner, ledgerId, bank, null, LocalDate.of(2026, 11, 18), 1_000));
        fixtures.cancel(owner, fixtures.expense(owner, ledgerId, bank, null, LocalDate.of(2026, 11, 18), 2_000));

        JsonNode items = client.get(path()).json().get("items");

        assertThat(items.valueStream().map(AccountListTest::describe)).containsExactly(
                bank + " 월급통장 BANK 70000 100000 2026-11-01",
                card + " 신용카드 CARD -62000 -50000 2026-11-01",
                cash + " 지갑 CASH 30000 0 2026-11-20");
        assertThat(items.valueStream().toList()).allSatisfy(item -> {
            assertThat(item.propertyNames()).containsExactly("id", "name", "type", "balance", "openingBalance", "openingDate");
            assertThat(item.get("balance").isIntegralNumber()).as("금액은 JSON 정수다").isTrue();
            assertThat(item.get("openingBalance").isIntegralNumber()).as("금액은 JSON 정수다").isTrue();
        });
    }

    @Test
    void 만든_시각이_같으면_id_순이다() throws Exception {
        List<UUID> ids = Stream.of("가", "나", "다", "라", "마")
                .map(name -> fixtures.account(owner, ledgerId, name, AccountType.CASH, 0, OPENING).getId())
                .toList();
        jdbc.update("update account set created_at = ? where ledger_id = ?", Timestamp.from(NOW), ledgerId);

        JsonNode items = client.get(path()).json().get("items");

        // PostgreSQL은 uuid를 바이트 순으로 놓는다. 소문자 표기를 글자 순으로 놓은 것과 같다(UUID.compareTo는 부호가 있어 다르다).
        assertThat(items.valueStream().map(item -> item.get("id").asString()))
                .containsExactlyElementsOf(ids.stream().map(UUID::toString).sorted(Comparator.naturalOrder()).toList());
    }

    @Test
    void 잔액은_장부_전체를_한_번에_구한다() throws Exception {
        fixtures.account(owner, ledgerId, "월급통장", AccountType.BANK, 0, OPENING);
        fixtures.account(owner, ledgerId, "지갑", AccountType.CASH, 0, OPENING);
        clearInvocations(balanceQuery);

        assertThat(client.get(path()).json().get("items").size()).isEqualTo(2);

        verify(balanceQuery, times(1)).balances(owner.getId(), ledgerId);
        verify(balanceQuery, never()).balance(any(), any());
    }

    private String path() {
        return "/api/v1/ledgers/" + ledgerId + "/accounts";
    }

    private static String describe(JsonNode item) {
        return String.join(" ", item.get("id").asString(), item.get("name").asString(), item.get("type").asString(),
                item.get("balance").asString(), item.get("openingBalance").asString(), item.get("openingDate").asString());
    }
}
