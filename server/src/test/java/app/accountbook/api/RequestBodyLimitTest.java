package app.accountbook.api;

import static org.assertj.core.api.Assertions.assertThat;

import app.accountbook.api.BodyProbeController.Received;
import app.accountbook.api.ServerClient.Reply;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.concurrent.Future;
import java.util.stream.IntStream;
import java.util.zip.GZIPOutputStream;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.web.server.LocalServerPort;

/** 요청 본문은 64KB까지이고 넘으면 413이다(#21). 모든 경로와 메서드에서 로그인 확인보다 먼저다. */
@BodyLimitServerTest
class RequestBodyLimitTest {

    private static final int LIMIT = 64 * 1024;

    @LocalServerPort int port;
    @Autowired BodyProbeFilters.ReadBytes readBytes;
    @Autowired BodyProbeFilters.Inside inside;

    private final String id = UUID.randomUUID().toString();
    private ServerClient server;

    @BeforeEach
    void setUp() {
        server = new ServerClient(port);
    }

    // --- 경계 ---

    @Test
    void 정확히_64KB인_본문은_그대로_받는다() throws Exception {
        String body = text(LIMIT);

        assertReceived(server.send("POST", BodyProbeController.BYTES, body), body);
    }

    @Test
    void 조각으로_보낸_64KB도_그대로_받는다() throws Exception {
        String body = text(LIMIT);

        assertReceived(sendChunked(BodyProbeController.BYTES, body), body);
    }

    @Test
    void 한_바이트씩_나눈_조각도_합쳐서_센다() throws Exception {
        String chunks = "1\r\na\r\n";

        Reply exact = post(BodyProbeController.BYTES, "Transfer-Encoding: chunked\r\n",
                chunks.repeat(LIMIT) + "0\r\n\r\n");
        assertReceived(exact, "a".repeat(LIMIT));

        post(BodyProbeController.BYTES, "Transfer-Encoding: chunked\r\n", chunks.repeat(LIMIT + 1) + "0\r\n\r\n")
                .assertProblem(413, "Content Too Large", "PAYLOAD_TOO_LARGE");
    }

    @Test
    void 한_바이트_넘으면_413이고_안쪽에_닿지_않는다() throws Exception {
        Reply reply = server.send("POST", BodyProbeController.BYTES, text(LIMIT + 1), "X-Request-Id", id);

        reply.assertProblem(413, "Content Too Large", "PAYLOAD_TOO_LARGE");
        assertThat(reply.json().get("detail").asString()).isEqualTo("요청 본문이 너무 크다");
        assertThat(reply.header("X-Request-Id")).isEqualTo(id);
        assertThat(inside.reached(id)).isFalse();
    }

    @Test
    void 조각으로_보내도_한_바이트_넘으면_413이고_안쪽에_닿지_않는다() throws Exception {
        sendChunked(BodyProbeController.BYTES, text(LIMIT + 1), "X-Request-Id", id)
                .assertProblem(413, "Content Too Large", "PAYLOAD_TOO_LARGE");

        assertThat(inside.reached(id)).isFalse();
    }

    @Test
    void 상한_안이면_안쪽에_닿는다() throws Exception {
        server.send("POST", BodyProbeController.BYTES, text(LIMIT), "X-Request-Id", id);

        assertThat(inside.reached(id)).isTrue();
        assertThat(readBytes.of(id)).isEqualTo(LIMIT);
    }

    // --- 다 받지 않고 거절한다 ---

    @ParameterizedTest
    @ValueSource(strings = {"65537", "10737418240", "9223372036854775807"})
    void Content_Length가_상한을_넘으면_본문을_기다리지도_읽지도_않는다(String length) throws Exception {
        try (OpenConnection connection = new OpenConnection(port)) {
            Reply reply = connection.send(head("POST", BodyProbeController.BYTES, "Content-Length: " + length + "\r\n"))
                    .reply();

            reply.assertProblem(413, "Content Too Large", "PAYLOAD_TOO_LARGE");
            assertThat(reply.header("Connection")).isEqualTo("close");
        }
        assertThat(readBytes.of(id)).isZero();
        assertThat(inside.reached(id)).isFalse();
    }

