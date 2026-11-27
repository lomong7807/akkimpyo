package app.accountbook.api;

import static app.accountbook.api.AccountCreateTest.OMIT;
import static app.accountbook.api.AccountCreateTest.json;
import static app.accountbook.api.AccountCreateTest.quoted;
import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.params.provider.Arguments.arguments;

import app.accountbook.api.ServerClient.Reply;
import app.accountbook.category.CategoryCommand;
import app.accountbook.category.CategoryKind;
import app.accountbook.category.CategoryService;
import app.accountbook.ledger.LedgerRole;
import app.accountbook.support.Fixtures;
import app.accountbook.support.StoppedClockConfig.StoppedClock;
import app.accountbook.user.User;
import java.text.Normalizer;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Stream;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.jdbc.core.JdbcTemplate;
import tools.jackson.databind.JsonNode;

/**
 * 카테고리 추가 {@code POST /api/v1/ledgers/{ledgerId}/categories}와 이름 바꾸기 {@code PUT .../categories/{categoryId}}
 * (#44, F-510, F-511, P-221). 응답은 목록(#34)의 항목과 같은 모양이다. 동시 요청의 DB 제약 위반은 {@code CategoryNameRaceTest}가 본다.
 */
@LedgerApiTest
class CategoryWriteTest {

    private static final Instant NOW = Instant.parse("2026-11-27T03:00:00Z");

    @LocalServerPort int port;
    @Autowired StoppedClock clock;
    @Autowired Fixtures fixtures;
    @Autowired CategoryService categoryService;
    @Autowired JdbcTemplate jdbc;

    private User owner;
    private UUID ledgerId;
    private ServerClient client;
    /** 지출 최상위 식비, 그 하위 점심, 수입 최상위 용돈, 지출 미분류, 남의 장부의 지출, 지운 지출, 없는 id. */
    private final Map<String, UUID> refs = new LinkedHashMap<>();

    @BeforeEach
    void setUp() {
        clock.stopAt(NOW);
        owner = user();
        ledgerId = fixtures.personalLedgerId(owner);
        client = ServerClient.signedIn(port, owner.getId(), NOW);
        refs.put("@식비", create(owner, ledgerId, "식비", CategoryKind.EXPENSE, null));
        refs.put("@점심", create(owner, ledgerId, "점심", CategoryKind.EXPENSE, refs.get("@식비")));
        refs.put("@용돈", create(owner, ledgerId, "용돈", CategoryKind.INCOME, null));
        refs.put("@미분류", categoryService.uncategorized(ledgerId, CategoryKind.EXPENSE).getId());
        User stranger = user();
        refs.put("@남의것", create(stranger, fixtures.personalLedgerId(stranger), "남의식비", CategoryKind.EXPENSE, null));
        refs.put("@지운것", create(owner, ledgerId, "지운분류", CategoryKind.EXPENSE, null));
        categoryService.delete(owner.getId(), refs.get("@지운것"));
        refs.put("@없는것", UUID.randomUUID());
    }

    @Test
    void 추가는_201이고_본문은_목록의_항목과_같은_모양이며_Location이_있다() throws Exception {
        Reply top = post(body("\"EXPENSE\"", "\"  외식　\"", "null"));
        Reply child = post(body("\"EXPENSE\"", "\"저녁\"", ref("@식비")));

        assertThat(top.status()).as(top.body()).isEqualTo(201);
        assertThat(top.header("Content-Type")).isEqualTo("application/json");
        JsonNode created = top.json();
        assertThat(created.propertyNames()).containsExactly("id", "kind", "name", "system", "children");
        assertThat(List.of(created.get("kind").asString(), created.get("name").asString())).containsExactly("EXPENSE", "외식");
        assertThat(created.get("system").isBoolean() && !created.get("system").asBoolean()).isTrue();
        assertThat(created.get("children").isArray() && created.get("children").isEmpty()).isTrue();
        assertThat(top.header("Location")).isEqualTo(path() + "/" + created.get("id").asString());
        assertThat(child.status()).as(child.body()).isEqualTo(201);
        assertThat(child.json().propertyNames()).containsExactly("id", "kind", "name", "system", "children");
        assertThat(child.json().get("children").isEmpty()).isTrue();
        List<JsonNode> items = client.get(path()).json().get("items").valueStream().toList();
        assertThat(items).contains(created);
        assertThat(items.getFirst().get("children").valueStream().map(item -> item.get("name").asString()))
                .as("하위는 상위의 children에 만든 순서로 든다").containsExactly("점심", "저녁");
        assertThat(items.getFirst().get("children").get(1).get("id")).isEqualTo(child.json().get("id"));
    }

