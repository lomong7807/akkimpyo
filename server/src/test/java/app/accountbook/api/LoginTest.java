package app.accountbook.api;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.params.provider.Arguments.argumentSet;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;

import app.accountbook.api.ServerClient.Reply;
import app.accountbook.support.CapturedLogs;
import app.accountbook.support.HttpServerTest;
import app.accountbook.support.SignedInUser;
import app.accountbook.support.StoppedClockConfig.StoppedClock;
import app.accountbook.support.TestAccessTokens;
import app.accountbook.user.PasswordHashBusyException;
import app.accountbook.user.UserService;
import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import java.time.Duration;
import java.time.Instant;
import java.util.Date;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
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
import org.springframework.beans.BeanUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.jdbc.core.JdbcTemplate;

/** 로그인 API(#12, F-009, P-105, P-106). 확인의 갈래는 UserAuthenticateTest가 보고, 여기서는 HTTP의 약속을 본다. */
@AccessTest
class LoginTest {

    private static final Instant NOW = Instant.parse("2030-01-01T00:00:00.700Z");
    private static final String LOGIN = "/api/v1/auth/login";
    private static final UUID USER_ID = UUID.fromString("7c1d2e3f-4a5b-4c6d-8e9f-0a1b2c3d4e5f");
    private static final String EMAIL = "marker-login@example.com";
    private static final String PASSWORD = "password1";
    /** PASSWORD의 저장값. */
    private static final String STORED = "$argon2id$v=19$m=256,t=1,p=1$YWNjb3VudC1ib29rLXRzdA"
            + "$vHygWA0jNvBLxOELjrkU6R1OAPyuN/Ro9FrihcYD2KI";
    private static final UUID NOOP_USER_ID = UUID.fromString("5e6f7a8b-9c0d-4e1f-8a2b-3c4d5e6f7a8b");
    private static final String NOOP_EMAIL = "marker-noop@example.com";
    private static final Logger OURS = (Logger) LoggerFactory.getLogger("app.accountbook");
    private static final Logger SPRING_WEB = (Logger) LoggerFactory.getLogger("org.springframework.web");

    @LocalServerPort int port;
    @Autowired StoppedClock clock;
    @Autowired JdbcTemplate jdbc;
    @Autowired UserService userService;

    private ServerClient anyone;
    private CapturedLogs logs;

    @BeforeEach
    void setUp() {
        clock.stopAt(NOW);
        anyone = ServerClient.anonymous(port);
        insertUser(USER_ID, EMAIL, STORED);
        insertUser(NOOP_USER_ID, NOOP_EMAIL, "{noop}" + PASSWORD);
        OURS.setLevel(Level.TRACE);
        logs = CapturedLogs.start();
    }

    @AfterEach
    void tearDown() {
        logs.close();
        OURS.setLevel(null);
        jdbc.update("delete from refresh_token where family_id in (select id from refresh_token_family where user_id = ?)",
                USER_ID);
        jdbc.update("delete from refresh_token_family where user_id = ?", USER_ID);
        jdbc.update("delete from users where id in (?, ?)", USER_ID, NOOP_USER_ID);
    }

    // --- 성공 ---

    @Test
    void 이메일과_비밀번호가_맞으면_access_token을_본문으로_준다() throws Exception {
        Reply reply = login(EMAIL, PASSWORD);

        assertThat(reply.status()).as(reply.body()).isEqualTo(200);
        assertThat(reply.header("Content-Type")).isEqualTo("application/json");
        assertThat(reply.headers().get("Cache-Control"))
                .containsExactly("no-cache, no-store, max-age=0, must-revalidate");
        assertThat(reply.headers()).doesNotContainKeys("Authorization", "Location");
        assertThat(reply.json().propertyNames()).containsExactly("accessToken");

        JWTClaimsSet claims = SignedJWT.parse(reply.json().get("accessToken").asString()).getJWTClaimsSet();
        Instant issuedAt = Instant.parse("2030-01-01T00:00:00Z");
        assertThat(claims.getClaims()).containsOnlyKeys("sub", "iat", "exp", "iss", "aud");
        assertThat(claims.getSubject()).isEqualTo(USER_ID.toString());
        assertThat(claims.getIssueTime()).isEqualTo(Date.from(issuedAt));
        assertThat(claims.getExpirationTime()).isEqualTo(Date.from(issuedAt.plus(Duration.ofMinutes(15))));
        assertThat(claims.getIssuer()).isEqualTo("account-book");
        assertThat(claims.getAudience()).containsExactly("account-book-api");
    }

