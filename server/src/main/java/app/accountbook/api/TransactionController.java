package app.accountbook.api;

import app.accountbook.common.InvalidRequestException;
import app.accountbook.transaction.CreateResult;
import app.accountbook.transaction.IdConflictException;
import app.accountbook.transaction.TransactionCommand;
import app.accountbook.transaction.TransactionService;
import app.accountbook.transaction.TransactionView;
import app.accountbook.user.UserService;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** 장부의 거래(F-201~F-204, #14). 구성원 확인은 {@link LedgerMemberInterceptor}가 먼저 하고 서비스가 한 번 더 한다. */
@RestController
@RequestMapping(path = "/api/v1/ledgers/{ledgerId}/transactions", produces = MediaType.APPLICATION_JSON_VALUE)
class TransactionController {

    /** 기기 값을 받는 헤더. 본문이 없는 쓰기(삭제 등)도 같은 자리로 보낸다(#14 요청 계약). */
    static final String DEVICE_HEADER = "X-Akkimpyo-Device";
    /** 헤더가 없는 요청의 기기 값. 이력에 그대로 남는다(ledger 결정 2026-11-25, #102). */
    static final String UNKNOWN_DEVICE = "unknown";

    private final TransactionService transactionService;
    private final UserService userService;

    TransactionController(TransactionService transactionService, UserService userService) {
        this.transactionService = transactionService;
        this.userService = userService;
    }

    /**
     * 새로 만들면 201, 같은 id의 재전송이면 200이고 본문은 거래 하나다(ADR 006 결정 3). 응답할 수 없는 {@code Accept}와
     * JSON이 아닌 본문은 저장하기 전에 거절된다(ADR 002 5절). 본문의 형식 검증이 서비스의 같은 id 조회보다 먼저다.
     * 서비스가 트랜잭션을 스스로 열므로 여기서 열지 않는다. 이름은 저장한 뒤 따로 읽는다(ADR 004 결정 6).
     */
    @PostMapping(consumes = MediaType.APPLICATION_JSON_VALUE)
    ResponseEntity<TransactionResponse> create(@AuthenticationPrincipal UUID actorId, @PathVariable UUID ledgerId,
                                               @RequestHeader(name = DEVICE_HEADER, required = false) String device,
                                               @RequestBody TransactionRequest request) {
        TransactionCommand command = request.command();
        CreateResult result;
        try {
            result = transactionService.createOrReplay(actorId, ledgerId, command,
                    device == null ? UNKNOWN_DEVICE : device);
        } catch (InvalidRequestException e) {
            throw atDeviceHeader(e);
        } catch (IdConflictException e) {
            throw new TransactionIdConflict(e.current().map(current -> response(actorId, ledgerId, current))
                    .orElse(null));
        }
        return ResponseEntity.status(result.created() ? HttpStatus.CREATED : HttpStatus.OK)
                .body(response(actorId, ledgerId, result.transaction()));
    }

    private TransactionResponse response(UUID actorId, UUID ledgerId, TransactionView tx) {
        return TransactionResponse.of(tx, userService.memberDisplayNames(actorId, ledgerId));
    }

    /** 서비스는 기기 값의 오류를 인자 이름으로 알린다. 받은 자리인 헤더의 이름으로 바꾼다. */
    private static InvalidRequestException atDeviceHeader(InvalidRequestException rejected) {
        return InvalidRequestException.ofAll(rejected.errors().stream()
                .map(error -> TransactionService.DEVICE_ID_FIELD.equals(error.field())
                        ? new InvalidRequestException(DEVICE_HEADER, error.code(), error.getMessage())
                        : error)
                .toList());
    }
}
