package app.accountbook.account;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doReturn;

import app.accountbook.category.CategoryKind;
import app.accountbook.category.CategoryService;
import app.accountbook.common.AccountHasTransactionsException;
import app.accountbook.support.Fixtures;
import app.accountbook.support.IntegrationTest;
import app.accountbook.user.User;
import jakarta.persistence.EntityManager;
import java.time.LocalDate;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;

/**
 * 동시 요청: "거래 없음"을 본 뒤 지우기 전에 그 계좌로 거래가 저장되는 경우(#43). 앱 검사가 못 본 것으로 만들어,
 * DB FK 위반(fk_transaction_line_account)이 500이 아니라 같은 예외로 바뀌는지 본다.
 */
@IntegrationTest
class AccountDeleteRaceTest {

    @Autowired AccountService accountService;
    @Autowired CategoryService categoryService;
    @Autowired Fixtures fixtures;
    @Autowired EntityManager entityManager;
    @MockitoSpyBean AccountUsage accountUsage;

    @Test
    void delete_translatesLineForeignKeyViolationToHasTransactions() {
        User owner = fixtures.user("owner@example.com");
        UUID ledgerId = fixtures.personalLedgerId(owner);
        UUID cash = fixtures.account(owner, ledgerId, "현금", AccountType.CASH, 0, LocalDate.of(2026, 11, 1)).getId();
        UUID uncategorized = categoryService.uncategorized(ledgerId, CategoryKind.EXPENSE).getId();
        fixtures.storedExpense(owner, ledgerId, cash, uncategorized, 12_000);
        entityManager.flush();
        doReturn(false).when(accountUsage).isUsed(any());

        assertThatThrownBy(() -> accountService.delete(owner.getId(), ledgerId, cash))
                .isExactlyInstanceOf(AccountHasTransactionsException.class);
    }
}
