package app.accountbook.api;

import app.accountbook.auth.AccessTokenVerifier;
import jakarta.servlet.DispatcherType;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import java.io.IOException;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.annotation.web.configurers.AbstractHttpConfigurer;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.core.AuthenticationException;
import org.springframework.security.web.SecurityFilterChain;
import org.springframework.security.web.authentication.AnonymousAuthenticationFilter;
import org.springframework.security.web.firewall.HttpFirewall;
import org.springframework.security.web.firewall.StrictHttpFirewall;
import org.springframework.security.web.header.HeaderWriterFilter;
import org.springframework.security.web.servlet.util.matcher.PathPatternRequestMatcher;
import org.springframework.security.web.util.matcher.RequestMatcher;

/**
 * 접근 제한(#12, ADR 001). 공개 주소의 목록에 없는 요청은 있는 주소든 없는 주소든 유효한 access token이 있어야 한다.
 * 장부마다의 권한은 여기서 보지 않는다.
 */
@Configuration(proxyBeanMethods = false)
class SecurityConfig {

    /** 토큰 없이 열리는 주소. 메서드와 경로를 글자 그대로 적는다(별표를 쓰지 않는다). 더할 때는 security 검토를 받는다. */
    private static final RequestMatcher[] PUBLIC = {
            PathPatternRequestMatcher.pathPattern(HttpMethod.GET, "/actuator/health"),
    };

    @Bean
    SecurityFilterChain securityFilterChain(HttpSecurity http, AccessTokenVerifier verifier, WebOrigin webOrigin) {
        return http
                .authorizeHttpRequests(requests -> requests
                        // 오류 응답을 그리는 전달이다. 밖에서 직접 부른 /error는 여기에 들지 않는다.
                        .dispatcherTypeMatchers(DispatcherType.ERROR).permitAll()
                        .requestMatchers(PUBLIC).permitAll()
                        .anyRequest().authenticated())
                // 거절하는 응답에도 Cache-Control이 붙게 헤더를 쓰는 필터 바로 다음에 둔다.
                .addFilterAfter(new AuthRequestFilter(webOrigin), HeaderWriterFilter.class)
                .addFilterBefore(new AccessTokenFilter(verifier), AnonymousAuthenticationFilter.class)
                .exceptionHandling(handling -> handling.authenticationEntryPoint(SecurityConfig::unauthenticated))
                .sessionManagement(session -> session.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
                // 캐시하지 말라는 것만 붙인다. HSTS와 나머지 보안 헤더는 프록시 한 곳에서 붙인다(ADR 005 결정 6).
                .headers(headers -> headers.defaultsDisabled().cacheControl(Customizer.withDefaults()))
                // 세션이 없다. 쿠키로 인증하는 요청의 방어는 출처 검사다(ADR 001 결정 5).
                .csrf(AbstractHttpConfigurer::disable)
                .logout(AbstractHttpConfigurer::disable)
                .build();
    }

    /**
     * 기본 방화벽에서 헤더 값의 글자 검사만 뺀다. 줄바꿈과 NUL 같은 제어 문자는 Tomcat이 먼저 거절한다.
     * 켜 두면 컨트롤러나 /error가 헤더를 읽는 도중에 값이 든 예외가 나서 값이 로그에 남거나(Origin) 본문이 빈 400이 나간다(Accept).
     */
    @Bean
    HttpFirewall httpFirewall() {
        StrictHttpFirewall firewall = new StrictHttpFirewall();
        firewall.setAllowedHeaderValues(value -> true);
        return firewall;
    }

    /** 이유를 나누지 않는다. 본문은 {@link ApiErrorController}가 쓴다. */
    private static void unauthenticated(HttpServletRequest request, HttpServletResponse response,
                                        AuthenticationException e) throws IOException {
        // RFC 6750 3절: Bearer 뒤에 값이 하나는 있어야 한다.
        response.setHeader(HttpHeaders.WWW_AUTHENTICATE, "Bearer realm=\"account-book\"");
        response.sendError(HttpServletResponse.SC_UNAUTHORIZED);
    }
}