    @ParameterizedTest(name = "{0} = {1} → {2}")
    @MethodSource("oneWrongField")
    void 추가에서_한_칸이_틀리면_그_칸의_이유로_400이고_저장하지_않는다(String field, String value, String expected)
            throws Exception {
        Map<String, String> fields = fields("\"EXPENSE\"", "\"외식\"", "null");
        fields.put(field, refs.containsKey(value) ? ref(value) : value);
        long before = storedCount();

        post(json(fields)).assertFieldErrors(expected);

        assertThat(storedCount()).isEqualTo(before);
    }

    static Stream<Arguments> oneWrongField() {
        return Stream.of(
                arguments("kind", OMIT, "kind:REQUIRED"),
                arguments("kind", "null", "kind:REQUIRED"),
                arguments("kind", "\"expense\"", "kind:INVALID_FORMAT"),
                arguments("kind", "\"TRANSFER\"", "kind:INVALID_FORMAT"),
                arguments("kind", "0", "kind:INVALID_FORMAT"),
                arguments("name", OMIT, "name:REQUIRED"),
                arguments("name", "\"\"", "name:REQUIRED"),
                arguments("name", "\" 　 \"", "name:REQUIRED"),
                arguments("name", quoted("가".repeat(21)), "name:TOO_LONG"),
                arguments("name", "\"외\\u0000식\"", "name:INVALID_FORMAT"),
                arguments("name", "\"외\\u200b식\"", "name:INVALID_FORMAT"),
                arguments("name", "1", "name:INVALID_FORMAT"),
                arguments("parentId", "\"x\"", "parentId:INVALID_FORMAT"),
                arguments("parentId", "1", "parentId:INVALID_FORMAT"),
                arguments("parentId", "@없는것", "parentId:NOT_FOUND"),
                arguments("parentId", "@남의것", "parentId:NOT_FOUND"),
                arguments("parentId", "@지운것", "parentId:NOT_FOUND"),
                arguments("parentId", "@점심", "parentId:TOO_DEEP"),
                arguments("parentId", "@용돈", "parentId:TYPE_MISMATCH"),
                arguments("parentId", "@미분류", "parentId:NOT_ALLOWED"));
    }

    /**
     * 읽을 수 없는 칸은 서비스 검증 전에 모두, 서비스 검증의 오류도 모두 함께 알린다. 같은 이름은 맞춘 뒤(NFC, 앞뒤 공백)
     * 같은 장부·구분·상위 아래에서 비교하고, 나머지 칸이 모두 맞을 때만 본다.
     */
    @Test
    void 추가에서_틀린_칸은_모두_알리고_같은_이름은_나머지가_맞을_때만_DUPLICATE다() throws Exception {
        long before = storedCount();

        post("{}").assertFieldErrors("kind:REQUIRED", "name:REQUIRED");
        post(body("\"X\"", "1", "\"x\"")).assertFieldErrors("kind:INVALID_FORMAT", "name:INVALID_FORMAT",
                "parentId:INVALID_FORMAT");
        post(body(OMIT, quoted("가".repeat(21)), ref("@점심")))
                .assertFieldErrors("kind:REQUIRED", "name:TOO_LONG", "parentId:TOO_DEEP");
        post(body("\"EXPENSE\"", "\" 식비 \"", "null")).assertFieldErrors("name:DUPLICATE");
        post(body("\"EXPENSE\"", quoted(Normalizer.normalize("식비", Normalizer.Form.NFD)), "null"))
                .assertFieldErrors("name:DUPLICATE");
        post(body("\"EXPENSE\"", "\"미분류\"", "null")).assertFieldErrors("name:DUPLICATE");
        post(body("\"EXPENSE\"", "\"점심\"", ref("@식비"))).assertFieldErrors("name:DUPLICATE");
        post(body(OMIT, "\"식비\"", "null")).assertFieldErrors("kind:REQUIRED");
        assertThat(storedCount()).isEqualTo(before);

        assertThat(post(body("\"INCOME\"", "\"식비\"", "null")).status()).as("다른 구분").isEqualTo(201);
        assertThat(post(body("\"EXPENSE\"", "\"식비\"", ref("@식비"))).status()).as("상위와 같은 이름").isEqualTo(201);
        assertThat(post(body("\"EXPENSE\"", "\"점심\"", "null")).status()).as("다른 상위").isEqualTo(201);
    }

