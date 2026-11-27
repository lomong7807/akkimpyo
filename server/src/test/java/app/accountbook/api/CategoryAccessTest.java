package app.accountbook.api;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.DynamicTest.dynamicTest;

import app.accountbook.api.ServerClient.Reply;
import app.accountbook.category.CategoryCommand;
import app.accountbook.category.CategoryKind;
import app.accountbook.category.CategoryService;
import app.accountbook.support.Fixtures;
import app.accountbook.support.StoppedClockConfig.StoppedClock;
import app.accountbook.user.User;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Stream;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DynamicTest;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.TestFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * 카테고리 목록의 다른 장부 접근 거부(#19의 표를 이 API의 HTTP로, #34). A가 장부 자리에 B의 장부나 B의 카테고리 id를
 * 넣으면 없는 장부와 같은 404이고, 응답에 B의 값이 없다. 대조로 B 자신은 같은 요청이 열린다.
 * 계좌 API의 표(#305)와 겹치지 않게 이 경로만 다룬다.
 */
@LedgerApiTest
class CategoryAccessTest {

    private static final Instant NOW = Instant.parse("2026-11-27T03:00:00Z");

    @LocalServerPort int port;
    @Autowired StoppedClock clock;
    @Autowired Fixtures fixtures;
    @Autowired CategoryService categoryService;
    @Autowired JdbcTemplate jdbc;

    private ServerClient a;
    private ServerClient b;
    private UUID ledgerA;
    private UUID ledgerB;
    private final Map<String, UUID> targets = new LinkedHashMap<>();
    private List<String> secretsOfB;

    @BeforeEach
    void setUp() {
        clock.stopAt(NOW);
        User userA = fixtures.user(UUID.randomUUID().toString().substring(0, 18) + "@example.com");
        ledgerA = fixtures.personalLedgerId(userA);
        categoryService.create(userA.getId(), ledgerA, new CategoryCommand("A식비", CategoryKind.EXPENSE, null));
        a = ServerClient.signedIn(port, userA.getId(), NOW);

        User userB = fixtures.user(UUID.randomUUID().toString().substring(0, 18) + "@example.com");
        ledgerB = fixtures.personalLedgerId(userB);
        UUID bFood = categoryService.create(userB.getId(), ledgerB,
                new CategoryCommand("B식비", CategoryKind.EXPENSE, null)).getId();
        UUID bLunch = categoryService.create(userB.getId(), ledgerB,
                new CategoryCommand("B점심", CategoryKind.EXPENSE, bFood)).getId();
        UUID bSalary = categoryService.create(userB.getId(), ledgerB,
                new CategoryCommand("B급여", CategoryKind.INCOME, null)).getId();
        b = ServerClient.signedIn(port, userB.getId(), NOW);

        targets.put("B의 장부", ledgerB);
        targets.put("B의 카테고리 id", bFood);
        targets.put("B의 하위 카테고리 id", bLunch);
        secretsOfB = List.of("B식비", "B점심", "B급여", userB.getEmail(),
                ledgerB.toString(), bFood.toString(), bLunch.toString(), bSalary.toString());
    }

    /** HTTP 테스트는 롤백되지 않는다. 만든 카테고리를 지운다(하위와 상위를 한 문장에서 지워 FK에 걸리지 않는다). */
    @AfterEach
    void removeCategories() {
        jdbc.update("delete from category where ledger_id in (?, ?) and not system", ledgerA, ledgerB);
    }

    @TestFactory
    Stream<DynamicTest> A는_B의_카테고리_목록에_닿을_수_없다() {
        return targets.entrySet().stream()
                .map(target -> dynamicTest("카테고리 목록: " + target.getKey(), () -> verifyDenied(target.getValue())));
    }

    @Test
    void 대조_B는_자기_장부의_카테고리_목록을_받는다() throws Exception {
        Reply reply = b.get(categories(ledgerB));

        assertThat(reply.status()).as(reply.body()).isEqualTo(200);
        assertThat(reply.body()).contains("B식비", "B점심", "B급여");
    }

    /** 거부와 별개로, A가 자기 장부를 조회한 결과에 B의 것이 섞이지 않는다. */
    @Test
    void A의_카테고리_목록에_B의_것이_섞이지_않는다() throws Exception {
        Reply reply = a.get(categories(ledgerA));

        assertThat(reply.status()).isEqualTo(200);
        assertThat(reply.body()).contains("A식비").doesNotContain(secretsOfB);
    }

    private void verifyDenied(UUID ledger) throws Exception {
        Reply missing = a.get(categories(UUID.randomUUID()));

        Reply denied = a.get(categories(ledger));

        denied.assertProblem(404, "Not Found", "NOT_FOUND");
        assertThat(denied.body().replace(denied.header("X-Request-Id"), ""))
                .as("없는 장부와 같은 응답")
                .isEqualTo(missing.body().replace(missing.header("X-Request-Id"), ""));
        assertThat(denied.headers().keySet()).isEqualTo(missing.headers().keySet());
        assertThat(String.join("\n", denied.body(), denied.headers().toString())).doesNotContain(secretsOfB);
    }

    private static String categories(UUID ledger) {
        return "/api/v1/ledgers/" + ledger + "/categories";
    }
}
