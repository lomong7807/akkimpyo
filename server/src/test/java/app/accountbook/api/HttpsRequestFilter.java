package app.accountbook.api;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletRequestWrapper;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.springframework.boot.test.context.TestComponent;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.web.filter.OncePerRequestFilter;

/** 프록시 뒤에서 https로 온 요청을 흉내 내는 테스트용 필터. {@link #HEADER}가 있는 요청만 https로 보인다. */
@TestComponent
@Order(Ordered.HIGHEST_PRECEDENCE + 10)
class HttpsRequestFilter extends OncePerRequestFilter {

    static final String HEADER = "X-Test-Https";

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        chain.doFilter(request.getHeader(HEADER) == null ? request : new HttpsRequest(request), response);
    }

    private static final class HttpsRequest extends HttpServletRequestWrapper {

        HttpsRequest(HttpServletRequest request) {
            super(request);
        }

        @Override
        public boolean isSecure() {
            return true;
        }

        @Override
        public String getScheme() {
            return "https";
        }
    }
}
