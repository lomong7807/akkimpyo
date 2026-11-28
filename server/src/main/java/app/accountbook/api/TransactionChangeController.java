package app.accountbook.api;

import app.accountbook.common.FieldErrorCode;
import app.accountbook.common.InvalidRequestException;
import app.accountbook.common.NotFoundException;
import app.accountbook.transaction.StaleVersionException;
import app.accountbook.transaction.TransactionService;
import app.accountbook.transaction.TransactionView;
import app.accountbook.user.UserService;
import java.util.UUID;
import java.util.function.Supplier;
import java.util.regex.Pattern;
import org.springframework.http.MediaType;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/**
 * 장부의 거래 하나를 고치고(F-208, #36) 휴지통에 넣고 되살리며(F-227, F-230, #38) 승인취소하고 되돌린다(F-225, F-226, #37).
 * 만들기와 조회({@link TransactionController})와 같은 경로 아래이고, 기기 값 헤더와 응답의 거래 모양이 같다. 구성원 확인은
 * {@link LedgerMemberInterceptor}가 먼저 하고 서비스가 한 번 더 한다.
 *
 * <p>검사 순서: 구성원과 경로의 장부의 거래인지(404) → 형식(400) → version(409 {@code STALE_VERSION}) →
 * 상태(409 {@code INVALID_STATE}) → 참조(400). 응답할 수 없는 {@code Accept}, JSON이 아닌 본문, 읽을 수 없는 JSON은
 * 그보다 먼저 거절된다(ADR 002 5절). 서비스가 트랜잭션을 열므로 여기서 열지 않는다(ADR 004 결정 6).
 */
@RestController
@RequestMapping(path = "/api/v1/ledgers/{ledgerId}/transactions/{transactionId}",
        produces = MediaType.APPLICATION_JSON_VALUE)
class TransactionChangeController {

    /** 쿼리의 version. ASCII 숫자로 쓴 정수이고 부호는 빼기만 붙을 수 있다. */
    private static final Pattern VERSION_TEXT = Pattern.compile("-?[0-9]{1,19}");

    private final TransactionService transactionService;
    private final UserService userService;

    TransactionChangeController(TransactionService transactionService, UserService userService) {
        this.transactionService = transactionService;
        this.userService = userService;
    }

    /** 200이고 본문은 고친 거래다. 같은 내용이면 version을 올리지 않고 지금 거래를 준다. */
    @PutMapping(consumes = MediaType.APPLICATION_JSON_VALUE)
    TransactionResponse update(@AuthenticationPrincipal UUID actorId, @PathVariable UUID ledgerId,
                               @PathVariable UUID transactionId,
                               @RequestHeader(name = TransactionController.DEVICE_HEADER, required = false)
                               String device,
                               @RequestBody TransactionUpdateRequest request) {
        requireInLedger(actorId, ledgerId, transactionId);
        TransactionUpdateRequest.Change change = request.change(transactionId);
        return changed(actorId, ledgerId, () -> transactionService.update(actorId, transactionId, change.version(),
                change.command(), change.keepRefundKind(), deviceOf(device)));
    }

    /** 휴지통에 넣는다. 200이고 본문은 바뀐 거래({@code deletedAt}, {@code purgeAt}, version+1)다. 본문은 읽지 않는다. */
    @DeleteMapping
    TransactionResponse delete(@AuthenticationPrincipal UUID actorId, @PathVariable UUID ledgerId,
                               @PathVariable UUID transactionId,
                               @RequestHeader(name = TransactionController.DEVICE_HEADER, required = false)
                               String device,
                               @RequestParam(name = "version", required = false) String version) {
        requireInLedger(actorId, ledgerId, transactionId);
        long expectedVersion = queryVersion(version);
        return changed(actorId, ledgerId, () -> transactionService.delete(actorId, transactionId, expectedVersion,
                deviceOf(device)));
    }

    /** 휴지통에서 되살린다(삭제 직후의 "되돌리기"가 부른다). 200이고 본문은 바뀐 거래다. */
    @PostMapping(path = "/restore", consumes = MediaType.APPLICATION_JSON_VALUE)
    TransactionResponse restore(@AuthenticationPrincipal UUID actorId, @PathVariable UUID ledgerId,
                                @PathVariable UUID transactionId,
                                @RequestHeader(name = TransactionController.DEVICE_HEADER, required = false)
                                String device,
                                @RequestBody TransactionVersionRequest request) {
        requireInLedger(actorId, ledgerId, transactionId);
        long expectedVersion = request.expectedVersion();
        return changed(actorId, ledgerId, () -> transactionService.restore(actorId, transactionId, expectedVersion,
                deviceOf(device)));
    }

