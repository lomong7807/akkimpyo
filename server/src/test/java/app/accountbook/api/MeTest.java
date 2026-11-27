package app.accountbook.api;

import static org.assertj.core.api.Assertions.assertThat;

import app.accountbook.api.ServerClient.Reply;
import app.accountbook.support.CapturedLogs;
import app.accountbook.support.StoppedClockConfig.StoppedClock;
import app.accountbook.support.TestAccessTokens;
import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import com.nimbusds.jwt.SignedJWT;
import java.sql.Timestamp;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.jdbc.core.JdbcTemplate;
import tools.jackson.databind.JsonNode;

/** 내 정보 API(#30, F-009, F-014, P-301). 응답의 모양은 이슈 #30의 "응답 계약"이다. */
@AccessTest
class MeTest {

    private static final Instant NOW = Instant.parse("2030-01-01T00:00:00Z");
    private static final String ME = "/api/v1/me";
    private static final Logger SPRING_WEB = (Logger) LoggerFactory.getLogger("org.springframework.web");

    private static final UUID A = UUID.fromString("3a000000-0000-4000-8000-00000000000a");
    private static final String A_EMAIL = "marker-me-a@example.com";
    private static final UUID B = UUID.fromString("3b000000-0000-4000-8000-00000000000b");
    private static final String B_EMAIL = "marker-me-b@example.com";
    private static final UUID A_LEDGER = UUID.fromString("1a000000-0000-4000-8000-000000000001");
    private static final UUID B_LEDGER = UUID.fromString("1b000000-0000-4000-8000-000000000002");
    /** B가 만들고 A가 MEMBER로 들어온 장부. id가 A_LEDGER보다 뒤다. */
    private static final UUID SHARED = UUID.fromString("9c000000-0000-4000-8000-000000000003");

    @LocalServerPort int port;
    @Autowired StoppedClock clock;
    @Autowired JdbcTemplate jdbc;

    private ServerClient anyone;

    @BeforeEach
    void setUp() {
        clock.stopAt(NOW);
        anyone = ServerClient.anonymous(port);
        insertUser(A, A_EMAIL, "에이");
        insertUser(B, B_EMAIL, "비");
        insertLedger(A_LEDGER, "에이의 장부", "2025-01-01T00:00:00Z");
        insertLedger(SHARED, "같이 쓰는 장부", "2025-06-01T00:00:00Z");
        insertLedger(B_LEDGER, "비의 장부", "2025-07-01T00:00:00Z");
        // A는 같이 쓰는 장부에 자기 장부보다 먼저 들어갔다. 장부를 만든 순서, 권한, id 순이면 A의 장부가 앞이다.
        insertMember(SHARED, B, "OWNER", "2026-01-01T00:00:00Z");
        insertMember(SHARED, A, "MEMBER", "2026-02-01T00:00:00Z");
        insertMember(A_LEDGER, A, "OWNER", "2026-03-01T00:00:00Z");
        insertMember(B_LEDGER, B, "OWNER", "2026-04-01T00:00:00Z");
    }

    @AfterEach
    void tearDown() {
        jdbc.update("delete from ledger_member where user_id in (?, ?)", A, B);
        jdbc.update("delete from ledger where id in (?, ?, ?)", A_LEDGER, B_LEDGER, SHARED);
        jdbc.update("delete from users where id in (?, ?)", A, B);
    }

    // --- 성공 ---

    @Test
    void 내_정보와_내가_속한_장부를_먼저_속한_순서로_준다() throws Exception {
        String token = TestAccessTokens.valid(A, NOW);

        Reply reply = anyone.get(ME, "Authorization", "Bearer " + token);

        assertThat(reply.status()).as(reply.body()).isEqualTo(200);
        assertThat(reply.header("Content-Type")).isEqualTo("application/json");
        JsonNode me = reply.json();
        assertThat(me.propertyNames()).containsExactlyInAnyOrder("id", "email", "displayName", "ledgers");
        assertThat(me.get("id").asString())
                .isEqualTo(SignedJWT.parse(token).getJWTClaimsSet().getSubject())
                .isEqualTo(A.toString());
        assertThat(me.get("email").asString()).isEqualTo(A_EMAIL);
        assertThat(me.get("displayName").asString()).isEqualTo("에이");
        assertThat(me.get("ledgers").isArray()).as("{items}로 감싸지 않는다").isTrue();
        assertThat(me.get("ledgers").valueStream().map(JsonNode::propertyNames))
                .allSatisfy(names -> assertThat(names).containsExactlyInAnyOrder("id", "name", "role"));
        assertThat(ledgers(me)).containsExactly(
                SHARED + " 같이 쓰는 장부 MEMBER",
                A_LEDGER + " 에이의 장부 OWNER");
    }

    @Test
    void 응답을_브라우저가_저장하지_않는다() throws Exception {
        Reply reply = get(A);

        assertThat(reply.headers().get("Cache-Control"))
                .containsExactly("no-cache, no-store, max-age=0, must-revalidate");
    }

