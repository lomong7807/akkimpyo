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
import org.junit.jupiter.params.provider.CsvSource;
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

    @Test
    void sameVersionOfSameTransactionInChangeLogIsRejectedByDatabase() {
        LedgerRows mine = insertLedgerRows();
        UUID actor = UUID.randomUUID();
        insertChangeLog(mine.transaction(), mine.ledger(), 1L, actor);
        // 다른 번호와, 다른 거래의 같은 번호는 들어간다.
        insertChangeLog(mine.transaction(), mine.ledger(), 2L, actor);
        insertChangeLog(UUID.randomUUID(), mine.ledger(), 1L, actor);

        assertRejectedBy("uq_change_log_transaction_version",
                () -> insertChangeLog(mine.transaction(), mine.ledger(), 1L, actor));
        // 장부가 달라도 같은 거래의 같은 번호다.
        LedgerRows other = insertLedgerRows();
        assertRejectedBy("uq_change_log_transaction_version",
                () -> insertChangeLog(mine.transaction(), other.ledger(), 1L, actor));
    }

    @Test
    void changeLogWithoutVersionIsRejectedByDatabase() {
        LedgerRows mine = insertLedgerRows();

        assertRejectedBy("null value in column \"version\"",
                () -> insertChangeLog(mine.transaction(), mine.ledger(), null, UUID.randomUUID()));
    }

    @Test
    void changeLogOfMissingLedgerIsRejectedByDatabase() {
        LedgerRows mine = insertLedgerRows();

        assertRejectedBy("fk_change_log_ledger",
                () -> insertChangeLog(mine.transaction(), UUID.randomUUID(), 1L, UUID.randomUUID()));
    }

    @Test
    void ledgerWithChangeLogCannotBeDeletedInDatabase() {
        // 장부 삭제는 CASCADE에 기대지 않는다. 이력이 남아 있으면 장부를 지울 수 없다.
        UUID ledger = ledgerRepository.saveAndFlush(Ledger.personal()).getId();
        insertChangeLog(UUID.randomUUID(), ledger, 1L, UUID.randomUUID());

        assertRejectedBy("fk_change_log_ledger", () -> jdbc.update("delete from ledger where id = ?", ledger));

        jdbc.update("delete from change_log where ledger_id = ?", ledger);
        assertThat(jdbc.update("delete from ledger where id = ?", ledger)).isEqualTo(1);
    }

    @Test
    void changeLogOutlivesItsTransactionInDatabase() {
        // transaction_id는 FK가 아니다. 거래를 지워도 이력이 남고, 없는 거래의 이력도 들어간다.
        LedgerRows mine = insertLedgerRows();
        insertChangeLog(mine.transaction(), mine.ledger(), 1L, UUID.randomUUID());

        jdbc.update("delete from transaction where id = ?", mine.transaction());
        insertChangeLog(mine.transaction(), mine.ledger(), 2L, UUID.randomUUID());

        assertThat(jdbc.queryForList("select version from change_log where transaction_id = ? order by version",
                Long.class, mine.transaction())).containsExactly(1L, 2L);
    }

    @Test
    void changeLogWithoutActorIsAcceptedByDatabase() {
        // 서버가 한 일과 탈퇴한 사람의 자리(ADR 007 결정 5, 6).
        LedgerRows mine = insertLedgerRows();

        insertChangeLog(mine.transaction(), mine.ledger(), 1L, null);

        assertThat(jdbc.queryForObject("select count(*) from change_log where transaction_id = ? and actor_id is null",
                Integer.class, mine.transaction())).isEqualTo(1);
    }

    @Test
    void changeLogFormatVersionIsOneUnlessGivenAndNeverBelowOneInDatabase() {
        LedgerRows mine = insertLedgerRows();
        insertChangeLog(mine.transaction(), mine.ledger(), 1L, UUID.randomUUID());

        assertThat(jdbc.queryForObject("select format_version from change_log where transaction_id = ?",
                Integer.class, mine.transaction())).isEqualTo(1);
        assertRejectedBy("ck_change_log_format_version_min", () -> jdbc.update(
                "update change_log set format_version = 0 where transaction_id = ?", mine.transaction()));
        assertRejectedBy("null value in column \"format_version\"", () -> jdbc.update(
                "update change_log set format_version = null where transaction_id = ?", mine.transaction()));
    }

    // 열거형 컬럼의 값 목록(#63). 목록 자체가 Java enum과 같은지는 SchemaValueMatchTest가 본다.
    // 대소문자와 앞뒤 공백도 그대로 비교한다. 빈 문자열도 목록 밖이다.

    @ParameterizedTest
    @ValueSource(strings = {"ADMIN", "owner", "OWNER ", ""})
    void ledgerMemberRoleOutsideEnumIsRejectedByDatabase(String role) {
        assertThatThrownBy(() -> insertLedgerMember(role))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("ck_ledger_member_role_values");
    }

    @ParameterizedTest
    @ValueSource(strings = {"SAVINGS", "bank", ""})
    void accountTypeOutsideEnumIsRejectedByDatabase(String type) {
        UUID ledger = ledgerRepository.saveAndFlush(Ledger.personal()).getId();

        assertThatThrownBy(() -> insertAccount(ledger, type, "KRW", "2026-11-01"))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("ck_account_type_values");
    }

    @ParameterizedTest
    @ValueSource(strings = {"TRANSFER", "expense", ""}) // TRANSFER는 거래 유형에만 있다.
    void categoryKindOutsideEnumIsRejectedByDatabase(String kind) {
        UUID ledger = ledgerRepository.saveAndFlush(Ledger.personal()).getId();

        assertThatThrownBy(() -> insertCategory(UUID.randomUUID(), ledger, kind, "식비", null, false))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("ck_category_kind_values");
    }

    @ParameterizedTest
    @ValueSource(strings = {"REFUND", "expense", ""})
    void transactionTypeOutsideEnumIsRejectedByDatabase(String type) {
        assertThatThrownBy(() -> insertTransaction(type, "POSTED", "2026-11-18"))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("ck_transaction_type_values");
    }

    @ParameterizedTest
    @ValueSource(strings = {"CONFIRMED", "posted", ""})
    void transactionStatusOutsideEnumIsRejectedByDatabase(String status) {
        assertThatThrownBy(() -> insertTransaction("EXPENSE", status, "2026-11-18"))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("ck_transaction_status_values");
    }

    @ParameterizedTest
    @ValueSource(strings = {"HARD_DELETE", "create", ""})
    void changeLogActionOutsideEnumIsRejectedByDatabase(String action) {
        UUID ledger = ledgerRepository.saveAndFlush(Ledger.personal()).getId();

        assertThatThrownBy(() -> insertChangeLogAction(ledger, action))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("ck_change_log_action_values");
    }

    @ParameterizedTest
    @ValueSource(strings = {"USD", "krw", "KRW ", ""})
    void currencyOtherThanKrwIsRejectedByDatabase(String currency) {
        // char(3)였을 때는 'KRW '가 'KRW'로 저장됐다. text라서 다른 값이다.
        UUID ledger = ledgerRepository.saveAndFlush(Ledger.personal()).getId();

        assertThatThrownBy(() -> insertAccount(ledger, "CASH", currency, "2026-11-01"))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("ck_account_currency_values");
    }

    @ParameterizedTest
    @CsvSource({
            "ledger_member, role", "account, type", "account, currency", "category, kind",
            "transaction, type", "transaction, status", "change_log, action"})
    void enumAndCurrencyColumnsAreText(String table, String column) {
        // varchar(20)이면 20자를 넘는 enum 값을 CHECK와 따로 막는다(schema-standards 1절: 열거형은 text + CHECK).
        assertThat(jdbc.queryForObject("""
                select format_type(a.atttypid, a.atttypmod)
                  from pg_attribute a
                  join pg_class t on t.oid = a.attrelid
                 where t.relname = ? and a.attname = ? and not a.attisdropped
                """, String.class, table, column)).isEqualTo("text");
    }

    @Test
    void currencyDefaultsToKrwAndAccountEntityStoresKrw() {
        UUID ledger = ledgerRepository.saveAndFlush(Ledger.personal()).getId();
        insertAccount(ledger, "생활비", 0L); // currency를 적지 않는다.
        accountRepository.saveAndFlush(Account.of(ledger, "현금", AccountType.CASH, 0, LocalDate.of(2026, 11, 1)));

        assertThat(jdbc.queryForList("select currency from account where ledger_id = ?", String.class, ledger))
                .containsExactly("KRW", "KRW");
        assertThat(jdbc.queryForObject("""
                select column_default from information_schema.columns
                 where table_schema = 'public' and table_name = 'account' and column_name = 'currency'
                """, String.class)).isEqualTo("'KRW'::text");
    }

    // 하한 CHECK(V5, V9)는 'infinity'를 통과시킨다. 그런 계좌는 잔액 조회가 실패한다(#165).
    // '-infinity'는 하한도 어기지만 PostgreSQL은 한 테이블의 CHECK를 이름 순으로 검사해서 _finite가 먼저 걸린다.

    @ParameterizedTest
    @ValueSource(strings = {"infinity", "-infinity"})
    void infiniteOpeningDateIsRejectedByDatabase(String openingDate) {
        UUID ledger = ledgerRepository.saveAndFlush(Ledger.personal()).getId();

        assertThatThrownBy(() -> insertAccount(ledger, "CASH", "KRW", openingDate))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("ck_account_opening_date_finite");
    }

    @ParameterizedTest
    @ValueSource(strings = {"infinity", "-infinity"})
    void infiniteOccurredOnIsRejectedByDatabase(String occurredOn) {
        assertThatThrownBy(() -> insertTransaction("EXPENSE", "POSTED", occurredOn))
                .isInstanceOf(DataIntegrityViolationException.class)
                .hasMessageContaining("ck_transaction_occurred_on_finite");
    }

    /** 앱 검사와 엔터티를 거치지 않고 DB에 바로 넣는다. 장부와 사용자를 새로 만들고 거래 id를 돌려준다. */
    private UUID insertTransaction(LocalDate occurredOn) {
        return insertTransaction("EXPENSE", "POSTED", occurredOn.toString());
    }

    /** 위와 같다. 날짜는 'infinity'처럼 LocalDate로 나타낼 수 없는 값도 넣을 수 있게 문자열로 받는다. */
    private UUID insertTransaction(String type, String status, String occurredOn) {
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
                values (?, ?, ?, cast(? as date), ?, ?, 1, now(), now())
                """, tx, ledger, type, occurredOn, status, user);
        return tx;
    }

    /** 앱 검사와 엔터티를 거치지 않고 DB에 바로 넣는다. 장부와 사용자는 새로 만든 거래의 것을 쓴다. */
    private void insertLedgerMember(String role) {
        UUID tx = insertTransaction(LocalDate.of(2026, 11, 18));
        jdbc.update("""
                insert into ledger_member (id, ledger_id, user_id, role, created_at)
                select ?, ledger_id, created_by, ?, now() from transaction where id = ?
                """, UUID.randomUUID(), role, tx);
    }

    /** 앱 검사와 엔터티를 거치지 않고 DB에 바로 넣는다. 거래가 있는지는 보지 않는다(transaction_id는 FK가 아니다). */
    private void insertChangeLogAction(UUID ledgerId, String action) {
        jdbc.update("""
                insert into change_log (id, transaction_id, ledger_id, version, action, created_at)
                values (?, ?, ?, 1, ?, now())
                """, UUID.randomUUID(), UUID.randomUUID(), ledgerId, action);
    }

    /** 앱 검사와 엔터티를 거치지 않고 DB에 바로 넣는다. 기준일은 'infinity'도 넣을 수 있게 문자열로 받는다. */
    private void insertAccount(UUID ledgerId, String type, String currency, String openingDate) {
        jdbc.update("""
                insert into account (id, ledger_id, name, type, opening_date, currency, created_at)
                values (?, ?, '현금', ?, cast(? as date), ?, now())
                """, UUID.randomUUID(), ledgerId, type, openingDate, currency);
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

    /**
     * 앱 검사와 엔터티를 거치지 않고 DB에 바로 넣는다. 한 거래에 여러 번 부를 수 있게 번호(version)를 하나씩 올린다
     * (uq_change_log_transaction_version).
     */
    private void insertChangeLog(UUID transactionId, String deviceId) {
        jdbc.update("""
                insert into change_log (id, transaction_id, ledger_id, version, action, actor_id, device_id, created_at)
                select ?, id, ledger_id, 1 + (select count(*) from change_log where transaction_id = t.id), 'CREATE',
                       created_by, ?, now()
                  from transaction t where id = ?
                """, UUID.randomUUID(), deviceId, transactionId);
    }

    /** 앱 검사와 엔터티를 거치지 않고 DB에 바로 넣는다. 거래와 장부가 있는지도 보지 않는다. 형식 버전은 적지 않는다. */
    private void insertChangeLog(UUID transactionId, UUID ledgerId, Long version, UUID actorId) {
        jdbc.update("""
                insert into change_log (id, transaction_id, ledger_id, version, action, actor_id, created_at)
                values (?, ?, ?, ?, 'CREATE', ?, now())
                """, UUID.randomUUID(), transactionId, ledgerId, version, actorId);
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
