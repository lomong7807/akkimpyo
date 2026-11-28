package app.accountbook.api;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.params.provider.Arguments.arguments;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doReturn;

import app.accountbook.account.AccountRepository;
import app.accountbook.api.ServerClient.Reply;
import app.accountbook.support.Fixtures;
import app.accountbook.support.StoppedClockConfig.StoppedClock;
import app.accountbook.user.User;
import java.time.Instant;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;
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

/** {@code POST /api/v1/ledgers/{ledgerId}/accounts}(#13 추가 요청과 응답 계약, F-502). */
@LedgerApiTest
class AccountCreateTest {

    /** 서울은 2026-11-28 00:30이고 UTC는 아직 11-27이다. 기준일의 끝은 서울의 오늘로부터 1년 뒤인 2027-11-28이다. */
    static final Instant NOW = Instant.parse("2026-11-27T15:30:00Z");
    /** 이 값을 넣으면 그 입력란을 본문에서 뺀다. */
    static final String OMIT = "(빠짐)";

    @LocalServerPort int port;
    @Autowired StoppedClock clock;
    @Autowired Fixtures fixtures;
    @Autowired AccountRepository accountRepository;
    @Autowired JdbcTemplate jdbc;

    private UUID ledgerId;
    private ServerClient client;

    @BeforeEach
    void setUp() {
        clock.stopAt(NOW);
        User owner = fixtures.user(UUID.randomUUID().toString().substring(0, 18) + "@example.com");
        ledgerId = fixtures.personalLedgerId(owner);
        client = ServerClient.signedIn(port, owner.getId(), NOW);
    }

    @Test
    void 만들면_201이고_본문은_목록의_항목과_같다() throws Exception {
        Reply created = create(body("\"  신한카드　\"", "\"CARD\"", "-350000", "\"2026-11-01\""));

        assertThat(created.status()).as(created.body()).isEqualTo(201);
        assertThat(created.header("Content-Type")).isEqualTo("application/json");
        JsonNode account = created.json();
        assertThat(account.propertyNames()).containsExactly("id", "name", "type", "balance", "openingBalance", "openingDate",
                "hidden");
        assertThat(account.get("id").asString()).matches("[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}");
        assertThat(account.get("name").asString()).isEqualTo("신한카드");
        assertThat(account.get("type").asString()).isEqualTo("CARD");
        assertThat(account.get("hidden").asBoolean()).as("새 계좌는 보인다").isFalse();
        assertThat(account.get("balance").isIntegralNumber()).isTrue();
        assertThat(account.get("balance").asLong()).as("부호를 바꾸지 않는다").isEqualTo(-350_000);
        assertThat(account.get("openingBalance").isIntegralNumber()).isTrue();
        assertThat(account.get("openingBalance").asLong()).isEqualTo(-350_000);
        assertThat(account.get("openingDate").asString()).isEqualTo("2026-11-01");
        assertThat(client.get(path()).json().get("items").get(0)).isEqualTo(account);
        assertThat(jdbc.queryForObject("select opening_balance from account where id = ?::uuid", Long.class,
                account.get("id").asString())).isEqualTo(-350_000);
    }

    @ParameterizedTest
    @CsvSource(delimiterString = "|", textBlock = """
            이름은 50자까지          | NAME50 | 0            | 2026-11-01
            시작 잔액의 아래 끝      | 가     | -9999999999  | 2026-11-01
            시작 잔액의 위 끝        | 나     | 9999999999   | 2026-11-01
            기준일의 처음            | 다     | 0            | 2000-01-01
            기준일의 끝(서울의 오늘+1년) | 라  | 0            | 2027-11-28
            """)
    void 범위의_끝은_받는다(String label, String name, String openingBalance, String openingDate) throws Exception {
        String actualName = name.equals("NAME50") ? "가".repeat(50) : name;

        Reply reply = create(body(quoted(actualName), "\"CASH\"", openingBalance, quoted(openingDate)));

        assertThat(reply.status()).as(label + " " + reply.body()).isEqualTo(201);
        assertThat(reply.json().get("balance").asString()).isEqualTo(openingBalance);
    }

    @ParameterizedTest(name = "{0} = {1} → {2}")
    @MethodSource("oneWrongField")
    void 한_칸이_틀리면_그_칸의_이유로_400이고_저장하지_않는다(String field, String value, String expected)
            throws Exception {
        Map<String, String> fields = valid();
        fields.put(field, value);

        create(json(fields)).assertFieldErrors(expected);

        assertThat(storedCount()).isZero();
    }

