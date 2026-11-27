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
import app.accountbook.support.StoppedClockConfig.StoppedClock;
import app.accountbook.user.PasswordHashBusyException;
import app.accountbook.user.SignupRows;
import app.accountbook.user.UserService;
import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import com.nimbusds.jwt.SignedJWT;
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
import org.springframework.beans.BeanUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.jdbc.core.JdbcTemplate;

/** 가입 API(#29, F-002, F-003, P-101, P-102). 입력 규칙의 갈래는 user의 테스트가 보고, 여기서는 HTTP의 약속을 본다. */
@AccessTest
class SignupTest {

    private static final Instant NOW = Instant.parse("2030-01-01T00:00:00Z");
    private static final String SIGNUP = "/api/v1/auth/signup";
    private static final String EMAIL = "marker-signup@example.com";
    /** 테스트 설정의 허용 목록(@example.com) 밖이다. */
    private static final String OUTSIDER = "marker-outsider@example.org";
    private static final String PASSWORD = "password1";
    private static final String NAME = "아낌이";
    private static final Logger OURS = (Logger) LoggerFactory.getLogger("app.accountbook");
    private static final Logger SPRING_WEB = (Logger) LoggerFactory.getLogger("org.springframework.web");

    @LocalServerPort int port;
    @Autowired StoppedClock clock;
    @Autowired JdbcTemplate jdbc;
    @Autowired UserService userService;

    private ServerClient anyone;

    @BeforeEach
    void setUp() {
        clock.stopAt(NOW);
        anyone = ServerClient.anonymous(port);
    }

    @AfterEach
    void tearDown() {
        SignupRows.delete(jdbc, EMAIL);
        SignupRows.delete(jdbc, OUTSIDER);
    }

    @Test
    void 가입하면_201과_로그인과_같은_본문을_주고_그_토큰으로_열린다() throws Exception {
        Reply reply = signup(EMAIL, PASSWORD, NAME);

        assertThat(reply.status()).as(reply.body()).isEqualTo(201);
        assertThat(reply.header("Content-Type")).isEqualTo("application/json");
        assertThat(reply.headers().get("Cache-Control"))
                .containsExactly("no-cache, no-store, max-age=0, must-revalidate");
        assertThat(reply.headers()).doesNotContainKeys("Set-Cookie", "Location");
        assertThat(reply.json().propertyNames()).containsExactly("accessToken");

        UUID userId = jdbc.queryForObject("select id from users where email = ?", UUID.class, EMAIL);
        String token = reply.json().get("accessToken").asString();
        assertThat(SignedJWT.parse(token).getJWTClaimsSet().getSubject()).isEqualTo(userId.toString());
        assertThat(anyone.get(AccessProbeController.ME, "Authorization", "Bearer " + token).json()
                .get("userId").asString()).isEqualTo(userId.toString());
    }

    static Stream<Arguments> invalidInputs() {
        String longEmail = "a".repeat(255 - "@example.com".length()) + "@example.com";
        List<String> allRequired = List.of("email:REQUIRED", "password:REQUIRED", "displayName:REQUIRED");
        return Stream.of(
                argumentSet("모두 없다", "{}", allRequired),
                argumentSet("null과 빈 글자", "{\"email\":null,\"password\":\"\",\"displayName\":\"\"}", allRequired),
                argumentSet("공백류뿐", body(" \\t", PASSWORD, "\\u3000 "), List.of("email:REQUIRED", "displayName:REQUIRED")),
                argumentSet("형식", body("marker-signup", "password", "아낌\\u0007"),
                        List.of("email:INVALID_FORMAT", "password:INVALID_FORMAT", "displayName:INVALID_FORMAT")),
                argumentSet("길이", body(longEmail, "a1" + "가".repeat(71), "가".repeat(21)),
                        List.of("email:TOO_LONG", "password:TOO_LONG", "displayName:TOO_LONG")),
                argumentSet("정규화 전 512자를 넘는 비밀번호", body(EMAIL, "a1" + "x".repeat(511), NAME), List.of("password:TOO_LONG")),
                argumentSet("공백뿐인 비밀번호", body(EMAIL, "        ", NAME), List.of("password:INVALID_FORMAT")),
                argumentSet("짝 없는 서로게이트", body(EMAIL, PASSWORD + "\\uD800", NAME), List.of("password:INVALID_FORMAT")),
                argumentSet("형식이 틀리면 허용 목록 밖이어도 형식 오류만", body(OUTSIDER, "abc1234", NAME),
                        List.of("password:INVALID_FORMAT")),
                argumentSet("다른 형의 값", "{\"email\":true,\"password\":\"password1\",\"displayName\":\"아낌이\"}",
                        List.of("email:INVALID_FORMAT")),
                argumentSet("본문이 배열", "[]", List.of(":INVALID_FORMAT")));
    }

