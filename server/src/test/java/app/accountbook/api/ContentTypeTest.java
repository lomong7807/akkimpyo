package app.accountbook.api;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.stream.Stream;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.boot.test.web.server.LocalServerPort;

/**
 * JSON이 아닌 Content-Type의 쓰기 요청은 415이고, 본문과 Content-Type이 없는 요청은 막지 않는다(#21).
 * 스프링의 기본 동작이다. 오류 본문의 모양은 {@link ControllerErrorTest}가 앱 전체에서도 본다.
 */
@BodyLimitServerTest
class ContentTypeTest {

    private static final String BODY = "{\"text\":\"a\"}";

    @LocalServerPort int port;

    private ServerClient server;

    @BeforeEach
    void setUp() {
        server = new ServerClient(port);
    }

    static Stream<Arguments> notJson() {
        return Stream.of("POST", "PUT", "PATCH").flatMap(method -> Stream.of("text/plain", "text/json", "text/html",
                        "application/xml", "application/yaml", "application/cbor", "application/octet-stream",
                        "application/x-www-form-urlencoded", "multipart/form-data; boundary=x", "image/png",
                        "*/*", "application/*", "garbage", "application/json;charset=marker")
                .map(contentType -> Arguments.of(method, contentType)));
    }

    @ParameterizedTest
    @MethodSource("notJson")
    void JSON이_아닌_쓰기_요청은_415다(String method, String contentType) throws Exception {
        server.send(method, BodyProbeController.JSON, BODY, "Content-Type", contentType)
                .assertProblem(415, "Unsupported Media Type", "UNSUPPORTED_MEDIA_TYPE");
    }

    @ParameterizedTest
    @ValueSource(strings = {"POST", "PUT", "PATCH"})
    void JSON을_받는_주소에_Content_Type_없이_보낸_본문은_415다(String method) throws Exception {
        server.send(method, BodyProbeController.JSON, BODY)
                .assertProblem(415, "Unsupported Media Type", "UNSUPPORTED_MEDIA_TYPE");
    }

    /** Content-Type이 없다고 막는 것이 아니라 있어야 할 본문이 없는 것이다. */
    @ParameterizedTest
    @ValueSource(strings = {"POST", "PUT", "PATCH"})
    void JSON을_받는_주소에_본문도_Content_Type도_없으면_읽을_수_없는_요청이다(String method) throws Exception {
        server.send(method, BodyProbeController.JSON, null).assertProblem(400, "Bad Request", "MALFORMED_REQUEST");
        server.send(method, BodyProbeController.JSON, "").assertProblem(400, "Bad Request", "MALFORMED_REQUEST");
    }

    @ParameterizedTest
    @ValueSource(strings = {"application/json", "APPLICATION/JSON", "application/json;charset=UTF-8",
            "application/json; charset=utf-8", "application/merge-patch+json"})
    void JSON은_받는다(String contentType) throws Exception {
        for (String method : List.of("POST", "PUT", "PATCH")) {
            assertThat(server.send(method, BodyProbeController.JSON, BODY, "Content-Type", contentType).status())
                    .isEqualTo(200);
        }
    }

    @Test
    void 본문을_받지_않는_주소는_Content_Type이_없어도_된다() throws Exception {
        for (String method : List.of("POST", "PUT", "PATCH", "DELETE")) {
            assertThat(server.send(method, BodyProbeController.NONE, null).status()).isEqualTo(204);
        }
    }
}
