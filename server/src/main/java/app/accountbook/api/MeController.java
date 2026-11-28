package app.accountbook.api;

import app.accountbook.ledger.LedgerService;
import app.accountbook.user.UserService;
import java.util.UUID;
import org.springframework.http.MediaType;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 내 정보(#30, #68, F-009, F-014). 사용자는 검증한 access token으로만 정한다. 경로에 사용자 id가 없다.
 * 응답은 사람마다 달라 캐시하지 않는다(SecurityConfig의 Cache-Control).
 */
@RestController
@RequestMapping("/api/v1/me")
class MeController {

    private final UserService userService;
    private final LedgerService ledgerService;

    MeController(UserService userService, LedgerService ledgerService) {
        this.userService = userService;
        this.ledgerService = ledgerService;
    }

    /** user와 ledger의 값을 차례로 읽어 합친다. 그 사이의 짧은 시점 차이는 받아들인다(ADR 004 결정 6). */
    @GetMapping(produces = MediaType.APPLICATION_JSON_VALUE)
    MeResponse getMe(@AuthenticationPrincipal UUID userId) {
        return MeResponse.of(userId, userService.profile(userId), ledgerService.memberships(userId));
    }

    /**
     * 표시 이름 바꾸기(#68, F-014). 200이고 본문은 내 정보 조회와 같다. 같은 이름이어도 200이다. 바꾸는 사람은 토큰의 사용자뿐이고
     * 이메일은 바꾸지 않는다(P-113). 검증은 가입과 같다(P-101). 응답할 수 없는 {@code Accept}와 JSON이 아닌 본문은 바꾸기 전에
     * 거절된다(ADR 002 5절).
     */
    @PutMapping(path = "/display-name", consumes = MediaType.APPLICATION_JSON_VALUE,
            produces = MediaType.APPLICATION_JSON_VALUE)
    MeResponse changeDisplayName(@AuthenticationPrincipal UUID userId, @RequestBody DisplayNameRequest request) {
        return MeResponse.of(userId, userService.changeDisplayName(userId, request.displayName()),
                ledgerService.memberships(userId));
    }
}
