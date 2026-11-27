package app.accountbook.auth;

import app.accountbook.user.User;
import app.accountbook.user.UserService;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 로그인(F-009), 가입 직후의 로그인, 갱신. 확인과 가입은 user가 하고 여기서는 그 결과로 토큰을 준다(ADR 004 결정 6).
 * 로그인과 가입은 새 refresh token 계열을 만들고, 요청의 refresh 쿠키가 가리키던 계열은 폐기한다(ADR 001 결정 3).
 * 모두 비밀번호 해시가 DB 연결을 잡지 않도록 트랜잭션 안에서 부르지 않는다.
 */
@Service
public class LoginService {

    private static final Logger log = LoggerFactory.getLogger(LoginService.class);

    private final UserService userService;
    private final AccessTokenIssuer issuer;
    private final RefreshTokenService refreshTokens;
    private final TransactionTemplate transactionTemplate;

    LoginService(UserService userService, AccessTokenIssuer issuer, RefreshTokenService refreshTokens,
                 TransactionTemplate transactionTemplate) {
        this.userService = userService;
        this.issuer = issuer;
        this.refreshTokens = refreshTokens;
        this.transactionTemplate = transactionTemplate;
    }

    /**
     * 이메일과 비밀번호가 맞으면 그 사용자의 토큰. 아니면 {@link InvalidCredentialsException}이고 이유를 나누지 않으며
     * 아무것도 폐기하지 않는다(P-105). 실패는 사용자를 아는 user가 로그로 남긴다.
     *
     * @param refreshCookie 요청의 refresh 쿠키 값. 없으면 null
     */
    public LoginTokens login(String email, String password, String refreshCookie) {
        UUID userId = userService.authenticate(email, password).orElseThrow(InvalidCredentialsException::new);
        IssuedRefreshToken refreshToken = transactionTemplate.execute(status -> newFamily(userId, refreshCookie));
        log.info("로그인 성공: 사용자 {}", userId);
        return tokens(refreshToken);
    }

    /**
     * 가입(F-002, F-003)하고 그 사용자의 토큰을 준다. 가입과 그 규칙(입력, 허용 목록, 중복)은 user가 한다. 가입과 계열은
     * 한 트랜잭션이 아니다. 계열 쪽이 실패해도 가입은 남고 사용자는 로그인하면 된다(ADR 004, dba).
     */
    public LoginTokens signup(String email, String password, String displayName, String refreshCookie) {
        User user = userService.createUser(email, password, displayName);
        return tokens(transactionTemplate.execute(status -> newFamily(user.getId(), refreshCookie)));
    }

    /**
     * 갱신: refresh 쿠키의 값을 회전하고 새 access token을 준다. 쓸 수 없는 값이면 {@link RefreshRejectedException}이다.
     * 재사용 감지의 폐기가 되돌려지지 않게 회전은 바깥 트랜잭션 없이 커밋한다.
     */
    public LoginTokens refresh(String refreshCookie) {
        return refreshTokens.rotate(refreshCookie).map(this::tokens).orElseThrow(RefreshRejectedException::new);
    }

    private IssuedRefreshToken newFamily(UUID userId, String refreshCookie) {
        refreshTokens.revokeFamily(refreshCookie);
        return refreshTokens.issue(userId);
    }

    private LoginTokens tokens(IssuedRefreshToken refreshToken) {
        return new LoginTokens(issuer.issue(refreshToken.userId()), refreshToken);
    }
}