    @ParameterizedTest
    @MethodSource("invalidInputs")
    void 형식_오류는_입력란마다_이유를_모두_돌려주고_아무것도_만들지_않는다(String json, List<String> expected) throws Exception {
        long usersBefore = users();

        post(json).assertFieldErrors(expected.toArray(String[]::new));

        assertThat(users()).isEqualTo(usersBefore);
    }

    /** 허용 목록을 가입 여부보다 먼저 본다. 목록 밖의 이미 가입된 이메일(OUTSIDER)도 NOT_ALLOWED다. */
    @ParameterizedTest
    @ValueSource(strings = {OUTSIDER, "marker-sub@sub.example.com", "marker@example.com.example.org"})
    void 허용_목록_밖의_이메일은_가입_여부와_무관하게_NOT_ALLOWED이고_아무것도_만들지_않는다(String email) throws Exception {
        jdbc.update("insert into users (id, email, password_hash, display_name, created_at) values (?, ?, 'x', '먼저', now())",
                UUID.randomUUID(), OUTSIDER);
        long usersBefore = users();

        signup(email, PASSWORD, NAME).assertFieldErrors("email:NOT_ALLOWED");

        assertThat(users()).isEqualTo(usersBefore);
    }

    @Test
    void 이미_가입된_이메일은_대소문자와_앞뒤_공백이_달라도_DUPLICATE다() throws Exception {
        assertThat(signup(EMAIL, PASSWORD, NAME).status()).isEqualTo(201);

        signup(" MARKER-Signup@Example.COM ", "password2", "다른 사람").assertFieldErrors("email:DUPLICATE");
        // 형식이 하나라도 틀리면 가입 여부를 알리지 않는다.
        signup(EMAIL, "abc1234", " ").assertFieldErrors("password:INVALID_FORMAT", "displayName:REQUIRED");
        assertThat(jdbc.queryForObject("select count(*) from users where email = ?", Long.class, EMAIL)).isOne();
    }

    /** 동시 가입: 중복 확인을 지난 뒤 저장 직전에 트리거가 같은 이메일을 넣는다(#20의 유일 제약 경로). 앞의 중복 확인과 같은 응답이다. */
    @Test
    void 동시에_같은_이메일이_먼저_저장되어도_500이_아니라_같은_DUPLICATE다() throws Exception {
        jdbc.execute("""
                CREATE FUNCTION signup_race() RETURNS trigger LANGUAGE plpgsql AS $$
                BEGIN
                    INSERT INTO users (id, email, password_hash, display_name, created_at)
                    VALUES (gen_random_uuid(), NEW.email, NEW.password_hash, '먼저', now());
                    RETURN NEW;
                END $$""");
        Reply raced;
        try {
            jdbc.execute("CREATE TRIGGER signup_race BEFORE INSERT ON users FOR EACH ROW WHEN (NEW.display_name = '겹친 가입') "
                    + "EXECUTE FUNCTION signup_race()");
            raced = signup(EMAIL, PASSWORD, "겹친 가입");
        } finally {
            jdbc.execute("DROP FUNCTION signup_race() CASCADE");
        }
        raced.assertFieldErrors("email:DUPLICATE");
        // 진 가입과 함께 트리거가 넣은 행도 롤백됐다.
        assertThat(jdbc.queryForObject("select count(*) from users where email = ?", Long.class, EMAIL)).isZero();

        assertThat(signup(EMAIL, PASSWORD, NAME).status()).isEqualTo(201);
        assertThat(withoutRequestId(raced)).isEqualTo(withoutRequestId(signup(EMAIL, PASSWORD, "겹친 가입")));
    }

