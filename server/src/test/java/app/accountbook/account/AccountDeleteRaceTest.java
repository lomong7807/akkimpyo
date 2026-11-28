package app.accountbook.account;

import static org.assertj.core.api.Assertions.assertThatThrownBy;

import app.accountbook.category.CategoryKind;
import app.accountbook.category.CategoryService;
import app.accountbook.common.AccountHasTransactionsException;
import app.accountbook.ledger.LedgerAccess;
import app.accountbook.ledger.LedgerRepository;
import app.accountbook.support.Fixtures;
import app.accountbook.support.IntegrationTest;
import app.accountbook.user.User;
import jakarta.persistence.EntityManager;
import java.time.Clock;
import java.time.LocalDate;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/**
 * 동시 요청: "거래 없음"을 본 뒤 지우기 전에 그 계좌로 거래가 저장되는 경우(#43). 앱 검사가 못 본 것으로 만들어,
 * DB FK 위반(fk_transaction_line_account)이 500이 아니라 같은 예외로 바뀌는지 본다.
 *
 * <p>공용 컨텍스트를 그대로 쓴다(#359). 빈을 바꾸지 않고, 공용 컨텍스트의 리포지토리와 "늘 거래 없음"이라 답하는
 * {@link AccountUsage}로 서비스를 직접 만든다. 테스트의 트랜잭션 안에서 리포지토리가 DB에 닿는다.
 */
@IntegrationTest
class AccountDeleteRaceTest {

    @Autowired AccountRepository accountRepository;
    @Autowired LedgerAccess ledgerAccess;
    @Autowired LedgerRepository ledgerRepository;
    @Autowired Clock clock;
    @Autowired CategoryService categoryService;
    @Autowired Fixtures fixtures;
    @Autowired EntityManager entityManager;

    @Test
    void delete_translatesLineForeignKeyViolationToHasTransactions() {
        User owner = fixtures.user("owner@example.com");
        UUID ledgerId = fixtures.personalLedgerId(owner);
        UUID cash = fixtures.account(owner, ledgerId, "현금", AccountType.CASH, 0, LocalDate.of(2026, 11, 1)).getId();
        UUID uncategorized = categoryService.uncategorized(ledgerId, CategoryKind.EXPENSE).getId();
        fixtures.storedExpense(owner, ledgerId, cash, uncategorized, 12_000);
        entityManager.flush();
        AccountUsage missedLine = accountId -> false;
        AccountService checkedTooEarly = new AccountService(accountRepository, missedLine, ledgerAccess,
                ledgerRepository, clock);

        assertThatThrownBy(() -> checkedTooEarly.delete(owner.getId(), ledgerId, cash))
                .isExactlyInstanceOf(AccountHasTransactionsException.class);
    }
}
