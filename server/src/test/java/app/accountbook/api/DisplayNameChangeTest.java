package app.accountbook.api;

import static app.accountbook.api.AccountCreateTest.NOW;
import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.params.provider.Arguments.argumentSet;

import app.accountbook.account.AccountType;
import app.accountbook.api.ServerClient.Reply;
import app.accountbook.ledger.LedgerRole;
import app.accountbook.support.CapturedLogs;
import app.accountbook.support.Fixtures;
import app.accountbook.support.StoppedClockConfig.StoppedClock;
import app.accountbook.transaction.TransactionCommand;
import app.accountbook.transaction.TransactionService;
import app.accountbook.transaction.TransactionType;
import app.accountbook.user.User;
import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import java.text.Normalizer;
import java.time.Duration;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import java.util.stream.Stream;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.jdbc.core.JdbcTemplate;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/**
 * {@code PUT /api/v1/me/display-name}(#68, F-014, P-101). 본문은 {@code {"displayName": "..."}}이고 응답은 내 정보
 * 조회(#30)와 같다. 바꾸는 사람은 토큰의 사용자뿐이고 이메일은 바뀌지 않는다.
 */
@LedgerApiTest
class DisplayNameChangeTest {

    private static final String PATH = "/api/v1/me/display-name";
    private static final LocalDate DAY = LocalDate.of(2026, 11, 18);
    /** 조합형으로 20자. */
    private static final String TWENTY = "가각간갇갈감갑갓강갖갗같갚갛개객갠갤갬갭";
    private static final String FAMILY = "👨‍👩‍👧";
    private static final JsonMapper JSON = new JsonMapper();
    private static final Logger SPRING_WEB = (Logger) LoggerFactory.getLogger("org.springframework.web");

    @LocalServerPort int port;
    @Autowired StoppedClock clock;
    @Autowired Fixtures fixtures;
    @Autowired TransactionService transactionService;
    @Autowired JdbcTemplate jdbc;

    private final List<UUID> ledgersWithTransactions = new ArrayList<>();
    private User me;
    private ServerClient client;

    @BeforeEach
    void setUp() {
        clock.stopAt(NOW);
        me = user();
        client = ServerClient.signedIn(port, me.getId(), NOW);
    }

    /** HTTP 테스트는 롤백되지 않는다. 거래 수를 DB 전체로 세는 테스트가 있어 만든 거래를 지운다. */
    @AfterEach
    void removeTransactions() {
        ledgersWithTransactions.forEach(ledgerId -> {
            jdbc.update("delete from change_log where ledger_id = ?", ledgerId);
            jdbc.update("delete from transaction where ledger_id = ?", ledgerId);
        });
    }

    // ---------------------------------------------------------------- 성공

    @Test
    void 바꾸면_200이고_본문은_내_정보_조회와_같다() throws Exception {
        Reply reply = change(body("바뀐 이름"));

        assertThat(reply.status()).as(reply.body()).isEqualTo(200);
        assertThat(reply.header("Content-Type")).isEqualTo("application/json");
        assertThat(reply.json().get("displayName").asString()).isEqualTo("바뀐 이름");
        assertThat(reply.json()).isEqualTo(client.get("/api/v1/me").json());
        assertThat(stored(me)).containsExactly(me.getEmail(), "바뀐 이름");
    }

    @ParameterizedTest
    @MethodSource
    void 가입과_같은_규칙으로_맞춰_저장한다(String sent, String expected) throws Exception {
        Reply reply = change(body(sent));

        assertThat(reply.status()).as(reply.body()).isEqualTo(200);
        assertThat(reply.json().get("displayName").asString()).isEqualTo(expected);
        assertThat(stored(me)).containsExactly(me.getEmail(), expected);
    }

    static Stream<Arguments> 가입과_같은_규칙으로_맞춰_저장한다() {
        return Stream.of(
                argumentSet("앞뒤 공백류를 지운다", "\\u3000\\u00A0아낌 표\\u2003", "아낌 표"),
                argumentSet("조합형으로 맞춘다", nfd("아낌이"), "아낌이"),
                argumentSet("조합형으로 센 20자", nfd(TWENTY), TWENTY),
                argumentSet("이모지는 남긴다", "아낌 " + FAMILY, "아낌 " + FAMILY));
    }

    @Test
    void 같은_이름이어도_200이고_그대로다() throws Exception {
        Reply reply = change(body(me.getDisplayName()));

        assertThat(reply.status()).as(reply.body()).isEqualTo(200);
        assertThat(reply.json().get("displayName").asString()).isEqualTo(me.getDisplayName());
        assertThat(stored(me)).containsExactly(me.getEmail(), me.getDisplayName());
    }

    // ---------------------------------------------------------------- 작성자 이름

