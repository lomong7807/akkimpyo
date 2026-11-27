package app.accountbook.api;

import static org.assertj.core.api.Assertions.assertThat;

import app.accountbook.api.ServerClient.Reply;
import app.accountbook.support.CapturedLogs;
import app.accountbook.support.StoppedClockConfig.StoppedClock;
import app.accountbook.support.TestAccessTokens;
import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import com.nimbusds.jwt.SignedJWT;
import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import java.util.stream.Stream;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.jdbc.core.JdbcTemplate;

/** 갱신 API와 refresh 쿠키(#26, ADR 001 결정 3~6). 회전의 규칙과 겹침은 auth의 RefreshTokenServiceTest, RaceTest가 본다. */
@AccessTest
class RefreshTest {

    private static final Instant NOW = Instant.parse("2030-01-01T00:00:00Z");
    private static final String LOGIN = "/api/v1/auth/login";
    private static final String REFRESH = "/api/v1/auth/refresh";
    private static final String COOKIE = "__Secure-akkimpyo_refresh";
    private static final String NO_STORE = "no-cache, no-store, max-age=0, must-revalidate";
    private static final UUID USER_ID = UUID.fromString("3b4c5d6e-7f80-4a1b-9c2d-3e4f5a6b7c8d");
    private static final String EMAIL = "marker-refresh@example.com";
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
        jdbc.update("insert into users (id, email, password_hash, display_name, created_at) values (?, ?, ?, 'r', now())",
                USER_ID, EMAIL, STORED);
    }

    @AfterEach
    void deleteUser() {
        jdbc.update("delete from refresh_token where family_id in (select id from refresh_token_family where user_id = ?)",
                USER_ID);
        jdbc.update("delete from refresh_token_family where user_id = ?", USER_ID);
        jdbc.update("delete from users where id = ?", USER_ID);
    }

    @Test
    void 로그인하면_refresh_token을_속성이_정해진_쿠키로만_준다() throws Exception {
        Reply reply = login(PASSWORD, null);

        assertThat(reply.status()).as(reply.body()).isEqualTo(200);
        assertThat(reply.headers().get("Set-Cookie")).hasSize(1);
        List<String> attributes = List.of(reply.header("Set-Cookie").split("; "));
        assertThat(attributes.getFirst()).matches(COOKIE + "=[A-Za-z0-9_-]{43}");
        assertThat(attributes).contains("Path=/api/v1/auth", "Max-Age=2592000", "Secure", "HttpOnly", "SameSite=Strict")
                .noneMatch(attribute -> attribute.startsWith("Domain"));
        assertThat(reply.json().propertyNames()).containsExactly("accessToken");
        assertThat(reply.body()).doesNotContain(cookie(reply));
    }

    /** 화면은 본문과 Content-Type 없이 보낸다. 만료된 access token이 같이 와도 쿠키만 본다. */
    @Test
    void 갱신은_쿠키만으로_같은_사용자의_새_access_token과_새_쿠키를_준다() throws Exception {
        String first = cookie(login(PASSWORD, null));
        clock.stopAt(NOW.plus(Duration.ofHours(1)));

        Reply reply = refresh(first, "Authorization", "Bearer " + TestAccessTokens.valid(USER_ID, NOW));

        assertThat(reply.status()).as(reply.body()).isEqualTo(200);
        assertThat(reply.header("Content-Type")).isEqualTo("application/json");
        assertThat(reply.headers().get("Cache-Control")).containsExactly(NO_STORE);
        assertThat(reply.json().propertyNames()).containsExactly("accessToken");
        assertThat(SignedJWT.parse(reply.json().get("accessToken").asString()).getJWTClaimsSet().getSubject())
                .isEqualTo(USER_ID.toString());
        assertThat(cookie(reply)).isNotEqualTo(first);
        assertThat(reply.header("Set-Cookie")).contains("Max-Age=2592000");
        // Content-Length도 없는 요청
        assertThat(anyone.rawReply("POST " + REFRESH + " HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n"
                + "X-Akkimpyo-Client: web\r\nCookie: " + COOKIE + "=" + cookie(reply) + "\r\n\r\n").status()).isEqualTo(200);
    }

    @Test
    void 본문이_있으면_JSON만_받고_회전하지_않는다() throws Exception {
        String cookie = cookie(login(PASSWORD, null));

        anyone.send("POST", REFRESH, "x", "Content-Type", "text/plain", "X-Akkimpyo-Client", "web",
                "Cookie", COOKIE + "=" + cookie).assertProblem(415, "Unsupported Media Type", "UNSUPPORTED_MEDIA_TYPE");
        assertThat(refresh(cookie).status()).isEqualTo(200);
    }

    /** 늦게 온 401이 다른 탭의 새 로그인 쿠키를 지우지 않게, 실패에는 Set-Cookie가 없다(security 결정). */
    @ParameterizedTest
    @ValueSource(strings = {"none", "unknown", "reused", "duplicated"})
    void 쓸_수_없는_쿠키면_401이고_쿠키를_지우지_않는다(String sent) throws Exception {
        String first = cookie(login(PASSWORD, null));
        String current = cookie(refresh(first));
        clock.stopAt(NOW.plusSeconds(11));

        Reply reply = switch (sent) {
            case "none" -> anyone.send("POST", REFRESH, null, "X-Akkimpyo-Client", "web");
            case "unknown" -> refresh("A".repeat(43));
            case "reused" -> refresh(first);
            default -> anyone.send("POST", REFRESH, null, "X-Akkimpyo-Client", "web",
                    "Cookie", COOKIE + "=" + current + "; " + COOKIE + "=" + current);
        };

        reply.assertProblem(401, "Unauthorized", "UNAUTHENTICATED");
        assertThat(reply.headers()).doesNotContainKey("Set-Cookie");
        assertThat(reply.headers().get("WWW-Authenticate")).containsExactly(SecurityConfig.CHALLENGE);
        assertThat(reply.headers().get("Cache-Control")).containsExactly(NO_STORE);
    }

    @ParameterizedTest
    @ValueSource(booleans = {true, false})
    void 전용_헤더가_없거나_다른_출처면_403이고_회전하지_않는다(boolean withoutClientHeader) throws Exception {
        String cookie = cookie(login(PASSWORD, null));

        Reply reply = withoutClientHeader ? anyone.send("POST", REFRESH, null, "Cookie", COOKIE + "=" + cookie)
                : refresh(cookie, "Origin", "https://other.example.com");

        reply.assertProblem(403, "Forbidden", "ORIGIN_NOT_ALLOWED");
        assertThat(reply.headers()).doesNotContainKey("Set-Cookie");
        assertThat(refresh(cookie).status()).isEqualTo(200);
    }

    @Test
    void 로그인은_요청_쿠키의_계열을_폐기하고_실패한_로그인은_아무것도_폐기하지_않는다() throws Exception {
        String before = cookie(login(PASSWORD, null));

        Reply failed = login("wrong-password1", before).assertProblem(401, "Unauthorized", "INVALID_CREDENTIALS");
        assertThat(failed.headers()).doesNotContainKey("Set-Cookie");
        String kept = cookie(refresh(before));
        String after = cookie(login(PASSWORD, kept));

        refresh(kept).assertProblem(401, "Unauthorized", "UNAUTHENTICATED");
        assertThat(refresh(after).status()).isEqualTo(200);
    }

    @Test
    void 지운_사용자의_쿠키는_401이다() throws Exception {
        String cookie = cookie(login(PASSWORD, null));
        deleteUser();

        refresh(cookie).assertProblem(401, "Unauthorized", "UNAUTHENTICATED");
    }

    @Test
    void 로그와_오류_응답에_refresh_token이_없다() throws Exception {
        Logger ours = (Logger) LoggerFactory.getLogger("app.accountbook");
        ours.setLevel(Level.TRACE);
        try (CapturedLogs logs = CapturedLogs.start()) {
            String first = cookie(login(PASSWORD, null));
            String second = cookie(refresh(first));
            clock.stopAt(NOW.plusSeconds(11));
            Reply reused = refresh(first);

            assertThat(logs.text()).doesNotContain(first, second);
            assertThat(reused.body()).doesNotContain(first);
        } finally {
            ours.setLevel(null);
        }
    }

    private Reply login(String password, String cookie) throws Exception {
        return anyone.send("POST", LOGIN, "{\"email\":\"" + EMAIL + "\",\"password\":\"" + password + "\"}",
                Stream.concat(Stream.of("Content-Type", "application/json", "X-Akkimpyo-Client", "web"),
                        cookie == null ? Stream.empty() : Stream.of("Cookie", COOKIE + "=" + cookie)).toArray(String[]::new));
    }

    private Reply refresh(String cookie, String... headers) throws Exception {
        return anyone.send("POST", REFRESH, null, Stream.concat(
                Stream.of("X-Akkimpyo-Client", "web", "Cookie", COOKIE + "=" + cookie), Stream.of(headers))
                .toArray(String[]::new));
    }

    /** 응답이 준 refresh 쿠키의 값. */
    private static String cookie(Reply reply) {
        assertThat(reply.status()).as(reply.body()).isBetween(200, 201);
        return reply.header("Set-Cookie").split(";", 2)[0].substring(COOKIE.length() + 1);
    }
}
