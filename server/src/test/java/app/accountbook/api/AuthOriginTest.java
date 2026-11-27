package app.accountbook.api;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

import app.accountbook.api.ServerClient.Reply;
import app.accountbook.support.CapturedLogs;
import app.accountbook.support.HttpServerTest;
import app.accountbook.support.SignedInUser;
import app.accountbook.support.StoppedClockConfig.StoppedClock;
import app.accountbook.support.TestAccessTokens;
import app.accountbook.user.UserService;
import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.web.server.LocalServerPort;

/**
 * {@code /api/v1/auth} 아래는 우리 출처와 전용 헤더를 지킨 POST만 받는다(ADR 001 결정 5). 규칙의 갈래는
 * AuthRequestFilterTest가 보고, 여기서는 실제 필터 체인을 지난 응답을 본다. 컨트롤러가 없는 주소로 본다.
 */
@AccessTest
class AuthOriginTest {

    private static final Instant NOW = Instant.parse("2030-01-01T00:00:00Z");
    private static final String AUTH = "/api/v1/auth/nope";
    private static final String EVIL = "https://marker-evil.example";
    private static final String HOST = "Host: localhost\r\nConnection: close\r\nContent-Length: 0\r\n";

    @LocalServerPort int port;
    @Autowired StoppedClock clock;
    @Autowired UserService userService;

    private ServerClient anyone;
    private String bearer;

    @BeforeEach
    void setUp() {
        clock.stopAt(NOW);
        anyone = ServerClient.anonymous(port);
        bearer = "Bearer " + TestAccessTokens.valid(SignedInUser.ID, NOW);
    }

    @Test
    void 조건을_지킨_요청은_필터_체인을_지나_다음_규칙으로_간다() throws Exception {
        for (String[] headers : new String[][] {{"X-Akkimpyo-Client", "web"},
                {"X-Akkimpyo-Client", "web", "Origin", HttpServerTest.ORIGIN}}) {
            anyone.send("POST", AUTH, null, headers).assertProblem(401, "Unauthorized", "UNAUTHENTICATED");
        }
        anyone.send("POST", AUTH, null, "X-Akkimpyo-Client", "web", "Authorization", bearer)
                .assertProblem(404, "Not Found", "NOT_FOUND");
    }

    @Test
    void 전용_헤더가_없거나_출처가_다르면_403이다() throws Exception {
        List<Reply> replies = List.of(
                anyone.send("POST", AUTH, null),
                anyone.send("POST", AUTH, null, "Origin", HttpServerTest.ORIGIN),
                anyone.send("POST", AUTH, null, "Origin", EVIL),
                anyone.send("POST", AUTH, null, "X-Akkimpyo-Client", "web", "Origin", EVIL),
                anyone.send("POST", AUTH, null, "X-Akkimpyo-Client", "web", "Origin", "null"),
                anyone.send("POST", AUTH, "{", "Content-Type", "text/plain"),
                anyone.send("GET", AUTH, null),
                anyone.rawReply("POST " + AUTH + " HTTP/1.1\r\n" + HOST + "X-Akkimpyo-Client: web\r\nOrigin:\r\n\r\n"),
                anyone.rawReply("POST " + AUTH + " HTTP/1.1\r\n" + HOST + "X-Akkimpyo-Client: web\r\nOrigin: "
                        + HttpServerTest.ORIGIN + "\r\nOrigin: " + EVIL + "\r\n\r\n"),
                anyone.rawReply("POST /api/v1/%61uth/nope HTTP/1.1\r\n" + HOST + "\r\n"));

        assertThat(replies).allSatisfy(AuthOriginTest::assertNotAllowed);
    }

    @Test
    void 유효한_토큰이_있어도_403이고_토큰을_확인하지_않는다() throws Exception {
        assertNotAllowed(anyone.send("POST", AUTH, null, "Authorization", bearer));
        assertNotAllowed(anyone.send("POST", AUTH, null, "Authorization", bearer, "X-Akkimpyo-Client", "web",
                "Origin", EVIL));

        verify(userService, never()).exists(any());
    }

    @ParameterizedTest
    @ValueSource(strings = {"GET", "PUT", "PATCH", "DELETE", "OPTIONS"})
    void POST가_아니면_토큰과_무관하게_405다(String method) throws Exception {
        for (String[] headers : new String[][] {{"X-Akkimpyo-Client", "web"},
                {"X-Akkimpyo-Client", "web", "Origin", HttpServerTest.ORIGIN, "Authorization", bearer}}) {
            Reply reply = anyone.send(method, AUTH, null, headers)
                    .assertProblem(405, "Method Not Allowed", "METHOD_NOT_ALLOWED");

            assertThat(reply.headers().get("Allow")).containsExactly("POST");
        }
    }

    @Test
    void 다른_출처의_사전_요청은_403이고_허용한다고_답하지_않는다() throws Exception {
        for (String origin : List.of(EVIL, HttpServerTest.ORIGIN)) {
            // 사전 요청에는 전용 헤더가 없다(값이 아니라 이름만 온다). 우리 화면은 같은 출처라 사전 요청을 보내지 않는다.
            Reply reply = anyone.send("OPTIONS", AUTH, null, "Origin", origin, "Access-Control-Request-Method", "POST",
                    "Access-Control-Request-Headers", "content-type,x-akkimpyo-client");

            assertNotAllowed(reply);
            assertThat(reply.headers().keySet())
                    .noneMatch(name -> name.toLowerCase().startsWith("access-control-"));
        }
    }

    @Test
    void 다른_경로에는_조건이_없다() throws Exception {
        assertThat(anyone.get("/actuator/health", "Origin", EVIL).status()).isEqualTo(200);
        assertThat(anyone.get(AccessProbeController.ME, "Origin", EVIL, "Authorization", bearer).status())
                .isEqualTo(200);
        anyone.send("POST", "/api/v1/authx", null, "Authorization", bearer).assertProblem(404, "Not Found", "NOT_FOUND");
    }

    @Test
    void 거절은_운영_기본_수준의_로그에_남지_않고_출처의_값은_어디에도_없다() throws Exception {
        Logger ours = (Logger) LoggerFactory.getLogger("app.accountbook");
        ours.setLevel(Level.TRACE);
        try (CapturedLogs logs = CapturedLogs.start()) {
            Reply reply = anyone.send("POST", AUTH, null, "X-Akkimpyo-Client", "marker-client", "Origin", EVIL);

            assertNotAllowed(reply);
            assertThat(reply.headers() + reply.body()).doesNotContain("marker-evil", "marker-client");
            assertThat(logs.text()).contains("ORIGIN_NOT_ALLOWED").doesNotContain("marker-evil", "marker-client");
            assertThat(logs.events()).filteredOn(event -> event.getThreadName().contains("-exec-"))
                    .noneMatch(event -> event.getLevel().isGreaterOrEqual(Level.INFO));
        } finally {
            ours.setLevel(null);
        }
    }

    private static void assertNotAllowed(Reply reply) {
        reply.assertProblem(403, "Forbidden", "ORIGIN_NOT_ALLOWED");
        assertThat(reply.headers().get("Cache-Control"))
                .containsExactly("no-cache, no-store, max-age=0, must-revalidate");
        assertThat(reply.headers()).doesNotContainKeys("Set-Cookie", "WWW-Authenticate", "Location");
    }
}
