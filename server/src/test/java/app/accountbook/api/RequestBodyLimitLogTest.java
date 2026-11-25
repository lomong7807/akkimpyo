package app.accountbook.api;

import static org.assertj.core.api.Assertions.assertThat;

import app.accountbook.api.ServerClient.Reply;
import app.accountbook.support.CapturedLogs;
import ch.qos.logback.classic.Level;
import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import java.io.IOException;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.slf4j.LoggerFactory;
import org.springframework.boot.test.web.server.LocalServerPort;

/**
 * 본문이 커서 거절한 요청의 로그(#21). 밖에서 얼마든지 만들 수 있으므로 DEBUG에 code만 남긴다.
 * 우리 코드의 로그는 TRACE까지, 프레임워크와 Tomcat의 로그는 운영과 같은 기본 수준으로 모아서 본다.
 */
@BodyLimitServerTest
class RequestBodyLimitLogTest {

    private static final String MARKER = "marker-password-21";
    private static final int TOO_BIG = 64 * 1024 + 1;

    private static final Logger OURS = (Logger) LoggerFactory.getLogger("app.accountbook");

    @LocalServerPort int port;

    private CapturedLogs logs;

    @BeforeEach
    void setUp() throws Exception {
        // 첫 요청에 DispatcherServlet이 준비하며 남기는 INFO를 모으기 전에 끝낸다.
        new ServerClient(port).get(BodyProbeController.NONE);
        OURS.setLevel(Level.TRACE);
        logs = CapturedLogs.start();
        OURS.trace("로그 수집 확인");
    }

    @AfterEach
    void tearDown() {
        logs.close();
        OURS.setLevel(null);
    }

    @ParameterizedTest
    @ValueSource(strings = {"Content-Length: 65537\r\n", "Transfer-Encoding: chunked\r\n"})
    void 거절은_되풀이해도_DEBUG에_code만_요청_id와_함께_남는다(String length) throws Exception {
        String body = MARKER + "a".repeat(TOO_BIG - MARKER.length());
        String sent = length.startsWith("Content") ? body
                : Integer.toHexString(TOO_BIG) + "\r\n" + body + "\r\n0\r\n\r\n";
        for (int i = 0; i < 20; i++) {
            Reply reply = new ServerClient(port).rawReply("POST /test/body/bytes HTTP/1.1\r\nHost: localhost\r\n"
                            + "Connection: close\r\nX-Request-Id: too-big-" + i + "\r\n" + length + "\r\n" + sent)
                    .assertProblem(413, "Content Too Large", "PAYLOAD_TOO_LARGE");
            assertThat(reply.body()).doesNotContain(MARKER, "65537", "65536");
        }

        assertThat(atLeast(Level.INFO)).isEmpty();
        assertThat(atLeast(Level.TRACE)).hasSize(20).allSatisfy(event -> {
            assertThat(event.getLevel()).isEqualTo(Level.DEBUG);
            assertThat(event.getFormattedMessage()).isEqualTo("PAYLOAD_TOO_LARGE (상태 413)");
            assertThat(event.getThrowableProxy()).isNull();
            assertThat(event.getMDCPropertyMap().get("requestId")).startsWith("too-big-");
        });
        assertThat(logs.text()).contains("로그 수집 확인").doesNotContain(MARKER, "65537", "65536");
    }

    @Test
    void 받은_본문의_값도_로그에_없다() throws Exception {
        Reply reply = new ServerClient(port).send("POST", BodyProbeController.BYTES, MARKER);

        assertThat(reply.status()).isEqualTo(200);
        assertThat(logs.text()).contains("로그 수집 확인").doesNotContain(MARKER);
    }

    /** Tomcat은 남은 본문을 2MB까지만 읽어 버리고 연결을 끊는다. */
    @ParameterizedTest
    @ValueSource(strings = {"Content-Length: 67108864\r\n", "Transfer-Encoding: chunked\r\n"})
    void 응답을_보지_않고_계속_보내다_끊긴_것도_INFO_이상으로_남지_않는다(String length) throws Exception {
        String piece = MARKER + "a".repeat(65_536 - MARKER.length());
        String sent = length.startsWith("Content") ? piece : "10000\r\n" + piece + "\r\n";
        try (OpenConnection connection = new OpenConnection(port)) {
            connection.send("POST /test/body/bytes HTTP/1.1\r\nHost: localhost\r\n" + length + "\r\n");
            boolean cut = false;
            for (int i = 0; i < 1024 && !cut; i++) {
                cut = isCut(connection, sent);
            }
            assertThat(cut).as("64MB를 다 받아 주지 않는다").isTrue();
        }

        assertThat(atLeast(Level.INFO)).isEmpty();
        assertThat(logs.text()).doesNotContain(MARKER);
    }

    @ParameterizedTest
    @ValueSource(strings = {"Content-Length: 50\r\n", "Transfer-Encoding: chunked\r\n"})
    void 보내다_끊은_본문은_INFO_이상으로_남지_않는다(String length) throws Exception {
        try (OpenConnection connection = new OpenConnection(port)) {
            connection.send("POST /test/body/bytes HTTP/1.1\r\nHost: localhost\r\n" + length + "\r\n"
                    + (length.startsWith("Content") ? MARKER : "12\r\n" + MARKER)).finishSending();
            assertThat(connection.reply().status()).isEqualTo(400);
        }

        assertThat(atLeast(Level.INFO)).isEmpty();
        assertThat(logs.text()).doesNotContain(MARKER);
    }

    @Test
    void 보내다_멈춘_본문은_요청_id와_함께_WARN_한_줄이다() throws Exception {
        try (OpenConnection connection = new OpenConnection(port)) {
            connection.send("POST /test/body/bytes HTTP/1.1\r\nHost: localhost\r\nX-Request-Id: stalled-21\r\n"
                    + "Content-Length: 50\r\n\r\n" + MARKER);
            connection.reply().assertProblem(500, "Internal Server Error", "INTERNAL_ERROR");
        }

        assertThat(atLeast(Level.INFO)).singleElement().satisfies(event -> {
            assertThat(event.getLevel()).isEqualTo(Level.WARN);
            assertThat(event.getMDCPropertyMap()).containsEntry("requestId", "stalled-21");
        });
        assertThat(logs.text()).doesNotContain(MARKER);
    }

    private static boolean isCut(OpenConnection connection, String text) {
        try {
            connection.send(text);
            return false;
        } catch (IOException e) {
            return true;
        }
    }

    /** 요청을 처리하는 Tomcat 스레드의 로그. 다른 컨텍스트가 같은 때 남긴 것은 뺀다. */
    private List<ILoggingEvent> atLeast(Level level) {
        return logs.events().stream()
                .filter(event -> event.getThreadName().contains("-exec-"))
                .filter(event -> event.getLevel().isGreaterOrEqual(level))
                .toList();
    }
}
