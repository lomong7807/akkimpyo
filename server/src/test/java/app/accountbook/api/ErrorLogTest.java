package app.accountbook.api;

import static java.nio.charset.StandardCharsets.UTF_8;
import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.params.provider.Arguments.argumentSet;

import app.accountbook.api.ServerClient.Reply;
import app.accountbook.support.CapturedLogs;
import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.classic.spi.ThrowableProxyUtil;
import jakarta.servlet.ServletOutputStream;
import jakarta.servlet.WriteListener;
import java.io.IOException;
import java.util.List;
import java.util.stream.Stream;
import org.apache.catalina.connector.ClientAbortException;
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
import org.springframework.http.converter.HttpMessageNotWritableException;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.web.servlet.DispatcherServlet;

/**
 * 오류를 처리하면서 남기는 로그에 요청 값(비밀번호, 이메일을 흉내 낸 표식)이 없고, 500은 요청 id와 함께 한 번 남는다(#12).
 * 우리 코드의 로그는 TRACE까지, 프레임워크와 Tomcat의 로그는 운영과 같은 기본 수준으로 모아서 본다.
 */
@ApiErrorTest
class ErrorLogTest {

    private static final String PASSWORD = "marker-password-7";
    private static final String EMAIL = "marker-email-7";

    private static final String BODY = ErrorProbeController.PATH + "/body";
    private static final String QUERY = ErrorProbeController.PATH + "/query";
    private static final String THROW = ErrorProbeController.PATH + "/throw";
    private static final String HOST = "Host: localhost\r\nConnection: close\r\n";

    private static final Logger OURS = (Logger) LoggerFactory.getLogger("app.accountbook");

    @LocalServerPort int port;
    @Autowired ErrorProbeController probe;
    @Autowired DispatcherServlet dispatcherServlet;

    private ServerClient server;
    private CapturedLogs logs;

    @BeforeEach
    void setUp() {
        server = new ServerClient(port);
        OURS.setLevel(Level.TRACE);
        logs = CapturedLogs.start();
        OURS.trace("로그 수집 확인");
    }

    @AfterEach
    void tearDown() {
        logs.close();
        OURS.setLevel(null);
    }

    // --- 요청 값이 로그에 없다 ---

    static Stream<Arguments> bodiesWithValues() {
        return Stream.of(
                argumentSet("검증 실패의 거절된 값",
                        "{\"name\":\"" + PASSWORD + "\",\"amount\":0,\"email\":\"" + EMAIL + "\"}"),
                argumentSet("형이 틀린 값", "{\"name\":\"a\",\"amount\":\"" + PASSWORD + "\"}"),
                argumentSet("정해진 값이 아닌 값", "{\"name\":\"a\",\"amount\":1,\"kind\":\"" + PASSWORD + "\"}"),
                argumentSet("모르는 필드의 값", "{\"" + EMAIL + "\":\"" + PASSWORD + "\"}"),
                argumentSet("JSON이 아닌 본문", PASSWORD + " " + EMAIL),
                argumentSet("깨진 JSON", "{\"name\":\"" + PASSWORD + "\",\"email\":" + EMAIL + "}"));
    }

    @ParameterizedTest
    @MethodSource("bodiesWithValues")
    void 본문의_값이_로그에_없다(String json) throws Exception {
        Reply reply = server.postJson(BODY, json);

        assertThat(reply.status()).isEqualTo(400);
        assertNoValuesInLogs();
    }

    @Test
    void 경로와_쿼리와_헤더의_값이_로그에_없다() throws Exception {
        server.get("/" + EMAIL + "?token=" + PASSWORD);
        server.get(ErrorProbeController.PATH + "/ledgers/" + PASSWORD);
        server.get(QUERY + "?version=" + PASSWORD);
        server.get(QUERY + "?version=1&limit=101&cursor=" + PASSWORD);
        server.rawReply("GET " + QUERY + "?version=" + PASSWORD + "%zz HTTP/1.1\r\n" + HOST + "\r\n");
        server.rawReply("GET " + ThrowingFilter.READ_PARAMETER + "?token=" + PASSWORD + "%zz HTTP/1.1\r\n" + HOST
                + "\r\n");
        server.send(PASSWORD.toUpperCase(), BODY, null);
        server.send("POST", BODY, PASSWORD, "Content-Type", PASSWORD + "/" + EMAIL);
        server.get(ErrorProbeController.PATH + "/ok", "Accept", PASSWORD);
        server.send("POST", BODY, "a=" + PASSWORD + "%zz", "Content-Type", "application/x-www-form-urlencoded");
        server.send("PUT", BODY, "a=" + PASSWORD + "%zz", "Content-Type", "application/x-www-form-urlencoded");
        server.send("POST", BODY, PASSWORD, "Content-Type", "multipart/form-data");

        assertNoValuesInLogs();
    }

    @ParameterizedTest
    @ValueSource(strings = {
            "GET /invite/" + PASSWORD + "| HTTP/1.1\r\n" + HOST + "\r\n",
            "GET /x?token=" + PASSWORD + "%zz| HTTP/1.1\r\n" + HOST + "\r\n",
            "GET /" + PASSWORD + "/%zz HTTP/1.1\r\n" + HOST + "\r\n",
            "GET / HTTP/1.1\r\n" + HOST + "Authorization Bearer " + PASSWORD + "\r\n\r\n",
            "GET / HTTP/1.1\r\n" + HOST + "Authorization : Bearer " + PASSWORD + "\r\n\r\n",
            "GET / HTTP/1.1\r\n" + HOST + "Cookie: a=" + PASSWORD + "\u0001\r\n\r\n",
            "POST / HTTP/1.1\r\n" + HOST + "Content-Length: " + PASSWORD + "\r\n\r\n",
            "GET / HTTP/1.1\r\nHost: " + PASSWORD + "_ {}\r\nConnection: close\r\n\r\n"})
    void Tomcat이_거절한_요청의_값이_로그에_없다(String request) throws Exception {
        server.rawReply(request).assertProblem(400, "Bad Request", "MALFORMED_REQUEST");

        assertNoValuesInLogs();
    }

