package app.accountbook.api;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.params.provider.Arguments.argumentSet;

import app.accountbook.api.ServerClient.Reply;
import app.accountbook.support.CapturedLogs;
import java.util.UUID;
import java.util.stream.Stream;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.boot.test.web.server.LocalServerPort;

/** 요청 id: 프록시가 준 것을 쓰고, 없거나 형식이 아니면 새로 만든다(ADR 002 4절, ADR 005 결정 7). */
@ApiErrorTest
@ExtendWith(OutputCaptureExtension.class)
class RequestIdTest {

    private static final String OK = ErrorProbeController.PATH + "/ok";
    private static final String THROW = ErrorProbeController.PATH + "/throw";

    @LocalServerPort int port;
    @Autowired ErrorProbeController probe;

    private ServerClient server;

    @BeforeEach
    void setUp() {
        server = new ServerClient(port);
        probe.willThrow(new IllegalStateException("요청 id 확인"));
    }

    static Stream<String> accepted() {
        return Stream.of("a", "req-example_1", "0B9f6c1e-3d52-4a7e-9c11-5f2e8a7d4b60", "-", "_", "a".repeat(64));
    }

    @ParameterizedTest
    @MethodSource("accepted")
    void 형식에_맞는_값은_그대로_쓴다(String id) throws Exception {
        assertThat(server.get(OK, "X-Request-Id", id).header("X-Request-Id")).isEqualTo(id);

        Reply error = server.get(THROW, "X-Request-Id", id)
                .assertProblem(500, "Internal Server Error", "INTERNAL_ERROR");
        assertThat(error.json().get("requestId").asString()).isEqualTo(id);
    }

    static Stream<Arguments> rejected() {
        return Stream.of(
                argumentSet("비었다", ""),
                argumentSet("65자", "a".repeat(65)),
                argumentSet("아주 길다", "a".repeat(4000)),
                argumentSet("공백", "a b"),
                argumentSet("점", "a.b"),
                argumentSet("빗금", "a/b"),
                argumentSet("로그의 줄을 흉내 낸 값", "a] ERROR 1 --- fake"),
                argumentSet("퍼센트로 적은 줄바꿈", "a%0d%0aX-Injected:1"),
                argumentSet("탭", "a\tb"),
                argumentSet("ASCII가 아닌 숫자", "²"),
                // 이모지의 UTF-8 바이트 하나씩을 그대로 보낸다
                argumentSet("이모지", "ð\u009f\u0098\u0080"));
    }

    @ParameterizedTest
    @MethodSource("rejected")
    void 형식에_맞지_않으면_새로_만든다(String value) throws Exception {
        Reply ok = server.rawReply(request(OK, "X-Request-Id: " + value + "\r\n"));
        Reply error = server.rawReply(request(THROW, "X-Request-Id: " + value + "\r\n"))
                .assertProblem(500, "Internal Server Error", "INTERNAL_ERROR");

        assertIsNew(ok.header("X-Request-Id"));
        assertIsNew(error.header("X-Request-Id"));
        assertThat(ok.headers()).doesNotContainKey("X-Injected");
    }

    @Test
    void 헤더가_없으면_요청마다_새로_만든다() throws Exception {
        String first = server.get(OK).header("X-Request-Id");
        String second = server.get(OK).header("X-Request-Id");

        assertIsNew(first);
        assertIsNew(second);
        assertThat(first).isNotEqualTo(second);
    }

    @Test
    void 줄바꿈을_끼운_헤더는_헤더로_더해지지_않고_로그의_줄을_만들지_못한다(CapturedOutput output) throws Exception {
        // 접힌 헤더(obs-fold): 다음 줄이 앞 헤더의 값에 이어진다.
        String received = server.raw(request(THROW, "X-Request-Id: good\r\n \r\n\tFAKE LOG LINE\r\n"));

        assertThat(received).doesNotContain("FAKE LOG LINE");
        assertThat(output.getAll()).doesNotContain("FAKE LOG LINE");
    }

    @ParameterizedTest
    @ValueSource(strings = {"/nope", "//nope", ThrowingFilter.THROW, "/actuator/health"})
    void 어느_단계에서_끝나도_같은_값이_응답에_있다(String path) throws Exception {
        assertThat(server.get(path, "X-Request-Id", "stage-1").header("X-Request-Id")).isEqualTo("stage-1");
        assertThat(ServerClient.anonymous(port).get(path, "X-Request-Id", "stage-2").header("X-Request-Id"))
                .isEqualTo("stage-2");
    }

    @Test
    void Tomcat이_거절한_요청에도_요청_id가_있다() throws Exception {
        Reply read = server.rawReply("GET /%zz HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n"
                + "X-Request-Id: tomcat-1\r\n\r\n").assertProblem(400, "Bad Request", "MALFORMED_REQUEST");
        assertThat(read.header("X-Request-Id")).isEqualTo("tomcat-1");

        // 요청 줄에서 막히면 헤더를 읽지 못했으므로 새로 만든다.
        Reply unread = server.rawReply("GET /| HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n"
                + "X-Request-Id: tomcat-2\r\n\r\n").assertProblem(400, "Bad Request", "MALFORMED_REQUEST");
        assertIsNew(unread.header("X-Request-Id"));
    }

    @Test
    void 로그의_줄에_요청_id가_보인다(CapturedOutput output) throws Exception {
        server.get(THROW, "X-Request-Id", "log-visible-1");

        assertThat(output.getAll().lines().filter(line -> line.contains("log-visible-1")))
                .singleElement().asString().contains("ERROR").contains("[log-visible-1]");
    }

    @Test
    void 요청_id는_다음_요청의_로그에_남지_않는다() throws Exception {
        try (CapturedLogs logs = CapturedLogs.start()) {
            server.get(THROW, "X-Request-Id", "first-request");
            server.get(THROW);

            assertThat(logs.events().stream()
                    .filter(event -> event.getThrowableProxy() != null)
                    .map(event -> event.getMDCPropertyMap().get("requestId")))
                    .hasSize(2)
                    .startsWith("first-request")
                    .doesNotHaveDuplicates()
                    .doesNotContainNull();
        }
    }

    private static void assertIsNew(String id) {
        assertThat(UUID.fromString(id)).hasToString(id);
    }

    private String request(String path, String headers) {
        return "GET " + path + " HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n" + server.authorizationLine()
                + headers + "\r\n";
    }
}
