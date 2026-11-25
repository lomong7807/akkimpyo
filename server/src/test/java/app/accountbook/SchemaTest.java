package app.accountbook;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import app.accountbook.account.Account;
import app.accountbook.account.AccountRepository;
import app.accountbook.account.AccountType;
import app.accountbook.category.Category;
import app.accountbook.category.CategoryKind;
import app.accountbook.category.CategoryRepository;
import app.accountbook.ledger.Ledger;
import app.accountbook.ledger.LedgerRepository;
import app.accountbook.support.IntegrationTest;
import app.accountbook.transaction.Transaction;
import app.accountbook.transaction.TransactionRepository;
import app.accountbook.transaction.TransactionType;
import app.accountbook.user.User;
import app.accountbook.user.UserRepository;
import java.time.LocalDate;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.jdbc.core.JdbcTemplate;

@IntegrationTest
class SchemaTest {

    @Autowired JdbcTemplate jdbc;
    @Autowired UserRepository userRepository;
    @Autowired LedgerRepository ledgerRepository;
    @Autowired AccountRepository accountRepository;
    @Autowired CategoryRepository categoryRepository;
    @Autowired TransactionRepository transactionRepository;

    @Test
    void migrationAppliesAndEntitiesValidate() {
        // 컨텍스트가 떴다는 것 자체가 Flyway 적용과 ddl-auto=validate 통과를 뜻한다.
        Boolean success = jdbc.queryForObject(
                "select success from flyway_schema_history where version = '1'", Boolean.class);

        assertThat(success).isTrue();
    }

    @Test
    void amountZeroIsRejectedByDatabase() {
        User user = userRepository.save(User.of("schema@example.com", "hash", "스키마"));
        Ledger ledger = ledgerRepository.save(Ledger.personal());
        Account account = accountRepository.save(
                Account.of(ledger.getId(), "현금", AccountType.CASH, 0, LocalDate.of(2026, 11, 1)));
        Transaction tx = Transaction.of(UUID.randomUUID(), ledger.getId(), TransactionType.EXPENSE,
                LocalDate.of(2026, 11, 18), null, null, null, user.getId(), user.getId());
        tx.addLine(account.getId(), null, 0);

        assertThatThrownBy(() -> transactionRepository.saveAndFlush(tx))
                .isInstanceOf(DataIntegrityViolationException.class);
    }

    @Test
    void categoryNameOverTwentyCharactersIsRejectedByDatabase() {
        Ledger ledger = ledgerRepository.save(Ledger.personal());
        Category tooLong = Category.of(ledger.getId(), CategoryKind.EXPENSE, "가".repeat(21), null);

        assertThatThrownBy(() -> categoryRepository.saveAndFlush(tooLong))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("ck_category_name_length");
    }

    @Test
    void sameTopLevelCategoryNameIsRejectedByDatabase() {
        Ledger ledger = ledgerRepository.save(Ledger.personal());
        categoryRepository.saveAndFlush(Category.of(ledger.getId(), CategoryKind.EXPENSE, "식비", null));
        Category duplicate = Category.of(ledger.getId(), CategoryKind.EXPENSE, "식비", null);

        assertThatThrownBy(() -> categoryRepository.saveAndFlush(duplicate))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("uq_category_name");
    }
}
