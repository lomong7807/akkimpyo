package app.accountbook.api;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.clearInvocations;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;

import app.accountbook.account.AccountService;
import app.accountbook.api.ServerClient.Reply;
import app.accountbook.support.Fixtures;
import app.accountbook.support.StoppedClockConfig.StoppedClock;
import app.accountbook.user.User;
import app.accountbook.user.UserService;
import java.time.Instant;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.stream.Stream;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.servlet.mvc.method.RequestMappingInfo;
import org.springframework.web.servlet.mvc.method.annotation.RequestMappingHandlerMapping;

/**
 * 장부 경로({@code /api/v1/ledgers/{ledgerId}/**})의 구성원 확인은 인자를 읽기 전에 한 자리에서 한다(ADR 002 5절, #13).
 * 구성원이 아닌 장부, 없는 장부, 형식이 틀린 장부 id는 본문이 틀려도 같은 404다.
 */
@LedgerApiTest
class LedgerPathTest {

    private static final Instant NOW = Instant.parse("2026-11-27T03:00:00Z");
    private static final String LEDGER_ROUTE = "/api/v1/ledgers/\\{[^}]+}(/.*)?";
    private static final String VARIABLE = "\\{[^}]+}";

    @LocalServerPort int port;
    @Autowired StoppedClock clock;
    @Autowired Fixtures fixtures;
    @Autowired LedgerProbeController probe;
    @Autowired UserService userService;
    @Autowired AccountService accountService;
    @Autowired @Qualifier("requestMappingHandlerMapping") RequestMappingHandlerMapping mappings;

    private UUID ledgerId;
    private ServerClient owner;
    private ServerClient outsider;
    private ServerClient anyone;

    @BeforeEach
    void setUp() {
        clock.stopAt(NOW);
        User ownerUser = fixtures.user(UUID.randomUUID().toString().substring(0, 18) + "@example.com");
        ledgerId = fixtures.personalLedgerId(ownerUser);
        owner = ServerClient.signedIn(port, ownerUser.getId(), NOW);
        outsider = ServerClient.signedIn(port, fixtures.user(UUID.randomUUID().toString().substring(0, 18) + "@example.com").getId(), NOW);
        anyone = ServerClient.anonymous(port);
    }

    @ParameterizedTest
    @ValueSource(strings = {"not-a-uuid", "1-2-3-4-5", "00000000000000000000000000000000",
            "0b9f6c1e-3d52-4a7e-9c11-5f2e8a7d4b6", "0b9f6c1e-3d52-4a7e-9c11-5f2e8a7d4b600", "%200b9f6c1e-3d52-4a7e-9c11-5f2e8a7d4b60",
            "%7B0b9f6c1e-3d52-4a7e-9c11-5f2e8a7d4b60%7D", "0b9f6c1e-3d52-4a7e-9c11-5f2e8a7d4b6g"})
    void 형식이_틀린_장부_id는_없는_장부와_같은_404다(String badId) throws Exception {
        Reply missing = owner.get(accounts(UUID.randomUUID()));

        assertSameNotFound(owner.get("/api/v1/ledgers/" + badId + "/accounts"), missing);
        assertSameNotFound(owner.postJson("/api/v1/ledgers/" + badId + "/test-probe", "{"), missing);
    }

    @Test
    void 구성원이_아닌_장부와_없는_장부는_같은_404이고_구성원은_열린다() throws Exception {
        Reply missing = owner.get(accounts(UUID.randomUUID()));

        assertSameNotFound(outsider.get(accounts(ledgerId)), missing);
        assertThat(owner.get(accounts(ledgerId)).status()).isEqualTo(200);
        // 대소문자는 가리지 않는다(architect 결정 2026-11-26, #102).
        assertThat(owner.get("/api/v1/ledgers/" + ledgerId.toString().toUpperCase(Locale.ROOT) + "/accounts")
                .status()).isEqualTo(200);
    }

    @Test
    void 구성원_확인은_본문을_읽고_검증하기_전이다() throws Exception {
        String path = probe(ledgerId);
        int before = probe.calls.get();

        for (String body : List.of("{", "{}", "[]", "{\"value\":\"x\"}")) {
            outsider.postJson(path, body).assertProblem(404, "Not Found", "NOT_FOUND");
        }
        assertThat(probe.calls.get()).as("구성원이 아니면 컨트롤러에 닿지 않는다").isEqualTo(before);

        // 대조: 구성원이면 본문을 읽고(400) 검증한다(400). 둘 다 지나면 컨트롤러가 불린다.
        owner.postJson(path, "{").assertProblem(400, "Bad Request", "MALFORMED_REQUEST");
        owner.postJson(path, "{}").assertFieldErrors("value:REQUIRED");
        assertThat(owner.postJson(path, "{\"value\":\"x\"}").status()).isEqualTo(200);
        assertThat(probe.calls.get()).isEqualTo(before + 1);
    }

    @Test
    void 장부_경로의_모든_컨트롤러는_구성원이_아니면_잘못된_본문에도_404다() throws Exception {
        List<Route> routes = ledgerRoutes();
        assertThat(routes).extracting(Route::toString)
                .contains("GET /api/v1/ledgers/{ledgerId}/accounts", "POST " + LedgerProbeController.PATH);

        for (Route route : routes) {
            String path = route.pattern().replaceFirst(VARIABLE, ledgerId.toString())
                    .replaceAll(VARIABLE, UUID.randomUUID().toString());
            Reply reply = outsider.send(route.method(), path, "{", "Content-Type", route.consumes(),
                    "Accept", route.produces());

            assertThat(reply.status()).as(route.toString()).isEqualTo(404);
            reply.assertProblem(404, "Not Found", "NOT_FOUND");
        }
    }

