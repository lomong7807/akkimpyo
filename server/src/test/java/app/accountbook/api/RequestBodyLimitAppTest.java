package app.accountbook.api;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.stream.Stream;
import org.apache.catalina.Context;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.servlet.filter.OrderedCharacterEncodingFilter;
import org.springframework.boot.test.web.server.LocalServerPort;
import org.springframework.boot.tomcat.TomcatWebServer;
import org.springframework.boot.web.server.servlet.context.ServletWebServerApplicationContext;
import org.springframework.web.filter.ServerHttpObservationFilter;

/** 앱 전체에서 본문 상한이 걸리는 자리와 기본값을 본다(#21). 나머지는 {@link RequestBodyLimitTest}가 DB 없이 본다. */
@ApiErrorTest
class RequestBodyLimitAppTest {

    private static final String BODY = ErrorProbeController.PATH + "/body";
    private static final int LIMIT = 64 * 1024;

    @LocalServerPort int port;
    @Autowired ServletWebServerApplicationContext context;

    private ServerClient server;

    @BeforeEach
    void setUp() {
        server = new ServerClient(port);
    }

    /** 여기 없는 필터가 앞에 오면 상한 없는 본문을 읽을 수 있다. 로그인 확인의 필터(#188)도 뒤에 온다. */
    @Test
    void 본문_상한보다_먼저_도는_것은_인코딩과_요청_id와_측정뿐이다() {
        Context tomcat = (Context) ((TomcatWebServer) context.getWebServer()).getTomcat().getHost().findChildren()[0];
        List<Class<?>> filters = Stream.of(tomcat.findFilterMaps())
                .<Class<?>>map(map -> tomcat.findFilterDef(map.getFilterName()).getFilter().getClass())
                .toList();

        assertThat(filters).contains(RequestBodyLimitFilter.class, ThrowingFilter.class);
        assertThat(filters.subList(0, filters.indexOf(RequestBodyLimitFilter.class)))
                .contains(RequestBoundaryFilter.class)
                .isSubsetOf(OrderedCharacterEncodingFilter.class, RequestBoundaryFilter.class,
                        ServerHttpObservationFilter.class);
    }

    @Test
    void 설정하지_않으면_64KB까지_받는다() throws Exception {
        String json = "{\"name\":\"이름\",\"amount\":100,\"없는필드\":\"a\"}";
        String exact = json + " ".repeat(LIMIT - json.getBytes(StandardCharsets.UTF_8).length);

        assertThat(server.postJson(BODY, exact).status()).isEqualTo(200);
        server.postJson(BODY, exact + " ").assertProblem(413, "Content Too Large", "PAYLOAD_TOO_LARGE");
    }

    @ParameterizedTest
    @ValueSource(strings = {"POST /api/v1/nope", "POST /api/v1/auth/login", "GET /actuator/health", "POST /error",
            "PUT " + BODY})
    void 로그인하지_않은_요청도_주소와_무관하게_413이다(String line) throws Exception {
        for (String length : new String[] {"Content-Length: 65537\r\n\r\n", "Transfer-Encoding: chunked\r\n\r\n10001\r\n"}) {
            server.rawReply(line + " HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n" + length
                            + "a".repeat(LIMIT + 1) + (length.startsWith("Transfer") ? "\r\n0\r\n\r\n" : ""))
                    .assertProblem(413, "Content Too Large", "PAYLOAD_TOO_LARGE");
        }
    }
}
