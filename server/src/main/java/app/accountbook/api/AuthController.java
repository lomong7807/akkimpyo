package app.accountbook.api;

import app.accountbook.auth.LoginService;
import jakarta.validation.Valid;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/** 인증. 이 아래의 경로는 모두 POST이고 출처를 먼저 본다({@link AuthRequestFilter}). */
@RestController
@RequestMapping("/api/v1/auth")
class AuthController {

    private final LoginService loginService;

    AuthController(LoginService loginService) {
        this.loginService = loginService;
    }

    /** produces와 consumes를 적어 줄 수 없는 형식의 응답과 JSON이 아닌 본문을 비밀번호를 확인하기 전에 거절한다(ADR 002 5절). */
    @PostMapping(path = "/login", consumes = MediaType.APPLICATION_JSON_VALUE,
            produces = MediaType.APPLICATION_JSON_VALUE)
    AccessTokenResponse login(@Valid @RequestBody LoginRequest request) {
        return new AccessTokenResponse(loginService.login(request.email(), request.password()));
    }

    /** 가입(F-002)하고 로그인과 같은 토큰을 준다. api는 auth만 부른다(ModuleBoundaryTest). refresh 쿠키는 #26. */
    @PostMapping(path = "/signup", consumes = MediaType.APPLICATION_JSON_VALUE,
            produces = MediaType.APPLICATION_JSON_VALUE)
    @ResponseStatus(HttpStatus.CREATED)
    AccessTokenResponse signup(@RequestBody SignupRequest request) {
        return new AccessTokenResponse(loginService.signup(request.email(), request.password(), request.displayName()));
    }
}