    @Test
    void 받은_토큰으로_보호된_주소가_열리고_15분_뒤에_닫힌다() throws Exception {
        String bearer = "Bearer " + login(EMAIL, PASSWORD).json().get("accessToken").asString();

        Reply me = anyone.get(AccessProbeController.ME, "Authorization", bearer);
        assertThat(me.json().get("userId").asString()).isEqualTo(USER_ID.toString());

        clock.stopAt(NOW.plus(Duration.ofMinutes(15)));
        anyone.get(AccessProbeController.ME, "Authorization", bearer)
                .assertProblem(401, "Unauthorized", "UNAUTHENTICATED");
    }

    @Test
    void 이메일의_대소문자와_앞뒤_공백은_달라도_된다() throws Exception {
        assertThat(login(" MARKER-Login@Example.COM\\t", PASSWORD).status()).isEqualTo(200);
    }

    @Test
    void 전각으로_친_비밀번호도_맞는다() throws Exception {
        assertThat(login(EMAIL, "ｐａｓｓｗｏｒｄ１").status()).isEqualTo(200);
    }

    @Test
    void 모르는_필드는_무시한다() throws Exception {
        Reply reply = post("{\"email\":\"%s\",\"password\":\"%s\",\"userId\":\"%s\",\"remember\":true}"
                .formatted(EMAIL, PASSWORD, SignedInUser.ID));

        assertThat(SignedJWT.parse(reply.json().get("accessToken").asString()).getJWTClaimsSet().getSubject())
                .isEqualTo(USER_ID.toString());
    }

    // --- 실패: 이유를 나누지 않는다 ---

    static Stream<Arguments> wrongCredentials() {
        return Stream.of(
                argumentSet("틀린 비밀번호", EMAIL, "password2"),
                argumentSet("비밀번호의 대소문자", EMAIL, "Password1"),
                argumentSet("비밀번호의 앞뒤 공백", EMAIL, " password1 "),
                argumentSet("공백뿐인 비밀번호", EMAIL, "        "),
                argumentSet("없는 이메일", "marker-nobody@example.com", PASSWORD),
                argumentSet("형식이 틀린 이메일", "marker-nobody", PASSWORD),
                argumentSet("ASCII가 아닌 이메일", "marker-사용자@example.com", PASSWORD),
                argumentSet("255자 이메일", "marker-" + "a".repeat(236) + "@example.com", PASSWORD),
                argumentSet("{noop} 저장값", NOOP_EMAIL, PASSWORD),
                argumentSet("{noop} 저장값을 그대로 보낸다", NOOP_EMAIL, "{noop}" + PASSWORD),
                argumentSet("형식이 깨진 저장값", "signed-in-user@example.com", "none"),
                argumentSet("가입된 이메일과 너무 긴 비밀번호(정규화 전)", EMAIL, "a".repeat(513)),
                argumentSet("가입된 이메일과 너무 긴 비밀번호(정규화 뒤)", EMAIL, "a1" + "가".repeat(71)),
                argumentSet("없는 이메일과 너무 긴 비밀번호", "marker-nobody@example.com", "a".repeat(513)),
                argumentSet("짝 없는 서로게이트", EMAIL, "password1\\uD800"));
    }

    @ParameterizedTest
    @MethodSource("wrongCredentials")
    void 실패는_이유와_무관하게_상태와_본문과_헤더가_같다(String email, String password) throws Exception {
        Reply wrongPassword = login(EMAIL, "wrong-password1");

        Reply reply = login(email, password);

        reply.assertProblem(401, "Unauthorized", "INVALID_CREDENTIALS");
        assertThat(withoutRequestId(reply)).isEqualTo(withoutRequestId(wrongPassword));
        assertThat(comparableHeaders(reply)).isEqualTo(comparableHeaders(wrongPassword));
        assertThat(reply.headers().get("WWW-Authenticate")).containsExactly("Bearer realm=\"account-book\"");
        assertThat(reply.headers().get("Cache-Control"))
                .containsExactly("no-cache, no-store, max-age=0, must-revalidate");
        assertThat(reply.headers()).doesNotContainKeys("Set-Cookie", "Retry-After");
    }

    // --- 400: 빠진 값과 다른 형 ---

