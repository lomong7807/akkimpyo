package app.accountbook.api;

import app.accountbook.transaction.TransactionListQuery;
import app.accountbook.transaction.TransactionPage;
import app.accountbook.transaction.TransactionType;
import app.accountbook.user.UserService;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.enums.ParameterIn;
import io.swagger.v3.oas.annotations.media.ArraySchema;
import io.swagger.v3.oas.annotations.media.Schema;
import java.time.LocalDate;
import java.util.UUID;
import org.springframework.http.MediaType;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.util.MultiValueMap;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 거래 검색(F-223, P-232, #64 응답 계약): {@code GET ?q=&from=&to=&accountId=&categoryId=&type=&status=&cursor=}. 거래
 * 목록({@link TransactionController})과 같은 경로 아래이고, 경로는 {@code /{transactionId}}보다 이것이 먼저 맞는다. 쿼리
 * 값의 형식 오류는 여기서, 조건이 없거나 기간이 거꾸로이거나 장부에 없는 계좌·카테고리는 조회가 400으로 거절한다. 구성원이
 * 아니면 쿼리 값이 틀려도 {@link LedgerMemberInterceptor}가 먼저 404로 답하고, 조회가 구성원을 한 번 더 확인한다.
 */
@RestController
@RequestMapping(path = "/api/v1/ledgers/{ledgerId}/transactions/search", produces = MediaType.APPLICATION_JSON_VALUE)
class TransactionSearchController {

    private final TransactionListQuery transactionListQuery;
    private final UserService userService;

    TransactionSearchController(TransactionListQuery transactionListQuery, UserService userService) {
        this.transactionListQuery = transactionListQuery;
        this.userService = userService;
    }

    /** 한 쪽은 {@value TransactionListQuery#MAX_LIMIT}건이다. 이름은 쪽마다 한 번 읽는다. */
    @GetMapping
    @Parameter(name = "accountId", in = ParameterIn.QUERY, description = ApiDoc.ANY_OF, array = @ArraySchema(
            maxItems = TransactionListRequest.MAX_FILTER_VALUES, schema = @Schema(implementation = UUID.class)))
    @Parameter(name = "categoryId", in = ParameterIn.QUERY, description = ApiDoc.ANY_OF, array = @ArraySchema(
            maxItems = TransactionListRequest.MAX_FILTER_VALUES, schema = @Schema(implementation = UUID.class)))
    @Parameter(name = "type", in = ParameterIn.QUERY, description = ApiDoc.ANY_OF, array = @ArraySchema(
            maxItems = TransactionListRequest.MAX_FILTER_VALUES, schema = @Schema(implementation = TransactionType.class)))
    @Parameter(name = "status", in = ParameterIn.QUERY, description = ApiDoc.STATUS,
            schema = @Schema(type = "string", types = "string", allowableValues = {"POSTED", "CANCELED"}))
    TransactionSearchResponse searchTransactions(@AuthenticationPrincipal UUID actorId, @PathVariable UUID ledgerId,
                                     @RequestParam(name = "q", required = false) String q,
                                     @Parameter(schema = @Schema(implementation = LocalDate.class))
                                     @RequestParam(name = "from", required = false) String from,
                                     @Parameter(schema = @Schema(implementation = LocalDate.class))
                                     @RequestParam(name = "to", required = false) String to,
                                     @RequestParam(name = "cursor", required = false) String cursor,
                                     @Parameter(hidden = true) @RequestParam MultiValueMap<String, String> query) {
        TransactionSearchRequest request = TransactionSearchRequest.of(ledgerId, q, from, to, cursor, query);
        TransactionPage page = transactionListQuery.search(actorId, ledgerId, request.search(), request.filter(),
                request.after());
        String nextCursor = page.next() == null ? null
                : TransactionCursor.encode(ledgerId, request.search(), request.filter(), page.next());
        return TransactionSearchResponse.of(page, userService.memberDisplayNames(actorId, ledgerId), nextCursor);
    }
}
