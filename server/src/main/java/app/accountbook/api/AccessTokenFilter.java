package app.accountbook.api;

import app.accountbook.auth.AccessTokenVerifier;
import jakarta.servlet.FilterChain;
import jakarta.servlet.ServletException;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import java.util.Collections;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.springframework.http.HttpHeaders;
import org.springframework.security.core.context.SecurityContext;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.security.web.authentication.preauth.PreAuthenticatedAuthenticationToken;
import org.springframework.security.web.context.RequestAttributeSecurityContextRepository;
import org.springframework.security.web.context.SecurityContextRepository;
import org.springframework.web.filter.OncePerRequestFilter;

/**
 * {@code Authorization: Bearer} 헤더의 access token으로 누구의 요청인지 정한다(ADR 001 결정 1). 다른 곳은 보지 않는다.
 * 유효하지 않으면 로그인하지 않은 요청으로 두고, 막는 것은 {@link SecurityConfig}의 규칙이 한다.
 *
 * <p>빈으로 두지 않는다. 빈이면 스프링 부트가 필터 체인 밖에도 한 번 더 등록한다.
 */
final class AccessTokenFilter extends OncePerRequestFilter {

    /** RFC 6750 2.1절. 방식의 이름은 대소문자를 가리지 않는다(RFC 9110 11.1절). */
    private static final Pattern BEARER = Pattern.compile("(?i:Bearer) +([A-Za-z0-9._~+/-]+=*)");

    private final AccessTokenVerifier verifier;
    /** 응답을 다른 스레드에서 만드는 요청이 이어질 때 다시 읽는 곳. 요청과 함께 사라진다. */
    private final SecurityContextRepository contexts = new RequestAttributeSecurityContextRepository();

    AccessTokenFilter(AccessTokenVerifier verifier) {
        this.verifier = verifier;
    }

    @Override
    protected void doFilterInternal(HttpServletRequest request, HttpServletResponse response, FilterChain chain)
            throws ServletException, IOException {
        bearerToken(request).flatMap(verifier::verify).ifPresent(userId -> signIn(userId, request, response));
        chain.doFilter(request, response);
    }

    /** 헤더가 여럿이면 어느 것을 믿을지 정하지 않고 받지 않는다. */
    private static Optional<String> bearerToken(HttpServletRequest request) {
        List<String> values = Collections.list(request.getHeaders(HttpHeaders.AUTHORIZATION));
        if (values.size() != 1) {
            return Optional.empty();
        }
        Matcher matcher = BEARER.matcher(values.getFirst());
        return matcher.matches() ? Optional.of(matcher.group(1)) : Optional.empty();
    }

    /** 토큰은 남기지 않는다. 권한은 요청마다 장부 구성원 정보로 판단하므로 여기서 주는 것은 없다. */
    private void signIn(UUID userId, HttpServletRequest request, HttpServletResponse response) {
        SecurityContext context = SecurityContextHolder.createEmptyContext();
        context.setAuthentication(new PreAuthenticatedAuthenticationToken(userId, null, List.of()));
        SecurityContextHolder.setContext(context);
        contexts.saveContext(context, request, response);
    }
}