    @Test
    void 조각_전송은_상한을_넘는_순간_거절하고_나머지를_기다리지_않는다() throws Exception {
        try (OpenConnection connection = new OpenConnection(port)) {
            Reply reply = connection.send(head("POST", BodyProbeController.BYTES, "Transfer-Encoding: chunked\r\n"))
                    .send(chunk(text(LIMIT)))
                    .send(chunk("a"))
                    .reply();

            reply.assertProblem(413, "Content Too Large", "PAYLOAD_TOO_LARGE");
            assertThat(reply.header("Connection")).isEqualTo("close");
        }
        assertThat(readBytes.of(id)).isEqualTo(LIMIT + 1);
        assertThat(inside.reached(id)).isFalse();
    }

    @Test
    void Content_Length를_작게_적은_조각_전송도_읽은_양으로_거절한다() throws Exception {
        post(BodyProbeController.BYTES, "Content-Length: 2\r\nTransfer-Encoding: chunked\r\n",
                chunk(text(LIMIT + 1)) + "0\r\n\r\n")
                .assertProblem(413, "Content Too Large", "PAYLOAD_TOO_LARGE");

        assertThat(inside.reached(id)).isFalse();
    }

    @Test
    void Content_Length를_작게_적으면_적은_만큼만_본문이고_나머지는_다음_요청이다() throws Exception {
        try (OpenConnection connection = new OpenConnection(port)) {
            connection.send(head("POST", BodyProbeController.BYTES, "Content-Length: 2\r\n") + "{}" + text(LIMIT + 1));

            assertReceived(connection.reply(), "{}");
            assertThat(readBytes.of(id)).isEqualTo(2);
            connection.reply().assertProblem(400, "Bad Request", "MALFORMED_REQUEST");
        }
    }

    @Test
    void 동시에_온_큰_요청들도_상한까지만_읽고_모두_413이다() throws Exception {
        List<String> ids = IntStream.range(0, 32).mapToObj(i -> "concurrent-" + id.substring(0, 8) + "-" + i).toList();
        String body = text(512 * 1024);

        try (ExecutorService clients = Executors.newVirtualThreadPerTaskExecutor()) {
            List<Future<Reply>> replies = ids.stream()
                    .map(each -> clients.submit(() ->
                            sendChunked(BodyProbeController.BYTES, body, "X-Request-Id", each)))
                    .toList();
            for (Future<Reply> reply : replies) {
                reply.get().assertProblem(413, "Content Too Large", "PAYLOAD_TOO_LARGE");
            }
        }

        assertThat(ids).allSatisfy(each -> {
            assertThat(readBytes.of(each)).isEqualTo(LIMIT + 1);
            assertThat(inside.reached(each)).isFalse();
        });
    }

    // --- 모든 경로, 메서드, Content-Type ---

    @ParameterizedTest
    @CsvSource({"POST, /test/body/none", "POST, /api/v1/nope", "POST, /", "POST, /error", "POST, //nope",
            "PUT, /test/body/bytes", "PATCH, /test/body/bytes", "DELETE, /test/body/bytes", "GET, /test/body/bytes",
            "OPTIONS, /test/body/bytes", "MARKER, /test/body/bytes"})
    void 경로와_메서드를_가리지_않는다(String method, String path) throws Exception {
        for (String length : new String[] {"Content-Length: 65537\r\n", "Transfer-Encoding: chunked\r\n"}) {
            String body = text(LIMIT + 1);
            server.rawReply(head(method, path, length + "Connection: close\r\n")
                            + (length.startsWith("Content") ? body : chunk(body) + "0\r\n\r\n"))
                    .assertProblem(413, "Content Too Large", "PAYLOAD_TOO_LARGE");
        }
        assertThat(inside.reached(id)).isFalse();
    }

    @Test
    void HEAD는_본문_없이_상태만_같다() throws Exception {
        Reply reply = server.send("HEAD", BodyProbeController.BYTES, text(LIMIT + 1));

        assertThat(reply.status()).isEqualTo(413);
        assertThat(reply.body()).isEmpty();
    }

    @ParameterizedTest
    @ValueSource(strings = {"application/json", "text/plain", "application/x-www-form-urlencoded",
            "multipart/form-data; boundary=x", "application/octet-stream", "garbage"})
    void Content_Type을_가리지_않고_415보다_먼저다(String contentType) throws Exception {
        server.send("POST", BodyProbeController.JSON, text(LIMIT + 1), "Content-Type", contentType)
                .assertProblem(413, "Content Too Large", "PAYLOAD_TOO_LARGE");
        sendChunked(BodyProbeController.JSON, text(LIMIT + 1), "Content-Type", contentType)
                .assertProblem(413, "Content Too Large", "PAYLOAD_TOO_LARGE");
    }

