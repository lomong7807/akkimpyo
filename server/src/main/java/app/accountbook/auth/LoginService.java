package app.accountbook.auth;

import app.accountbook.user.UserService;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

/** 로그인(F-009). 확인은 user가 하고 여기서는 결과만 받아 토큰을 발급한다(ADR 004 결정 6). */
@Service
public class LoginService {

    private static final Logger log = LoggerFactory.getLogger(LoginService.class);

    private final UserService userService;
    private final AccessTokenIssuer issuer;

    LoginService(UserService userService, AccessTokenIssuer issuer) {
        this.userService = userService;
        this.issuer = issuer;
    }

    /**
     * 이메일과 비밀번호가 맞으면 그 사용자의 access token. 아니면 {@link InvalidCredentialsException}이고 이유를 나누지 않는다(P-105).
     * 비밀번호 비교가 DB 연결을 잡지 않도록 트랜잭션 안에서 부르지 않는다. 실패는 사용자를 아는 user가 로그로 남긴다.
     */
    public String login(String email, String password) {
        UUID userId = userService.authenticate(email, password).orElseThrow(InvalidCredentialsException::new);
        String accessToken = issuer.issue(userId);
        log.info("로그인 성공: 사용자 {}", userId);
        return accessToken;
    }
}
