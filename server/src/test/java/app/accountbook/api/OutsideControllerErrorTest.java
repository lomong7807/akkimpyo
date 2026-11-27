package app.accountbook.api;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.params.provider.Arguments.argumentSet;

import app.accountbook.api.ServerClient.Reply;
import app.accountbook.support.CapturedLogs;
import ch.qos.logback.classic.Level;
import java.io.IOException;
import java.util.stream.Stream;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.boot.test.web.server.LocalServerPort;

/** 컨트롤러에 닿지 못한 요청의 오류도 같은 모양이다: 없는 경로, 필터의 예외, Tomcat이 직접 거절한 요청(ADR 002 7절). */
@ApiErrorTest
class OutsideControllerErrorTest {

    private static final String HOST = "Host: localhost\r\nConnection: close\r\n";

    @LocalServerPort int port;

    private ServerClient server;

    @BeforeEach
    void setUp() {
        server = new ServerClient(port);
    }

    // --- 없는 경로 ---

    @ParameterizedTest
    @ValueSource(strings = {"GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"})
    void 없는_경로는_메서드와_무관하게_404다(String method) throws Exception {
        server.send(method, "/api/v1/nope", null).assertProblem(404, "Not Found", "NOT_FOUND");
    }

    @ParameterizedTest
    @ValueSource(strings = {"/", "/favicon.ico", "/index.html", "/error", "/error/x", "/actuator/env"})
    void 열려_있지_않은_경로는_404다(String path) throws Exception {
        server.get(path, "Accept", "text/html").assertProblem(404, "Not Found", "NOT_FOUND");
    }

    @Test
    void HEAD는_본문_없이_상태만_같다() throws Exception {
        Reply reply = server.send("HEAD", "/nope", null);

        assertThat(reply.status()).isEqualTo(404);
        assertThat(reply.header("Content-Type")).isEqualTo("application/problem+json");
        assertThat(reply.body()).isEmpty();
    }

    // --- 필터의 예외 ---

    @ParameterizedTest
    @ValueSource(strings = {ThrowingFilter.THROW, ThrowingFilter.THROW_ERROR})
    void 필터에서_난_예외도_고정_문구의_500이다(String path) throws Exception {
        for (String accept : new String[] {"*/*", "text/html"}) {
            Reply reply = server.get(path, "Accept", accept)
                    .assertProblem(500, "Internal Server Error", "INTERNAL_ERROR");
            assertThat(reply.body()).doesNotContain(ThrowingFilter.MESSAGE, "IllegalState", "Assertion");
        }
    }

    @Test
    void 응답을_보내기_시작한_뒤의_필터_예외는_오류를_덧붙이지_않고_연결을_끊는다() throws Exception {
        String received = server.raw("GET " + ThrowingFilter.THROW_AFTER_FLUSH + " HTTP/1.1\r\n" + HOST + "\r\n");

        assertThat(received).startsWith("HTTP/1.1 200").doesNotContain("problem", "INTERNAL_ERROR", "Exception");
        // 조각 전송의 끝 표시가 없으므로 클라이언트는 응답이 잘린 것을 안다.
        assertThat(received).doesNotEndWith("0\r\n\r\n");
    }

    @Test
    void 필터가_읽은_쿼리의_인코딩이_깨졌으면_500이_아니라_읽을_수_없는_요청이다() throws Exception {
        server.rawReply("GET " + ThrowingFilter.READ_PARAMETER + "?token=%zz HTTP/1.1\r\n" + HOST + "\r\n")
                .assertProblem(400, "Bad Request", "MALFORMED_REQUEST");
    }

    @ParameterizedTest
    @ValueSource(strings = {"PUT", "PATCH", "DELETE"})
    void 깨진_폼_본문도_500이_아니다(String method) throws Exception {
        server.send(method, ErrorProbeController.PATH + "/body", "a=%zz",
                        "Content-Type", "application/x-www-form-urlencoded")
                .assertProblem(405, "Method Not Allowed", "METHOD_NOT_ALLOWED");
    }

    // --- 본문을 다 보내지 않은 요청 ---

