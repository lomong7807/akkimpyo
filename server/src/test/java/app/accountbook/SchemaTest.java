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

    @Test
    void categoryNameWithSurroundingSpaceIsRejectedByDatabase() {
        Ledger ledger = ledgerRepository.save(Ledger.personal());
        Category trailingSpace = Category.of(ledger.getId(), CategoryKind.EXPENSE, "식비 ", null);

        assertThatThrownBy(() -> categoryRepository.saveAndFlush(trailingSpace))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("ck_category_name_trimmed");
    }

    @Test
    void secondSystemCategoryOfSameLedgerAndKindIsRejectedByDatabase() {
        Ledger ledger = ledgerRepository.saveAndFlush(Ledger.personal());
        insertCategory(UUID.randomUUID(), ledger.getId(), "EXPENSE", "미분류", null, true);
        // 이름이 같으면 uq_category_name이 먼저 걸리므로 이름을 다르게 넣는다.

        assertThatThrownBy(() -> insertCategory(UUID.randomUUID(), ledger.getId(), "EXPENSE", "기본", null, true))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("uq_category_system");
    }

    @Test
    void systemCategoryPerKindIsAcceptedByDatabase() {
        Ledger ledger = ledgerRepository.saveAndFlush(Ledger.personal());
        Ledger other = ledgerRepository.saveAndFlush(Ledger.personal());

        insertCategory(UUID.randomUUID(), ledger.getId(), "EXPENSE", "미분류", null, true);
        insertCategory(UUID.randomUUID(), ledger.getId(), "INCOME", "미분류", null, true);
        insertCategory(UUID.randomUUID(), other.getId(), "EXPENSE", "미분류", null, true);

        assertThat(jdbc.queryForObject("select count(*) from category where system and ledger_id in (?, ?)",
                Integer.class, ledger.getId(), other.getId())).isEqualTo(3);
    }

    @Test
    void parentInAnotherLedgerIsRejectedByDatabase() {
        Ledger ledger = ledgerRepository.saveAndFlush(Ledger.personal());
        Ledger other = ledgerRepository.saveAndFlush(Ledger.personal());
        UUID parentInOtherLedger = UUID.randomUUID();
        insertCategory(parentInOtherLedger, other.getId(), "EXPENSE", "식비", null, false);

        assertThatThrownBy(() -> insertCategory(UUID.randomUUID(), ledger.getId(), "EXPENSE", "외식",
                parentInOtherLedger, false))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("fk_category_parent");
    }

    @Test
    void parentOfAnotherKindIsRejectedByDatabase() {
        Ledger ledger = ledgerRepository.saveAndFlush(Ledger.personal());
        UUID incomeParent = UUID.randomUUID();
        insertCategory(incomeParent, ledger.getId(), "INCOME", "급여", null, false);

        assertThatThrownBy(() -> insertCategory(UUID.randomUUID(), ledger.getId(), "EXPENSE", "외식",
                incomeParent, false))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("fk_category_parent");
    }

    @Test
    void missingParentIsRejectedByDatabase() {
        Ledger ledger = ledgerRepository.saveAndFlush(Ledger.personal());

        assertThatThrownBy(() -> insertCategory(UUID.randomUUID(), ledger.getId(), "EXPENSE", "외식",
                UUID.randomUUID(), false))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("fk_category_parent");
    }

    @Test
    void selfAsParentIsRejectedByDatabase() {
        Ledger ledger = ledgerRepository.saveAndFlush(Ledger.personal());
        UUID id = UUID.randomUUID();

        assertThatThrownBy(() -> insertCategory(id, ledger.getId(), "EXPENSE", "식비", id, false))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("ck_category_parent_not_self");
    }

    @Test
    void topLevelParentOfSameLedgerAndKindIsAcceptedByDatabase() {
        Ledger ledger = ledgerRepository.saveAndFlush(Ledger.personal());
        UUID parent = UUID.randomUUID();
        UUID child = UUID.randomUUID();
        insertCategory(parent, ledger.getId(), "EXPENSE", "식비", null, false);

        insertCategory(child, ledger.getId(), "EXPENSE", "외식", parent, false);

        assertThat(jdbc.queryForObject("select parent_id from category where id = ?", UUID.class, child))
                .isEqualTo(parent);
    }

    @Test
    void parentWithChildCannotBeDeletedOrMovedToAnotherKindInDatabase() {
        Ledger ledger = ledgerRepository.saveAndFlush(Ledger.personal());
        UUID parent = UUID.randomUUID();
        insertCategory(parent, ledger.getId(), "EXPENSE", "식비", null, false);
        insertCategory(UUID.randomUUID(), ledger.getId(), "EXPENSE", "외식", parent, false);

        // 실패한 문장 뒤에는 트랜잭션이 막히므로 SAVEPOINT로 되돌린 뒤 다음 문장을 본다.
        jdbc.execute("SAVEPOINT before_delete");
        assertThatThrownBy(() -> jdbc.update("delete from category where id = ?", parent))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("fk_category_parent");
        jdbc.execute("ROLLBACK TO SAVEPOINT before_delete");

        assertThatThrownBy(() -> jdbc.update("update category set kind = 'INCOME' where id = ?", parent))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("fk_category_parent");
    }

    /** 앱 검사와 엔터티를 거치지 않고 DB에 바로 넣는다. */
    private void insertCategory(UUID id, UUID ledgerId, String kind, String name, UUID parentId, boolean system) {
        jdbc.update("""
                insert into category (id, ledger_id, kind, name, parent_id, system, created_at)
                values (?, ?, ?, ?, ?, ?, now())
                """, id, ledgerId, kind, name, parentId, system);
    }
}
