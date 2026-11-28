package app.accountbook.api;

import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.Collections;
import java.util.List;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.security.web.servlet.util.matcher.PathPatternRequestMatcher;
import org.springframework.security.web.util.matcher.RequestMatcher;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * {@code /api/v1/auth} 아래는 우리 화면이 보낸 POST만 받는다(ADR 001 결정 5). 다른 사이트가 사용자의 브라우저로
 * 로그인이나 쿠키로 인증하는 요청을 보내지 못하게 한다. 토큰 확인과 본문 읽기, 비밀번호 해시보다 먼저 본다.
 *
 * <p>빈으로 두지 않는다. 빈이면 스프링 부트가 필터 체인 밖에도 한 번 더 등록한다.
 */
final class AuthRequestFilter extends OncePerRequestFilter {

    /** 값은 클라이언트의 종류다. 있는지만 보고 값으로 판단하지 않는다. */
    private static final String CLIENT_HEADER = "X-Akkimpyo-Client";
    private static final RequestMatcher AUTH_PATHS = PathPatternRequestMatcher.pathPattern("/api/v1/auth/**");

    private final WebOrigin webOrigin;

    AuthRequestFilter(WebOrigin webOrigin) {
        this.webOrigin = webOrigin;
    }

    @Override
    protected boolean shouldNotFilter(HttpServletRequest request) {
        return !AUTH_PATHS.matches(request);
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        if (!isFromUs(request)) {
            ApiErrorController.send(ErrorCode.ORIGIN_NOT_ALLOWED, request, response);
        } else if (!HttpMethod.POST.matches(request.getMethod())) {
            response.setHeader(HttpHeaders.ALLOW, HttpMethod.POST.name());
            ApiErrorController.send(ErrorCode.METHOD_NOT_ALLOWED, request, response);
        } else {
            chain.doFilter(request, response);
        }
    }

    /** 브라우저가 아닌 클라이언트는 Origin을 보내지 않으므로 없어도 된다. 여럿이면 어느 것을 믿을지 정하지 않고 받지 않는다. */
    private boolean isFromUs(HttpServletRequest request) {
        List<String> origins = Collections.list(request.getHeaders(HttpHeaders.ORIGIN));
        return request.getHeader(CLIENT_HEADER) != null
                && origins.size() <= 1
                && origins.stream().allMatch(webOrigin::matches);
    }
}
