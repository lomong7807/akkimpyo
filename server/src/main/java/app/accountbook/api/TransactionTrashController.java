package app.accountbook.api;

import app.accountbook.common.FieldErrorCode;
import app.accountbook.common.InvalidRequestException;
import app.accountbook.transaction.TransactionTrashQuery;
import app.accountbook.transaction.TrashPage;
import app.accountbook.user.UserService;
import java.util.UUID;
import org.springframework.http.MediaType;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 장부의 휴지통(F-229, P-215, #47 응답 계약): {@code GET ?cursor=}. 거래 목록({@link TransactionController})과 같은 경로
 * 아래이고, 경로는 {@code /{transactionId}}보다 이것이 먼저 맞는다. 구성원이 아니면 cursor가 틀려도
 * {@link LedgerMemberInterceptor}가 먼저 404로 답하고, 서비스가 구성원을 한 번 더 확인한다.
 */
@RestController
@RequestMapping(path = "/api/v1/ledgers/{ledgerId}/transactions/trash", produces = MediaType.APPLICATION_JSON_VALUE)
class TransactionTrashController {

    private final TransactionTrashQuery transactionTrashQuery;
    private final UserService userService;

    TransactionTrashController(TransactionTrashQuery transactionTrashQuery, UserService userService) {
        this.transactionTrashQuery = transactionTrashQuery;
        this.userService = userService;
    }

    /** 한 쪽은 {@value TransactionTrashQuery#PAGE_SIZE}건이다. 이름은 쪽마다 한 번 읽는다. */
    @GetMapping
    TrashResponse listTrash(@AuthenticationPrincipal UUID actorId, @PathVariable UUID ledgerId,
                       @RequestParam(name = "cursor", required = false) String cursor) {
        TrashPage.Key after = cursor == null ? null : TrashCursor.decode(cursor, ledgerId)
                .orElseThrow(() -> new InvalidRequestException("cursor", FieldErrorCode.INVALID_FORMAT,
                        "이 목록에서 받은 cursor가 아닙니다."));
        TrashPage page = transactionTrashQuery.page(actorId, ledgerId, after);
        String nextCursor = page.next() == null ? null : TrashCursor.encode(ledgerId, page.next());
        return TrashResponse.of(page, userService.memberDisplayNames(actorId, ledgerId), nextCursor);
    }
}
