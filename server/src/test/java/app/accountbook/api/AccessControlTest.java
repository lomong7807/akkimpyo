package app.accountbook.api;

import static org.assertj.core.api.Assertions.assertThat;

import app.accountbook.api.ServerClient.Reply;
import app.accountbook.support.SignedInUser;
import app.accountbook.support.StoppedClockConfig.StoppedClock;
import app.accountbook.support.TestAccessTokens;
import java.time.Instant;
import java.util.Arrays;
import java.util.List;
import java.util.stream.Stream;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.context.ApplicationContext;
import org.springframework.security.authentication.AuthenticationManager;
import org.springframework.security.core.userdetails.UserDetailsService;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.web.SecurityFilterChain;

/** 공개 주소는 목록뿐이고 나머지는 토큰이 있어야 한다(#12, ADR 001). 응답은 ADR 002의 모양이다. */
@AccessTest
class AccessControlTest {

    private static final String HEALTH = "/actuator/health";
    private static final String HOST = "Host: localhost\r\nConnection: close\r\n";
    private static final Instant NOW = Instant.parse("2030-01-01T00:00:00Z");

    @LocalServerPort int port;
    @Autowired StoppedClock clock;
    @Autowired SessionCounter sessions;
    @Autowired ApplicationContext context;

    private ServerClient anyone;
    private String bearer;

    @BeforeEach
    void setUp() {
        clock.stopAt(NOW);
        anyone = ServerClient.anonymous(port);
        bearer = "Bearer " + TestAccessTokens.valid(SignedInUser.ID, NOW);
    }

    // --- 공개 주소 ---

    @Test
    void health는_토큰_없이_열리고_상세가_없다() throws Exception {
        assertPlainHealth(anyone.get(HEALTH));
    }

    @Test
    void health는_로그인한_사람에게도_상세가_없다() throws Exception {
        assertPlainHealth(anyone.get(HEALTH, "Authorization", bearer));
    }

    @Test
    void 공개_주소는_유효하지_않은_토큰이_와도_열린다() throws Exception {
        assertPlainHealth(anyone.get(HEALTH, "Authorization", "Bearer not-a-token"));
    }

    // --- 나머지는 모두 토큰이 있어야 한다 ---

    @ParameterizedTest
    @ValueSource(strings = {
            // 있는 주소
            AccessProbeController.ME,
            // health의 하위 경로와 비슷한 주소. 공개는 글자 그대로 하나다
            HEALTH + "/", HEALTH + "/liveness", HEALTH + "/readiness", HEALTH + "/db", HEALTH + "/x/y",
            HEALTH + ".json", "/actuator/healthz", "/ACTUATOR/HEALTH", "/actuator", "/actuator/info",
            "/actuator/env", "/actuator/metrics",
            // 없는 주소. 밖에서 직접 부른 /error도 같다
            "/", "/nope", "/api/v1/nope", "/favicon.ico", "/index.html", "/error", "/error/x",
            // 보안 라이브러리가 스스로 여는 주소
            "/login", "/logout", "/default-ui.css", "/oauth2/authorization/x", "/login/oauth2/code/x",
            "/.well-known/oauth-protected-resource", "/.well-known/oauth-authorization-server",
            // OpenAPI 문서 주소. 문서는 server/openapi.json으로만 낸다(ADR 003 결정 3, 4)
            "/v3/api-docs", "/v3/api-docs.yaml", "/swagger-ui.html", "/swagger-ui/index.html"})
    void 토큰이_없으면_있는_주소든_없는_주소든_401이다(String path) throws Exception {
        for (String method : List.of("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS")) {
            assertUnauthenticated(anyone.send(method, path, null, "Accept", "text/html"));
        }
    }

    @ParameterizedTest
    @ValueSource(strings = {"POST", "PUT", "PATCH", "DELETE", "OPTIONS"})
    void health도_GET이_아니면_토큰이_있어야_한다(String method) throws Exception {
        assertUnauthenticated(anyone.send(method, HEALTH, null));
    }

    @Test
    void HEAD는_본문_없이_401이다() throws Exception {
        for (String path : List.of(HEALTH, AccessProbeController.ME, "/nope")) {
            Reply reply = anyone.send("HEAD", path, null);

            assertThat(reply.status()).isEqualTo(401);
            assertThat(reply.header("Content-Type")).isEqualTo("application/problem+json");
            assertThat(reply.body()).isEmpty();
        }
    }

    @ParameterizedTest
    @ValueSource(strings = {"/", "/nope", "/api/v1/nope", "/error", "/error/x", "/actuator", "/actuator/",
            "/actuator/info", "/actuator/env", "/actuator/healthz", "/login", "/logout", "/.well-known/oauth-protected-resource",
            "/v3/api-docs", "/v3/api-docs.yaml", "/swagger-ui.html", "/swagger-ui/index.html"})
    void 토큰이_있으면_없는_주소는_404다(String path) throws Exception {
        for (String method : List.of("GET", "POST")) {
            anyone.send(method, path, null, "Authorization", bearer).assertProblem(404, "Not Found", "NOT_FOUND");
        }
    }

