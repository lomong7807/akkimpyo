package app.accountbook.api;

import static java.nio.charset.StandardCharsets.UTF_8;
import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.params.provider.Arguments.argumentSet;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;

import app.accountbook.api.ServerClient.Reply;
import app.accountbook.support.BadAccessTokens;
import app.accountbook.support.CapturedLogs;
import app.accountbook.support.SignedInUser;
import app.accountbook.support.StoppedClockConfig.StoppedClock;
import app.accountbook.support.TestAccessTokens;
import app.accountbook.user.UserService;
import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import java.time.Duration;
import java.time.Instant;
import java.util.Arrays;
import java.util.Base64;
import java.util.List;
import java.util.Set;
import java.util.TreeSet;
import java.util.UUID;
import java.util.stream.Stream;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.dao.DataAccessResourceFailureException;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * 유효한 access token만 통하고, 나머지는 이유와 무관하게 같은 401이다(#12, ADR 001 결정 1, 2).
 * 시계는 실제보다 몇 년 뒤에 멈춰 있다. 서버가 주입한 시계를 쓰지 않으면 유효한 토큰의 만료를 잘못 본다.
 */
@AccessTest
class AccessTokenTest {

    private static final Instant NOW = Instant.parse("2030-01-01T00:00:00Z");
    private static final Logger OURS = (Logger) LoggerFactory.getLogger("app.accountbook");

    @LocalServerPort int port;
    @Autowired StoppedClock clock;
    @Autowired JdbcTemplate jdbc;
    @Autowired UserService userService;

    private ServerClient server;
    private CapturedLogs logs;
    /** 토큰 없이 부른 응답. 거절한 응답은 모두 이것과 모양이 같다. */
    private Reply withoutToken;

    @BeforeEach
    void setUp() throws Exception {
        clock.stopAt(NOW);
        server = ServerClient.anonymous(port);
        withoutToken = server.get(AccessProbeController.ME);
        OURS.setLevel(Level.TRACE);
        logs = CapturedLogs.start();
        OURS.trace("로그 수집 확인");
    }

    @AfterEach
    void tearDown() {
        logs.close();
        OURS.setLevel(null);
    }

    // --- 유효한 토큰 ---

    @Test
    void 유효한_토큰의_사용자_id가_컨트롤러에_온다() throws Exception {
        assertSignedIn(me("Bearer " + valid()));
    }

    @ParameterizedTest
    @ValueSource(strings = {"bearer ", "BEARER ", "Bearer   "})
    void 방식의_이름은_대소문자를_가리지_않는다(String prefix) throws Exception {
        assertSignedIn(me(prefix + valid()));
    }

    @Test
    void 사용자_id는_토큰에서만_꺼낸다() throws Exception {
        UUID other = UUID.randomUUID();

        Reply reply = server.send("POST", AccessProbeController.PATH + "/users/" + other + "?userId=" + other,
                "{\"userId\":\"" + other + "\"}", "Content-Type", "application/json",
                "X-User-Id", other.toString(), "Authorization", "Bearer " + valid());

        assertSignedIn(reply);
    }

    @Test
    void 다른_스레드에서_답하는_컨트롤러도_로그인이_유지된다() throws Exception {
        assertSignedIn(server.get(AccessProbeController.PATH + "/async", "Authorization", "Bearer " + valid()));
    }

    // --- 만료: 허용 오차가 없다 ---

    @Test
    void 만료_직전까지_통하고_만료_시각부터_통하지_않는다() throws Exception {
        String token = valid();
        Instant expiry = NOW.plus(Duration.ofMinutes(15));

        clock.stopAt(expiry.minusNanos(1));
        assertSignedIn(me("Bearer " + token));
        clock.stopAt(expiry);
        assertRejected(me("Bearer " + token), token);
        clock.stopAt(expiry.plusNanos(1));
        assertRejected(me("Bearer " + token), token);
        clock.stopAt(expiry.plusSeconds(59));
        assertRejected(me("Bearer " + token), token);
    }

    // --- 헤더 ---

    static Stream<Arguments> badAuthorization() {
        String valid = valid();
        return Stream.of(
                argumentSet("빈 값", ""),
                argumentSet("방식만", "Bearer"),
                argumentSet("방식과 공백", "Bearer "),
                argumentSet("방식이 없다", valid),
                argumentSet("공백이 없다", "Bearer" + valid),
                argumentSet("콜론", "Bearer:" + valid),
                argumentSet("따옴표", "Bearer \"" + valid + "\""),
                argumentSet("뒤에 다른 값", "Bearer " + valid + " x"),
                argumentSet("쉼표로 이은 두 토큰", "Bearer " + valid + ", Bearer " + valid),
                argumentSet("앞에 다른 값", "x Bearer " + valid),
                argumentSet("두 번 적은 방식", "Bearer Bearer " + valid),
                argumentSet("다른 방식", "Token " + valid),
                argumentSet("Basic", "Basic " + base64("user:password")),
                argumentSet("Basic에 토큰", "Basic " + base64("user:" + valid)),
                argumentSet("DPoP", "DPoP " + valid),
                argumentSet("JSON", "{\"token\":\"" + valid + "\"}"));
    }

    @ParameterizedTest
    @MethodSource("badAuthorization")
    void Bearer가_아닌_값은_401이다(String authorization) throws Exception {
        assertRejected(me(authorization), authorization);
    }

    @Test
    void 헤더가_없으면_401이다() throws Exception {
        assertRejected(server.get(AccessProbeController.ME), "");
    }

    @Test
    void Authorization_헤더가_둘이면_둘_다_유효해도_401이다() throws Exception {
        String valid = "Authorization: Bearer " + valid() + "\r\n";

        for (String lines : List.of(valid + valid, valid + "Authorization: Bearer x\r\n",
                "Authorization: Basic eA==\r\n" + valid, "Authorization:\r\n" + valid)) {
            assertRejected(server.rawReply("GET " + AccessProbeController.ME + " HTTP/1.1\r\nHost: localhost\r\n"
                    + "Connection: close\r\n" + lines + "\r\n"), valid());
        }
    }

    @Test
    void 헤더_밖으로_온_토큰은_받지_않는다() throws Exception {
        String token = valid();

        assertRejected(server.get(AccessProbeController.ME + "?access_token=" + token), token);
        assertRejected(server.get(AccessProbeController.ME + "?Authorization=Bearer%20" + token), token);
        for (String cookie : List.of("access_token", "accessToken", "Authorization", "token", "JSESSIONID")) {
            assertRejected(server.get(AccessProbeController.ME, "Cookie", cookie + "=" + token), token);
        }
        assertRejected(server.send("POST", AccessProbeController.ME, "access_token=" + token,
                "Content-Type", "application/x-www-form-urlencoded"), token);
        for (String header : List.of("X-Authorization", "Proxy-Authorization", "X-Access-Token", "X-Auth-Token",
                "X-Forwarded-Authorization")) {
            assertRejected(server.get(AccessProbeController.ME, header, "Bearer " + token), token);
        }
    }

    // --- 토큰 ---

    static Stream<Arguments> badTokens() {
        return BadAccessTokens.at(NOW);
    }

    @ParameterizedTest
    @MethodSource("badTokens")
    void 유효하지_않은_토큰은_이유와_무관하게_같은_401이다(String token) throws Exception {
        assertRejected(me("Bearer " + token), token);
    }

    @Test
    void 탈퇴해_지워진_사용자의_토큰은_401이다() throws Exception {
        UUID userId = UUID.randomUUID();
        String token = TestAccessTokens.valid(userId, NOW);
        jdbc.update("""
                insert into users (id, email, password_hash, display_name, created_at)
                values (?, ?, 'none', '탈퇴할 사람', now())
                """, userId, "leaving-" + userId + "@example.com");
        assertThat(me("Bearer " + token).json().get("userId").asString()).isEqualTo(userId.toString());

        jdbc.update("delete from users where id = ?", userId);

        assertRejected(me("Bearer " + token), token);
    }

    @Test
    void 사용자를_조회하지_못하면_로그인이_풀린_것이_아니라_500이다() throws Exception {
        doThrow(new DataAccessResourceFailureException("DB에 닿지 못함")).when(userService).exists(any());

        Reply reply = me("Bearer " + valid());

        reply.assertProblem(500, "Internal Server Error", "INTERNAL_ERROR");
        assertThat(reply.body()).doesNotContain("DB에 닿지 못함");
        assertThat(logs.text()).contains("DB에 닿지 못함").doesNotContain(valid());
    }

    // --- 읽을 수 없는 글자가 든 요청 ---

    @Test
    void 토큰에_제어_문자가_있어도_같은_401이다() throws Exception {
        assertRejected(server.rawReply(requestWith("GET", AccessProbeController.ME,
                "Authorization: Bearer " + valid() + "\u0085\r\n")), valid());
    }

    @ParameterizedTest
    @ValueSource(strings = {"Accept", "Origin", "Content-Type", "If-None-Match", "Accept-Language", "Range", "Cookie",
            "Access-Control-Request-Method", "X-Forwarded-For", "User-Agent"})
    void 다른_헤더에_제어_문자가_있어도_500이나_빈_오류가_되지_않고_값이_남지_않는다(String header) throws Exception {
        for (String method : List.of("GET", "POST", "OPTIONS")) {
            for (String path : List.of(AccessProbeController.ME, "/nope")) {
                Reply reply = server.rawReply(requestWith(method, path, "Authorization: Bearer " + valid() + "\r\n"
                        + header + ": marker-header-value\u0085\r\n"));

                assertThat(reply.status()).as(reply.body()).isLessThan(500);
                if (reply.status() >= 400) {
                    assertThat(reply.json().get("status").asInt()).isEqualTo(reply.status());
                }
                assertThat(reply.headers() + reply.body()).doesNotContain("marker-header-value");
                assertNotLogged("marker-header-value");
            }
        }
    }

    @Test
    void 쿼리의_이름에_제어_문자가_있으면_읽을_수_없는_요청이고_값이_남지_않는다() throws Exception {
        Reply reply = server.get(AccessProbeController.PATH + "/query?marker-query-name%01=1",
                "Authorization", "Bearer " + valid());

        reply.assertProblem(400, "Bad Request", "MALFORMED_REQUEST");
        assertThat(reply.body()).doesNotContain("marker-query-name");
        assertNotLogged("marker-query-name");
    }

    @Test
    void 헤더가_상한을_넘게_긴_토큰은_읽을_수_없는_요청이다() throws Exception {
        Reply reply = me("Bearer " + "x".repeat(9000));

        reply.assertProblem(400, "Bad Request", "MALFORMED_REQUEST");
        assertNotLeaked(reply, "x".repeat(9000));
    }

    private Reply me(String authorization) throws Exception {
        return server.get(AccessProbeController.ME, "Authorization", authorization);
    }

    private static void assertSignedIn(Reply reply) {
        assertThat(reply.status()).as(reply.body()).isEqualTo(200);
        assertThat(reply.json().get("userId").asString()).isEqualTo(SignedInUser.ID.toString());
        assertThat(reply.json().get("principalName").asString()).isEqualTo(SignedInUser.ID.toString());
        assertThat(reply.json().get("session").asBoolean()).isFalse();
    }

    /** 어떤 이유든 본문(요청 id 말고)과 헤더의 모양이 같고, 토큰과 이유가 응답과 로그에 없다. */
    private void assertRejected(Reply reply, String sent) {
        reply.assertProblem(401, "Unauthorized", "UNAUTHENTICATED");
        assertThat(reply.json().get("detail").asString()).isEqualTo("유효한 access token이 없다");
        assertThat(reply.headers().get("WWW-Authenticate")).containsExactly("Bearer realm=\"account-book\"");
        assertThat(headerNames(reply)).isEqualTo(headerNames(withoutToken));
        assertNotLeaked(reply, sent);
    }

    private static Set<String> headerNames(Reply reply) {
        Set<String> names = new TreeSet<>(String.CASE_INSENSITIVE_ORDER);
        names.addAll(reply.headers().keySet());
        // 소켓에 직접 쓴 요청은 연결을 닫아 달라고 한다.
        names.removeAll(Set.of("Connection", "Keep-Alive"));
        return names;
    }

    private void assertNotLeaked(Reply reply, String sent) {
        String answered = reply.headers() + reply.body();
        assertThat(answered).doesNotContainIgnoringCase("expired").doesNotContainIgnoringCase("signature")
                .doesNotContainIgnoringCase("jwt").doesNotContainIgnoringCase("exception")
                .doesNotContain(SignedInUser.ID.toString());
        assertThat(logs.text()).contains("로그 수집 확인")
                .doesNotContainIgnoringCase("jwt").doesNotContainIgnoringCase("signature")
                .doesNotContain(SignedInUser.ID.toString());
        Arrays.stream(sent.split("[ .,\"]")).filter(part -> part.length() > 15).forEach(part -> {
            assertThat(answered).doesNotContain(part);
            assertThat(logs.text()).doesNotContain(part);
        });
        assertNotLogged("eyJ");
        // 거절은 운영 기본 수준의 로그에 남지 않는다.
        assertThat(requestLogs()).noneMatch(event -> event.getLevel().isGreaterOrEqual(Level.INFO));
    }

    private void assertNotLogged(String value) {
        assertThat(logs.text()).contains("로그 수집 확인").doesNotContain(value);
        assertThat(requestLogs())
                .noneMatch(event -> event.getLevel().isGreaterOrEqual(Level.ERROR))
                .noneMatch(event -> event.getThrowableProxy() != null);
    }

    /** 요청을 처리하는 Tomcat 스레드의 로그. 다른 컨텍스트가 같은 때 남긴 것은 뺀다. */
    private List<ILoggingEvent> requestLogs() {
        return logs.events().stream().filter(event -> event.getThreadName().contains("-exec-")).toList();
    }

    private static String requestWith(String method, String path, String headers) {
        return method + " " + path + " HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n" + headers + "\r\n";
    }

    private static String valid() {
        return TestAccessTokens.valid(SignedInUser.ID, NOW);
    }

    private static String base64(String text) {
        return Base64.getUrlEncoder().withoutPadding().encodeToString(text.getBytes(UTF_8));
    }
}