    /** 최상위는 지금의 하위를 담고 하위는 children이 비어 있다. 같은 이름(맞춘 뒤)으로 바꾸면 200이고 바뀌는 것이 없다. */
    @Test
    void 이름_바꾸기는_200이고_본문은_목록의_항목과_같은_모양이다() throws Exception {
        Reply top = put(refs.get("@식비"), "{\"name\":\"　밥값 \"}");

        assertThat(top.status()).as(top.body()).isEqualTo(200);
        assertThat(top.header("Content-Type")).isEqualTo("application/json");
        assertThat(top.json().propertyNames()).containsExactly("id", "kind", "name", "system", "children");
        assertThat(top.json().get("name").asString()).isEqualTo("밥값");
        assertThat(client.get(path()).json().get("items").get(0)).isEqualTo(top.json());
        assertThat(top.json().get("children").get(0).get("id").asString()).isEqualTo(refs.get("@점심").toString());

        Reply child = put(refs.get("@점심"), "{\"name\":\"밥값\"}");
        assertThat(child.status()).as("상위와 같은 이름은 겹치지 않는다 " + child.body()).isEqualTo(200);
        assertThat(child.json().get("children").isEmpty()).isTrue();

        for (String same : List.of("밥값", " 밥값 ", Normalizer.normalize("밥값", Normalizer.Form.NFD))) {
            Reply reply = put(refs.get("@식비"), "{\"name\":" + quoted(same) + "}");
            assertThat(reply.status()).as(reply.body()).isEqualTo(200);
            assertThat(reply.json()).isEqualTo(client.get(path()).json().get("items").get(0));
        }
        assertThat(List.of(stored(refs.get("@식비")), stored(refs.get("@점심")))).containsExactly("밥값", "밥값");
    }

    @ParameterizedTest(name = "{0} → {1}")
    @CsvSource(delimiterString = "|", textBlock = """
            {}                       | name:REQUIRED
            {"name":null}            | name:REQUIRED
            {"name":" 　 "}          | name:REQUIRED
            {"name":"가나다라마바사아자차카타파하가나다라마바사"} | name:TOO_LONG
            {"name":"외\\u200b식"}   | name:INVALID_FORMAT
            {"name":1}               | name:INVALID_FORMAT
            {"name":["식비"]}        | name:INVALID_FORMAT
            {"name":"점심","kind":1} | name:DUPLICATE
            """)
    void 이름_바꾸기에서_이름이_틀리면_추가와_같은_이유로_400이고_바꾸지_않는다(String body, String expected)
            throws Exception {
        UUID dinner = create(owner, ledgerId, "저녁", CategoryKind.EXPENSE, refs.get("@식비"));

        put(dinner, body).assertFieldErrors(expected);

        assertThat(stored(dinner)).isEqualTo("저녁");
    }

    /** 최상위에는 미분류가 있어 그 이름은 겹친다. 미분류 자신은 409이고, 입력 검증이 상태 검사보다 먼저다(ADR 002 5절). */
    @Test
    void 이름_바꾸기에서_최상위의_같은_이름은_400이고_미분류는_409다() throws Exception {
        UUID uncategorized = refs.get("@미분류");

        put(refs.get("@식비"), "{\"name\":\"미분류\"}").assertFieldErrors("name:DUPLICATE");
        assertThat(put(refs.get("@식비"), "{\"name\":\"지운분류\"}").status()).as("지운 것의 이름").isEqualTo(200);
        put(uncategorized, "{\"name\":\"기타\"}").assertProblem(409, "Conflict", "INVALID_STATE");
        put(uncategorized, "{\"name\":\"미분류\"}").assertProblem(409, "Conflict", "INVALID_STATE");
        put(uncategorized, "{\"name\":1}").assertFieldErrors("name:INVALID_FORMAT");

        assertThat(stored(uncategorized)).isEqualTo("미분류");
    }

    /** 내가 구성원인 다른 장부의 것, 남의 것, 지운 것, 형식이 틀린 id는 본문이 틀려도 없는 id와 같은 404이고 바꾸지 않는다. */
    @Test
    void 이름_바꾸기는_경로의_장부의_카테고리가_아니면_같은_404다() throws Exception {
        User other = user();
        UUID shared = fixtures.personalLedgerId(other);
        fixtures.addMember(shared, owner, LedgerRole.MEMBER);
        UUID sharedFood = create(other, shared, "같이쓰는식비", CategoryKind.EXPENSE, null);
        Reply missing = put(refs.get("@없는것"), "{\"name\":\"바꾼이름\"}");

        for (Object target : List.of(sharedFood, refs.get("@남의것"), refs.get("@지운것"), "x")) {
            for (String body : List.of("{\"name\":\"바꾼이름\"}", "{\"name\":1}", "{}")) {
                Reply reply = put(target, body).assertProblem(404, "Not Found", "NOT_FOUND");
                assertThat(withoutRequestId(reply)).as(target + " " + body).isEqualTo(withoutRequestId(missing));
            }
        }
        assertThat(List.of(stored(sharedFood), stored(refs.get("@남의것")))).containsExactly("같이쓰는식비", "남의식비");
        // 대조: 그 카테고리의 장부 경로로는 바뀐다. 구성원이면 소유자가 아니어도 된다.
        assertThat(client.send("PUT", "/api/v1/ledgers/" + shared + "/categories/" + sharedFood,
                "{\"name\":\"바꾼이름\"}", "Content-Type", "application/json").status()).isEqualTo(200);
    }

