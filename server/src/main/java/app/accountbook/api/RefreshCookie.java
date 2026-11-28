package app.accountbook.api;

import app.accountbook.auth.LoginTokens;
import jakarta.servlet.http.Cookie;
import jakarta.servlet.http.HttpServletRequest;
import java.time.Clock;
import java.time.Duration;
import java.util.Arrays;
import java.util.List;
import org.springframework.core.env.Environment;
import org.springframework.http.HttpHeaders;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseCookie;
import org.springframework.http.ResponseEntity;
import org.springframework.stereotype.Component;

/**
 * refresh 쿠키(ADR 001 결정 4, ADR 005 결정 6): {@code HttpOnly; Secure; SameSite=Strict; Path=/api/v1/auth}, Domain 없음,
 * 이름에 {@code __Secure-} 접두어, 유효 기간은 refresh token의 기한. local 프로파일(로컬 http)에서만 Secure와 접두어를 끈다.
 * 쿠키를 지우는 응답은 로그아웃(#28)뿐이고, 지우는 쿠키는 같은 이름·Path·속성에 {@code Max-Age=0}이다.
 */
@Component
final class RefreshCookie {

    static final String PATH = "/api/v1/auth";
    private static final String NAME = "akkimpyo_refresh";

    private final boolean secure;
    private final String name;
    private final Clock clock;

    RefreshCookie(Environment environment, Clock clock) {
        this.secure = !environment.matchesProfiles("local");
        this.name = secure ? "__Secure-" + NAME : NAME;
        this.clock = clock;
    }

    /** 요청의 refresh 쿠키 값. 없거나 같은 이름이 여럿이면 어느 것을 믿을지 정하지 않고 null이다. */
    String read(HttpServletRequest request) {
        List<String> values = Arrays.stream(request.getCookies() == null ? new Cookie[0] : request.getCookies())
                .filter(cookie -> cookie.getName().equals(name))
                .map(Cookie::getValue)
                .toList();
        return values.size() == 1 ? values.getFirst() : null;
    }

    /** access token을 본문으로, refresh token을 쿠키로 담은 응답. refresh token은 본문에 넣지 않는다. */
    ResponseEntity<AccessTokenResponse> respond(HttpStatus status, LoginTokens tokens) {
        return ResponseEntity.status(status)
                .header(HttpHeaders.SET_COOKIE, cookie(tokens.refreshToken().value(),
                        Duration.between(clock.instant(), tokens.refreshToken().expiresAt())))
                .body(new AccessTokenResponse(tokens.accessToken()));
    }

    /** 로그아웃의 응답: 본문 없는 204와 브라우저의 refresh 쿠키를 지우는 쿠키. */
    ResponseEntity<Void> clear() {
        return ResponseEntity.noContent().header(HttpHeaders.SET_COOKIE, cookie("", Duration.ZERO)).build();
    }

    private String cookie(String value, Duration maxAge) {
        return ResponseCookie.from(name, value)
                .httpOnly(true)
                .secure(secure)
                .sameSite("Strict")
                .path(PATH)
                .maxAge(maxAge)
                .build()
                .toString();
    }
}