    static Stream<Arguments> invalidBodies() {
        return Stream.of(
                argumentSet("둘 다 없다", "{}", List.of("email:REQUIRED", "password:REQUIRED")),
                argumentSet("이메일이 없다", "{\"password\":\"password1\"}", List.of("email:REQUIRED")),
                argumentSet("비밀번호가 없다", "{\"email\":\"a@b.example\"}", List.of("password:REQUIRED")),
                argumentSet("null", "{\"email\":null,\"password\":null}", List.of("email:REQUIRED", "password:REQUIRED")),
                argumentSet("빈 글자", "{\"email\":\"\",\"password\":\"\"}", List.of("email:REQUIRED", "password:REQUIRED")),
                argumentSet("공백뿐인 이메일", "{\"email\":\" \\t\",\"password\":\"password1\"}", List.of("email:REQUIRED")),
                argumentSet("수로 온 비밀번호", "{\"email\":\"a@b.example\",\"password\":12345678}",
                        List.of("password:INVALID_FORMAT")),
                argumentSet("참거짓으로 온 이메일", "{\"email\":true,\"password\":\"password1\"}",
                        List.of("email:INVALID_FORMAT")),
                argumentSet("객체로 온 비밀번호", "{\"email\":\"a@b.example\",\"password\":{}}",
                        List.of("password:INVALID_FORMAT")),
                argumentSet("목록으로 온 이메일", "{\"email\":[\"a@b.example\"],\"password\":\"password1\"}",
                        List.of("email:INVALID_FORMAT")),
                argumentSet("본문이 배열", "[]", List.of(":INVALID_FORMAT")));
    }

    @ParameterizedTest
    @MethodSource("invalidBodies")
    void 빠졌거나_형이_다른_값은_그_입력란의_오류이고_확인하지_않는다(String json, List<String> expected) throws Exception {
        post(json).assertFieldErrors(expected.toArray(String[]::new));

        assertNotAuthenticated();
    }

    @ParameterizedTest
    @ValueSource(strings = {"", "null", "{", "not json", "{\"email\":\"a@b.example\",\"password\":\"password1\"}{}"})
    void JSON_하나로_읽을_수_없는_본문은_MALFORMED_REQUEST이고_확인하지_않는다(String body) throws Exception {
        post(body).assertProblem(400, "Bad Request", "MALFORMED_REQUEST");

        assertNotAuthenticated();
    }

    // --- 확인보다 먼저 거절하는 것 ---

    @Test
    void 출처와_전용_헤더가_먼저이고_본문을_보지_않는다() throws Exception {
        for (String body : List.of(body(EMAIL, PASSWORD), body(EMAIL, "wrong-password1"), "{}", "{")) {
            anyone.send("POST", LOGIN, body, "Content-Type", "application/json")
                    .assertProblem(403, "Forbidden", "ORIGIN_NOT_ALLOWED");
            anyone.send("POST", LOGIN, body, "Content-Type", "application/json", "X-Akkimpyo-Client", "web",
                    "Origin", "https://evil.example").assertProblem(403, "Forbidden", "ORIGIN_NOT_ALLOWED");
        }

        assertNotAuthenticated();
        assertThat(login(EMAIL, PASSWORD, "Origin", HttpServerTest.ORIGIN).status()).isEqualTo(200);
    }

    @ParameterizedTest
    @ValueSource(strings = {"text/plain", "application/x-www-form-urlencoded", "multipart/form-data; boundary=x",
            "application/xml", "application/merge-patch+json", "garbage"})
    void JSON이_아닌_본문은_415이고_확인하지_않는다(String contentType) throws Exception {
        anyone.send("POST", LOGIN, body(EMAIL, PASSWORD), "Content-Type", contentType, "X-Akkimpyo-Client", "web")
                .assertProblem(415, "Unsupported Media Type", "UNSUPPORTED_MEDIA_TYPE");

        assertNotAuthenticated();
    }

    @Test
    void Content_Type이_없는_본문도_415다() throws Exception {
        anyone.send("POST", LOGIN, body(EMAIL, PASSWORD), "X-Akkimpyo-Client", "web")
                .assertProblem(415, "Unsupported Media Type", "UNSUPPORTED_MEDIA_TYPE");

        assertNotAuthenticated();
    }

    @ParameterizedTest
    @ValueSource(strings = {"text/html", "application/xml", "image/png", "application/problem+json", "garbage"})
    void JSON을_받지_않는_Accept는_확인하기_전에_거절한다(String accept) throws Exception {
        login(EMAIL, PASSWORD, "Accept", accept).assertProblem(400, "Bad Request", "MALFORMED_REQUEST");

        assertNotAuthenticated();
    }