    @Test
    void 뒤에_빗금을_붙인_health는_토큰이_있을_때만_답하고_상세가_없다() throws Exception {
        assertPlainHealth(anyone.get(HEALTH + "/", "Authorization", bearer));
    }

    @ParameterizedTest
    @ValueSource(strings = {HEALTH + "/liveness", HEALTH + "/readiness", HEALTH + "/db"})
    void health의_하위_경로는_꺼져_있어_토큰이_있어도_404다(String path) throws Exception {
        // 없는 상태 항목은 actuator가 직접 빈 본문의 404로 답한다(#177).
        Reply reply = anyone.get(path, "Authorization", bearer);

        assertThat(reply.status()).isEqualTo(404);
        assertThat(reply.body()).isEmpty();
    }

    @Test
    void 상태로만_알려진_403도_같은_모양이다() throws Exception {
        // 필터 체인은 아직 403을 내지 않는다. 스프링 시큐리티가 권한 부족을 알리는 방법(sendError)을 흉내 낸다.
        anyone.get(ThrowingFilter.FORBIDDEN, "Accept", "text/html").assertProblem(403, "Forbidden", "FORBIDDEN");
    }

    // --- 읽을 수 없는 요청은 토큰보다 먼저 400이다 ---

    @ParameterizedTest
    @ValueSource(strings = {HEALTH + ";x", "/actuator;x/health", "/actuator//health", "//actuator/health",
            "/actuator/%2e/health", "/actuator/health%3b", "/x/../actuator/health", "/actuator/health%0a",
            "/%25"})
    void 꾸민_경로는_읽지_않는다(String path) throws Exception {
        for (String authorization : List.of("", "Authorization: " + bearer + "\r\n")) {
            anyone.rawReply("GET " + path + " HTTP/1.1\r\n" + HOST + authorization + "\r\n")
                    .assertProblem(400, "Bad Request", "MALFORMED_REQUEST");
        }
    }

    @ParameterizedTest
    @ValueSource(strings = {HEALTH, AccessProbeController.ME, "/nope"})
    void HTTP에_없는_메서드는_읽을_수_없는_요청이다(String path) throws Exception {
        anyone.send("MARKER", path, null).assertProblem(400, "Bad Request", "MALFORMED_REQUEST");
        anyone.send("MARKER", path, null, "Authorization", bearer)
                .assertProblem(400, "Bad Request", "MALFORMED_REQUEST");
    }

    // --- 응답 헤더 ---

    @Test
    void 모든_응답에_캐시하지_말라고_적는다() throws Exception {
        List<Reply> replies = List.of(
                anyone.get(HEALTH),
                anyone.get(AccessProbeController.ME, "Authorization", bearer),
                anyone.get(AccessProbeController.PATH + "/async", "Authorization", bearer),
                anyone.get(AccessProbeController.ME),
                anyone.get(AccessProbeController.ME, "Authorization", "Bearer x"),
                anyone.get("/nope", "Authorization", bearer),
                anyone.get(HEALTH + "/liveness", "Authorization", bearer),
                anyone.send("DELETE", AccessProbeController.ME, null, "Authorization", bearer),
                // 필터 체인 앞에서 끝나는 것
                anyone.get("//nope"),
                anyone.send("MARKER", "/nope", null),
                anyone.get(ThrowingFilter.THROW),
                anyone.rawReply("TRACE / HTTP/1.1\r\n" + HOST + "\r\n"));

        assertThat(replies).extracting(Reply::status)
                .containsExactly(200, 200, 200, 401, 401, 404, 404, 405, 400, 400, 500, 405);
        assertThat(replies).allSatisfy(reply ->
                assertThat(reply.headers().get("Cache-Control"))
                        .containsExactly("no-cache, no-store, max-age=0, must-revalidate"));
    }

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void 나머지_보안_헤더는_붙이지_않는다(boolean https) throws Exception {
        // 프록시 한 곳에서 붙인다(ADR 005 결정 6). HSTS의 기본값은 https로 온 요청에만 나가므로 그것도 본다.
        String[] anyoneHeaders = https ? new String[] {HttpsRequestFilter.HEADER, "1"} : new String[] {};
        String[] signedIn = concat(new String[] {"Authorization", bearer}, anyoneHeaders);
        Reply me = anyone.get(AccessProbeController.ME, signedIn);
        assertThat(me.json().get("https").asBoolean()).isEqualTo(https);

        List<Reply> replies = List.of(me,
                anyone.get(HEALTH, anyoneHeaders),
                anyone.get(AccessProbeController.ME, anyoneHeaders),
                anyone.get("/nope", signedIn),
                anyone.send("DELETE", AccessProbeController.ME, null, signedIn),
                anyone.get("//nope", anyoneHeaders),
                anyone.get(AccessProbeController.PATH + "/async", signedIn));

        assertThat(replies).extracting(Reply::status).containsExactly(200, 200, 401, 404, 405, 400, 200);
        assertThat(replies).allSatisfy(reply -> assertThat(reply.headers())
                .containsKey("Cache-Control")
                .doesNotContainKeys("Strict-Transport-Security", "X-Frame-Options", "X-Content-Type-Options",
                        "X-XSS-Protection"));
    }

