package app.accountbook.api;

import static org.assertj.core.api.Assertions.assertThat;

import app.accountbook.api.ServerClient.Reply;
import app.accountbook.category.CategoryCommand;
import app.accountbook.category.CategoryKind;
import app.accountbook.category.CategoryService;
import app.accountbook.support.Fixtures;
import app.accountbook.support.StoppedClockConfig.StoppedClock;
import app.accountbook.user.User;
import jakarta.persistence.EntityManagerFactory;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.Comparator;
import java.util.List;
import java.util.UUID;
import java.util.stream.IntStream;
import java.util.stream.Stream;
import org.hibernate.SessionFactory;
import org.hibernate.stat.Statistics;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.jdbc.core.JdbcTemplate;
import tools.jackson.databind.JsonNode;

/** {@code GET /api/v1/ledgers/{ledgerId}/categories}(#34 응답 계약, F-509, P-204). */
@LedgerApiTest
class CategoryListTest {

    private static final Instant NOW = Instant.parse("2026-11-27T03:00:00Z");

    @LocalServerPort int port;
    @Autowired StoppedClock clock;
    @Autowired Fixtures fixtures;
    @Autowired CategoryService categoryService;
    @Autowired JdbcTemplate jdbc;
    @Autowired EntityManagerFactory entityManagerFactory;

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

    /** HTTP 테스트는 롤백되지 않는다. 만든 카테고리를 지운다(하위와 상위를 한 문장에서 지워 FK에 걸리지 않는다). */
    @AfterEach
    void removeCategories() {
        jdbc.update("delete from category where ledger_id = ? and not system", ledgerId);
    }

    @Test
    void 미분류만_있으면_지출_수입_순서로_하위가_빈_배열이다() throws Exception {
        Reply reply = client.get(path());

        assertThat(reply.status()).isEqualTo(200);
        assertThat(reply.header("Content-Type")).isEqualTo("application/json");
        assertThat(reply.json().propertyNames()).containsExactly("items");
        JsonNode items = reply.json().get("items");
        assertThat(items.valueStream().map(CategoryListTest::describe))
                .containsExactly("EXPENSE 미분류 system []", "INCOME 미분류 system []");
        assertThat(items.valueStream().toList()).allSatisfy(item -> {
            assertThat(item.propertyNames()).containsExactly("id", "kind", "name", "system", "children");
            assertThat(item.get("system").isBoolean()).isTrue();
            assertThat(item.get("children").isArray()).as("하위가 없어도 null이 아니라 빈 배열이다").isTrue();
        });
    }

    /**
     * 미분류는 가입할 때 생겨 사용자가 만든 카테고리보다 만든 시각이 앞선다. 그래도 구분마다 맨 뒤다(dba 메모, PR #136).
     * 만든 시각을 이름과 다른 순서로 둬서 이름이나 저장 순서가 아니라 만든 시각으로 놓는 것을 본다.
     */
    @Test
    void 지출_먼저_수입_다음이고_구분_안에서_미분류가_맨_뒤_나머지는_만든_순서다() throws Exception {
        UUID salary = create("급여", CategoryKind.INCOME, null, 1);
        UUID transport = create("교통", CategoryKind.EXPENSE, null, 3);
        UUID food = create("식비", CategoryKind.EXPENSE, null, 2);
        UUID dinner = create("저녁", CategoryKind.EXPENSE, food, 5);
        UUID lunch = create("점심", CategoryKind.EXPENSE, food, 4);
        UUID bonus = create("상여", CategoryKind.INCOME, salary, 6);

        JsonNode items = client.get(path()).json().get("items");

        assertThat(items.valueStream().map(CategoryListTest::describe)).containsExactly(
                "EXPENSE 식비 [점심, 저녁]",
                "EXPENSE 교통 []",
                "EXPENSE 미분류 system []",
                "INCOME 급여 [상여]",
                "INCOME 미분류 system []");
        assertThat(items.valueStream().map(item -> item.get("id").asString()))
                .as("items는 최상위만이다")
                .doesNotContain(dinner.toString(), lunch.toString(), bonus.toString());
        assertThat(items.get(0).get("id").asString()).isEqualTo(food.toString());
        assertThat(items.get(1).get("id").asString()).isEqualTo(transport.toString());
        assertThat(items.get(3).get("id").asString()).isEqualTo(salary.toString());
        JsonNode lunchNode = items.get(0).get("children").get(0);
        assertThat(lunchNode.propertyNames()).containsExactly("id", "name");
        assertThat(lunchNode.get("id").asString()).isEqualTo(lunch.toString());
        assertThat(items.get(0).get("children").get(1).get("id").asString()).isEqualTo(dinner.toString());
        assertThat(items.get(3).get("children").get(0).get("id").asString()).isEqualTo(bonus.toString());
    }

