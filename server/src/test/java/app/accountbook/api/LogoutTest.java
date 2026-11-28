package app.accountbook.api;

import static org.assertj.core.api.Assertions.assertThat;

import app.accountbook.api.ServerClient.Reply;
import app.accountbook.support.BadAccessTokens;
import app.accountbook.support.CapturedLogs;
import app.accountbook.support.SignedInUser;
import app.accountbook.support.StoppedClockConfig.StoppedClock;
import app.accountbook.support.TestAccessTokens;
import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
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
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * 로그아웃 API(#28, ADR 001 결정 3·5·6). refresh 쿠키만으로 그 계열을 폐기하고 쿠키를 지운다. 계열 폐기와 갱신의 겹침은
 * auth의 RefreshTokenServiceTest, RaceTest가 본다. 폐기됐는지는 그 쿠키로 갱신해 401인지로 본다.
 */
@AccessTest
class LogoutTest {

    private static final Instant NOW = Instant.parse("2030-01-01T00:00:00Z");
    private static final String LOGIN = "/api/v1/auth/login";
    private static final String REFRESH = "/api/v1/auth/refresh";
    private static final String LOGOUT = "/api/v1/auth/logout";
    private static final String COOKIE = "__Secure-akkimpyo_refresh";
    private static final String NO_STORE = "no-cache, no-store, max-age=0, must-revalidate";
    private static final UUID USER_ID = UUID.fromString("5d6e7f80-91a2-4b3c-8d4e-5f6a7b8c9d0e");
    private static final String EMAIL = "marker-logout@example.com";
    private static final String PASSWORD = "password1";
    /** PASSWORD의 저장값(LoginTest와 같다). */
    private static final String STORED = "$argon2id$v=19$m=256,t=1,p=1$YWNjb3VudC1ib29rLXRzdA"
            + "$vHygWA0jNvBLxOELjrkU6R1OAPyuN/Ro9FrihcYD2KI";

    @LocalServerPort int port;
    @Autowired StoppedClock clock;
    @Autowired JdbcTemplate jdbc;

    private ServerClient anyone;

    @BeforeEach
    void setUp() {
        clock.stopAt(NOW);
        anyone = ServerClient.anonymous(port);
        jdbc.update("insert into users (id, email, password_hash, display_name, created_at) values (?, ?, ?, 'o', now())",
                USER_ID, EMAIL, STORED);
    }

    @AfterEach
    void deleteUser() {
        jdbc.update("delete from refresh_token where family_id in (select id from refresh_token_family where user_id = ?)",
                USER_ID);
        jdbc.update("delete from refresh_token_family where user_id = ?", USER_ID);
        jdbc.update("delete from users where id = ?", USER_ID);
    }

    /** 화면은 본문과 Content-Type 없이 보낸다. */
    @Test
    void 로그아웃은_쿠키의_계열을_폐기하고_같은_속성으로_쿠키를_지우는_204다() throws Exception {
        String cookie = cookie(login());

        Reply reply = logout(cookie);

        assertCleared(reply);
        assertThat(reply.body()).isEmpty();
        assertThat(reply.headers().get("Cache-Control")).containsExactly(NO_STORE);
        refresh(cookie).assertProblem(401, "Unauthorized", "UNAUTHENTICATED");
        // Content-Length도 없는 요청
        String other = cookie(login());
        assertCleared(anyone.rawReply("POST " + LOGOUT + " HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n"
                + "X-Akkimpyo-Client: web\r\nCookie: " + COOKIE + "=" + other + "\r\n\r\n"));
        refresh(other).assertProblem(401, "Unauthorized", "UNAUTHENTICATED");
    }

    @Test
    void 다른_기기의_로그인은_유지된다() throws Exception {
        String here = cookie(login());
        String there = cookie(login());

        assertCleared(logout(here));

        assertThat(refresh(there).status()).isEqualTo(200);
    }

    /** 갱신 응답을 놓쳐 옛 쿠키가 남은 기기에서 로그아웃해도 계열이 남지 않는다. 허용 시간 밖이어도 재사용으로 거부하지 않는다. */
    @ParameterizedTest
    @ValueSource(longs = {0, 11})
    void 이미_회전된_토큰으로도_그_계열을_폐기하고_204다(long secondsAfterRotation) throws Exception {
        String rotated = cookie(login());
        String current = cookie(refresh(rotated));
        clock.stopAt(NOW.plusSeconds(secondsAfterRotation));

        assertCleared(logout(rotated));

        refresh(current).assertProblem(401, "Unauthorized", "UNAUTHENTICATED");
    }

    /** 화면은 204만 성공으로 본다. 401을 주면 화면은 로그아웃 대기를 끝내지 못한다(ADR 001 결정 6). */
    @ParameterizedTest
    @ValueSource(strings = {"none", "unknown", "malformed", "revoked", "duplicated"})
    void 쿠키가_없거나_모르는_값이거나_이미_폐기됐어도_204이고_쿠키를_지운다(String sent) throws Exception {
        String cookie = cookie(login());
        if (sent.equals("revoked")) {
            assertCleared(logout(cookie));
        }

        Reply reply = switch (sent) {
            case "none" -> anyone.send("POST", LOGOUT, null, "X-Akkimpyo-Client", "web");
            case "unknown" -> logout("A".repeat(43));
            case "malformed" -> logout("x");
            case "revoked" -> logout(cookie);
            default -> anyone.send("POST", LOGOUT, null, "X-Akkimpyo-Client", "web",
                    "Cookie", COOKIE + "=" + cookie + "; " + COOKIE + "=" + cookie);
        };

        assertCleared(reply);
        assertThat(reply.headers().get("Cache-Control")).containsExactly(NO_STORE);
    }

    @ParameterizedTest
    @ValueSource(booleans = {true, false})
    void 전용_헤더가_없거나_다른_출처면_403이고_쿠키를_지우지_않고_폐기하지_않는다(boolean withoutClientHeader)
            throws Exception {
        String cookie = cookie(login());

        Reply reply = withoutClientHeader ? anyone.send("POST", LOGOUT, null, "Cookie", COOKIE + "=" + cookie)
                : logout(cookie, "Origin", "https://other.example.com");

        reply.assertProblem(403, "Forbidden", "ORIGIN_NOT_ALLOWED");
        assertThat(reply.headers()).doesNotContainKey("Set-Cookie");
        assertThat(refresh(cookie).status()).isEqualTo(200);
    }

    static Stream<Arguments> badTokens() {
        return BadAccessTokens.at(NOW);
    }

    /** Bearer 필터가 401로 먼저 막으면 쿠키와 계열이 남는다. 실제 필터 체인으로 본다. */
    @ParameterizedTest
    @MethodSource("badTokens")
    void 유효하지_않은_access_token이_붙어도_204이고_계열을_폐기한다(String token) throws Exception {
        String cookie = cookie(login());

        assertCleared(logout(cookie, "Authorization", "Bearer " + token));

        refresh(cookie).assertProblem(401, "Unauthorized", "UNAUTHENTICATED");
    }

    @Test
    void Bearer가_아닌_Authorization이나_다른_사람의_유효한_토큰이_붙어도_쿠키의_계열을_폐기한다() throws Exception {
        for (String authorization : List.of("Bearer x", "Bearer", "Basic eDp5",
                "Bearer " + TestAccessTokens.valid(SignedInUser.ID, NOW))) {
            String cookie = cookie(login());

            assertCleared(logout(cookie, "Authorization", authorization));

            refresh(cookie).assertProblem(401, "Unauthorized", "UNAUTHENTICATED");
        }
    }

    @Test
    void 본문이_있으면_JSON만_받고_폐기하지_않는다() throws Exception {
        String cookie = cookie(login());

        Reply reply = anyone.send("POST", LOGOUT, "x", "Content-Type", "text/plain", "X-Akkimpyo-Client", "web",
                "Cookie", COOKIE + "=" + cookie).assertProblem(415, "Unsupported Media Type", "UNSUPPORTED_MEDIA_TYPE");

        assertThat(reply.headers()).doesNotContainKey("Set-Cookie");
        assertThat(refresh(cookie).status()).isEqualTo(200);
    }

    @ParameterizedTest
    @ValueSource(strings = {LOGOUT + "/", LOGOUT + ".json", LOGOUT + "/x", "/api/v1/auth/Logout", "/api/v1/logout"})
    void 비슷한_주소는_열리지_않고_폐기하지_않는다(String path) throws Exception {
        String cookie = cookie(login());

        Reply reply = anyone.send("POST", path, null, "X-Akkimpyo-Client", "web", "Cookie", COOKIE + "=" + cookie)
                .assertProblem(401, "Unauthorized", "UNAUTHENTICATED");

        assertThat(reply.headers()).doesNotContainKey("Set-Cookie");
        assertThat(refresh(cookie).status()).isEqualTo(200);
    }

    @Test
    void 로그에_refresh_token이_없다() throws Exception {
        Logger ours = (Logger) LoggerFactory.getLogger("app.accountbook");
        ours.setLevel(Level.TRACE);
        try (CapturedLogs logs = CapturedLogs.start()) {
            String cookie = cookie(login());
            assertCleared(logout(cookie));

            assertThat(logs.text()).doesNotContain(cookie);
        } finally {
            ours.setLevel(null);
        }
    }

    /** 204이고 받은 쿠키와 같은 이름·Path·속성에 Max-Age=0인 Set-Cookie 하나다. */
    private static void assertCleared(Reply reply) {
        assertThat(reply.status()).as(reply.body()).isEqualTo(204);
        assertThat(reply.headers().get("Set-Cookie")).hasSize(1);
        List<String> attributes = List.of(reply.header("Set-Cookie").split("; "));
        assertThat(attributes.getFirst()).isEqualTo(COOKIE + "=");
        assertThat(attributes).contains("Path=/api/v1/auth", "Max-Age=0", "Secure", "HttpOnly", "SameSite=Strict")
                .noneMatch(attribute -> attribute.startsWith("Domain"));
    }

    private Reply login() throws Exception {
        return anyone.send("POST", LOGIN, "{\"email\":\"" + EMAIL + "\",\"password\":\"" + PASSWORD + "\"}",
                "Content-Type", "application/json", "X-Akkimpyo-Client", "web");
    }

    private Reply refresh(String cookie) throws Exception {
        return anyone.send("POST", REFRESH, null, "X-Akkimpyo-Client", "web", "Cookie", COOKIE + "=" + cookie);
    }

    private Reply logout(String cookie, String... headers) throws Exception {
        return anyone.send("POST", LOGOUT, null, Stream.concat(
                Stream.of("X-Akkimpyo-Client", "web", "Cookie", COOKIE + "=" + cookie), Stream.of(headers))
                .toArray(String[]::new));
    }

    /** 응답이 준 refresh 쿠키의 값. */
    private static String cookie(Reply reply) {
        assertThat(reply.status()).as(reply.body()).isEqualTo(200);
        return reply.header("Set-Cookie").split(";", 2)[0].substring(COOKIE.length() + 1);
    }
}
