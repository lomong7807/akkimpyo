package app.accountbook.api;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.apache.catalina.connector.ClientAbortException;
import org.springframework.boot.test.context.TestComponent;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.web.filter.OncePerRequestFilter;

/** 컨트롤러에 닿기 전에 실패하거나 쿼리를 읽는 테스트용 필터. */
@TestComponent
@Order(Ordered.HIGHEST_PRECEDENCE + 10)
class ThrowingFilter extends OncePerRequestFilter {

    static final String THROW = "/test/filter/throw";
    static final String THROW_AFTER_FLUSH = "/test/filter/throw-after-flush";
    static final String THROW_ERROR = "/test/filter/throw-error";
    static final String READ_PARAMETER = "/test/filter/read-parameter";
    static final String CLIENT_ABORT = "/test/filter/client-abort";
    static final String WRAPPED_CLIENT_ABORT = "/test/filter/wrapped-client-abort";

    static final String MESSAGE = "필터 예외의 문구";

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        switch (request.getRequestURI()) {
            case THROW -> throw new IllegalStateException(MESSAGE);
            case THROW_ERROR -> throw new AssertionError(MESSAGE);
            case THROW_AFTER_FLUSH -> {
                response.getOutputStream().write('x');
                response.flushBuffer();
                throw new IllegalStateException(MESSAGE);
            }
            case CLIENT_ABORT -> throw new ClientAbortException();
            case WRAPPED_CLIENT_ABORT -> throw new ServletException(MESSAGE, new ClientAbortException());
            case READ_PARAMETER -> request.getParameter("token");
            default -> chain.doFilter(request, response);
        }
    }
}
