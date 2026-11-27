package app.accountbook.api;

import app.accountbook.account.Account;
import app.accountbook.account.AccountService;
import app.accountbook.category.Category;
import app.accountbook.category.CategoryService;
import app.accountbook.common.NotLedgerMemberException;
import app.accountbook.ledger.LedgerMembership;
import app.accountbook.ledger.LedgerService;
import app.accountbook.transaction.ExportedTransaction;
import app.accountbook.transaction.TransactionExportQuery;
import app.accountbook.user.UserService;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.http.CacheControl;
import org.springframework.http.HttpHeaders;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 장부 거래 내보내기(F-701, P-228, #57 요청 계약). 성공은 파일이고 오류만 problem+json이라(ADR 002 1절) {@code produces}를
 * 적지 않는다. 구성원 확인은 {@link LedgerMemberInterceptor}가 먼저 하고 조회가 한 번 더 한다. 파일을 다 만든 뒤 응답을
 * 시작한다. 만드는 중에 실패하면 반쯤 쓴 파일 대신 오류 응답이 나간다. 거래는 한 문장으로 읽고, 이름(장부, 계좌, 카테고리,
 * 작성자)은 그 뒤에 각 모듈에서 따로 읽는다(ADR 004 결정 6의 시점 차이).
 */
@RestController
class ExportController {

    static final MediaType CSV = new MediaType("text", "csv", StandardCharsets.UTF_8);

    private final TransactionExportQuery exportQuery;
    private final LedgerService ledgerService;
    private final AccountService accountService;
    private final CategoryService categoryService;
    private final UserService userService;

    ExportController(TransactionExportQuery exportQuery, LedgerService ledgerService, AccountService accountService,
                     CategoryService categoryService, UserService userService) {
        this.exportQuery = exportQuery;
        this.ledgerService = ledgerService;
        this.accountService = accountService;
        this.categoryService = categoryService;
        this.userService = userService;
    }

    /** 200은 파일, 기간에 내보낼 거래가 없으면 204(본문 없음)다. 둘 다 저장하지 않게 한다. */
    @GetMapping("/api/v1/ledgers/{ledgerId}/exports")
    ResponseEntity<byte[]> export(@AuthenticationPrincipal UUID actorId, @PathVariable UUID ledgerId,
                                  @RequestParam(name = "format", required = false) String format,
                                  @RequestParam(name = "from", required = false) String from,
                                  @RequestParam(name = "to", required = false) String to) throws IOException {
        ExportRequest request = ExportRequest.of(format, from, to);
        List<ExportedTransaction> found = exportQuery.transactions(actorId, ledgerId, request.from(), request.to());
        if (found.isEmpty()) {
            return ResponseEntity.noContent().cacheControl(CacheControl.noStore()).build();
        }
        ExportRow.Names names = new ExportRow.Names(
                accountService.list(actorId, ledgerId).stream()
                        .collect(Collectors.toMap(Account::getId, Account::getName)),
                categoryService.list(actorId, ledgerId).stream()
                        .collect(Collectors.toMap(Category::getId, Function.identity())),
                userService.memberDisplayNames(actorId, ledgerId));
        String ledgerName = ledgerService.memberships(actorId).stream()
                .filter(membership -> membership.ledgerId().equals(ledgerId))
                .map(LedgerMembership::name)
                .findFirst().orElseThrow(NotLedgerMemberException::new);
        ByteArrayOutputStream file = new ByteArrayOutputStream();
        CsvExport.write(ExportRow.of(found, names), file);
        return ResponseEntity.ok()
                .contentType(CSV)
                .header(HttpHeaders.CONTENT_DISPOSITION, ExportFileName.attachment(
                        ExportFileName.of(ledgerName, request.from(), request.to(), request.format())))
                .cacheControl(CacheControl.noStore())
                .body(file.toByteArray());
    }
}
