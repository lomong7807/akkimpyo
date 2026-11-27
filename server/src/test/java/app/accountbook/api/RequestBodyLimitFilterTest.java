package app.accountbook.api;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.catchException;

import jakarta.servlet.ReadListener;
import jakarta.servlet.ServletInputStream;
import jakarta.servlet.http.HttpServletRequest;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.util.unit.DataSize;

/** 실제 Tomcat으로는 만들 수 없는 경우와 설정을 본다(#21). 나머지는 {@link RequestBodyLimitTest}가 실제 서버로 본다. */
class RequestBodyLimitFilterTest {

    private static final int LIMIT = 1024;

    private final RequestBodyLimitFilter filter =
            new RequestBodyLimitFilter(new RequestBodyProperties(DataSize.ofBytes(LIMIT)));
    private final MockHttpServletResponse response = new MockHttpServletResponse();
    private final MockFilterChain chain = new MockFilterChain();

    @ParameterizedTest
    @CsvSource({"1024, 200", "1025, 413"})
    void 설정한_값이_상한이다(int length, int status) {
        new ApplicationContextRunner().withUserConfiguration(RequestBodyConfig.class)
                .withPropertyValues("accountbook.request-body.max-size=1KB")
                .run(context -> {
                    context.getBean(RequestBodyLimitFilter.class).doFilter(request(length), response, chain);

                    assertThat(response.getStatus()).isEqualTo(status);
                    assertThat(chain.getRequest() != null).isEqualTo(status == 200);
                });
    }

    /** Tomcat은 적힌 만큼만 준다. 그렇지 않은 서버에서도 적힌 값을 믿지 않는다. */
    @Test
    void Content_Length가_작아도_읽은_양이_넘으면_413이다() throws Exception {
        MockHttpServletRequest lying = new MockHttpServletRequest("POST", "/x") {
            @Override
            public long getContentLengthLong() {
                return 10;
            }
        };
        lying.setContent(new byte[LIMIT + 1]);

        filter.doFilter(lying, response, chain);

        assertThat(response.getStatus()).isEqualTo(413);
        assertThat(chain.getRequest()).isNull();
    }

    @Test
    void Content_Length가_크면_본문을_열지_않는다() throws Exception {
        MockHttpServletRequest declared = new MockHttpServletRequest("POST", "/x") {
            @Override
            public ServletInputStream getInputStream() {
                throw new AssertionError("본문을 열었다");
            }
        };
        declared.setContent(new byte[LIMIT + 1]);

        filter.doFilter(declared, response, chain);

        assertThat(response.getStatus()).isEqualTo(413);
        assertThat(chain.getRequest()).isNull();
    }

    @Test
    void 서버가_상태를_정하지_않은_읽기_오류는_감추지_않는다() {
        IOException failure = new IOException("읽지 못함");

        assertThat(catchException(() -> filter.doFilter(unreadable(failure), response, chain))).isSameAs(failure);
        assertThat(chain.getRequest()).isNull();
    }

    @Test
    void 서버가_상태를_정한_읽기_오류는_그_상태로_끝난다() throws Exception {
        MockHttpServletRequest stalled = unreadable(new IOException("보내다 멈춤"));
        // Tomcat은 예외를 던지기 전에 상태를 정해 둔다.
        response.sendError(408);

        filter.doFilter(stalled, response, chain);

        assertThat(response.getStatus()).isEqualTo(408);
        assertThat(chain.getRequest()).isNull();
    }

    @ParameterizedTest
    @CsvSource({"UTF-8, UTF-8", ", ISO-8859-1"})
    void 글자로_읽을_때는_요청의_인코딩을_쓰고_없으면_서블릿의_기본값이다(String requested, String used) throws Exception {
        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/x");
        request.setCharacterEncoding(requested);
        byte[] bytes = "é".getBytes(StandardCharsets.UTF_8);
        request.setContent(bytes);

        filter.doFilter(request, response, chain);

        assertThat(inside().getReader().readLine()).isEqualTo(new String(bytes, used));
    }

    @Test
    void 받은_본문은_끝까지_읽으면_끝난_것이고_나눠_읽기는_받지_않는다() throws Exception {
        filter.doFilter(request(2), response, chain);

        ServletInputStream body = inside().getInputStream();
        assertThat(body.isReady()).isTrue();
        assertThat(body.read()).isZero();
        assertThat(body.isFinished()).isFalse();
        assertThat(body.read()).isZero();
        assertThat(body.isFinished()).isTrue();
        assertThat(body.read()).isEqualTo(-1);
        assertThatThrownBy(() -> body.setReadListener(new NoListener())).isInstanceOf(IllegalStateException.class);
    }

    private HttpServletRequest inside() {
        return (HttpServletRequest) chain.getRequest();
    }

    private static MockHttpServletRequest request(int length) {
        MockHttpServletRequest request = new MockHttpServletRequest("POST", "/x");
        request.setContent(new byte[length]);
        return request;
    }

    private static MockHttpServletRequest unreadable(IOException failure) {
        return new MockHttpServletRequest("POST", "/x") {
            @Override
            public ServletInputStream getInputStream() {
                return new ServletInputStream() {
                    @Override
                    public int read() throws IOException {
                        throw failure;
                    }

                    @Override
                    public boolean isFinished() {
                        return false;
                    }

                    @Override
                    public boolean isReady() {
                        return true;
                    }

                    @Override
                    public void setReadListener(ReadListener listener) {
                        throw new UnsupportedOperationException();
                    }
                };
            }
        };
    }

    private static final class NoListener implements ReadListener {

        @Override
        public void onDataAvailable() {
        }

        @Override
        public void onAllDataRead() {
        }

        @Override
        public void onError(Throwable throwable) {
        }
    }
}
