package app.accountbook.api;

import app.accountbook.auth.LoginService;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.validation.Valid;
import java.util.Map;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 인증. 이 아래의 경로는 모두 POST이고 출처를 먼저 본다({@link AuthRequestFilter}). 토큰이 든 응답은 캐시하지 않는다
 * ({@link SecurityConfig}의 Cache-Control). access token은 본문으로, refresh token은 쿠키로만 준다({@link RefreshCookie}).
 */
@RestController
@RequestMapping("/api/v1/auth")
class AuthController {

    private final LoginService loginService;
    private final RefreshCookie refreshCookie;

    AuthController(LoginService loginService, RefreshCookie refreshCookie) {
        this.loginService = loginService;
        this.refreshCookie = refreshCookie;
    }

    /**
     * produces와 consumes를 적어 줄 수 없는 형식의 응답과 JSON이 아닌 본문을 비밀번호를 확인하기 전에 거절한다(ADR 002 5절).
     * 요청의 refresh 쿠키가 가리키던 계열은 로그인이 성공할 때만 폐기한다(ADR 001 결정 3).
     */
    @PostMapping(path = "/login", consumes = MediaType.APPLICATION_JSON_VALUE,
            produces = MediaType.APPLICATION_JSON_VALUE)
    ResponseEntity<AccessTokenResponse> login(@Valid @RequestBody LoginRequest request, HttpServletRequest http) {
        return refreshCookie.respond(HttpStatus.OK,
                loginService.login(request.email(), request.password(), refreshCookie.read(http)));
    }

    /** 가입(F-002)하고 로그인과 같은 토큰을 준다. api는 auth만 부른다(ModuleBoundaryTest). */
    @PostMapping(path = "/signup", consumes = MediaType.APPLICATION_JSON_VALUE,
            produces = MediaType.APPLICATION_JSON_VALUE)
    ResponseEntity<AccessTokenResponse> signup(@RequestBody SignupRequest request, HttpServletRequest http) {
        return refreshCookie.respond(HttpStatus.CREATED, loginService.signup(request.email(), request.password(),
                request.displayName(), refreshCookie.read(http)));
    }

    /**
     * 갱신(#26): refresh 쿠키만으로 인증한다. 화면은 본문과 Content-Type 없이 보낸다. 본문이 있으면 JSON만 받고 읽지 않는다
     * (본문이 필수가 아니면 본문 없는 요청은 consumes를 보지 않는다). 실패는 401이고 쿠키를 지우지 않는다(security 결정).
     */
    @PostMapping(path = "/refresh", consumes = MediaType.APPLICATION_JSON_VALUE,
            produces = MediaType.APPLICATION_JSON_VALUE)
    ResponseEntity<AccessTokenResponse> refresh(@RequestBody(required = false) Map<String, Object> ignored,
                                                HttpServletRequest http) {
        return refreshCookie.respond(HttpStatus.OK, loginService.refresh(refreshCookie.read(http)));
    }
}