    @Test
    void 만든_시각이_같으면_최상위도_하위도_id_순이고_미분류는_여전히_맨_뒤다() throws Exception {
        List<UUID> tops = Stream.of("가", "나", "다", "라", "마")
                .map(name -> create(name, CategoryKind.EXPENSE, null, 0))
                .toList();
        UUID parent = tops.getFirst();
        List<UUID> children = Stream.of("하나", "둘", "셋", "넷", "다섯")
                .map(name -> create(name, CategoryKind.EXPENSE, parent, 0))
                .toList();
        // 미분류까지 모두 같은 시각으로 둔다.
        jdbc.update("update category set created_at = ? where ledger_id = ?", Timestamp.from(NOW), ledgerId);

        JsonNode items = client.get(path()).json().get("items");

        // PostgreSQL은 uuid를 바이트 순으로 놓는다. 소문자 표기를 글자 순으로 놓은 것과 같다(UUID.compareTo는 부호가 있어 다르다).
        List<String> expense = items.valueStream()
                .filter(item -> item.get("kind").asString().equals("EXPENSE"))
                .map(item -> item.get("id").asString())
                .toList();
        assertThat(expense.subList(0, tops.size())).containsExactlyElementsOf(byteOrder(tops));
        assertThat(items.get(tops.size()).get("system").asBoolean()).isTrue();
        JsonNode parentNode = items.valueStream()
                .filter(item -> item.get("id").asString().equals(parent.toString()))
                .findFirst().orElseThrow();
        assertThat(parentNode.get("children").valueStream().map(child -> child.get("id").asString()))
                .containsExactlyElementsOf(byteOrder(children));
    }

    /** 장부의 카테고리 수와 상관없이 요청 하나가 DB에 보내는 문장 수가 같다(N+1 없음). */
    @Test
    void 카테고리가_늘어도_문장_수가_같다() throws Exception {
        long few = statements();

        IntStream.range(0, 4).forEach(i -> {
            UUID expense = create("지출" + i, CategoryKind.EXPENSE, null, i);
            UUID income = create("수입" + i, CategoryKind.INCOME, null, i);
            IntStream.range(0, 3).forEach(j -> {
                create("지출" + i + "-" + j, CategoryKind.EXPENSE, expense, 10 + j);
                create("수입" + i + "-" + j, CategoryKind.INCOME, income, 10 + j);
            });
        });
        assertThat(client.get(path()).json().get("items").size()).isEqualTo(10);

        assertThat(few).isPositive();
        assertThat(statements()).isEqualTo(few);
    }

    @Test
    void 토큰이_없으면_401이다() throws Exception {
        ServerClient anyone = ServerClient.anonymous(port);

        for (UUID ledger : List.of(ledgerId, UUID.randomUUID())) {
            anyone.get("/api/v1/ledgers/" + ledger + "/categories")
                    .assertProblem(401, "Unauthorized", "UNAUTHENTICATED");
        }
    }

    /** 요청 하나를 처리하며 Hibernate가 준비한 문장 수. 통계는 이 동안만 켠다(테스트는 한 번에 하나씩 돈다). */
    private long statements() throws Exception {
        Statistics statistics = entityManagerFactory.unwrap(SessionFactory.class).getStatistics();
        statistics.clear();
        statistics.setStatisticsEnabled(true);
        try {
            assertThat(client.get(path()).status()).isEqualTo(200);
            return statistics.getPrepareStatementCount();
        } finally {
            statistics.setStatisticsEnabled(false);
            statistics.clear();
        }
    }

    /** 카테고리를 만들고 만든 시각을 NOW + offsetSeconds로 둔다. */
    private UUID create(String name, CategoryKind kind, UUID parentId, int offsetSeconds) {
        UUID id = categoryService.create(owner.getId(), ledgerId, new CategoryCommand(name, kind, parentId)).getId();
        jdbc.update("update category set created_at = ? where id = ?", Timestamp.from(NOW.plusSeconds(offsetSeconds)), id);
        return id;
    }

    private String path() {
        return "/api/v1/ledgers/" + ledgerId + "/categories";
    }

    private static List<String> byteOrder(List<UUID> ids) {
        return ids.stream().map(UUID::toString).sorted(Comparator.naturalOrder()).toList();
    }

    /** "구분 이름 [system] [하위 이름, ...]". */
    private static String describe(JsonNode item) {
        List<String> children = item.get("children").valueStream().map(child -> child.get("name").asString()).toList();
        return String.join(" ", Stream.of(item.get("kind").asString(), item.get("name").asString(),
                        item.get("system").asBoolean() ? "system" : null, children.toString())
                .filter(part -> part != null)
                .toList());
    }
}
