package app.accountbook.api;

import static org.assertj.core.api.Assertions.assertThat;

import app.accountbook.auth.IssuedRefreshToken;
import app.accountbook.auth.LoginTokens;
import app.accountbook.support.SignedInUser;
import app.accountbook.support.StoppedClockConfig.StoppedClock;
import jakarta.servlet.http.Cookie;
import java.time.Duration;
import java.time.Instant;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.mock.env.MockEnvironment;
import org.springframework.mock.web.MockHttpServletRequest;

/**
 * refresh 쿠키의 Secure와 {@code __Secure-} 접두어는 local 프로파일에서만 꺼진다(ADR 001 결정 4). 지우는 쿠키도 같다.
 * 켜진 쪽은 RefreshTest와 LogoutTest가 본다.
 */
class RefreshCookieTest {

    private static final Instant NOW = Instant.parse("2030-01-01T00:00:00Z");

    @Test
    void local_프로파일에서만_Secure와_접두어를_끄고_다른_속성은_같다() {
        StoppedClock clock = new StoppedClock();
        clock.stopAt(NOW);
        MockEnvironment local = new MockEnvironment();
        local.setActiveProfiles("local");
        LoginTokens tokens = new LoginTokens("access",
                new IssuedRefreshToken("value", SignedInUser.ID, NOW.plus(Duration.ofDays(30))));

        String localCookie = setCookie(new RefreshCookie(local, clock), tokens);
        String defaultCookie = setCookie(new RefreshCookie(new MockEnvironment(), clock), tokens);

        assertThat(localCookie).startsWith("akkimpyo_refresh=value; Path=/api/v1/auth; Max-Age=2592000; ")
                .contains("; HttpOnly", "; SameSite=Strict").doesNotContain("Secure", "Domain");
        assertThat(defaultCookie).startsWith("__Secure-akkimpyo_refresh=value; Path=/api/v1/auth; Max-Age=2592000; ")
                .contains("; Secure", "; HttpOnly", "; SameSite=Strict");

        MockHttpServletRequest request = new MockHttpServletRequest();
        request.setCookies(new Cookie("__Secure-akkimpyo_refresh", "a"), new Cookie("akkimpyo_refresh", "b"));
        assertThat(new RefreshCookie(local, clock).read(request)).isEqualTo("b");
        assertThat(new RefreshCookie(new MockEnvironment(), clock).read(request)).isEqualTo("a");

        assertThat(clearCookie(new RefreshCookie(local, clock)))
                .startsWith("akkimpyo_refresh=; Path=/api/v1/auth; Max-Age=0; ")
                .contains("; HttpOnly", "; SameSite=Strict").doesNotContain("Secure", "Domain");
        assertThat(clearCookie(new RefreshCookie(new MockEnvironment(), clock)))
                .startsWith("__Secure-akkimpyo_refresh=; Path=/api/v1/auth; Max-Age=0; ")
                .contains("; Secure", "; HttpOnly", "; SameSite=Strict").doesNotContain("Domain");
    }

    /** 로그아웃의 응답(#28): 204이고 같은 이름·Path·속성에 Max-Age=0인 쿠키 하나다. */
    private static String clearCookie(RefreshCookie cookie) {
        ResponseEntity<Void> response = cookie.clear();
        assertThat(response.getStatusCode()).isEqualTo(HttpStatus.NO_CONTENT);
        assertThat(response.getHeaders().get(HttpHeaders.SET_COOKIE)).hasSize(1);
        return response.getHeaders().getFirst(HttpHeaders.SET_COOKIE);
    }

    private static String setCookie(RefreshCookie cookie, LoginTokens tokens) {
        return cookie.respond(HttpStatus.OK, tokens).getHeaders().getFirst(HttpHeaders.SET_COOKIE);
    }
}