    @Test
    void Content_Type이_없어도_같다() throws Exception {
        server.send("POST", BodyProbeController.JSON, text(LIMIT + 1))
                .assertProblem(413, "Content Too Large", "PAYLOAD_TOO_LARGE");
    }

    @Test
    void 프레임워크가_읽는_폼의_본문도_센다() throws Exception {
        String form = "text=" + "a".repeat(LIMIT - 4);

        sendChunked(BodyProbeController.FORM, form, "Content-Type", "application/x-www-form-urlencoded")
                .assertProblem(413, "Content Too Large", "PAYLOAD_TOO_LARGE");
    }

    /** 폼은 받지 않는다(application.yml). 프레임워크가 본문을 따로 읽는 길이 없어 상한을 비켜 가지 못한다. */
    @Test
    void 폼의_본문은_파라미터가_되지_않고_쿼리는_그대로다() throws Exception {
        assertReceived(server.send("POST", BodyProbeController.FORM + "?text=query", "text=form",
                "Content-Type", "application/x-www-form-urlencoded"), "query");
        assertReceived(server.send("POST", BodyProbeController.FORM, "text=form",
                "Content-Type", "application/x-www-form-urlencoded"), "");
    }

    @ParameterizedTest
    @ValueSource(strings = {"text/html", "application/json", "image/png"})
    void Accept와_무관하게_같은_모양이다(String accept) throws Exception {
        server.send("POST", BodyProbeController.BYTES, text(LIMIT + 1), "Accept", accept)
                .assertProblem(413, "Content Too Large", "PAYLOAD_TOO_LARGE");
    }

    // --- 압축 ---

    @Test
    void 압축된_본문은_풀지_않고_받은_바이트로_센다() throws Exception {
        byte[] zipped = gzip("{\"text\":\"" + "a".repeat(10 * 1024 * 1024) + "\"}");
        assertThat(zipped).hasSizeLessThan(LIMIT);
        String body = new String(zipped, StandardCharsets.ISO_8859_1);
        String headers = "Content-Encoding: gzip\r\nContent-Type: application/json\r\nContent-Length: " + zipped.length
                + "\r\n";

        Reply bytes = post(BodyProbeController.BYTES, headers, body);
        assertThat(bytes.status()).isEqualTo(200);
        assertThat(bytes.json().get("length").asInt()).isEqualTo(zipped.length);

        post(BodyProbeController.JSON, headers, body).assertProblem(400, "Bad Request", "MALFORMED_REQUEST");
    }

    @Test
    void 압축_전송은_받지_않는다() throws Exception {
        String zipped = new String(gzip("a"), StandardCharsets.ISO_8859_1);

        post(BodyProbeController.BYTES, "Transfer-Encoding: gzip, chunked\r\n", chunk(zipped) + "0\r\n\r\n")
                .assertProblem(400, "Bad Request", "MALFORMED_REQUEST");
    }

    // --- 본문 없는 요청 ---

    @ParameterizedTest
    @ValueSource(strings = {"GET", "POST", "PUT", "PATCH", "DELETE"})
    void 본문과_Content_Type이_없는_요청은_막지_않는다(String method) throws Exception {
        assertThat(server.send(method, BodyProbeController.NONE, null).status()).isEqualTo(204);
        assertThat(server.rawReply(head(method, BodyProbeController.NONE, "Connection: close\r\n")).status())
                .isEqualTo(204);
        assertThat(server.rawReply(head(method, BodyProbeController.NONE, "Connection: close\r\nContent-Length: 0\r\n"))
                .status()).isEqualTo(204);
        assertThat(post(BodyProbeController.NONE, "Transfer-Encoding: chunked\r\n", "0\r\n\r\n").status())
                .isEqualTo(204);
    }

    // --- 안쪽에서 읽는 방법 ---

    @Test
    void JSON_본문은_전과_같이_읽힌다() throws Exception {
        String text = "가".repeat(20_000);

        Reply reply = server.postJson(BodyProbeController.JSON, "{\"text\":\"" + text + "\"}");

        assertReceived(reply, text);
    }

    @ParameterizedTest
    @ValueSource(strings = {"text/plain", "text/plain; charset=UTF-8"})
    void 글자로_읽어도_전과_같다(String contentType) throws Exception {
        Reply reply = server.send("POST", BodyProbeController.TEXT, "가나다 abc", "Content-Type", contentType);

        assertReceived(reply, "가나다 abc");
    }