    @ParameterizedTest
    @ValueSource(strings = {"application/json", "*/*", "application/*", "text/html, application/json;q=0.1"})
    void JSON을_받는_Accept는_그대로_답한다(String accept) throws Exception {
        Reply reply = login(EMAIL, PASSWORD, "Accept", accept);

        assertThat(reply.status()).isEqualTo(200);
        assertThat(reply.header("Content-Type")).isEqualTo("application/json");
    }

    @Test
    void 해시_자리가_없으면_429이고_1초_뒤에_다시_보내라고_알린다() throws Exception {
        doThrow(BeanUtils.instantiateClass(PasswordHashBusyException.class))
                .when(userService).checkPassword(any(), any());

        Reply reply = login(EMAIL, PASSWORD).assertProblem(429, "Too Many Requests", "TOO_MANY_REQUESTS");

        assertThat(reply.header("Retry-After")).isEqualTo("1");
        // 자리가 모자란 동안 로그가 쌓이지 않는다.
        assertThat(requestLogs(Level.INFO)).isEmpty();
    }

    // --- 공개 주소는 글자 그대로 하나다 ---

    @Test
    void 틀린_Authorization이_붙어도_열린다() throws Exception {
        for (String authorization : List.of("Bearer x", "Bearer", "Basic eDp5", "Bearer "
                + TestAccessTokens.valid(SignedInUser.ID, NOW.minus(Duration.ofDays(1))))) {
            assertThat(login(EMAIL, PASSWORD, "Authorization", authorization).status()).isEqualTo(200);
        }
    }

    @Test
    void 다른_사람의_유효한_토큰이_붙어도_본문의_사람으로_로그인한다() throws Exception {
        Reply reply = login(EMAIL, PASSWORD, "Authorization",
                "Bearer " + TestAccessTokens.valid(SignedInUser.ID, NOW));

        assertThat(SignedJWT.parse(reply.json().get("accessToken").asString()).getJWTClaimsSet().getSubject())
                .isEqualTo(USER_ID.toString());
    }

    @ParameterizedTest
    @ValueSource(strings = {"/api/v1/auth", "/api/v1/auth/", LOGIN + "/", LOGIN + ".json", LOGIN + "/x", "/api/v1/auth/Login",
            "/api/v1/auth/refresh", "/api/v1/login", "/auth/login"})
    void 비슷한_주소는_열리지_않는다(String path) throws Exception {
        anyone.send("POST", path, body(EMAIL, PASSWORD), "Content-Type", "application/json", "X-Akkimpyo-Client", "web")
                .assertProblem(401, "Unauthorized", "UNAUTHENTICATED");
    }

    @ParameterizedTest
    @ValueSource(strings = {"GET", "PUT", "PATCH", "DELETE", "OPTIONS"})
    void 로그인_주소는_POST만_받는다(String method) throws Exception {
        for (String[] headers : new String[][] {{"X-Akkimpyo-Client", "web"},
                {"X-Akkimpyo-Client", "web", "Authorization", "Bearer " + TestAccessTokens.valid(SignedInUser.ID, NOW)}}) {
            Reply reply = anyone.send(method, LOGIN, null, headers)
                    .assertProblem(405, "Method Not Allowed", "METHOD_NOT_ALLOWED");

            assertThat(reply.headers().get("Allow")).containsExactly("POST");
        }
        assertNotAuthenticated();
    }

    // --- 로그와 응답에 비밀번호, 이메일, 토큰이 없다 ---

    @Test
    void 성공과_실패는_사용자_id로_한_줄씩_남는다() throws Exception {
        login(EMAIL, PASSWORD, "X-Request-Id", "login-ok");
        login(EMAIL, "wrong-password1", "X-Request-Id", "login-wrong");
        login("marker-nobody@example.com", PASSWORD, "X-Request-Id", "login-nobody");

        assertThat(requestLogs(Level.INFO)).extracting(ILoggingEvent::getLevel).containsOnly(Level.INFO);
        assertThat(requestLogs(Level.INFO))
                .extracting(event -> event.getMDCPropertyMap().get("requestId") + " " + event.getFormattedMessage())
                .containsExactly("login-ok 로그인 성공: 사용자 " + USER_ID, "login-wrong 로그인 실패: 사용자 " + USER_ID,
                        "login-nobody 로그인 실패: 알 수 없는 계정");
    }

