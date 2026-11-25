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

    @Test
    void displayNameOverTwentyCharactersIsRejectedByDatabase() {
        insertUser("twenty@example.com", "가".repeat(20));

        assertThatThrownBy(() -> insertUser("twentyone@example.com", "가".repeat(21)))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("ck_users_display_name_length");
    }

    @Test
    void emptyDisplayNameIsRejectedByDatabase() {
        assertThatThrownBy(() -> insertUser("empty@example.com", ""))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("ck_users_display_name_length");
    }

    @Test
    void displayNameWithSurroundingSpaceIsRejectedByDatabase() {
        assertThatThrownBy(() -> insertUser("space@example.com", "주인 "))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("ck_users_display_name_trimmed");
    }

    @Test
    void lineAmountAtRangeEdgesIsAcceptedByDatabase() {
        UUID tx = insertTransaction(LocalDate.of(2026, 11, 18));

        insertLine(tx, 9_999_999_999L);
        insertLine(tx, -9_999_999_999L);

        assertThat(jdbc.queryForList("select amount from transaction_line where transaction_id = ? order by amount",
                Long.class, tx)).containsExactly(-9_999_999_999L, 9_999_999_999L);
    }

    @Test
    void lineAmountOverMaxIsRejectedByDatabase() {
        UUID tx = insertTransaction(LocalDate.of(2026, 11, 18));

        assertThatThrownBy(() -> insertLine(tx, 10_000_000_000L))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("ck_transaction_line_amount_range");
    }

    @Test
    void lineAmountUnderMinIsRejectedByDatabase() {
        UUID tx = insertTransaction(LocalDate.of(2026, 11, 18));

        assertThatThrownBy(() -> insertLine(tx, -10_000_000_000L))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("ck_transaction_line_amount_range");
    }

    @Test
    void lineAmountZeroIsRejectedByRangeConstraint() {
        // V1의 이름 없는 CHECK(amount <> 0)를 지워도 0은 새 제약이 막는다.
        UUID tx = insertTransaction(LocalDate.of(2026, 11, 18));

        assertThatThrownBy(() -> insertLine(tx, 0L))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("ck_transaction_line_amount_range");
    }

    @Test
    void occurredOnAtMinIsAcceptedByDatabase() {
        UUID tx = insertTransaction(LocalDate.of(2000, 1, 1));

        assertThat(jdbc.queryForObject("select occurred_on from transaction where id = ?", LocalDate.class, tx))
                .isEqualTo(LocalDate.of(2000, 1, 1));
    }

    @Test
    void occurredOnBeforeMinIsRejectedByDatabase() {
        assertThatThrownBy(() -> insertTransaction(LocalDate.of(1999, 12, 31)))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("ck_transaction_occurred_on_min");
    }

    @Test
    void sameAccountNameInSameLedgerIsRejectedByDatabase() {
        UUID ledger = ledgerRepository.saveAndFlush(Ledger.personal()).getId();
        UUID other = ledgerRepository.saveAndFlush(Ledger.personal()).getId();
        insertAccount(ledger, "생활비", 0L);
        // 다른 장부에서는 같은 이름이 들어간다.
        insertAccount(other, "생활비", 0L);

        assertThatThrownBy(() -> insertAccount(ledger, "생활비", 0L))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("uq_account_name");
    }

    @Test
    void accountNameOverFiftyCharactersIsRejectedByDatabase() {
        UUID ledger = ledgerRepository.saveAndFlush(Ledger.personal()).getId();
        insertAccount(ledger, "가".repeat(50), 0L);

        assertThatThrownBy(() -> insertAccount(ledger, "가".repeat(51), 0L))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("ck_account_name_length");
    }

    @Test
    void emptyAccountNameIsRejectedByDatabase() {
        UUID ledger = ledgerRepository.saveAndFlush(Ledger.personal()).getId();

        assertThatThrownBy(() -> insertAccount(ledger, "", 0L))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("ck_account_name_length");
    }

    @Test
    void accountNameWithSurroundingSpaceIsRejectedByDatabase() {
        UUID ledger = ledgerRepository.saveAndFlush(Ledger.personal()).getId();

        assertThatThrownBy(() -> insertAccount(ledger, "생활비 ", 0L))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("ck_account_name_trimmed");
    }

    /** 앱 검사와 엔터티를 거치지 않고 DB에 바로 넣는다. 장부와 사용자를 새로 만들고 거래 id를 돌려준다. */
    private UUID insertTransaction(LocalDate occurredOn) {
        UUID user = UUID.randomUUID();
        UUID ledger = UUID.randomUUID();
        UUID tx = UUID.randomUUID();
        jdbc.update("""
                insert into users (id, email, password_hash, display_name, created_at)
                values (?, ?, 'hash', '스키마', now())
                """, user, user + "@example.com");
        jdbc.update("insert into ledger (id, name, created_at) values (?, '장부', now())", ledger);
        jdbc.update("""
                insert into transaction (id, ledger_id, type, occurred_on, status, created_by, version,
                                         created_at, updated_at)
                values (?, ?, 'EXPENSE', ?, 'POSTED', ?, 1, now(), now())
                """, tx, ledger, occurredOn, user);
        return tx;
    }

    /**
     * 앱 검사와 엔터티를 거치지 않고 DB에 바로 넣는다. 계좌는 거래의 장부에 새로 만든다.
     * 한 장부에 여러 번 부를 수 있게 계좌 이름을 호출마다 다르게 한다(uq_account_name).
     */
    private void insertLine(UUID transactionId, long amount) {
        UUID account = UUID.randomUUID();
        jdbc.update("""
                insert into account (id, ledger_id, name, type, opening_date, created_at)
                select ?, ledger_id, ?, 'CASH', DATE '2026-11-01', now() from transaction where id = ?
                """, account, "현금-" + account, transactionId);
        jdbc.update("""
                insert into transaction_line (id, transaction_id, account_id, amount, created_at)
                values (?, ?, ?, ?, now())
                """, UUID.randomUUID(), transactionId, account, amount);
    }

    /** 앱 검사와 엔터티를 거치지 않고 DB에 바로 넣는다. */
    private void insertAccount(UUID ledgerId, String name, long openingBalance) {
        jdbc.update("""
                insert into account (id, ledger_id, name, type, opening_balance, opening_date, created_at)
                values (?, ?, ?, 'BANK', ?, DATE '2026-11-01', now())
                """, UUID.randomUUID(), ledgerId, name, openingBalance);
    }

    /** 앱 검사와 엔터티를 거치지 않고 DB에 바로 넣는다. */
    private void insertUser(String email, String displayName) {
        jdbc.update("""
                insert into users (id, email, password_hash, display_name, created_at)
                values (?, ?, 'hash', ?, now())
                """, UUID.randomUUID(), email, displayName);
    }

    /** 앱 검사와 엔터티를 거치지 않고 DB에 바로 넣는다. */
    private void insertCategory(UUID id, UUID ledgerId, String kind, String name, UUID parentId, boolean system) {
        jdbc.update("""
                insert into category (id, ledger_id, kind, name, parent_id, system, created_at)
                values (?, ?, ?, ?, ?, ?, now())
                """, id, ledgerId, kind, name, parentId, system);
    }
}
