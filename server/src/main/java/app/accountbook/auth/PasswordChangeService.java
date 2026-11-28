package app.accountbook.auth;

import app.accountbook.user.PasswordChange;
import app.accountbook.user.UserService;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

/**
 * 비밀번호 바꾸기(#31, F-015, P-108). 현재 비밀번호 확인과 새 해시는 user가 트랜잭션 밖에서 하고, 저장과 다른 계열의 폐기는
 * 여기서 여는 한 트랜잭션에서 한다(ADR 001 결정 7, ADR 004 결정 6). 저장은 사용자 행을 {@code FOR NO KEY UPDATE}로 잠그므로,
 * 옛 비밀번호로 확인을 마친 로그인은 이 트랜잭션보다 먼저 커밋해 여기서 폐기되거나, 뒤에 저장값이 달라져 실패한다.
 */
@Service
public class PasswordChangeService {

    private final UserService userService;
    private final RefreshTokenService refreshTokens;
    private final TransactionTemplate transactionTemplate;

    PasswordChangeService(UserService userService, RefreshTokenService refreshTokens,
                          TransactionTemplate transactionTemplate) {
        this.userService = userService;
        this.refreshTokens = refreshTokens;
        this.transactionTemplate = transactionTemplate;
    }

    /**
     * 현재 비밀번호가 맞으면 새 비밀번호로 바꾸고 refreshCookie의 계열(지금 기기)만 남긴다. 쿠키가 없거나 그 사용자의 쓸 수
     * 있는 계열이 아니면 모두 폐기한다(ADR 001 결정 3). 오류면 아무것도 바꾸지 않는다. 트랜잭션 안에서 부르지 않는다.
     *
     * @param refreshCookie 요청의 refresh 쿠키 값. 없으면 null
     */
    public void changePassword(UUID actorId, String currentPassword, String newPassword, String refreshCookie) {
        PasswordChange change = userService.checkPasswordChange(actorId, currentPassword, newPassword);
        transactionTemplate.executeWithoutResult(status -> {
            userService.changePassword(change);
            refreshTokens.revokeOthers(actorId, refreshCookie);
        });
    }
}
