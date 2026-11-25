package app.accountbook.api;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.params.provider.Arguments.argumentSet;

import app.accountbook.api.ServerClient.Reply;
import app.accountbook.common.NotFoundException;
import java.util.List;
import java.util.stream.Stream;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.web.server.LocalServerPort;

/** 컨트롤러까지 온 요청의 오류가 ADR 002 4·5절의 모양으로 나간다(#12). 입력란과 서비스 예외는 InputErrorTest가 본다. */
@ApiErrorTest
class ControllerErrorTest {

    private static final String BODY = ErrorProbeController.PATH + "/body";
    private static final String QUERY = ErrorProbeController.PATH + "/query";
    private static final String THROW = ErrorProbeController.PATH + "/throw";

    @LocalServerPort int port;
    @Autowired ErrorProbeController probe;

    private ServerClient server;

    @BeforeEach
    void setUp() {
        server = new ServerClient(port);
    }

    @Test
    void 맞는_본문은_그대로_받는다() throws Exception {
        Reply reply = server.postJson(BODY, """
                {"name":"이름","amount":100,"email":"a@b.example","code":"ab","occurredOn":"2026-11-26","kind":"A",
                 "lines":[{"amount":1}],"없는필드":1}
                """);

        assertThat(reply.status()).isEqualTo(200);
        assertThat(reply.json().get("value").asString()).isEqualTo("이름");
    }

    // --- 400 MALFORMED_REQUEST ---

    @ParameterizedTest
    @ValueSource(strings = {"", "{", "{\"name\":\"a\"", "{\"name\":tru}", "{\"amount\":12x}", "{'name':'a'}",
            "{\"lines\":[{\"amount\":1}", "{\"lines\":[{\"amount\":}]}", "not json", "{\"name\":\"a\u0001\"}",
            "{\"name\":\"a\",\"amount\":1}{}", "{\"name\":\"a\",\"amount\":1} 1", "{\"name\":\"a\",\"amount\":1} null"})
    void 본문을_JSON으로_읽을_수_없으면_문구가_고정이다(String body) throws Exception {
        Reply reply = server.postJson(BODY, body).assertProblem(400, "Bad Request", "MALFORMED_REQUEST");

        assertThat(reply.json().get("detail").asString()).isEqualTo("요청을 읽을 수 없다");
    }

    @ParameterizedTest
    @ValueSource(strings = {"?version=%zz", "?version=1&limit=%F"})
    void 쿼리의_인코딩이_깨지면_읽을_수_없는_요청이다(String query) throws Exception {
        server.rawReply("GET " + QUERY + query + " HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n\r\n")
                .assertProblem(400, "Bad Request", "MALFORMED_REQUEST");
    }

    // --- 405, 415 ---

    @Test
    void 받지_않는_메서드는_405이고_받는_메서드를_알린다() throws Exception {
        Reply reply = server.send("DELETE", BODY, null).assertProblem(405, "Method Not Allowed", "METHOD_NOT_ALLOWED");

        assertThat(reply.header("Allow")).isEqualTo("POST");
    }

    @Test
    void HTTP에_없는_메서드도_405다() throws Exception {
        server.send("MARKER", BODY, null).assertProblem(405, "Method Not Allowed", "METHOD_NOT_ALLOWED");
    }

    @ParameterizedTest
    @ValueSource(strings = {"text/plain", "application/xml", "application/x-www-form-urlencoded", "garbage",
            "multipart/form-data", "multipart/form-data; boundary=x", "application/json;charset=marker"})
    void JSON이_아닌_본문은_415다(String contentType) throws Exception {
        server.send("POST", BODY, "{}", "Content-Type", contentType)
                .assertProblem(415, "Unsupported Media Type", "UNSUPPORTED_MEDIA_TYPE");
    }

    @Test
    void Content_Type이_없는_본문은_415다() throws Exception {
        server.send("POST", BODY, "{}").assertProblem(415, "Unsupported Media Type", "UNSUPPORTED_MEDIA_TYPE");
    }

    // --- 500 INTERNAL_ERROR ---

    static Stream<Arguments> unexpected() {
        return Stream.of(
                argumentSet("예외", new IllegalStateException("비밀 문구")),
                argumentSet("검사 예외", new Exception("비밀 문구")),
                argumentSet("Error", new StackOverflowError("비밀 문구")),
                argumentSet("원인이 입력 오류인 예외",
                        new IllegalStateException("비밀 문구", new NotFoundException())));
    }