    /**
     * 거래의 사람 이름은 저장한 사본이 아니라 응답할 때 사용자에서 붙인다. 내 장부와 같이 쓰는 장부 모두에서 내가 적은 거래와
     * 내가 낸 거래에 새 이름이 나오고, 다른 사람의 이름은 그대로다.
     */
    @Test
    void 바꾼_이름이_내가_속한_모든_장부의_거래에_나온다() throws Exception {
        User other = user();
        UUID mine = fixtures.personalLedgerId(me);
        UUID shared = fixtures.personalLedgerId(other);
        fixtures.addMember(shared, me, LedgerRole.MEMBER);
        ledgersWithTransactions.addAll(List.of(mine, shared));
        UUID myCash = cash(me, mine);
        UUID sharedCash = cash(other, shared);
        UUID inMine = fixtures.expense(me, mine, myCash, null, DAY, 1_000).id();
        UUID inShared = fixtures.expense(me, shared, sharedCash, null, DAY, 2_000).id();
        UUID paidByMe = transactionService.create(other.getId(), shared,
                new TransactionCommand.Entry(UUID.randomUUID(), TransactionType.EXPENSE, DAY, null, sharedCash, null,
                        3_000, false, null, null, me.getId()), "test-device").id();

        assertThat(change(body("바뀐 이름")).status()).isEqualTo(200);

        JsonNode renamed = person(me.getId(), "바뀐 이름");
        Map<String, JsonNode> mineItems = items(mine);
        Map<String, JsonNode> sharedItems = items(shared);
        for (JsonNode tx : List.of(mineItems.get(inMine.toString()), sharedItems.get(inShared.toString()),
                client.get(transactions(shared) + "/" + inShared).json())) {
            assertThat(List.of(tx.get("createdBy"), tx.get("paidBy"), tx.get("updatedBy"))).containsOnly(renamed);
        }
        JsonNode othersEntry = sharedItems.get(paidByMe.toString());
        assertThat(othersEntry.get("paidBy")).isEqualTo(renamed);
        assertThat(othersEntry.get("createdBy")).isEqualTo(person(other.getId(), other.getDisplayName()));
    }

    // ---------------------------------------------------------------- 남의 것과 이메일은 바뀌지 않는다

    /**
     * 경로에 사용자 id가 없다. 본문·쿼리·헤더에 다른 사람의 id와 이메일을 넣어도 바뀌는 것은 토큰의 사용자의 표시 이름뿐이다.
     * 본문의 다른 칸은 읽지 않는다.
     */
    @Test
    void 바뀌는_것은_토큰의_사용자의_표시_이름뿐이다() throws Exception {
        User other = user();
        String myHash = passwordHash(me);
        String body = "{\"displayName\":\"바뀐 이름\",\"id\":\"" + other.getId() + "\",\"userId\":\"" + other.getId()
                + "\",\"email\":\"" + other.getEmail() + "\",\"passwordHash\":\"none\"}";

        Reply reply = client.send("PUT", PATH + "?userId=" + other.getId() + "&id=" + other.getId(), body,
                "Content-Type", "application/json", "X-User-Id", other.getId().toString());

        assertThat(reply.status()).as(reply.body()).isEqualTo(200);
        assertThat(reply.json().get("id").asString()).isEqualTo(me.getId().toString());
        assertThat(reply.json().get("email").asString()).isEqualTo(me.getEmail());
        assertThat(reply.body()).doesNotContain(other.getId().toString(), other.getEmail());
        assertThat(stored(me)).containsExactly(me.getEmail(), "바뀐 이름");
        assertThat(passwordHash(me)).isEqualTo(myHash);
        assertThat(stored(other)).containsExactly(other.getEmail(), other.getDisplayName());
    }

    // ---------------------------------------------------------------- 실패

    @ParameterizedTest
    @MethodSource
    void 규칙에_맞지_않으면_400이고_바꾸지_않는다(String body, String expected) throws Exception {
        change(body).assertFieldErrors(expected);

        assertThat(stored(me)).containsExactly(me.getEmail(), me.getDisplayName());
    }

    static Stream<Arguments> 규칙에_맞지_않으면_400이고_바꾸지_않는다() {
        return Stream.of(
                argumentSet("빠짐", "{}", "displayName:REQUIRED"),
                argumentSet("이메일만", "{\"email\":\"new@example.com\"}", "displayName:REQUIRED"),
                argumentSet("null", "{\"displayName\":null}", "displayName:REQUIRED"),
                argumentSet("빈 글자", body(""), "displayName:REQUIRED"),
                argumentSet("공백류뿐", body("\\u3000\\u00A0 "), "displayName:REQUIRED"),
                argumentSet("21자", body("가".repeat(21)), "displayName:TOO_LONG"),
                argumentSet("조합형으로 센 21자", body(nfd("가".repeat(21))), "displayName:TOO_LONG"),
                argumentSet("보이지 않는 글자", body("아낌\\u200B이"), "displayName:INVALID_FORMAT"),
                argumentSet("제어 문자", body("아낌\\t이"), "displayName:INVALID_FORMAT"),
                argumentSet("짝 없는 서로게이트", body("아낌\\uD800이"), "displayName:INVALID_FORMAT"),
                argumentSet("글자가 아닌 값", "{\"displayName\":5}", "displayName:INVALID_FORMAT"),
                argumentSet("배열", "{\"displayName\":[\"아낌이\"]}", "displayName:INVALID_FORMAT"),
                argumentSet("본문이 배열", "[]", ":INVALID_FORMAT"));
    }