    @Test
    void 출처_전용_헤더_메서드_본문_형식_Accept는_가입보다_먼저_본다() throws Exception {
        String body = body(EMAIL, PASSWORD, NAME);
        anyone.send("POST", SIGNUP, body, "Content-Type", "application/json")
                .assertProblem(403, "Forbidden", "ORIGIN_NOT_ALLOWED");
        anyone.send("POST", SIGNUP, body, "Content-Type", "application/json", "X-Akkimpyo-Client", "web",
                "Origin", "https://evil.example").assertProblem(403, "Forbidden", "ORIGIN_NOT_ALLOWED");
        anyone.send("GET", SIGNUP, null, "X-Akkimpyo-Client", "web")
                .assertProblem(405, "Method Not Allowed", "METHOD_NOT_ALLOWED");
        anyone.send("POST", SIGNUP, body, "Content-Type", "text/plain", "X-Akkimpyo-Client", "web")
                .assertProblem(415, "Unsupported Media Type", "UNSUPPORTED_MEDIA_TYPE");
        post(body, "Accept", "text/html").assertProblem(400, "Bad Request", "MALFORMED_REQUEST");
        for (String malformed : List.of("", "null", "{", body + "{}")) {
            post(malformed).assertProblem(400, "Bad Request", "MALFORMED_REQUEST");
        }

        verify(userService, never()).createUser(any(), any(), any());
        assertThat(signup(EMAIL, PASSWORD, NAME, "Origin", HttpServerTest.ORIGIN).status()).isEqualTo(201);
    }

    @Test
    void 해시_자리가_없으면_429이고_1초_뒤에_다시_보내라고_알린다() throws Exception {
        doThrow(BeanUtils.instantiateClass(PasswordHashBusyException.class)).when(userService).createUser(any(), any(), any());

        assertThat(signup(EMAIL, PASSWORD, NAME).assertProblem(429, "Too Many Requests", "TOO_MANY_REQUESTS")
                .header("Retry-After")).isEqualTo("1");
    }

    @ParameterizedTest
    @ValueSource(strings = {SIGNUP + "/", SIGNUP + ".json", SIGNUP + "/x", "/api/v1/auth/Signup", "/api/v1/auth/signups",
            "/api/v1/signup"})
    void 비슷한_주소는_열리지_않는다(String path) throws Exception {
        anyone.send("POST", path, body(EMAIL, PASSWORD, NAME), "Content-Type", "application/json",
                "X-Akkimpyo-Client", "web").assertProblem(401, "Unauthorized", "UNAUTHENTICATED");
    }

    @Test
    void 비밀번호와_토큰과_이메일은_로그와_오류_응답에_없다() throws Exception {
        String secret = "marker-Secret1";
        OURS.setLevel(Level.TRACE);
        SPRING_WEB.setLevel(Level.TRACE);
        try (CapturedLogs logs = CapturedLogs.start()) {
            String token = signup(EMAIL, secret, NAME).json().get("accessToken").asString();
            Stream.of(signup(EMAIL, secret, NAME), signup(OUTSIDER, secret, NAME), signup("marker", secret, ""),
                            signup(EMAIL, secret.repeat(60), NAME), post(body(EMAIL, secret, NAME), "Accept", "text/html"),
                            anyone.send("POST", SIGNUP, body(EMAIL, secret, NAME), "Content-Type", "application/json"))
                    .forEach(reply -> {
                        assertThat(reply.status()).isGreaterThanOrEqualTo(400);
                        assertThat(reply.headers() + reply.body()).doesNotContainIgnoringCase("marker")
                                .doesNotContain("argon2id", "Exception");
                    });
            assertThat(logs.text()).contains("SignupRequest[", "AccessTokenResponse[", "가입: 사용자 ")
                    .doesNotContainIgnoringCase("marker").doesNotContain("argon2id", "eyJ", token);
        } finally {
            OURS.setLevel(null);
            SPRING_WEB.setLevel(null);
        }
        assertThat(new SignupRequest(EMAIL, PASSWORD, NAME)).hasToString("SignupRequest[]");
    }

    private Reply signup(String email, String password, String displayName, String... headers) throws Exception {
        return post(body(email, password, displayName), headers);
    }

    private Reply post(String body, String... headers) throws Exception {
        return anyone.send("POST", SIGNUP, body, Stream.concat(
                Stream.of("Content-Type", "application/json", "X-Akkimpyo-Client", "web"),
                Stream.of(headers)).toArray(String[]::new));
    }

    /** 값을 그대로 끼워 넣는다. JSON의 이스케이프는 부르는 쪽이 적는다. */
    private static String body(String email, String password, String displayName) {
        return "{\"email\":\"" + email + "\",\"password\":\"" + password + "\",\"displayName\":\"" + displayName + "\"}";
    }

    private long users() {
        return jdbc.queryForObject("select count(*) from users", Long.class);
    }

    private static String withoutRequestId(Reply reply) {
        return reply.body().replaceFirst("\"requestId\":\"[^\"]*\"", "");
    }
}
