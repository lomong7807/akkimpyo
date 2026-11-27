package app.accountbook.api;

import static org.assertj.core.api.Assertions.assertThat;

import app.accountbook.api.ServerClient.Reply;
import java.io.IOException;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.web.server.LocalServerPort;

/**
 * 보내다 멈춘 연결은 끊고, 느리지만 이어서 보내는 요청은 끊지 않는다(#21). 시험 서버의 제한 시간은 3초다.
 * 전체 시간이 아니라 다음 바이트를 기다리는 시간이다. 본문을 보내다 멈췄을 때의 응답은 {@link RequestBodyLimitTest}가 본다.
 */
@BodyLimitServerTest
class ConnectionTimeoutTest {

    private static final Duration LIMIT = Duration.ofSeconds(3);
    /** 제한 시간보다 훨씬 짧게 쉬고, 다 합치면 제한 시간을 넘는다. */
    private static final Duration GAP = Duration.ofMillis(600);
    private static final int PIECES = 7;

    private static final String HEAD = "POST " + BodyProbeController.BYTES + " HTTP/1.1\r\nHost: localhost\r\n";

    @LocalServerPort int port;

    private final List<OpenConnection> connections = new ArrayList<>();

    @AfterEach
    void tearDown() throws IOException {
        for (OpenConnection connection : connections) {
            connection.close();
        }
    }

    @Test
    void 요청_줄이나_머리를_보내다_멈추면_응답_없이_끊는다() throws Exception {
        List<OpenConnection> stalled = List.of(open(), open().send("POST /te"), open().send("POST / HTTP/1.1\r\n"),
                open().send(HEAD), open().send(HEAD + "Content-Le"));

        for (OpenConnection connection : stalled) {
            assertThat(connection.isClosedByServer()).isTrue();
        }
    }

    @Test
    void 조각_사이가_제한_시간보다_짧으면_전체가_더_길어도_끊지_않는다() throws Exception {
        OpenConnection head = open().send(HEAD + "X-Slow: ");
        OpenConnection body = open().send(HEAD + "Content-Length: " + PIECES + "\r\n\r\n");
        OpenConnection chunked = open().send(HEAD + "Transfer-Encoding: chunked\r\n\r\n");

        long start = System.nanoTime();
        for (int i = 0; i < PIECES; i++) {
            if (i > 0) {
                Thread.sleep(GAP);
            }
            head.send("a");
            body.send("a");
            chunked.send("1\r\na\r\n");
        }
        assertThat(Duration.ofNanos(System.nanoTime() - start)).isGreaterThan(LIMIT);

        assertThat(length(head.send("\r\nContent-Length: 0\r\n\r\n").reply())).isZero();
        assertThat(length(body.reply())).isEqualTo(PIECES);
        assertThat(length(chunked.send("0\r\n\r\n").reply())).isEqualTo(PIECES);
    }

    @Test
    void 쉬는_유지_연결은_다시_쓰다가_제한_시간_뒤에_끊는다() throws Exception {
        String request = "GET " + BodyProbeController.NONE + " HTTP/1.1\r\nHost: localhost\r\nConnection: keep-alive\r\n\r\n";
        OpenConnection connection = open();

        assertThat(connection.send(request).reply().status()).isEqualTo(204);
        Reply reused = connection.send(request).reply();
        assertThat(reused.status()).isEqualTo(204);
        assertThat(reused.header("Keep-Alive")).isEqualTo("timeout=" + LIMIT.toSeconds());

        assertThat(connection.isClosedByServer()).isTrue();
    }

    private OpenConnection open() throws IOException {
        OpenConnection connection = new OpenConnection(port);
        connections.add(connection);
        return connection;
    }

    private static int length(Reply reply) {
        assertThat(reply.status()).as(reply.body()).isEqualTo(200);
        return reply.json().get("length").asInt();
    }
}
