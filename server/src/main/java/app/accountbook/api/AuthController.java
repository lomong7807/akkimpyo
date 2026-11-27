package app.accountbook.api;

import app.accountbook.auth.LoginService;
import app.accountbook.user.User;
import app.accountbook.user.UserService;
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
    private final UserService userService;

    AuthController(LoginService loginService, UserService userService) {
        this.loginService = loginService;
        this.userService = userService;
    }

    /** produces와 consumes를 적어 줄 수 없는 형식의 응답과 JSON이 아닌 본문을 비밀번호를 확인하기 전에 거절한다(ADR 002 5절). */
    @PostMapping(path = "/login", consumes = MediaType.APPLICATION_JSON_VALUE,
            produces = MediaType.APPLICATION_JSON_VALUE)
    AccessTokenResponse login(@Valid @RequestBody LoginRequest request) {
        return new AccessTokenResponse(loginService.login(request.email(), request.password()));
    }

    /** 가입(F-002)은 user, 이어서 로그인과 같은 토큰은 auth가 한다. 한 트랜잭션이 아니다(ADR 004). refresh 쿠키는 #26. */
    @PostMapping(path = "/signup", consumes = MediaType.APPLICATION_JSON_VALUE,
            produces = MediaType.APPLICATION_JSON_VALUE)
    @ResponseStatus(HttpStatus.CREATED)
    AccessTokenResponse signup(@RequestBody SignupRequest request) {
        User user = userService.createUser(request.email(), request.password(), request.displayName());
        return new AccessTokenResponse(loginService.loginNewUser(user));
    }
}