    static Stream<Arguments> oneWrongField() {
        return Stream.of(
                arguments("name", OMIT, "name:REQUIRED"),
                arguments("name", "null", "name:REQUIRED"),
                arguments("name", "\"\"", "name:REQUIRED"),
                arguments("name", "\" 　  \"", "name:REQUIRED"),
                arguments("name", quoted("가".repeat(51)), "name:TOO_LONG"),
                arguments("name", "\"생활\\u0000비\"", "name:INVALID_FORMAT"),
                arguments("name", "\"생활\\u200b비\"", "name:INVALID_FORMAT"),
                arguments("name", "1", "name:INVALID_FORMAT"),
                arguments("name", "[\"생활비\"]", "name:INVALID_FORMAT"),
                arguments("type", OMIT, "type:REQUIRED"),
                arguments("type", "null", "type:REQUIRED"),
                arguments("type", "\"bank\"", "type:INVALID_FORMAT"),
                arguments("type", "\"SAVINGS\"", "type:INVALID_FORMAT"),
                arguments("type", "\"\"", "type:INVALID_FORMAT"),
                arguments("type", "0", "type:INVALID_FORMAT"),
                arguments("openingBalance", OMIT, "openingBalance:REQUIRED"),
                arguments("openingBalance", "null", "openingBalance:REQUIRED"),
                arguments("openingBalance", "\"5\"", "openingBalance:INVALID_FORMAT"),
                arguments("openingBalance", "1.9", "openingBalance:INVALID_FORMAT"),
                arguments("openingBalance", "1.0", "openingBalance:INVALID_FORMAT"),
                arguments("openingBalance", "1e2", "openingBalance:INVALID_FORMAT"),
                arguments("openingBalance", "true", "openingBalance:INVALID_FORMAT"),
                arguments("openingBalance", "10000000000", "openingBalance:OUT_OF_RANGE"),
                arguments("openingBalance", "-10000000000", "openingBalance:OUT_OF_RANGE"),
                arguments("openingBalance", "99999999999999999999", "openingBalance:OUT_OF_RANGE"),
                arguments("openingDate", OMIT, "openingDate:REQUIRED"),
                arguments("openingDate", "null", "openingDate:REQUIRED"),
                arguments("openingDate", "\"\"", "openingDate:INVALID_FORMAT"),
                arguments("openingDate", "\"2026/11/01\"", "openingDate:INVALID_FORMAT"),
                arguments("openingDate", "\"2026-11-1\"", "openingDate:INVALID_FORMAT"),
                arguments("openingDate", "\"20261101\"", "openingDate:INVALID_FORMAT"),
                arguments("openingDate", "\"2026-02-30\"", "openingDate:INVALID_FORMAT"),
                arguments("openingDate", "\"2026-11-01T00:00:00Z\"", "openingDate:INVALID_FORMAT"),
                arguments("openingDate", "\"2026-11-01 \"", "openingDate:INVALID_FORMAT"),
                arguments("openingDate", "\"+2026-11-01\"", "openingDate:INVALID_FORMAT"),
                arguments("openingDate", "\"２０２６-11-01\"", "openingDate:INVALID_FORMAT"),
                arguments("openingDate", "[2026,11,1]", "openingDate:INVALID_FORMAT"),
                arguments("openingDate", "20261101", "openingDate:INVALID_FORMAT"),
                arguments("openingDate", "\"1999-12-31\"", "openingDate:OUT_OF_RANGE"),
                arguments("openingDate", "\"2027-11-29\"", "openingDate:OUT_OF_RANGE"));
    }

    @Test
    void 여러_칸이_틀리면_형식_오류를_모두_담는다() throws Exception {
        create("{}").assertFieldErrors("name:REQUIRED", "type:REQUIRED", "openingBalance:REQUIRED",
                "openingDate:REQUIRED");
        create(body("1", "\"X\"", "\"5\"", "\"x\"")).assertFieldErrors("name:INVALID_FORMAT", "type:INVALID_FORMAT",
                "openingBalance:INVALID_FORMAT", "openingDate:INVALID_FORMAT");
        create(body(quoted("가".repeat(51)), "\"CASH\"", "10000000000", "\"1999-12-31\""))
                .assertFieldErrors("name:TOO_LONG", "openingBalance:OUT_OF_RANGE", "openingDate:OUT_OF_RANGE");
        create(body(quoted("가".repeat(51)), "0", "1", "\"2099-01-01\""))
                .assertFieldErrors("name:TOO_LONG", "type:INVALID_FORMAT", "openingDate:OUT_OF_RANGE");

        assertThat(storedCount()).isZero();
    }

