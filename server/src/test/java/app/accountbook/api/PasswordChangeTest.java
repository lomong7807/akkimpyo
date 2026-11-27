package app.accountbook.api;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.params.provider.Arguments.argumentSet;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doAnswer;

import app.accountbook.api.ServerClient.Reply;
import app.accountbook.support.CapturedLogs;
import app.accountbook.support.StoppedClockConfig.StoppedClock;
import app.accountbook.user.UserService;
import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import java.text.Normalizer;
import java.time.Instant;
import java.util.ArrayList;
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
import org.springframework.transaction.support.TransactionSynchronizationManager;

/**
 * 비밀번호 바꾸기 API(#31, ADR 001 결정 3·5·7). 계열의 폐기는 그 쿠키로 갱신해 401인지로, 비밀번호는 로그인으로 본다.
 * 로그인과의 겹침은 auth의 PasswordChangeRaceTest가 본다.
 */
@AccessTest
class PasswordChangeTest {

    private static final Instant NOW = Instant.parse("2030-01-01T00:00:00Z");
    private static final String PATH = "/api/v1/auth/password";
    private static final String COOKIE = "__Secure-akkimpyo_refresh";
    private static final UUID USER_ID = UUID.fromString("6e7f8091-a2b3-4c4d-9e5f-6a7b8c9d0e1f");
    private static final String EMAIL = "marker-password-change@example.com";
    private static final UUID OTHER_ID = UUID.fromString("7f8091a2-b3c4-4d5e-8f6a-7b8c9d0e1f20");
    private static final String OTHER_EMAIL = "marker-password-change-other@example.com";
    private static final String PASSWORD = "password1";
    private static final String NEW_PASSWORD = "password2";
    private static final String INCORRECT = "currentPassword:INCORRECT";
    /** PASSWORD의 저장값(LoginTest와 같다). */
    private static final String STORED = "$argon2id$v=19$m=256,t=1,p=1$YWNjb3VudC1ib29rLXRzdA"
            + "$vHygWA0jNvBLxOELjrkU6R1OAPyuN/Ro9FrihcYD2KI";

    @LocalServerPort int port;
    @Autowired StoppedClock clock;
    @Autowired JdbcTemplate jdbc;
    @Autowired UserService userService;

    private ServerClient anyone;

    @BeforeEach
    void setUp() {
        clock.stopAt(NOW);
        anyone = ServerClient.anonymous(port);
        for (UUID id : List.of(USER_ID, OTHER_ID)) {
            jdbc.update("insert into users (id, email, password_hash, display_name, created_at) values (?, ?, ?, 'p', now())",
                    id, id.equals(USER_ID) ? EMAIL : OTHER_EMAIL, STORED);
        }
    }

    @AfterEach
    void deleteUsers() {
        for (String table : List.of("refresh_token where family_id in (select id from refresh_token_family where user_id",
                "refresh_token_family where (user_id", "users where (id")) {
            jdbc.update("delete from " + table + " in (?, ?))", USER_ID, OTHER_ID);
        }
    }

    /** 현재 비밀번호 확인과 새 해시는 트랜잭션 밖에서 한다(ADR 001 결정 7). */
    @Test
    void 바꾸면_204이고_지금_기기만_남고_다른_기기는_갱신할_수_없다() throws Exception {
        List<Boolean> inTransaction = new ArrayList<>();
        doAnswer(invocation -> {
            inTransaction.add(TransactionSynchronizationManager.isActualTransactionActive());
            return invocation.callRealMethod();
        }).when(userService).checkPasswordChange(any(), any(), any());
        Session here = login(EMAIL, PASSWORD);
        Session there = login(EMAIL, PASSWORD);

        Reply reply = change(here, here.cookie(), body(PASSWORD, NEW_PASSWORD));

        assertThat(reply.status()).as(reply.body()).isEqualTo(204);
        assertThat(inTransaction).containsExactly(false);
        assertThat(reply.body()).isEmpty();
        assertThat(reply.headers()).as("지금 계열을 그대로 쓰므로 쿠키를 새로 굽지 않는다").doesNotContainKey("Set-Cookie");
        assertThat(refresh(here.cookie()).status()).isEqualTo(200);
        refresh(there.cookie()).assertProblem(401, "Unauthorized", "UNAUTHENTICATED");
        assertThat(anyone.get("/api/v1/me", "Authorization", there.bearer()).status())
                .as("이미 나간 access token은 만료까지 둔다(ADR 001)").isEqualTo(200);
        loginReply(EMAIL, PASSWORD).assertProblem(401, "Unauthorized", "INVALID_CREDENTIALS");
        login(EMAIL, NEW_PASSWORD);
    }

