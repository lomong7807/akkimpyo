package app.accountbook.api;

import static org.assertj.core.api.Assertions.assertThat;

import app.accountbook.support.SignedInUser;
import app.accountbook.support.TestAccessTokens;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.net.Socket;
import java.net.URI;
import java.net.http.HttpClient;
import java.net.http.HttpRequest;
import java.net.http.HttpResponse;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.UUID;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** 테스트 서버를 부른다. HTTP 클라이언트가 보낼 수 없는 요청은 소켓에 글자를 그대로 쓴다. */
final class ServerClient {

    private final int port;
    /** 요청마다 붙이는 Authorization 헤더의 값. 없으면 붙이지 않는다. */
    private final String authorization;
    private final HttpClient http = HttpClient.newHttpClient();

    /** {@link SignedInUser}로 로그인해 부른다. */
    ServerClient(int port) {
        this(port, "Bearer " + TestAccessTokens.valid(SignedInUser.ID, Instant.now()));
    }

    private ServerClient(int port, String authorization) {
        this.port = port;
        this.authorization = authorization;
    }

    /** 로그인하지 않고 부른다. Authorization 헤더는 부르는 쪽이 적는 것뿐이다. */
    static ServerClient anonymous(int port) {
        return new ServerClient(port, null);
    }

    /** 그 사용자로 로그인해 부른다. 토큰은 issuedAt에 발급한 것이다(서버의 시계가 멈춰 있으면 그 시각을 준다). */
    static ServerClient signedIn(int port, UUID userId, Instant issuedAt) {
        return new ServerClient(port, "Bearer " + TestAccessTokens.valid(userId, issuedAt));
    }

    /** {@link #raw}의 요청에 직접 적을 Authorization 헤더 한 줄. */
    String authorizationLine() {
        return "Authorization: " + authorization + "\r\n";
    }

    /** @param headers 이름, 값이 번갈아 나온다 */
    Reply send(String method, String path, String body, String... headers) throws Exception {
        HttpRequest.Builder request = HttpRequest.newBuilder(URI.create("http://localhost:" + port + path))
                .method(method, body == null
                        ? HttpRequest.BodyPublishers.noBody() : HttpRequest.BodyPublishers.ofString(body));
        if (headers.length > 0) {
            request.headers(headers);
        }
        if (authorization != null) {
            request.header("Authorization", authorization);
        }
        HttpResponse<String> response = http.send(request.build(), HttpResponse.BodyHandlers.ofString());
        Map<String, List<String>> received = new TreeMap<>(String.CASE_INSENSITIVE_ORDER);
        received.putAll(response.headers().map());
        return new Reply(response.statusCode(), received, response.body());
    }

    Reply get(String path, String... headers) throws Exception {
        return send("GET", path, null, headers);
    }

    Reply postJson(String path, String json) throws Exception {
        return send("POST", path, json, "Content-Type", "application/json");
    }

    /** 소켓에 그대로 쓰고 서버가 연결을 닫을 때까지 읽는다. 응답이 없으면 빈 글자다. */
    String raw(String request) throws IOException {
        try (Socket socket = new Socket("localhost", port)) {
            socket.setSoTimeout(10_000);
            socket.getOutputStream().write(request.getBytes(StandardCharsets.ISO_8859_1));
            socket.getOutputStream().flush();
            ByteArrayOutputStream received = new ByteArrayOutputStream();
            socket.getInputStream().transferTo(received);
            return received.toString(StandardCharsets.UTF_8);
        }
    }

    /** {@link #raw}의 응답을 나눠 읽는다. 조각 전송은 풀어 준다. */
    Reply rawReply(String request) throws IOException {
        String received = raw(request);
        assertThat(received).as("응답이 있다").startsWith("HTTP/1.1 ");
        int end = received.indexOf("\r\n\r\n");
        List<String> head = received.substring(0, end).lines().toList();
        Map<String, List<String>> headers = new TreeMap<>(String.CASE_INSENSITIVE_ORDER);
        head.stream().skip(1).map(line -> line.split(": ?", 2)).forEach(line -> headers.put(line[0], List.of(line[1])));
        String body = received.substring(end + 4);
        boolean chunked = headers.getOrDefault("Transfer-Encoding", List.of()).contains("chunked");
        return new Reply(Integer.parseInt(head.getFirst().split(" ")[1]), headers, chunked ? dechunk(body) : body);
    }

    /** 응답이 한 조각이라고 보고 푼다. 테스트의 오류 응답은 모두 작다. */
    private static String dechunk(String body) {
        int start = body.indexOf("\r\n") + 2;
        return body.substring(start, body.indexOf("\r\n0\r\n"));
    }

    record Reply(int status, Map<String, List<String>> headers, String body) {

        private static final JsonMapper JSON = new JsonMapper();

        String header(String name) {
            return headers.getOrDefault(name, List.of()).stream().findFirst().orElse(null);
        }

        JsonNode json() {
            return JSON.readTree(body);
        }

        /** ADR 002 4절의 모양이다: 정한 필드만 있고 값이 맞는다. 입력란 오류는 VALIDATION_FAILED에만 있다. */
        Reply assertProblem(int status, String title, String code) {
            assertThat(this.status).as(body).isEqualTo(status);
            assertThat(header("Content-Type")).isEqualTo("application/problem+json");
            JsonNode problem = json();
            assertThat(problem.propertyNames()).containsExactlyInAnyOrderElementsOf(code.equals("VALIDATION_FAILED")
                    ? Set.of("type", "title", "status", "detail", "code", "requestId", "fieldErrors")
                    : Set.of("type", "title", "status", "detail", "code", "requestId"));
            assertThat(problem.get("type").asString()).isEqualTo("about:blank");
            assertThat(problem.get("title").asString()).isEqualTo(title);
            assertThat(problem.get("status").isInt()).isTrue();
            assertThat(problem.get("status").asInt()).isEqualTo(status);
            assertThat(problem.get("detail").asString()).isNotBlank();
            assertThat(problem.get("code").asString()).isEqualTo(code);
            assertThat(problem.get("requestId").asString())
                    .matches("[A-Za-z0-9_-]{1,64}")
                    .isEqualTo(header("X-Request-Id"));
            assertThat(headers.get("X-Request-Id")).hasSize(1);
            return this;
        }

        /** 400 VALIDATION_FAILED이고 입력란 오류가 정확히 이것이다. {@code 입력란:code}로 적는다. */
        Reply assertFieldErrors(String... expected) {
            assertProblem(400, "Bad Request", "VALIDATION_FAILED");
            List<String> actual = json().get("fieldErrors").valueStream()
                    .peek(error -> {
                        assertThat(error.propertyNames()).containsExactlyInAnyOrder("field", "code", "message");
                        assertThat(error.get("message").asString()).isNotBlank();
                    })
                    .map(error -> error.get("field").asString() + ":" + error.get("code").asString())
                    .toList();
            assertThat(actual).containsExactlyInAnyOrder(expected);
            return this;
        }
    }
}