    @ParameterizedTest
    @ValueSource(strings = {"application/json", "*/*", "text/html, application/json;q=0.1"})
    void JSON을_받는_Accept는_그대로_답한다(String accept) throws Exception {
        Reply reply = anyone.get(ME, "Authorization", bearer(A), "Accept", accept);

        assertThat(reply.status()).as(reply.body()).isEqualTo(200);
        assertThat(reply.header("Content-Type")).isEqualTo("application/json");
    }

    // --- 남의 것은 나오지 않는다 ---

    @Test
    void 다른_사용자의_정보와_내가_속하지_않은_장부는_나오지_않는다() throws Exception {
        Reply a = get(A);
        Reply b = get(B);

        assertThat(b.json().get("id").asString()).isEqualTo(B.toString());
        assertThat(b.json().get("email").asString()).isEqualTo(B_EMAIL);
        assertThat(b.json().get("displayName").asString()).isEqualTo("비");
        assertThat(ledgers(b.json())).containsExactly(
                SHARED + " 같이 쓰는 장부 OWNER",
                B_LEDGER + " 비의 장부 OWNER");
        assertThat(a.body()).doesNotContain(B.toString(), B_EMAIL, B_LEDGER.toString(), "비의 장부");
        assertThat(b.body()).doesNotContain(A.toString(), A_EMAIL, A_LEDGER.toString(), "에이");
    }

    @Test
    void 사용자는_토큰으로만_정한다() throws Exception {
        Reply reply = anyone.get(ME + "?userId=" + B + "&id=" + B,
                "Authorization", bearer(A), "X-User-Id", B.toString());

        assertThat(reply.json().get("id").asString()).isEqualTo(A.toString());
        assertThat(reply.body()).doesNotContain(B_EMAIL, B_LEDGER.toString());
    }

    // --- 실패 ---

    @Test
    void 토큰이_없으면_401이다() throws Exception {
        Reply reply = anyone.get(ME).assertProblem(401, "Unauthorized", "UNAUTHENTICATED");

        assertThat(reply.headers().get("WWW-Authenticate")).containsExactly(SecurityConfig.CHALLENGE);
    }

    @Test
    void 만료된_토큰이면_401이다() throws Exception {
        String expired = TestAccessTokens.valid(A, NOW.minus(Duration.ofMinutes(15)));

        Reply reply = anyone.get(ME, "Authorization", "Bearer " + expired)
                .assertProblem(401, "Unauthorized", "UNAUTHENTICATED");

        assertThat(reply.body()).doesNotContain(A_EMAIL);
    }

    @ParameterizedTest
    @ValueSource(strings = {"text/html", "application/xml", "application/problem+json"})
    void JSON을_받지_않는_Accept는_400이다(String accept) throws Exception {
        Reply reply = anyone.get(ME, "Authorization", bearer(A), "Accept", accept)
                .assertProblem(400, "Bad Request", "MALFORMED_REQUEST");

        assertThat(reply.body()).doesNotContain(A_EMAIL);
    }

    // --- 로그 ---

    @Test
    void 스프링이_응답_객체를_남겨도_이메일과_이름이_없다() throws Exception {
        // 운영에서 켜지 않는 수준이다. 사용자는 이메일이 아니라 id로 적는다(ADR 001 결정 10).
        SPRING_WEB.setLevel(Level.TRACE);
        try (CapturedLogs logs = CapturedLogs.start()) {
            assertThat(get(A).status()).isEqualTo(200);

            assertThat(logs.text()).contains("MeResponse[")
                    .doesNotContain(A_EMAIL, "에이", "같이 쓰는 장부");
        } finally {
            SPRING_WEB.setLevel(null);
        }
    }

    // --- 도우미 ---

    private Reply get(UUID userId) throws Exception {
        return anyone.get(ME, "Authorization", bearer(userId));
    }

    private static String bearer(UUID userId) {
        return "Bearer " + TestAccessTokens.valid(userId, NOW);
    }

    /** 장부마다 "id 이름 권한". 순서대로. */
    private static List<String> ledgers(JsonNode me) {
        return me.get("ledgers").valueStream()
                .map(ledger -> ledger.get("id").asString() + " " + ledger.get("name").asString() + " "
                        + ledger.get("role").asString())
                .toList();
    }

    private void insertUser(UUID id, String email, String displayName) {
        jdbc.update("""
                insert into users (id, email, password_hash, display_name, created_at)
                values (?, ?, 'none', ?, now())
                """, id, email, displayName);
    }

    private void insertLedger(UUID id, String name, String createdAt) {
        jdbc.update("insert into ledger (id, name, timezone, created_at) values (?, ?, 'Asia/Seoul', ?)",
                id, name, Timestamp.from(Instant.parse(createdAt)));
    }

    private void insertMember(UUID ledgerId, UUID userId, String role, String createdAt) {
        jdbc.update("insert into ledger_member (id, ledger_id, user_id, role, created_at) values (?, ?, ?, ?, ?)",
                UUID.randomUUID(), ledgerId, userId, role, Timestamp.from(Instant.parse(createdAt)));
    }
}
