package app.accountbook.api;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Arrays;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.mock.env.MockEnvironment;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;

/** {@code /api/v1/auth} 아래의 요청을 거르는 규칙(ADR 001 결정 5). 실제 필터 체인에서의 응답은 AuthOriginTest가 본다. */
class AuthRequestFilterTest {

    private static final String ORIGIN = "https://app.example.com";
    private static final String LOGIN = "/api/v1/auth/login";

    private final AuthRequestFilter filter = new AuthRequestFilter(
            new WebOrigin(new MockEnvironment().withProperty("WEB_ORIGIN", ORIGIN)));

    @ParameterizedTest
    @ValueSource(strings = {"web", "ios", "", " ", "아무 값"})
    void 전용_헤더는_값을_보지_않고_있는지만_본다(String value) throws Exception {
        assertThat(isPassed(request("POST", LOGIN, value, ORIGIN))).isTrue();
        // 브라우저가 아닌 클라이언트는 Origin을 보내지 않는다.
        assertThat(isPassed(request("POST", LOGIN, value))).isTrue();
    }

    @Test
    void 전용_헤더가_없으면_출처가_맞아도_거절한다() throws Exception {
        assertNotAllowed(request("POST", LOGIN, null));
        assertNotAllowed(request("POST", LOGIN, null, ORIGIN));
    }

    @ParameterizedTest
    @ValueSource(strings = {"https://evil.example", "null", "", " ", "*", "http://app.example.com",
            "https://app.example.com:443", "https://app.example.com:8443", "https://app.example.com/",
            "https://APP.example.com", "https://app.example.com.evil.example", "https://evil.example?https://app.example.com",
            "https://app.example.com, https://evil.example", "https://sub.app.example.com", "https://example.com",
            "http://localhost:5173"})
    void 다른_출처는_전용_헤더가_있어도_거절한다(String origin) throws Exception {
        assertNotAllowed(request("POST", LOGIN, "web", origin));
    }

    @Test
    void Origin_헤더가_여럿이면_모두_우리_출처여도_거절한다() throws Exception {
        assertNotAllowed(request("POST", LOGIN, "web", ORIGIN, ORIGIN));
        assertNotAllowed(request("POST", LOGIN, "web", ORIGIN, "https://evil.example"));
        assertNotAllowed(request("POST", LOGIN, "web", "https://evil.example", ORIGIN));
    }

    @ParameterizedTest
    @ValueSource(strings = {"GET", "HEAD", "PUT", "PATCH", "DELETE", "OPTIONS", "post", "PROPFIND"})
    void POST가_아니면_405이고_출처를_먼저_본다(String method) throws Exception {
        MockHttpServletResponse response = new MockHttpServletResponse();
        MockFilterChain chain = new MockFilterChain();

        filter.doFilter(request(method, LOGIN, "web", ORIGIN), response, chain);

        assertThat(chain.getRequest()).isNull();
        assertThat(response.getStatus()).isEqualTo(405);
        assertThat(response.getHeader("Allow")).isEqualTo("POST");
        assertNotAllowed(request(method, LOGIN, null, ORIGIN));
        assertNotAllowed(request(method, LOGIN, "web", "https://evil.example"));
    }

    @ParameterizedTest
    @ValueSource(strings = {"/api/v1/auth", "/api/v1/auth/", "/api/v1/auth/login", "/api/v1/auth/login/",
            "/api/v1/auth/a/b/c", "/api/v1/auth/없는-주소", "/api/v1/%61uth/login", "/api/v1/auth/%6Cogin"})
    void 인증_경로와_그_아래를_모두_본다(String path) throws Exception {
        assertNotAllowed(request("POST", path, null, ORIGIN));
        assertThat(isPassed(request("POST", path, "web", ORIGIN))).isTrue();
    }

    @ParameterizedTest
    @ValueSource(strings = {"/", "/api/v1", "/api/v1/me", "/api/v1/authx", "/api/v1/auth.json", "/api/v1/ledgers/auth/login",
            "/api/v2/auth/login", "/actuator/health", "/error"})
    void 다른_경로는_보지_않는다(String path) throws Exception {
        assertThat(isPassed(request("GET", path, null, "https://evil.example"))).isTrue();
        assertThat(isPassed(request("POST", path, null))).isTrue();
    }

    private boolean isPassed(MockHttpServletRequest request) throws Exception {
        MockHttpServletResponse response = new MockHttpServletResponse();
        MockFilterChain chain = new MockFilterChain();
        filter.doFilter(request, response, chain);
        assertThat(response.getStatus()).isEqualTo(chain.getRequest() == null ? 403 : 200);
        return chain.getRequest() != null;
    }

    private void assertNotAllowed(MockHttpServletRequest request) throws Exception {
        assertThat(isPassed(request)).isFalse();
    }

    private static MockHttpServletRequest request(String method, String path, String client, String... origins) {
        MockHttpServletRequest request = new MockHttpServletRequest(method, path);
        if (client != null) {
            request.addHeader("X-Akkimpyo-Client", client);
        }
        Arrays.stream(origins).forEach(origin -> request.addHeader("Origin", origin));
        return request;
    }
}