    @Test
    void 토큰이_없으면_구성원_확인보다_먼저_401이다() throws Exception {
        for (String path : List.of(accounts(ledgerId), accounts(UUID.randomUUID()), "/api/v1/ledgers/x/accounts",
                probe(ledgerId))) {
            for (String method : List.of("GET", "POST")) {
                anyone.send(method, path, "{", "Content-Type", "application/json")
                        .assertProblem(401, "Unauthorized", "UNAUTHENTICATED");
            }
        }
    }

    /** 화면이 연결을 판단할 때 쓰는 요청(frontend). 본문 없이 401이고 요청 id가 헤더에 있다. */
    @Test
    void 토큰_없는_HEAD_api_v1은_401이고_요청_id를_돌려준다() throws Exception {
        Reply given = anyone.send("HEAD", "/api/v1/", null, "X-Request-Id", "req-frontend_1");
        Reply generated = anyone.send("HEAD", "/api/v1/", null);
        Reply malformed = anyone.send("HEAD", "/api/v1/", null, "X-Request-Id", "bad.id");

        assertThat(List.of(given, generated, malformed)).allSatisfy(reply -> {
            assertThat(reply.status()).isEqualTo(401);
            assertThat(reply.body()).isEmpty();
            assertThat(reply.headers().get("X-Request-Id")).singleElement().asString().matches("[A-Za-z0-9_-]{1,64}");
        });
        assertThat(given.header("X-Request-Id")).isEqualTo("req-frontend_1");
        assertThat(malformed.header("X-Request-Id")).isNotEqualTo("bad.id");
    }

    /**
     * 본문 상한(#21)은 토큰 확인(UserService.exists), 로그인의 비밀번호 확인(UserService.authenticate)과 서비스보다 먼저다.
     * 본문은 상한이 없으면 그대로 처리될 JSON에 공백을 붙여 상한을 1바이트 넘긴 것이다. 소켓에 그대로 쓰므로 ASCII만 쓴다.
     */
    @Test
    void 본문이_상한을_넘으면_토큰_확인과_비밀번호_확인과_서비스보다_먼저_413이다() throws Exception {
        clearInvocations(userService, accountService);
        String account = "{\"name\":\"living\",\"type\":\"BANK\",\"openingBalance\":0,\"openingDate\":\"2026-11-01\"}";
        String login = "{\"email\":\"someone@example.com\",\"password\":\"password1\"}";
        Map<String, String> requests = Map.of(
                "POST " + accounts(ledgerId) + " HTTP/1.1\r\n" + owner.authorizationLine(), account,
                "POST /api/v1/auth/login HTTP/1.1\r\nX-Akkimpyo-Client: web\r\n", login);

        for (Map.Entry<String, String> request : requests.entrySet()) {
            String head = request.getKey() + "Host: localhost\r\nConnection: close\r\nContent-Type: application/json\r\n";
            String body = overLimit(request.getValue());
            owner.rawReply(head + "Content-Length: " + body.length() + "\r\n\r\n" + body)
                    .assertProblem(413, "Content Too Large", "PAYLOAD_TOO_LARGE");
            owner.rawReply(head + "Transfer-Encoding: chunked\r\n\r\n" + Integer.toHexString(body.length()) + "\r\n"
                            + body + "\r\n0\r\n\r\n")
                    .assertProblem(413, "Content Too Large", "PAYLOAD_TOO_LARGE");
        }

        verify(userService, never()).exists(any());
        verify(userService, never()).authenticate(any(), any());
        verifyNoInteractions(accountService);
    }

    /** 64KB를 1바이트 넘기게 뒤에 공백을 붙인다. */
    private static String overLimit(String json) {
        return json + " ".repeat(64 * 1024 + 1 - json.length());
    }

    private List<Route> ledgerRoutes() {
        return mappings.getHandlerMethods().keySet().stream()
                .flatMap(info -> info.getPathPatternsCondition().getPatternValues().stream()
                        .filter(pattern -> pattern.matches(LEDGER_ROUTE))
                        .flatMap(pattern -> methods(info).map(method -> new Route(method, pattern,
                                first(info.getConsumesCondition().getConsumableMediaTypes(), "application/json"),
                                first(info.getProducesCondition().getProducibleMediaTypes(), "*/*")))))
                .toList();
    }

    /** 메서드를 적지 않은 매핑은 모든 메서드를 받는다. 본문이 있는 것과 없는 것을 하나씩 본다. */
    private static Stream<String> methods(RequestMappingInfo info) {
        Set<RequestMethod> methods = info.getMethodsCondition().getMethods();
        return methods.isEmpty() ? Stream.of("GET", "POST") : methods.stream().map(RequestMethod::name);
    }

    private static String first(Set<MediaType> types, String otherwise) {
        return types.stream().findFirst().map(MediaType::toString).orElse(otherwise);
    }

    private static void assertSameNotFound(Reply reply, Reply reference) {
        reply.assertProblem(404, "Not Found", "NOT_FOUND");
        assertThat(withoutRequestId(reply)).isEqualTo(withoutRequestId(reference));
    }

    private static String withoutRequestId(Reply reply) {
        return reply.body().replace(reply.header("X-Request-Id"), "");
    }

    private static String accounts(UUID ledger) {
        return "/api/v1/ledgers/" + ledger + "/accounts";
    }

    private static String probe(UUID ledger) {
        return LedgerProbeController.PATH.replace("{ledgerId}", ledger.toString());
    }

    private record Route(String method, String pattern, String consumes, String produces) {

        @Override
        public String toString() {
            return method + " " + pattern;
        }
    }
}