    @Test
    void 비밀번호와_이메일과_토큰은_로그와_오류_응답에_없다() throws Exception {
        String secret = "marker-Secret1";
        String token = login(EMAIL, PASSWORD).json().get("accessToken").asString();

        Stream.of(login(EMAIL, secret), login("marker-nobody@example.com", secret), login("marker-nobody", secret),
                        login(EMAIL, secret.repeat(60)), login("", secret), login(EMAIL, ""),
                        post("{\"email\":\"" + EMAIL + "\",\"password\":\"" + secret + "\""),
                        post("{\"email\":[\"" + EMAIL + "\"],\"password\":\"" + secret + "\"}"),
                        post("{\"email\":\"" + EMAIL + "\",\"password\":[\"" + secret + "\"]}"),
                        login(EMAIL, secret, "Accept", "text/html"),
                        anyone.send("POST", LOGIN, body(EMAIL, secret), "Content-Type", "application/json"),
                        anyone.send("POST", LOGIN, body(EMAIL, secret), "Content-Type", "text/plain",
                                "X-Akkimpyo-Client", "web"))
                .forEach(reply -> {
                    assertThat(reply.status()).isGreaterThanOrEqualTo(400);
                    assertThat(reply.headers() + reply.body()).doesNotContainIgnoringCase("marker")
                            .doesNotContain(USER_ID.toString(), "argon2id", "Exception");
                });

        assertNoValuesInLogs(token);
    }

    @Test
    void 스프링이_요청과_응답_객체를_남겨도_값이_없다() throws Exception {
        // 운영에서 켜지 않는 수준이다. 객체를 글자로 바꿔도 값이 나오지 않는 것을 본다.
        SPRING_WEB.setLevel(Level.TRACE);
        try {
            String token = login(EMAIL, PASSWORD).json().get("accessToken").asString();
            login(EMAIL, "marker-Secret1");

            assertThat(logs.text()).contains("LoginRequest[", "AccessTokenResponse[");
            assertNoValuesInLogs(token);
        } finally {
            SPRING_WEB.setLevel(null);
        }
    }

    @Test
    void 요청과_응답_객체의_글자에_값이_없다() {
        assertThat(new LoginRequest(EMAIL, PASSWORD)).hasToString("LoginRequest[]");
        assertThat(new AccessTokenResponse("eyJ.marker.token")).hasToString("AccessTokenResponse[]");
    }

    private void insertUser(UUID id, String email, String stored) {
        jdbc.update("""
                insert into users (id, email, password_hash, display_name, created_at)
                values (?, ?, ?, '로그인할 사람', now())
                """, id, email, stored);
    }

    private Reply login(String email, String password, String... headers) throws Exception {
        return post(body(email, password), headers);
    }

    private Reply post(String body, String... headers) throws Exception {
        return anyone.send("POST", LOGIN, body, Stream.concat(
                Stream.of("Content-Type", "application/json", "X-Akkimpyo-Client", "web"),
                Stream.of(headers)).toArray(String[]::new));
    }

    /** 값을 그대로 끼워 넣는다. JSON의 이스케이프는 부르는 쪽이 적는다. */
    private static String body(String email, String password) {
        return "{\"email\":\"" + email + "\",\"password\":\"" + password + "\"}";
    }

    private void assertNotAuthenticated() {
        verify(userService, never()).checkPassword(any(), any());
    }

    private static Map<String, Object> withoutRequestId(Reply reply) {
        Map<String, Object> problem = new TreeMap<>();
        reply.json().properties().forEach(property -> problem.put(property.getKey(), property.getValue().toString()));
        problem.remove("requestId");
        return problem;
    }

    /** 요청마다 다른 것을 뺀 헤더. */
    private static Map<String, List<String>> comparableHeaders(Reply reply) {
        Map<String, List<String>> headers = new TreeMap<>(reply.headers());
        headers.remove("date");
        headers.remove("x-request-id");
        return headers;
    }

    private List<ILoggingEvent> requestLogs(Level level) {
        return logs.events().stream()
                .filter(event -> event.getThreadName().contains("-exec-"))
                .filter(event -> event.getLevel().isGreaterOrEqual(level))
                .toList();
    }

    private void assertNoValuesInLogs(String token) {
        assertThat(logs.text()).contains("로그인 실패", "로그인 성공")
                .doesNotContainIgnoringCase("marker").doesNotContain(PASSWORD, "argon2id", "eyJ", token);
    }
}