    /** 승인취소(F-225). 200이고 본문은 바뀐 거래({@code status}가 {@code CANCELED}, version+1)다. 잔액과 통계에서 빠진다. */
    @PostMapping(path = "/cancel", consumes = MediaType.APPLICATION_JSON_VALUE)
    TransactionResponse cancel(@AuthenticationPrincipal UUID actorId, @PathVariable UUID ledgerId,
                               @PathVariable UUID transactionId,
                               @RequestHeader(name = TransactionController.DEVICE_HEADER, required = false)
                               String device,
                               @RequestBody TransactionVersionRequest request) {
        requireInLedger(actorId, ledgerId, transactionId);
        long expectedVersion = request.expectedVersion();
        return changed(actorId, ledgerId, () -> transactionService.cancel(actorId, transactionId, expectedVersion,
                deviceOf(device)));
    }

    /** 승인취소 되돌리기(F-226). 200이고 본문은 취소 직전 상태로 돌아간 거래(version+1)다. 잔액과 통계에 다시 든다. */
    @PostMapping(path = "/uncancel", consumes = MediaType.APPLICATION_JSON_VALUE)
    TransactionResponse uncancel(@AuthenticationPrincipal UUID actorId, @PathVariable UUID ledgerId,
                                 @PathVariable UUID transactionId,
                                 @RequestHeader(name = TransactionController.DEVICE_HEADER, required = false)
                                 String device,
                                 @RequestBody TransactionVersionRequest request) {
        requireInLedger(actorId, ledgerId, transactionId);
        long expectedVersion = request.expectedVersion();
        return changed(actorId, ledgerId, () -> transactionService.uncancel(actorId, transactionId, expectedVersion,
                deviceOf(device)));
    }

    /**
     * 경로의 장부의 거래가 아니면 없는 거래와 같은 404다. 내가 구성원인 다른 장부의 거래, 완전히 지운 거래도 같다(ADR 002
     * "지금 코드와 다른 점"). 서비스는 거래 id만 받으므로 바꾸기 전에 여기서 본다. 거래의 장부는 바뀌지 않으므로
     * (만든 뒤 {@code ledger_id}를 쓰는 곳이 없다) 이 확인과 서비스의 쓰기 사이에 어긋나지 않는다.
     */
    private void requireInLedger(UUID actorId, UUID ledgerId, UUID transactionId) {
        if (!transactionService.get(actorId, transactionId).ledgerId().equals(ledgerId)) {
            throw new NotFoundException();
        }
    }

    /** 서비스가 알린 기기 값 오류는 받은 자리인 헤더의 이름으로, 낡은 version은 표시 이름을 붙인 current와 함께 409로 바꾼다. */
    private TransactionResponse changed(UUID actorId, UUID ledgerId, Supplier<TransactionView> change) {
        TransactionView changed;
        try {
            changed = change.get();
        } catch (InvalidRequestException e) {
            throw atDeviceHeader(e);
        } catch (StaleVersionException e) {
            throw new TransactionStaleVersion(response(actorId, ledgerId, e.current()));
        }
        return response(actorId, ledgerId, changed);
    }

    private TransactionResponse response(UUID actorId, UUID ledgerId, TransactionView tx) {
        return TransactionResponse.of(tx, userService.memberDisplayNames(actorId, ledgerId));
    }

    /**
     * 쿼리의 {@code version}(ADR 002 4절: 쿼리의 오류도 그 이름의 입력란 오류다). 빠지거나 비면 {@code REQUIRED}, 정수가
     * 아니면(소수, 16진수, 공백, 여러 번 보냄, long 밖) {@code INVALID_FORMAT}이다.
     */
    private static long queryVersion(String text) {
        if (text == null || text.isEmpty()) {
            throw new InvalidRequestException("version", FieldErrorCode.REQUIRED, "값이 없습니다.");
        }
        if (VERSION_TEXT.matcher(text).matches()) {
            try {
                return Long.parseLong(text);
            } catch (NumberFormatException e) {
                // long 밖이다. 아래에서 형식 오류로 알린다.
            }
        }
        throw new InvalidRequestException("version", FieldErrorCode.INVALID_FORMAT, "읽을 수 없는 값입니다.");
    }

    private static String deviceOf(String header) {
        return header == null ? TransactionController.UNKNOWN_DEVICE : header;
    }

    /** {@link TransactionController}와 같은 변환이다. 그 파일을 #15와 함께 고치지 않으려고 따로 둔다. */
    private static InvalidRequestException atDeviceHeader(InvalidRequestException rejected) {
        return InvalidRequestException.ofAll(rejected.errors().stream()
                .map(error -> TransactionService.DEVICE_ID_FIELD.equals(error.field())
                        ? new InvalidRequestException(TransactionController.DEVICE_HEADER, error.code(),
                        error.getMessage())
                        : error)
                .toList());
    }
}