    @Test
    void DB_제약_위반의_값이_로그에_없고_제약_이름으로_원인을_찾을_수_있다() throws Exception {
        server.postJson(ErrorProbeController.PATH + "/db-violation",
                        "{\"name\":\"" + PASSWORD + "\",\"email\":\"" + EMAIL.toUpperCase() + "\"}")
                .assertProblem(500, "Internal Server Error", "INTERNAL_ERROR");

        assertThat(atLeast(Level.ERROR)).singleElement()
                .satisfies(event -> assertThat(event.getThrowableProxy()).isNotNull());
        assertThat(logs.text()).contains("DataIntegrityViolationException", "ck_users_email");
        assertNoValuesInLogs();
    }

    @Test
    void 오류_응답을_보내다_연결이_끊겨도_요청_값이_로그에_없다() throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest("POST", BODY);
        request.setContentType("application/json");
        request.setContent(("{\"name\":\"" + PASSWORD + "\",\"amount\":\"" + EMAIL + "\"}").getBytes(UTF_8));

        dispatcherServlet.service(request, new DisconnectedResponse());

        // 응답을 쓰다 실패해도 스프링의 기본 처리기(거절된 값을 남긴다)로 넘어가지 않는다.
        assertThat(logs.text()).contains("HttpMessageNotReadableException");
        assertNoValuesInLogs();
    }

    // --- 500은 요청 id와 함께 한 번 ---

    @Test
    void 컨트롤러의_500은_요청_id와_함께_ERROR로_한_번_남는다() throws Exception {
        probe.willThrow(new IllegalStateException("원인 문구"));

        server.get(THROW, "X-Request-Id", "log-once-1").assertProblem(500, "Internal Server Error", "INTERNAL_ERROR");

        assertLoggedOnce("log-once-1", "원인 문구");
    }

    @ParameterizedTest
    @ValueSource(strings = {ThrowingFilter.THROW, ThrowingFilter.THROW_ERROR})
    void 필터의_500도_요청_id와_함께_ERROR로_한_번_남는다(String path) throws Exception {
        server.get(path, "X-Request-Id", "log-once-2").assertProblem(500, "Internal Server Error", "INTERNAL_ERROR");

        assertLoggedOnce("log-once-2", ThrowingFilter.MESSAGE);
    }

    @Test
    void 응답을_보내기_시작한_뒤의_500도_요청_id와_함께_한_번_남는다() throws Exception {
        server.raw("GET " + ErrorProbeController.PATH + "/fail-after-flush HTTP/1.1\r\n" + HOST
                + "X-Request-Id: log-once-3\r\n\r\n");

        assertLoggedOnce("log-once-3", "보낸 뒤의 실패");
    }

    @Test
    void 클라이언트가_끊은_것은_ERROR로_남기지_않는다() throws Exception {
        probe.willThrow(new HttpMessageNotWritableException("쓰지 못함", new ClientAbortException()));

        server.get(THROW);

        assertThat(atLeast(Level.INFO)).isEmpty();
    }

    // --- 4xx ---

    @Test
    void 요청의_잘못은_DEBUG로만_남고_code와_예외의_종류뿐이다() throws Exception {
        server.get("/" + EMAIL, "X-Request-Id", "log-4xx").assertProblem(404, "Not Found", "NOT_FOUND");

        assertThat(atLeast(Level.INFO)).isEmpty();
        ILoggingEvent event = atLeast(Level.DEBUG).getLast();
        assertThat(event.getLevel()).isEqualTo(Level.DEBUG);
        assertThat(event.getFormattedMessage()).isEqualTo("NOT_FOUND NoResourceFoundException");
        assertThat(event.getThrowableProxy()).isNull();
        assertThat(event.getMDCPropertyMap()).containsEntry("requestId", "log-4xx");
    }

    private void assertLoggedOnce(String requestId, String cause) {
        assertThat(atLeast(Level.WARN)).singleElement().satisfies(event -> {
            assertThat(event.getLevel()).isEqualTo(Level.ERROR);
            assertThat(ThrowableProxyUtil.asString(event.getThrowableProxy())).contains(cause);
            assertThat(event.getMDCPropertyMap()).containsEntry("requestId", requestId);
        });
    }

    /** 요청을 처리하는 Tomcat 스레드의 로그. 다른 컨텍스트가 같은 때 남긴 것은 뺀다. */
    private List<ILoggingEvent> atLeast(Level level) {
        return logs.events().stream()
                .filter(event -> event.getThreadName().contains("-exec-"))
                .filter(event -> event.getLevel().isGreaterOrEqual(level))
                .toList();
    }

    /** 본문을 보낼 때 이미 끊겨 있는 연결. */
    private static final class DisconnectedResponse extends MockHttpServletResponse {

        @Override
        public ServletOutputStream getOutputStream() {
            return new ServletOutputStream() {
                @Override
                public boolean isReady() {
                    return true;
                }

                @Override
                public void setWriteListener(WriteListener listener) {
                    throw new UnsupportedOperationException();
                }

                @Override
                public void write(int b) throws IOException {
                    throw new ClientAbortException(new IOException("Broken pipe"));
                }
            };
        }
    }

    private void assertNoValuesInLogs() {
        assertThat(logs.text())
                .contains("로그 수집 확인")
                .doesNotContainIgnoringCase(PASSWORD)
                .doesNotContainIgnoringCase(EMAIL);
    }
}