    /**
     * 401 → 415 → 404(구성원 확인은 본문을 읽기 전) 순서다. 응답할 수 없는 {@code Accept}와 JSON이 아닌 본문은 저장하기 전에
     * 거절한다(ADR 002 5절). 구성원이면 소유자가 아니어도 만든다.
     */
    @Test
    void 인증_Content_Type_구성원_확인_순서이고_받을_수_없는_요청은_저장하기_전에_거절한다() throws Exception {
        String valid = body("\"EXPENSE\"", "\"외식\"", "null");
        String food = path() + "/" + refs.get("@식비");
        ServerClient outsider = ServerClient.signedIn(port, user().getId(), NOW);
        long before = storedCount();

        for (String[] call : List.of(new String[] {"POST", path()}, new String[] {"PUT", food})) {
            ServerClient.anonymous(port).send(call[0], call[1], valid, "Content-Type", "application/json")
                    .assertProblem(401, "Unauthorized", "UNAUTHENTICATED");
            outsider.send(call[0], call[1], valid, "Content-Type", "text/plain")
                    .assertProblem(415, "Unsupported Media Type", "UNSUPPORTED_MEDIA_TYPE");
            for (String body : List.of(valid, "{", "{\"kind\":1,\"name\":1}")) {
                outsider.send(call[0], call[1], body, "Content-Type", "application/json")
                        .assertProblem(404, "Not Found", "NOT_FOUND");
            }
            client.send(call[0], call[1], valid, "Content-Type", "application/json", "Accept", "text/html")
                    .assertProblem(400, "Bad Request", "MALFORMED_REQUEST");
            client.send(call[0], call[1], "{", "Content-Type", "application/json")
                    .assertProblem(400, "Bad Request", "MALFORMED_REQUEST");
            client.send(call[0], call[1], valid + " {}", "Content-Type", "application/json")
                    .assertProblem(400, "Bad Request", "MALFORMED_REQUEST");
            client.send(call[0], call[1], "[]", "Content-Type", "application/json").assertFieldErrors(":INVALID_FORMAT");
        }
        assertThat(storedCount()).isEqualTo(before);
        assertThat(stored(refs.get("@식비"))).isEqualTo("식비");

        User member = user();
        fixtures.addMember(ledgerId, member, LedgerRole.MEMBER);
        assertThat(ServerClient.signedIn(port, member.getId(), NOW).postJson(path(), valid).status()).isEqualTo(201);
    }

    // ---------------------------------------------------------------- 도우미

    private Reply post(String json) throws Exception {
        return client.send("POST", path(), json, "Content-Type", "application/json", "Accept", "application/json");
    }

    private Reply put(Object categoryId, String json) throws Exception {
        return client.send("PUT", path() + "/" + categoryId, json, "Content-Type", "application/json",
                "Accept", "application/json");
    }

    private UUID create(User actor, UUID ledger, String name, CategoryKind kind, UUID parentId) {
        return categoryService.create(actor.getId(), ledger, new CategoryCommand(name, kind, parentId)).getId();
    }

    private String ref(String key) {
        return quoted(refs.get(key).toString());
    }

    private long storedCount() {
        return jdbc.queryForObject("select count(*) from category where ledger_id = ?", Long.class, ledgerId);
    }

    private String stored(UUID categoryId) {
        return jdbc.queryForObject("select name from category where id = ?", String.class, categoryId);
    }

    private String path() {
        return "/api/v1/ledgers/" + ledgerId + "/categories";
    }

    private User user() {
        return fixtures.user(UUID.randomUUID().toString().substring(0, 18) + "@example.com");
    }

    private static String body(String kind, String name, String parentId) {
        return json(fields(kind, name, parentId));
    }

    private static Map<String, String> fields(String kind, String name, String parentId) {
        Map<String, String> fields = new LinkedHashMap<>();
        fields.put("kind", kind);
        fields.put("name", name);
        fields.put("parentId", parentId);
        return fields;
    }

    private static String withoutRequestId(Reply reply) {
        return reply.body().replace(reply.header("X-Request-Id"), "");
    }
}