    @Test
    void 같은_이름은_400_DUPLICATE이고_형식이_모두_맞을_때만_본다() throws Exception {
        assertThat(create(json(valid())).status()).isEqualTo(201);

        create(json(valid())).assertFieldErrors("name:DUPLICATE");
        // 공백은 서버도 지운다.
        create(body("\" 생활비 \"", "\"BANK\"", "0", "\"2026-11-01\"")).assertFieldErrors("name:DUPLICATE");
        create(body("\"생활비\"", "\"bank\"", "0", "\"2026-11-01\"")).assertFieldErrors("type:INVALID_FORMAT");
        create(body("\"생활비\"", "\"BANK\"", "0", "\"1999-12-31\"")).assertFieldErrors("openingDate:OUT_OF_RANGE");
        assertThat(storedCount()).isEqualTo(1);
    }

    /** 두 요청이 모두 "같은 이름 없음"을 본 뒤 저장하면 나중 것이 DB 제약에 걸린다. 앱 검사와 같은 응답이다. */
    @Test
    void 동시에_같은_이름으로_만들어도_같은_400이다() throws Exception {
        assertThat(create(json(valid())).status()).isEqualTo(201);
        Reply checkedByApp = create(json(valid()));
        doReturn(false).when(accountRepository).existsByLedgerIdAndNameAndIdNot(any(), any(), any());

        Reply checkedByDb = create(json(valid()));

        checkedByDb.assertFieldErrors("name:DUPLICATE");
        assertThat(withoutRequestId(checkedByDb)).isEqualTo(withoutRequestId(checkedByApp));
        assertThat(storedCount()).isEqualTo(1);
    }

    @Test
    void 받을_수_없는_Accept와_JSON이_아닌_본문은_저장하기_전에_거절한다() throws Exception {
        String valid = json(valid());

        client.send("POST", path(), valid, "Content-Type", "application/json", "Accept", "text/html")
                .assertProblem(400, "Bad Request", "MALFORMED_REQUEST");
        client.send("POST", path(), valid, "Content-Type", "text/plain")
                .assertProblem(415, "Unsupported Media Type", "UNSUPPORTED_MEDIA_TYPE");
        client.send("POST", path(), valid).assertProblem(415, "Unsupported Media Type", "UNSUPPORTED_MEDIA_TYPE");
        create("{").assertProblem(400, "Bad Request", "MALFORMED_REQUEST");
        create(valid + " {}").assertProblem(400, "Bad Request", "MALFORMED_REQUEST");
        create("[]").assertFieldErrors(":INVALID_FORMAT");

        assertThat(storedCount()).isZero();
    }

    private Reply create(String json) throws Exception {
        return client.send("POST", path(), json, "Content-Type", "application/json", "Accept", "application/json");
    }

    private long storedCount() {
        return jdbc.queryForObject("select count(*) from account where ledger_id = ?", Long.class, ledgerId);
    }

    private String path() {
        return "/api/v1/ledgers/" + ledgerId + "/accounts";
    }

    static Map<String, String> valid() {
        Map<String, String> fields = new LinkedHashMap<>();
        fields.put("name", "\"생활비\"");
        fields.put("type", "\"BANK\"");
        fields.put("openingBalance", "0");
        fields.put("openingDate", "\"2026-11-01\"");
        return fields;
    }

    static String body(String name, String type, String openingBalance, String openingDate) {
        Map<String, String> fields = new LinkedHashMap<>();
        fields.put("name", name);
        fields.put("type", type);
        fields.put("openingBalance", openingBalance);
        fields.put("openingDate", openingDate);
        return json(fields);
    }

    /** 값은 JSON 글자 그대로다. */
    static String json(Map<String, String> fields) {
        return fields.entrySet().stream()
                .filter(field -> !field.getValue().equals(OMIT))
                .map(field -> "\"" + field.getKey() + "\":" + field.getValue())
                .collect(Collectors.joining(",", "{", "}"));
    }

    static String quoted(String text) {
        return "\"" + text + "\"";
    }

    private static String withoutRequestId(Reply reply) {
        return reply.body().replace(reply.header("X-Request-Id"), "");
    }
}
