package app.accountbook.api;

import app.accountbook.ledger.LedgerService;
import app.accountbook.user.UserService;
import java.util.UUID;
import org.springframework.http.MediaType;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 내 정보(#30, F-009, F-014). 사용자는 검증한 access token으로만 정한다.
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
    MeResponse me(@AuthenticationPrincipal UUID userId) {
        return MeResponse.of(userId, userService.profile(userId), ledgerService.memberships(userId));
    }
}