    @Test
    void 이어서_온_요청이_앞_요청의_본문을_보지_않는다() throws Exception {
        try (OpenConnection connection = new OpenConnection(port)) {
            for (String body : List.of(text(LIMIT), "", "b")) {
                connection.send(head("POST", BodyProbeController.BYTES, "Content-Length: " + body.length() + "\r\n")
                        + body);
                assertReceived(connection.reply(), body);
            }
        }
    }

    // --- 본문을 다 보내지 않은 요청(#177의 동작 그대로) ---

    @ParameterizedTest
    @ValueSource(strings = {"Content-Length: 50\r\n", "Transfer-Encoding: chunked\r\n"})
    void 보내다_멈춘_본문은_다시_보낼_수_있게_500이고_안쪽에_닿지_않는다(String length) throws Exception {
        try (OpenConnection connection = new OpenConnection(port)) {
            connection.send(head("POST", BodyProbeController.BYTES, length))
                    .send(length.startsWith("Content") ? "{\"text\":" : "8\r\n{\"text\":")
                    .reply()
                    .assertProblem(500, "Internal Server Error", "INTERNAL_ERROR");
        }
        assertThat(inside.reached(id)).isFalse();
    }

    @Test
    void 깨진_조각은_읽을_수_없는_요청이고_안쪽에_닿지_않는다() throws Exception {
        post(BodyProbeController.BYTES, "Transfer-Encoding: chunked\r\n", "zz\r\nabc\r\n")
                .assertProblem(400, "Bad Request", "MALFORMED_REQUEST");

        assertThat(inside.reached(id)).isFalse();
    }

    @Test
    void 보내다_끊은_요청은_안쪽에_닿지_않는다() throws Exception {
        try (OpenConnection connection = new OpenConnection(port)) {
            connection.send(head("POST", BodyProbeController.BYTES, "Content-Length: 50\r\n") + "{").finishSending();
            connection.isClosedByServer();
        }
        assertThat(inside.reached(id)).isFalse();
    }

    // ---

    private String head(String method, String path, String headers) {
        return method + " " + path + " HTTP/1.1\r\nHost: localhost\r\nX-Request-Id: " + id + "\r\n" + headers + "\r\n";
    }

    private Reply post(String path, String headers, String body) throws IOException {
        return server.rawReply(head("POST", path, "Connection: close\r\n" + headers) + body);
    }

    private static String chunk(String data) {
        return Integer.toHexString(data.length()) + "\r\n" + data + "\r\n";
    }

    /** 길이를 모르는 본문으로 보낸다. HTTP 클라이언트가 조각으로 나눈다. */
    private Reply sendChunked(String path, String body, String... headers) throws Exception {
        HttpRequest.Builder request = HttpRequest.newBuilder(URI.create("http://localhost:" + port + path))
                .POST(HttpRequest.BodyPublishers.ofInputStream(
                        () -> new ByteArrayInputStream(body.getBytes(StandardCharsets.UTF_8))));
        if (headers.length > 0) {
            request.headers(headers);
        }
        try (HttpClient http = HttpClient.newHttpClient()) {
            HttpResponse<String> response = http.send(request.build(), HttpResponse.BodyHandlers.ofString());
            return new Reply(response.statusCode(), response.headers().map(), response.body());
        }
    }

    /** 순서가 바뀌거나 빠지면 지문이 달라지는 글자. */
    private static String text(int length) {
        StringBuilder text = new StringBuilder(length);
        for (int i = 0; text.length() < length; i++) {
            text.append(i).append(' ');
        }
        return text.substring(0, length);
    }

    private static byte[] gzip(String text) throws IOException {
        ByteArrayOutputStream zipped = new ByteArrayOutputStream();
        try (GZIPOutputStream out = new GZIPOutputStream(zipped)) {
            out.write(text.getBytes(StandardCharsets.UTF_8));
        }
        return zipped.toByteArray();
    }

    private static void assertReceived(Reply reply, String body) {
        Received expected = Received.of(body.getBytes(StandardCharsets.UTF_8));
        assertThat(reply.status()).as(reply.body()).isEqualTo(200);
        assertThat(reply.json().get("length").asInt()).isEqualTo(expected.length());
        assertThat(reply.json().get("sha256").asString()).isEqualTo(expected.sha256());
    }
}
