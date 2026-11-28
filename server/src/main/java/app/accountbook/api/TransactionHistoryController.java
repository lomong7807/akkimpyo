package app.accountbook.api;

import app.accountbook.transaction.TransactionHistoryQuery;
import app.accountbook.user.UserService;
import java.util.UUID;
import org.springframework.http.MediaType;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 거래 하나의 변경 이력(F-228, P-216, #47 응답 계약). 거래 상세({@link TransactionController})와 같은 경로 아래다.
 * 구성원이 아니면 {@link LedgerMemberInterceptor}가 먼저 404로 답하고, 조회가 구성원을 한 번 더 확인한다. 휴지통의 거래도
 * 200이고, 없는 거래·다른 장부의 거래·완전히 지운 거래는 구분하지 않고 404다.
 */
@RestController
@RequestMapping(path = "/api/v1/ledgers/{ledgerId}/transactions/{transactionId}/history",
        produces = MediaType.APPLICATION_JSON_VALUE)
class TransactionHistoryController {

    private final TransactionHistoryQuery transactionHistoryQuery;
    private final UserService userService;

    TransactionHistoryController(TransactionHistoryQuery transactionHistoryQuery, UserService userService) {
        this.transactionHistoryQuery = transactionHistoryQuery;
        this.userService = userService;
    }

    /** 이름은 이력을 읽은 뒤 한 번 읽는다. */
    @GetMapping
    HistoryResponse getTransactionHistory(@AuthenticationPrincipal UUID actorId, @PathVariable UUID ledgerId,
                            @PathVariable UUID transactionId) {
        return HistoryResponse.of(transactionHistoryQuery.history(actorId, ledgerId, transactionId),
                userService.memberDisplayNames(actorId, ledgerId));
    }
}