    @ParameterizedTest
    @MethodSource("unexpected")
    void 예상하지_못한_오류는_고정_문구의_500이다(Throwable throwable) throws Exception {
        probe.willThrow(throwable);

        Reply reply = server.get(THROW).assertProblem(500, "Internal Server Error", "INTERNAL_ERROR");

        assertThat(reply.json().get("detail").asString()).isEqualTo("서버에서 오류가 났다");
        assertThat(reply.body()).doesNotContain("비밀 문구", "Exception", "StackOverflow", "app.accountbook", "\tat ");
    }

    @Test
    void 변환되지_않은_DB_제약_위반의_문구는_응답에_나가지_않는다() throws Exception {
        Reply reply = server.postJson(ErrorProbeController.PATH + "/db-violation",
                        "{\"name\":\"marker-hash\",\"email\":\"Marker@Example.com\"}")
                .assertProblem(500, "Internal Server Error", "INTERNAL_ERROR");

        assertThat(reply.body()).doesNotContainIgnoringCase("marker").doesNotContain("users", "ck_", "constraint");
    }

    @Test
    void 응답을_보내기_시작한_뒤의_실패는_오류를_덧붙이지_않고_연결을_끊는다() throws Exception {
        String received = server.raw("GET " + ErrorProbeController.PATH + "/fail-after-flush HTTP/1.1\r\n"
                + "Host: localhost\r\nConnection: close\r\n\r\n");

        assertThat(received).startsWith("HTTP/1.1 200").contains("partial")
                .doesNotContain("problem", "INTERNAL_ERROR", "보낸 뒤의 실패");
        // 조각 전송의 끝 표시가 없으므로 받는 쪽은 응답이 잘린 것을 안다.
        assertThat(received).doesNotEndWith("0\r\n\r\n");
    }

    // --- 응답 형식은 Accept와 무관하다 ---

    @ParameterizedTest
    @ValueSource(strings = {"text/html", "application/json", "image/png", "garbage"})
    void 오류는_Accept와_무관하게_problem_json이다(String accept) throws Exception {
        server.send("POST", BODY, "{", "Content-Type", "application/json", "Accept", accept)
                .assertProblem(400, "Bad Request", "MALFORMED_REQUEST");
        server.get("/nope", "Accept", accept).assertProblem(404, "Not Found", "NOT_FOUND");
        probe.willThrow(new IllegalStateException());
        server.get(THROW, "Accept", accept).assertProblem(500, "Internal Server Error", "INTERNAL_ERROR");
    }

    @ParameterizedTest
    @ValueSource(strings = {"image/png", "garbage"})
    void 줄_수_없는_형식을_달라는_요청은_읽을_수_없는_요청이다(String accept) throws Exception {
        server.get(ErrorProbeController.PATH + "/ok", "Accept", accept)
                .assertProblem(400, "Bad Request", "MALFORMED_REQUEST");
    }

    // --- 오류 응답에 요청 값이 없다 ---

    @Test
    void 오류_응답에_요청으로_받은_값이_없다() throws Exception {
        List<Reply> replies = List.of(
                server.postJson(BODY,
                        "{\"name\":\"marker-long\",\"amount\":0,\"email\":\"marker\",\"code\":\"MARKER\"}"),
                server.postJson(BODY, "{\"name\":\"a\",\"amount\":\"marker\"}"),
                server.postJson(BODY, "{\"name\":\"a\",\"amount\":1,\"kind\":\"marker\",\"marker\":1}"),
                server.postJson(BODY, "{\"marker\":marker}"),
                server.postJson(ErrorProbeController.PATH + "/fail-with-value", "{\"name\":\"marker\"}"),
                server.get(QUERY + "?version=marker"),
                server.get(QUERY + "?version=1&cursor=marker&marker=1"),
                server.get("/marker/marker?marker=marker"),
                server.get(ErrorProbeController.PATH + "/ledgers/marker"),
                server.get(ErrorProbeController.PATH + "/ok", "Accept", "marker/marker"),
                server.send("MARKER", BODY, null),
                server.send("POST", BODY, "marker", "Content-Type", "marker/marker"));

        assertThat(replies).allSatisfy(reply -> {
            assertThat(reply.status()).isGreaterThanOrEqualTo(400);
            assertThat(reply.body()).doesNotContainIgnoringCase("marker");
            assertThat(reply.headers().toString()).doesNotContainIgnoringCase("marker");
        });
    }
}
