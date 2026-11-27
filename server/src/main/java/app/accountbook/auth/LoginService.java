package app.accountbook.auth;

import app.accountbook.user.User;
import app.accountbook.user.UserService;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

/** 로그인(F-009)과 가입 직후의 로그인. 확인과 가입은 user가 하고 여기서는 결과만 받아 토큰을 발급한다(ADR 004 결정 6). */
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

    /**
     * 가입(F-002, F-003)하고 그 사용자의 access token을 준다. 가입과 그 규칙(입력, 허용 목록, 중복)은 user가 하고
     * 여기서는 만들어진 사용자의 토큰만 발급한다(login과 같은 모양). 둘은 한 트랜잭션이 아니다. 발급이 실패해도 가입은 남고
     * 사용자는 로그인하면 된다(ADR 004). 해시가 DB 연결을 잡지 않도록 트랜잭션 안에서 부르지 않는다.
     */
    public String signup(String email, String password, String displayName) {
        User user = userService.createUser(email, password, displayName);
        return issuer.issue(user.getId());
    }
}
