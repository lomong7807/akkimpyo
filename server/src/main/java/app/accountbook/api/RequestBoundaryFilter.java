package app.accountbook.api;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.apache.coyote.BadRequestException;
import org.apache.coyote.CloseNowException;
import org.apache.tomcat.util.http.InvalidParameterException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.slf4j.MDC;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * 가장 바깥 필터. 요청 id를 응답 헤더와 로그(MDC)에 넣고, 안쪽 필터에서 나온 예외를 500으로 답하게 한다.
 * 여기서 받지 않으면 Tomcat이 요청 id 없이 로그를 남긴다.
 */
@Component
@Order(Ordered.HIGHEST_PRECEDENCE)
class RequestBoundaryFilter extends OncePerRequestFilter {

    private static final Logger log = LoggerFactory.getLogger(RequestBoundaryFilter.class);

    /** 오류를 그리는 전달(/error)에서도 요청 id를 넣는다. 필터를 거치지 않고 온 것(TRACE 등)도 있다. */
    @Override
    protected boolean shouldNotFilterErrorDispatch() {
        return false;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        String requestId = RequestId.of(request);
        response.setHeader(RequestId.HEADER, requestId);
        try (MDC.MDCCloseable ignored = MDC.putCloseable("requestId", requestId)) {
            callInside(request, response, chain);
        }
    }

    private static void callInside(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        try {
            chain.doFilter(request, response);
        } catch (BadRequestException | InvalidParameterException e) {
            // 읽을 수 없는 요청이다. Tomcat이 400으로 정하고 /error로 넘긴다.
            throw e;
        } catch (Throwable e) {
            if (!ApiExceptionHandler.isClientGone(e)) {
                log.error("처리하지 못한 예외", e);
            }
            if (response.isCommitted()) {
                // 이미 보낸 응답에 오류를 덧붙이지 않는다. 끊어야 받는 쪽이 잘린 응답인 것을 안다.
                throw new CloseNowException(e);
            }
            response.sendError(HttpServletResponse.SC_INTERNAL_SERVER_ERROR);
        }
    }
}
