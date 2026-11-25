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
import java.util.Arrays;
import java.util.List;
import java.util.UUID;
import org.assertj.core.api.ThrowableAssert.ThrowingCallable;
import org.hibernate.exception.ConstraintViolationException;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
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

    @ParameterizedTest
    @ValueSource(strings = {
            "A@example.com", "Z@example.com", "owner@Example.com",         // 대문자
            " owner@example.com", "owner@example.com ",                    // 앞뒤 공백
            "ow ner@example.com",                                          // 가운데 공백
            "ow\tner@example.com", "owner@example.com\n", "ow\u007Fner@example.com", // 제어 문자
            "ow\u200Bner@example.com",                                     // 보이지 않는 글자
            "\u00E9@example.com", "가@example.com", "\u0130@example.com", "owner\uFF20example.com", // ASCII 밖
            ""})
    void emailOutsideNormalizedPrintableAsciiIsRejectedByDatabase(String email) {
        assertThatThrownBy(() -> insertUser(email, "스키마"))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("ck_users_email_normalized");
    }

    @Test
    void emailWithBoundaryCharactersIsAcceptedByDatabase() {
        // 허용 범위의 양 끝(!와 ~)과 대문자 구간의 바로 앞뒤(@와 [)다.
        List<String> emails = List.of("!@example.com", "~@example.com", "[@example.com");

        emails.forEach(email -> insertUser(email, "스키마"));

        assertThat(jdbc.queryForList("select email from users", String.class)).containsAll(emails);
    }

    @Test
    void emailOverTwoHundredFiftyFourCharactersIsRejectedByDatabase() {
        String domain = "@example.com";
        insertUser("a".repeat(254 - domain.length()) + domain, "스키마");

        assertThatThrownBy(() -> insertUser("a".repeat(255 - domain.length()) + domain, "스키마"))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("ck_users_email_length");
    }

    @Test
    void sameEmailIsRejectedByNamedUniqueConstraint() {
        // 이름은 V1의 UNIQUE (email)에 PostgreSQL이 붙인 것이다. UserService가 이 이름으로 동시 가입을 구분한다.
        insertUser("same@example.com", "처음");

        assertThatThrownBy(() -> insertUser("same@example.com", "두번째"))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("users_email_key");
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
    void lineWithAccountOfAnotherLedgerIsRejectedByDatabase() {
        LedgerRows mine = insertLedgerRows();
        LedgerRows other = insertLedgerRows();

        assertThatThrownBy(() -> insertLine(mine.transaction(), mine.ledger(), other.account(), mine.category()))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("fk_transaction_line_account");
    }

    @Test
    void lineWithCategoryOfAnotherLedgerIsRejectedByDatabase() {
        LedgerRows mine = insertLedgerRows();
        LedgerRows other = insertLedgerRows();

        assertThatThrownBy(() -> insertLine(mine.transaction(), mine.ledger(), mine.account(), other.category()))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("fk_transaction_line_category");
    }

    @Test
    void lineWithLedgerOtherThanItsTransactionIsRejectedByDatabase() {
        LedgerRows mine = insertLedgerRows();
        LedgerRows other = insertLedgerRows();

        // 계좌와 카테고리는 라인의 장부와 같으므로 거래 쪽 제약만 어긋난다.
        assertThatThrownBy(() -> insertLine(mine.transaction(), other.ledger(), other.account(), other.category()))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("fk_transaction_line_transaction");
    }

    @Test
    void lineWithoutLedgerIsRejectedByDatabase() {
        LedgerRows mine = insertLedgerRows();

        assertThatThrownBy(() -> insertLine(mine.transaction(), null, mine.account(), mine.category()))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("null value in column \"ledger_id\"");
    }

    @Test
    void lineOfMissingTransactionAccountOrCategoryIsRejectedByDatabase() {
        // V1의 단일 컬럼 FK를 지운 뒤에도 없는 행을 가리킬 수 없다.
        LedgerRows mine = insertLedgerRows();
        UUID missing = UUID.randomUUID();

        assertRejectedBy("fk_transaction_line_transaction",
                () -> insertLine(missing, mine.ledger(), mine.account(), mine.category()));
        assertRejectedBy("fk_transaction_line_account",
                () -> insertLine(mine.transaction(), mine.ledger(), missing, mine.category()));
        assertRejectedBy("fk_transaction_line_category",
                () -> insertLine(mine.transaction(), mine.ledger(), mine.account(), missing));
    }

    @Test
    void lineWithoutCategoryIsAcceptedByDatabase() {
        // 이체 라인은 카테고리가 없다(MATCH SIMPLE이라 카테고리 FK를 검사하지 않는다).
        LedgerRows mine = insertLedgerRows();

        insertLine(mine.transaction(), mine.ledger(), mine.account(), null);

        assertThat(countLines(mine.transaction())).isEqualTo(1);
    }

    @Test
    void deletingTransactionDeletesItsLinesInDatabase() {
        LedgerRows mine = insertLedgerRows();
        LedgerRows other = insertLedgerRows();
        insertLine(mine.transaction(), mine.ledger(), mine.account(), mine.category());
        insertLine(mine.transaction(), mine.ledger(), mine.account(), null);
        insertLine(other.transaction(), other.ledger(), other.account(), other.category());

        jdbc.update("delete from transaction where id = ?", mine.transaction());

        assertThat(countLines(mine.transaction())).isZero();
        assertThat(countLines(other.transaction())).isEqualTo(1);
    }

    @Test
    void accountOrCategoryWithLineCannotBeDeletedInDatabase() {
        LedgerRows mine = insertLedgerRows();
        insertLine(mine.transaction(), mine.ledger(), mine.account(), mine.category());

        assertRejectedBy("fk_transaction_line_account",
                () -> jdbc.update("delete from account where id = ?", mine.account()));
        assertRejectedBy("fk_transaction_line_category",
                () -> jdbc.update("delete from category where id = ?", mine.category()));
    }

    @Test
    void transactionAccountOrCategoryWithLineCannotMoveToAnotherLedgerInDatabase() {
        // 거래 하나는 장부 하나에만 속한다(P-314). 옮기면 라인이 다른 장부를 가리키게 된다.
        LedgerRows mine = insertLedgerRows();
        LedgerRows other = insertLedgerRows();
        insertLine(mine.transaction(), mine.ledger(), mine.account(), mine.category());

        assertRejectedBy("fk_transaction_line_transaction", () -> jdbc.update(
                "update transaction set ledger_id = ? where id = ?", other.ledger(), mine.transaction()));
        assertRejectedBy("fk_transaction_line_account", () -> jdbc.update(
                "update account set ledger_id = ?, name = '옮긴 계좌' where id = ?", other.ledger(), mine.account()));
        assertRejectedBy("fk_transaction_line_category", () -> jdbc.update(
                "update category set ledger_id = ?, name = '옮긴 분류' where id = ?", other.ledger(), mine.category()));
    }

    @Test
    void lineOfAnotherLedgersAccountIsRejectedWhenSavedThroughRepository() {
        // 서비스의 장부 검사에 버그가 생겨 다른 장부의 계좌가 엔터티까지 온 경우다.
        LedgerRows mine = insertLedgerRows();
        LedgerRows other = insertLedgerRows();
        UUID user = jdbc.queryForObject("select created_by from transaction where id = ?", UUID.class,
                mine.transaction());
        Transaction tx = Transaction.of(UUID.randomUUID(), mine.ledger(), TransactionType.EXPENSE,
                LocalDate.of(2026, 11, 18), null, null, null, user, user);
        tx.addLine(other.account(), mine.category(), -12_000);

        assertThatThrownBy(() -> transactionRepository.saveAndFlush(tx))
                .isInstanceOf(DataIntegrityViolationException.class)
                .cause().isInstanceOfSatisfying(ConstraintViolationException.class, violation ->
                        assertThat(violation.getConstraintName()).isEqualTo("fk_transaction_line_account"));
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

    @Test
    void openingBalanceAtRangeEdgesIsAcceptedByDatabase() {
        UUID ledger = ledgerRepository.saveAndFlush(Ledger.personal()).getId();

        insertAccount(ledger, "최대", 9_999_999_999L);
        insertAccount(ledger, "최소", -9_999_999_999L);

        assertThat(jdbc.queryForList(
                "select opening_balance from account where ledger_id = ? order by opening_balance",
                Long.class, ledger)).containsExactly(-9_999_999_999L, 9_999_999_999L);
    }

    @Test
    void openingBalanceOverMaxIsRejectedByDatabase() {
        UUID ledger = ledgerRepository.saveAndFlush(Ledger.personal()).getId();

        assertThatThrownBy(() -> insertAccount(ledger, "생활비", 10_000_000_000L))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("ck_account_opening_balance_range");
    }

    @Test
    void openingBalanceUnderMinIsRejectedByDatabase() {
        UUID ledger = ledgerRepository.saveAndFlush(Ledger.personal()).getId();

        assertThatThrownBy(() -> insertAccount(ledger, "생활비", -10_000_000_000L))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("ck_account_opening_balance_range");
    }

    @Test
    void openingDateAtMinIsAcceptedByDatabase() {
        UUID ledger = ledgerRepository.saveAndFlush(Ledger.personal()).getId();

        insertAccountOpenedOn(ledger, LocalDate.of(2000, 1, 1));

        assertThat(jdbc.queryForObject("select opening_date from account where ledger_id = ?", LocalDate.class,
                ledger)).isEqualTo(LocalDate.of(2000, 1, 1));
    }

    @Test
    void openingDateBeforeMinIsRejectedByDatabase() {
        UUID ledger = ledgerRepository.saveAndFlush(Ledger.personal()).getId();

        assertThatThrownBy(() -> insertAccountOpenedOn(ledger, LocalDate.of(1999, 12, 31)))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("ck_account_opening_date_min");
    }

    @ParameterizedTest
    @ValueSource(strings = {
            "",
            " ", "iphone safari", " iphone.safari", "iphone.safari ",      // 공백
            "iphone,safari", "iphone/safari", "iphone;safari",             // 허용 구간의 바로 앞뒤: , / ; @ [ ^ `
            "iphone@safari", "iphone[safari", "iphone^safari", "iphone`safari", "iphone{safari",
            "iphone.safari\n", "\niphone.safari", "iphone\tsafari", "iphone\u007Fsafari", // 제어 문자
            "iph\u00F3ne.safari", "아이폰.safari", "iphone.safari\u0661", "iphone.safari\uD83D\uDCF1"}) // ASCII 밖
    void deviceIdOutsideFormatIsRejectedByDatabase(String deviceId) {
        UUID tx = insertTransaction(LocalDate.of(2026, 11, 18));

        assertThatThrownBy(() -> insertChangeLog(tx, deviceId))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("ck_change_log_device_id_format");
    }

    @Test
    void deviceIdOverSixtyFourCharactersIsRejectedByDatabase() {
        UUID tx = insertTransaction(LocalDate.of(2026, 11, 18));

        assertThatThrownBy(() -> insertChangeLog(tx, "a".repeat(65)))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("ck_change_log_device_id_format");
    }

    @Test
    void deviceIdWithAllowedCharactersOrNullIsAcceptedByDatabase() {
        UUID tx = insertTransaction(LocalDate.of(2026, 11, 18));
        List<String> deviceIds = Arrays.asList("a",
                "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._", ":-", null);

        deviceIds.forEach(deviceId -> insertChangeLog(tx, deviceId));

        assertThat(jdbc.queryForList("select device_id from change_log where transaction_id = ?", String.class, tx))
                .containsExactlyInAnyOrderElementsOf(deviceIds);
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
                insert into transaction_line (id, transaction_id, ledger_id, account_id, amount, created_at)
                select ?, id, ledger_id, ?, ?, now() from transaction where id = ?
                """, UUID.randomUUID(), account, amount, transactionId);
    }

    /** 앱 검사와 엔터티를 거치지 않고 DB에 바로 넣는다. 장부, 거래, 계좌, 카테고리를 마음대로 섞을 수 있다. */
    private void insertLine(UUID transactionId, UUID ledgerId, UUID accountId, UUID categoryId) {
        jdbc.update("""
                insert into transaction_line (id, transaction_id, ledger_id, account_id, category_id, amount,
                                              created_at)
                values (?, ?, ?, ?, ?, -12000, now())
                """, UUID.randomUUID(), transactionId, ledgerId, accountId, categoryId);
    }

    private long countLines(UUID transactionId) {
        return jdbc.queryForObject("select count(*) from transaction_line where transaction_id = ?", Long.class,
                transactionId);
    }

    /** 실패한 문장 뒤에는 트랜잭션이 막히므로 SAVEPOINT로 되돌려, 한 테스트에서 여러 문장을 볼 수 있게 한다. */
    private void assertRejectedBy(String constraint, ThrowingCallable statement) {
        jdbc.execute("SAVEPOINT before_rejected");
        assertThatThrownBy(statement)
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining(constraint);
        jdbc.execute("ROLLBACK TO SAVEPOINT before_rejected");
    }

    /** 장부 하나와 그 안의 지출 거래(라인 없음), 계좌, 카테고리를 새로 만든다. */
    private LedgerRows insertLedgerRows() {
        UUID transaction = insertTransaction(LocalDate.of(2026, 11, 18));
        UUID ledger = jdbc.queryForObject("select ledger_id from transaction where id = ?", UUID.class, transaction);
        insertAccount(ledger, "현금", 0L);
        UUID account = jdbc.queryForObject("select id from account where ledger_id = ?", UUID.class, ledger);
        UUID category = UUID.randomUUID();
        insertCategory(category, ledger, "EXPENSE", "식비", null, false);
        return new LedgerRows(ledger, transaction, account, category);
    }

    private record LedgerRows(UUID ledger, UUID transaction, UUID account, UUID category) {
    }

    /** 앱 검사와 엔터티를 거치지 않고 DB에 바로 넣는다. */
    private void insertChangeLog(UUID transactionId, String deviceId) {
        jdbc.update("""
                insert into change_log (id, transaction_id, ledger_id, action, actor_id, device_id, created_at)
                select ?, id, ledger_id, 'CREATE', created_by, ?, now() from transaction where id = ?
                """, UUID.randomUUID(), deviceId, transactionId);
    }

    /** 앱 검사와 엔터티를 거치지 않고 DB에 바로 넣는다. */
    private void insertAccount(UUID ledgerId, String name, long openingBalance) {
        jdbc.update("""
                insert into account (id, ledger_id, name, type, opening_balance, opening_date, created_at)
                values (?, ?, ?, 'BANK', ?, DATE '2026-11-01', now())
                """, UUID.randomUUID(), ledgerId, name, openingBalance);
    }

    /** 앱 검사와 엔터티를 거치지 않고 DB에 바로 넣는다. */
    private void insertAccountOpenedOn(UUID ledgerId, LocalDate openingDate) {
        jdbc.update("""
                insert into account (id, ledger_id, name, type, opening_date, created_at)
                values (?, ?, '현금', 'CASH', ?, now())
                """, UUID.randomUUID(), ledgerId, openingDate);
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