    /** 다른 사용자의 계열은 어느 경우에도 건드리지 않는다. */
    @ParameterizedTest
    @ValueSource(strings = {"none", "unknown", "revoked", "rotated", "otherUser"})
    void 쿠키가_없거나_쓸_수_없는_계열이면_지금_기기도_폐기하고_204다(String sent) throws Exception {
        Session here = login(EMAIL, PASSWORD);
        Session there = login(EMAIL, PASSWORD);
        Session other = login(OTHER_EMAIL, PASSWORD);
        String current = here.cookie();
        String cookie = switch (sent) {
            case "none" -> null;
            case "unknown" -> "A".repeat(43);
            case "revoked" -> {
                Session gone = login(EMAIL, PASSWORD);
                assertThat(anyone.send("POST", "/api/v1/auth/logout", null, "X-Akkimpyo-Client", "web",
                        "Cookie", COOKIE + "=" + gone.cookie()).status()).isEqualTo(204);
                yield gone.cookie();
            }
            case "rotated" -> {
                current = cookie(refresh(here.cookie()));
                clock.stopAt(NOW.plusSeconds(11)); // 회전 직후 허용 시간(10초) 밖
                yield here.cookie();
            }
            default -> other.cookie();
        };

        assertThat(change(here, cookie, body(PASSWORD, NEW_PASSWORD)).status()).isEqualTo(204);

        refresh(current).assertProblem(401, "Unauthorized", "UNAUTHENTICATED");
        refresh(there.cookie()).assertProblem(401, "Unauthorized", "UNAUTHENTICATED");
        assertThat(refresh(other.cookie()).status()).isEqualTo(200);
    }

    static Stream<Arguments> invalidInputs() {
        return Stream.of(
                // 401이 아니다. 화면이 access token 만료로 보고 갱신하거나 로그아웃하지 않게 한다.
                argumentSet("틀린 현재 비밀번호", body(NEW_PASSWORD, NEW_PASSWORD), List.of(INCORRECT)),
                // 어떤 저장값과도 맞을 수 없어 해시하지 않는다.
                argumentSet("현재: 정규화한 뒤 72자를 넘는다", body("a1".repeat(37), NEW_PASSWORD), List.of(INCORRECT)),
                argumentSet("현재: 정규화 전에 512자를 넘는다", body(PASSWORD.repeat(57), NEW_PASSWORD), List.of(INCORRECT)),
                argumentSet("현재: 짝 없는 서로게이트", body(PASSWORD + "\\uD800", NEW_PASSWORD), List.of(INCORRECT)),
                argumentSet("둘 다 없다", "{}", List.of("currentPassword:REQUIRED", "newPassword:REQUIRED")),
                argumentSet("8자보다 짧다", body(PASSWORD, "pass123"), List.of("newPassword:INVALID_FORMAT")),
                argumentSet("정규화한 뒤 72자를 넘는다", body(PASSWORD, "a1".repeat(37)), List.of("newPassword:TOO_LONG")),
                argumentSet("정규화 전에 512자를 넘는다", body(PASSWORD, "a1".repeat(257)), List.of("newPassword:TOO_LONG")),
                // 해시보다 싼 검사를 먼저 한다(ADR 001 결정 7). 현재 비밀번호는 새 비밀번호의 형식이 맞을 때만 비교한다.
                argumentSet("현재 비밀번호도 틀렸다", body(NEW_PASSWORD, "short"), List.of("newPassword:INVALID_FORMAT")));
    }

    @ParameterizedTest
    @MethodSource("invalidInputs")
    void 입력이_규칙에_맞지_않거나_현재_비밀번호가_틀리면_400이고_아무것도_바꾸지_않는다(String body, List<String> errors) throws Exception {
        Session here = login(EMAIL, PASSWORD);
        Session there = login(EMAIL, PASSWORD);

        change(here, here.cookie(), body).assertFieldErrors(errors.toArray(String[]::new));

        assertUnchanged(there);
    }

    /** 가입과 로그인과 같은 정규화(NFKC)를 현재 비밀번호와 새 비밀번호 모두에 쓴다(ADR 001 결정 7). */
    @Test
    void 분해형이나_전각으로_넣은_비밀번호는_조합형이나_반각으로_맞는다() throws Exception {
        Session here = login(EMAIL, PASSWORD);
        String hangul = "한글암호abc1";

        assertThat(change(here, here.cookie(), body("ｐａｓｓｗｏｒｄ１", Normalizer.normalize(hangul, Normalizer.Form.NFD)))
                .status()).isEqualTo(204);
        Session again = login(EMAIL, hangul);
        assertThat(change(again, again.cookie(), body(hangul, "ｐａｓｓ２ｗｏｒｄ")).status()).isEqualTo(204);

        login(EMAIL, "pass2word");
    }