    @Test
    void 본문을_보내다_멈춘_요청은_다시_보낼_수_있게_500이고_요청_id와_함께_남는다() throws Exception {
        try (CapturedLogs logs = CapturedLogs.start()) {
            Reply reply = server.rawReply("POST " + ErrorProbeController.PATH + "/body HTTP/1.1\r\n" + HOST
                    + server.authorizationLine()
                    + "X-Request-Id: stalled-1\r\nContent-Type: application/json\r\nContent-Length: 50\r\n\r\n"
                    + "{\"name\":\"marker");

            // code가 있는 4xx로 답하면 화면이 다시 보내지 않는다(ADR 006 결정 6).
            reply.assertProblem(500, "Internal Server Error", "INTERNAL_ERROR");
            assertThat(reply.header("X-Request-Id")).isEqualTo("stalled-1");
            assertThat(logs.events().stream()
                    .filter(event -> "stalled-1".equals(event.getMDCPropertyMap().get("requestId"))))
                    .singleElement()
                    .satisfies(event -> assertThat(event.getLevel()).isEqualTo(Level.WARN));
            assertThat(logs.text()).doesNotContain("marker");
        }
    }

    // --- Tomcat이 직접 거절한 요청 ---

    static Stream<Arguments> rejectedByTomcat() {
        return Stream.of(
                argumentSet("요청 줄에 쓸 수 없는 글자", "GET /marker|x HTTP/1.1\r\n" + HOST + "\r\n"),
                argumentSet("없는 메서드 글자", "G(T /marker HTTP/1.1\r\n" + HOST + "\r\n"),
                argumentSet("깨진 경로 인코딩", "GET /marker/%zz HTTP/1.1\r\n" + HOST + "\r\n"),
                argumentSet("인코딩한 빗금", "GET /marker%2Fx HTTP/1.1\r\n" + HOST + "\r\n"),
                argumentSet("경로의 NUL", "GET /marker%00 HTTP/1.1\r\n" + HOST + "\r\n"),
                argumentSet("뿌리를 벗어나는 경로", "GET /../marker HTTP/1.1\r\n" + HOST + "\r\n"),
                argumentSet("깨진 헤더 이름", "GET / HTTP/1.1\r\n" + HOST + "X Marker: marker\r\n\r\n"),
                argumentSet("콜론 없는 헤더", "GET / HTTP/1.1\r\n" + HOST + "marker\r\n\r\n"),
                argumentSet("Host가 없다", "GET /marker HTTP/1.1\r\nConnection: close\r\n\r\n"),
                argumentSet("Host가 깨졌다", "GET /marker HTTP/1.1\r\nHost: mar ker\r\nConnection: close\r\n\r\n"),
                argumentSet("Content-Length가 수가 아니다",
                        "POST /marker HTTP/1.1\r\n" + HOST + "Content-Length: marker\r\n\r\n"),
                argumentSet("Content-Length가 둘",
                        "POST /marker HTTP/1.1\r\n" + HOST + "Content-Length: 1\r\nContent-Length: 2\r\n\r\n"),
                argumentSet("헤더가 너무 크다",
                        "GET / HTTP/1.1\r\n" + HOST + "X-Marker: " + "marker".repeat(3000) + "\r\n\r\n"),
                argumentSet("모르는 HTTP 버전", "GET /marker HTTP/9.9\r\n" + HOST + "\r\n"),
                argumentSet("모르는 전송 방식",
                        "POST /marker HTTP/1.1\r\n" + HOST + "Transfer-Encoding: marker\r\n\r\n"),
                argumentSet("모르는 기대", "POST /marker HTTP/1.1\r\n" + HOST + "Expect: marker\r\n\r\n"));
    }

    @ParameterizedTest
    @MethodSource("rejectedByTomcat")
    void Tomcat이_거절한_요청도_HTML이_아니라_같은_모양이다(String request) throws Exception {
        Reply reply = server.rawReply(request).assertProblem(400, "Bad Request", "MALFORMED_REQUEST");

        assertThat(reply.json().get("detail").asString()).isEqualTo("요청을 읽을 수 없다");
        assertThat(reply.body()).doesNotContainIgnoringCase("marker").doesNotContainIgnoringCase("tomcat");
        assertThat(reply.headers()).doesNotContainKey("Server");
    }

    @Test
    void TRACE는_요청을_되비추지_않는다() throws Exception {
        Reply reply = server.rawReply("TRACE /marker HTTP/1.1\r\n" + HOST + "X-Marker: marker\r\n\r\n")
                .assertProblem(405, "Method Not Allowed", "METHOD_NOT_ALLOWED");

        assertThat(reply.body()).doesNotContainIgnoringCase("marker");
    }

    @ParameterizedTest
    @ValueSource(strings = {"\u0016\u0003\u0001\u0002\u0000\r\n\r\n", "PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n"})
    void HTTP_1_1이_아닌_요청에도_HTML을_주지_않는다(String request) throws IOException {
        assertThat(server.raw(request)).doesNotContainIgnoringCase("<html").doesNotContainIgnoringCase("tomcat");
    }
}