    @ParameterizedTest
    @CsvSource({"OPTIONS, /api/v1/nope", "OPTIONS, " + AccessProbeController.ME, "OPTIONS, " + HEALTH,
            "GET, " + AccessProbeController.ME, "GET, " + HEALTH})
    void 다른_출처의_요청을_허용한다고_답하지_않는다(String method, String path) throws Exception {
        for (String[] authorization : new String[][] {{}, {"Authorization", bearer}}) {
            String[] headers = concat(new String[] {"Origin", "https://evil.example",
                    "Access-Control-Request-Method", "POST",
                    "Access-Control-Request-Headers", "authorization,content-type"}, authorization);

            Reply reply = anyone.send(method, path, null, headers);

            assertThat(reply.headers().keySet())
                    .noneMatch(name -> name.toLowerCase().startsWith("access-control-allow"));
        }
    }

    @Test
    void 세션을_만들지_않는다() throws Exception {
        int before = sessions.created();

        List<Reply> replies = List.of(
                anyone.get(HEALTH),
                anyone.get(AccessProbeController.ME),
                anyone.get(AccessProbeController.ME, "Authorization", bearer),
                anyone.get(AccessProbeController.ME, "Authorization", bearer, "Cookie", "JSESSIONID=abc"),
                anyone.get(AccessProbeController.PATH + "/async", "Authorization", bearer),
                anyone.get("/nope", "Accept", "text/html"),
                anyone.send("POST", "/login", "username=user&password=x",
                        "Content-Type", "application/x-www-form-urlencoded"));

        assertThat(replies).allSatisfy(reply -> assertThat(reply.headers()).doesNotContainKey("Set-Cookie"));
        assertThat(replies).filteredOn(reply -> reply.status() == 200 && reply.body().contains("session"))
                .hasSize(3)
                .allSatisfy(reply -> assertThat(reply.json().get("session").asBoolean()).isFalse());
        assertThat(sessions.created()).isEqualTo(before);

        // 대조: 컨트롤러가 세션을 만들면 드러난다.
        Reply withSession = anyone.get(AccessProbeController.PATH + "/session", "Authorization", bearer);
        assertThat(withSession.headers()).containsKey("Set-Cookie");
        assertThat(sessions.created()).isEqualTo(before + 1);
    }

    @Test
    void 필터_체인은_하나이고_계정이나_비밀번호로_로그인하는_길이_없다() {
        assertThat(context.getBeansOfType(SecurityFilterChain.class)).hasSize(1);
        assertThat(context.getBeansOfType(SecurityFilterChain.class).values().iterator().next().getFilters())
                .extracting(filter -> filter.getClass().getSimpleName())
                .doesNotContain("UsernamePasswordAuthenticationFilter", "BasicAuthenticationFilter",
                        "DefaultLoginPageGeneratingFilter", "LogoutFilter", "CsrfFilter", "CorsFilter",
                        "RememberMeAuthenticationFilter");
        // 스프링 부트가 만드는 기본 계정(비밀번호를 로그에 남긴다)이 없다. 인코더와 해독기도 빈으로 두지 않는다.
        assertThat(context.getBeansOfType(UserDetailsService.class)).isEmpty();
        assertThat(context.getBeansOfType(AuthenticationManager.class)).isEmpty();
        assertThat(context.getBeansOfType(PasswordEncoder.class)).isEmpty();
        assertThat(context.getBeansOfType(JwtDecoder.class)).isEmpty();
    }

    private static void assertPlainHealth(Reply reply) {
        assertThat(reply.status()).isEqualTo(200);
        assertThat(reply.json().propertyNames()).containsExactly("status");
        assertThat(reply.json().get("status").asString()).isEqualTo("UP");
    }

    private static void assertUnauthenticated(Reply reply) {
        reply.assertProblem(401, "Unauthorized", "UNAUTHENTICATED");
        assertThat(reply.headers().get("WWW-Authenticate")).containsExactly("Bearer realm=\"account-book\"");
        assertThat(reply.headers()).doesNotContainKeys("Location", "Set-Cookie");
    }

    private static String[] concat(String[] first, String[] second) {
        return Stream.of(first, second).flatMap(Arrays::stream).toArray(String[]::new);
    }
}
