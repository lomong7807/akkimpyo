package app.accountbook.api;

import app.accountbook.account.Account;
import app.accountbook.account.AccountService;
import app.accountbook.common.InvalidRequestException;
import app.accountbook.stats.BalanceQuery;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;

/**
 * 장부의 계좌(F-501, F-502, F-503, F-506, F-507, F-508). 구성원 확인은 {@link LedgerMemberInterceptor}가 먼저 하고 서비스가
 * 한 번 더 한다.
 */
@RestController
@RequestMapping(path = "/api/v1/ledgers/{ledgerId}/accounts", produces = MediaType.APPLICATION_JSON_VALUE)
class AccountController {

    private final AccountService accountService;
    private final BalanceQuery balanceQuery;

    AccountController(AccountService accountService, BalanceQuery balanceQuery) {
        this.accountService = accountService;
        this.balanceQuery = balanceQuery;
    }

    /** 만든 순서(만든 시각, 같으면 id)다. 잔액은 장부 전체를 한 번에 구한다. 계좌가 없으면 빈 목록이다. */
    @GetMapping
    AccountResponse.Items listAccounts(@AuthenticationPrincipal UUID actorId, @PathVariable UUID ledgerId) {
        List<Account> accounts = accountService.list(actorId, ledgerId);
        Map<UUID, Long> balances = balanceQuery.balances(actorId, ledgerId);
        // 두 조회는 트랜잭션이 따로다(ADR 004 결정 6). 그 사이에 지워진 계좌는 잔액이 없고 이미 없는 계좌라 뺀다.
        return new AccountResponse.Items(accounts.stream()
                .filter(account -> balances.containsKey(account.getId()))
                .map(account -> AccountResponse.of(account, balances.get(account.getId())))
                .toList());
    }

    /**
     * 201이고 본문은 목록의 항목과 같다. 새 계좌에는 거래가 없어 잔액이 시작 잔액이다. 부호는 바꾸지 않는다(F-502).
     * 응답할 수 없는 {@code Accept}와 JSON이 아닌 본문은 저장하기 전에 거절된다(ADR 002 5절).
     */
    @PostMapping(consumes = MediaType.APPLICATION_JSON_VALUE)
    @ResponseStatus(HttpStatus.CREATED)
    AccountResponse createAccount(@AuthenticationPrincipal UUID actorId, @PathVariable UUID ledgerId,
                           @RequestBody AccountRequest request) {
        AccountRequest.Read read = request.read();
        try {
            Account account = accountService.create(actorId, ledgerId, read.command());
            return AccountResponse.of(account, account.getOpeningBalance());
        } catch (InvalidRequestException e) {
            throw read.explain(e);
        }
    }

    /**
     * 200이고 본문은 목록의 항목과 같다(#33). 잔액은 바꾼 시작 잔액과 기준일로 다시 구한 값이다(P-206). version은 없고 나중
     * 저장이 덮어쓴다(P-217). 이 장부의 계좌가 아니면(내가 구성원인 다른 장부의 계좌, 없는 계좌) 본문이 틀려도 404다.
     * 검증은 만들기와 같다. 잔액은 저장한 뒤 따로 구한다(ADR 004 결정 6).
     */
    @PutMapping(path = "/{accountId}", consumes = MediaType.APPLICATION_JSON_VALUE)
    AccountResponse updateAccount(@AuthenticationPrincipal UUID actorId, @PathVariable UUID ledgerId,
                           @PathVariable UUID accountId, @RequestBody AccountRequest request) {
        AccountRequest.Read read = request.read();
        Account account;
        try {
            account = accountService.update(actorId, ledgerId, accountId, read.command());
        } catch (InvalidRequestException e) {
            throw read.explain(e);
        }
        return AccountResponse.of(account, balanceQuery.balance(actorId, account.getId()));
    }

    /**
     * 숨기기·다시 보이기(#43, F-506, F-507). 200이고 본문은 목록의 항목과 같다. 이미 그 상태면 바뀌는 것 없이 200이다.
     * version은 없다(고치기와 같다). 이 장부의 계좌가 아니면 본문이 틀려도 404다.
     */
    @PutMapping(path = "/{accountId}/visibility", consumes = MediaType.APPLICATION_JSON_VALUE)
    AccountResponse changeAccountVisibility(@AuthenticationPrincipal UUID actorId, @PathVariable UUID ledgerId,
                                     @PathVariable UUID accountId, @RequestBody AccountRequest.Visibility request) {
        AccountRequest.Visibility.Read read = request.read();
        Account account;
        try {
            account = accountService.setHidden(actorId, ledgerId, accountId, read.hidden());
        } catch (InvalidRequestException e) {
            throw read.explain(e);
        }
        return AccountResponse.of(account, balanceQuery.balance(actorId, account.getId()));
    }

    /**
     * 삭제(#43, F-508). 204다. 이 계좌를 쓰는 거래가 하나라도 있으면(휴지통·취소한 거래, 이체의 받는 쪽 포함) 409
     * {@code ACCOUNT_HAS_TRANSACTIONS}이다. 이 장부의 계좌가 아니면(이미 지운 계좌 포함) 404다.
     */
    @DeleteMapping(path = "/{accountId}")
    @ResponseStatus(HttpStatus.NO_CONTENT)
    @ApiResponse(responseCode = "409", ref = ApiDoc.CONFLICT)
    void deleteAccount(@AuthenticationPrincipal UUID actorId, @PathVariable UUID ledgerId, @PathVariable UUID accountId) {
        accountService.delete(actorId, ledgerId, accountId);
    }
}