    /** 토큰이 없거나 만료됐으면 401이다. 응답할 수 없는 {@code Accept}, JSON이 아닌 본문, 읽을 수 없는 본문은 바꾸기 전에 거절한다. */
    @Test
    void 인증과_받을_수_없는_요청은_바꾸기_전에_거절한다() throws Exception {
        String rename = body("바뀐 이름");

        Reply anonymous = ServerClient.anonymous(port).send("PUT", PATH, rename, "Content-Type", "application/json")
                .assertProblem(401, "Unauthorized", "UNAUTHENTICATED");
        assertThat(anonymous.headers().get("WWW-Authenticate")).containsExactly(SecurityConfig.CHALLENGE);
        ServerClient.signedIn(port, me.getId(), NOW.minus(Duration.ofMinutes(15)))
                .send("PUT", PATH, rename, "Content-Type", "application/json")
                .assertProblem(401, "Unauthorized", "UNAUTHENTICATED");
        client.send("PUT", PATH, rename, "Content-Type", "text/plain")
                .assertProblem(415, "Unsupported Media Type", "UNSUPPORTED_MEDIA_TYPE");
        client.send("PUT", PATH, rename).assertProblem(415, "Unsupported Media Type", "UNSUPPORTED_MEDIA_TYPE");
        client.send("PUT", PATH, rename, "Content-Type", "application/json", "Accept", "text/html")
                .assertProblem(400, "Bad Request", "MALFORMED_REQUEST");
        change("{").assertProblem(400, "Bad Request", "MALFORMED_REQUEST");
        change(rename + " {}").assertProblem(400, "Bad Request", "MALFORMED_REQUEST");

        assertThat(stored(me)).containsExactly(me.getEmail(), me.getDisplayName());
    }

    // ---------------------------------------------------------------- 로그

    @Test
    void 스프링이_요청과_응답_객체를_남겨도_이름과_이메일이_없다() throws Exception {
        // 운영에서 켜지 않는 수준이다. 사용자는 이메일이 아니라 id로 적는다(ADR 001 결정 10).
        SPRING_WEB.setLevel(Level.TRACE);
        try (CapturedLogs logs = CapturedLogs.start()) {
            assertThat(change(body("로그에없는이름")).status()).isEqualTo(200);

            assertThat(logs.text()).contains("DisplayNameRequest[", "MeResponse[", "표시 이름 바꿈: 사용자 " + me.getId())
                    .doesNotContain("로그에없는이름", me.getEmail());
        } finally {
            SPRING_WEB.setLevel(null);
        }
        assertThat(new DisplayNameRequest("아낌이")).hasToString("DisplayNameRequest[]");
    }

    // ---------------------------------------------------------------- 도우미

    private Reply change(String json) throws Exception {
        return client.send("PUT", PATH, json, "Content-Type", "application/json", "Accept", "application/json");
    }

    /** 값을 그대로 끼워 넣는다. JSON의 이스케이프는 부르는 쪽이 적는다. */
    private static String body(String displayName) {
        return "{\"displayName\":\"" + displayName + "\"}";
    }

    /** 이메일과 표시 이름. */
    private List<String> stored(User user) {
        return jdbc.queryForObject("select email, display_name from users where id = ?",
                (rs, row) -> List.of(rs.getString("email"), rs.getString("display_name")), user.getId());
    }

    private String passwordHash(User user) {
        return jdbc.queryForObject("select password_hash from users where id = ?", String.class, user.getId());
    }

    private UUID cash(User actor, UUID ledgerId) {
        return fixtures.account(actor, ledgerId, "현금", AccountType.CASH, 0, DAY.withDayOfMonth(1)).getId();
    }

    /** 장부 전체의 거래 목록(거래 id → 항목). */
    private Map<String, JsonNode> items(UUID ledgerId) throws Exception {
        Reply reply = client.get(transactions(ledgerId));
        assertThat(reply.status()).as(reply.body()).isEqualTo(200);
        return reply.json().get("items").valueStream()
                .collect(Collectors.toMap(tx -> tx.get("id").asString(), Function.identity()));
    }

    private static String transactions(UUID ledgerId) {
        return "/api/v1/ledgers/" + ledgerId + "/transactions";
    }

    private static JsonNode person(UUID id, String displayName) {
        return JSON.readTree("{\"id\":\"" + id + "\",\"displayName\":\"" + displayName + "\"}");
    }

    private static String nfd(String text) {
        return Normalizer.normalize(text, Normalizer.Form.NFD);
    }

    private User user() {
        return fixtures.user(UUID.randomUUID().toString().substring(0, 18) + "@example.com");
    }
}
