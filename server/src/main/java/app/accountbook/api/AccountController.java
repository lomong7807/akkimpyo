package app.accountbook.api;

import app.accountbook.account.Account;
import app.accountbook.account.AccountService;
import app.accountbook.stats.BalanceQuery;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.MediaType;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/** 장부의 계좌(F-501). 구성원 확인은 {@link LedgerMemberInterceptor}가 먼저 하고 서비스가 한 번 더 한다. */
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
    AccountResponse.Items list(@AuthenticationPrincipal UUID actorId, @PathVariable UUID ledgerId) {
        List<Account> accounts = accountService.list(actorId, ledgerId);
        Map<UUID, Long> balances = balanceQuery.balances(actorId, ledgerId);
        // 두 조회는 트랜잭션이 따로다(ADR 004 결정 6). 그 사이에 지워진 계좌는 잔액이 없고 이미 없는 계좌라 뺀다.
        return new AccountResponse.Items(accounts.stream()
                .filter(account -> balances.containsKey(account.getId()))
                .map(account -> AccountResponse.of(account, balances.get(account.getId())))
                .toList());
    }
}
