package app.accountbook.account;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import app.accountbook.category.CategoryKind;
import app.accountbook.category.CategoryService;
import app.accountbook.common.InUseException;
import app.accountbook.common.InvalidRequestException;
import app.accountbook.common.NotLedgerMemberException;
import app.accountbook.common.Times;
import app.accountbook.support.Fixtures;
import app.accountbook.support.IntegrationTest;
import app.accountbook.transaction.Transaction;
import app.accountbook.user.User;
import java.time.LocalDate;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

@IntegrationTest
class AccountServiceTest {

    @Autowired AccountService accountService;
    @Autowired AccountRepository accountRepository;
    @Autowired CategoryService categoryService;
    @Autowired Fixtures fixtures;

    User owner;
    UUID ledgerId;

    @BeforeEach
    void setUp() {
        owner = fixtures.user("owner@example.com");
        ledgerId = fixtures.personalLedgerId(owner);
    }

    @Test
    void create_storesOpeningBalanceAndDate() {
        // 카드 부채처럼 기준 잔액은 음수일 수 있다.
        Account created = accountService.create(owner.getId(), ledgerId,
                new AccountCommand("  신한카드  ", AccountType.CARD, -350_000, LocalDate.of(2026, 11, 10)));

        Account stored = accountRepository.findById(created.getId()).orElseThrow();
        assertThat(stored.getLedgerId()).isEqualTo(ledgerId);
        assertThat(stored.getName()).isEqualTo("신한카드");
        assertThat(stored.getType()).isEqualTo(AccountType.CARD);
        assertThat(stored.getOpeningBalance()).isEqualTo(-350_000);
        assertThat(stored.getOpeningDate()).isEqualTo(LocalDate.of(2026, 11, 10));
        assertThat(stored.getCurrency()).isEqualTo("KRW");
        assertThat(accountService.list(owner.getId(), ledgerId)).extracting(Account::getId)
                .containsExactly(created.getId());
    }

    @Test
    void create_rejectsBlankName() {
        LocalDate openingDate = LocalDate.of(2026, 11, 1);

        assertThatThrownBy(() -> accountService.create(owner.getId(), ledgerId,
                new AccountCommand("   ", AccountType.BANK, 0, openingDate)))
                .isInstanceOf(InvalidRequestException.class);
        assertThatThrownBy(() -> accountService.create(owner.getId(), ledgerId,
                new AccountCommand(null, AccountType.BANK, 0, openingDate)))
                .isInstanceOf(InvalidRequestException.class);
        assertThat(accountService.list(owner.getId(), ledgerId)).isEmpty();
    }

    @Test
    void create_rejectsOutsider() {
        User outsider = fixtures.user("outsider@example.com");

        assertThatThrownBy(() -> accountService.create(outsider.getId(), ledgerId,
                new AccountCommand("현금", AccountType.CASH, 0, LocalDate.of(2026, 11, 1))))
                .isInstanceOf(NotLedgerMemberException.class);
        assertThat(accountService.list(owner.getId(), ledgerId)).isEmpty();
    }

    @Test
    void delete_rejectsAccountWithLines() {
        Account account = accountService.create(owner.getId(), ledgerId,
                new AccountCommand("현금", AccountType.CASH, 0, LocalDate.of(2026, 11, 1)));
        UUID expenseCategoryId = categoryService.uncategorized(ledgerId, CategoryKind.EXPENSE).getId();
        Transaction tx = fixtures.storedExpense(owner, ledgerId, account.getId(), expenseCategoryId, 12_000);
        // 소프트 삭제된 거래의 라인도 계좌를 참조하는 것으로 본다.
        tx.markDeleted(Times.now());

        assertThatThrownBy(() -> accountService.delete(owner.getId(), account.getId()))
                .isInstanceOf(InUseException.class);
        assertThat(accountService.list(owner.getId(), ledgerId)).extracting(Account::getId)
                .containsExactly(account.getId());
    }

    @Test
    void delete_removesUnusedAccount() {
        Account account = accountService.create(owner.getId(), ledgerId,
                new AccountCommand("현금", AccountType.CASH, 0, LocalDate.of(2026, 11, 1)));

        accountService.delete(owner.getId(), account.getId());

        assertThat(accountRepository.findById(account.getId())).isEmpty();
        assertThat(accountService.list(owner.getId(), ledgerId)).isEmpty();
    }
}