    /** access token이 없거나 틀리면 401, 전용 헤더가 없거나 다른 출처면 403이다(ADR 001 결정 5). */
    @ParameterizedTest
    @ValueSource(strings = {"no token", "bad token", "no client header", "other origin"})
    void 거부된_요청은_아무것도_바꾸지_않는다(String rejected) throws Exception {
        Session here = login(EMAIL, PASSWORD);
        String body = body(PASSWORD, NEW_PASSWORD);

        Reply reply = switch (rejected) {
            case "no token" -> change(new Session(here.cookie(), ""), here.cookie(), body);
            case "bad token" -> change(new Session(here.cookie(), "Bearer x"), here.cookie(), body);
            case "no client header" -> anyone.send("POST", PATH, body, "Content-Type", "application/json",
                    "Authorization", here.bearer());
            default -> change(here, here.cookie(), body, "Origin", "https://other.example.com");
        };

        if (rejected.endsWith("token")) {
            reply.assertProblem(401, "Unauthorized", "UNAUTHENTICATED");
        } else {
            reply.assertProblem(403, "Forbidden", "ORIGIN_NOT_ALLOWED");
        }
        assertUnchanged(here);
    }

    /** 표식은 전각이라 NFKC로 맞추면 반각이 된다. 입력한 값과 맞춘 값 모두 로그와 응답에 없어야 한다. */
    @Test
    void 비밀번호는_로그와_응답에_없다() throws Exception {
        String wrong = "ｗｒｏｎｇｍａｒｋ１";
        String invalid = "ｆｒｅｓｈｍａｒｋ"; // 숫자가 없다. 바꾸는 값(fresh)의 앞부분이라 그것도 함께 본다.
        String fresh = invalid + "１";
        Logger ours = (Logger) LoggerFactory.getLogger("app.accountbook");
        ours.setLevel(Level.TRACE);
        List<String> replies = new ArrayList<>();
        try (CapturedLogs logs = CapturedLogs.start()) {
            Session here = login(EMAIL, PASSWORD);
            replies.add(change(here, here.cookie(), body(wrong, fresh)).assertFieldErrors("currentPassword:INCORRECT")
                    .body());
            replies.add(change(here, here.cookie(), body(PASSWORD, invalid))
                    .assertFieldErrors("newPassword:INVALID_FORMAT").body());
            Reply changed = change(here, here.cookie(), body(PASSWORD, fresh));
            assertThat(changed.status()).isEqualTo(204);
            replies.add(changed.body());

            List<String> secrets = Stream.of(wrong, invalid)
                    .flatMap(secret -> Stream.of(secret, Normalizer.normalize(secret, Normalizer.Form.NFKC)))
                    .toList();
            assertThat(logs.text()).doesNotContain(secrets);
            assertThat(String.join("\n", replies)).doesNotContain(secrets);
        } finally {
            ours.setLevel(null);
        }
    }

    /** 다른 기기의 계열이 남고 비밀번호가 그대로다. */
    private void assertUnchanged(Session there) throws Exception {
        assertThat(refresh(there.cookie()).status()).isEqualTo(200);
        loginReply(EMAIL, NEW_PASSWORD).assertProblem(401, "Unauthorized", "INVALID_CREDENTIALS");
        login(EMAIL, PASSWORD);
    }

    /** 한 기기의 로그인: refresh 쿠키 값과 Authorization 헤더 값. */
    private record Session(String cookie, String bearer) {
    }

    private Session login(String email, String password) throws Exception {
        Reply reply = loginReply(email, password);
        return new Session(cookie(reply), "Bearer " + reply.json().get("accessToken").asString());
    }

    private Reply loginReply(String email, String password) throws Exception {
        return anyone.send("POST", "/api/v1/auth/login", "{\"email\":\"" + email + "\",\"password\":\"" + password + "\"}",
                "Content-Type", "application/json", "X-Akkimpyo-Client", "web");
    }

    private Reply refresh(String cookie) throws Exception {
        return anyone.send("POST", "/api/v1/auth/refresh", null, "X-Akkimpyo-Client", "web", "Cookie", COOKIE + "=" + cookie);
    }

    /** @param cookie 보낼 refresh 쿠키 값. null이면 쿠키 없이 보낸다 */
    private Reply change(Session session, String cookie, String body, String... more) throws Exception {
        List<String> headers = new ArrayList<>(List.of("Content-Type", "application/json", "X-Akkimpyo-Client", "web"));
        headers.addAll(session.bearer().isEmpty() ? List.of() : List.of("Authorization", session.bearer()));
        headers.addAll(cookie == null ? List.of() : List.of("Cookie", COOKIE + "=" + cookie));
        headers.addAll(List.of(more));
        return anyone.send("POST", PATH, body, headers.toArray(String[]::new));
    }

    private static String body(String current, String next) {
        return "{\"currentPassword\":\"" + current + "\",\"newPassword\":\"" + next + "\"}";
    }

    /** 응답이 준 refresh 쿠키의 값. */
    private static String cookie(Reply reply) {
        assertThat(reply.status()).as(reply.body()).isEqualTo(200);
        return reply.header("Set-Cookie").split(";", 2)[0].substring(COOKIE.length() + 1);
    }
}
