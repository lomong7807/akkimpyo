package app.accountbook;

import static app.accountbook.support.CheckConstraints.CHANGE_BOTH;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.junit.jupiter.params.provider.Arguments.arguments;

import app.accountbook.account.Account;
import app.accountbook.account.AccountType;
import app.accountbook.category.Category;
import app.accountbook.category.CategoryKind;
import app.accountbook.common.InvalidRequestException;
import app.accountbook.common.Names;
import app.accountbook.ledger.LedgerDates;
import app.accountbook.ledger.LedgerRole;
import app.accountbook.support.CheckConstraints;
import app.accountbook.support.Fixtures;
import app.accountbook.support.IntegrationTest;
import app.accountbook.transaction.ChangeAction;
import app.accountbook.transaction.RefundKind;
import app.accountbook.transaction.TransactionStatus;
import app.accountbook.transaction.TransactionType;
import app.accountbook.user.User;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.Arrays;
import java.util.List;
import java.util.UUID;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * 앱의 값(Java enum, 상수)과 DB CHECK의 값이 같은지 본다(이슈 #63). DB 쪽 값은 pg_constraint의 정의에서 읽는다.
 * 어느 한쪽만 바꾸면 실패한다. 앱 상수가 밖에 보이지 않는 곳(LedgerDates, AccountService)은 DB 값의 경계에서 앱의 동작을 본다.
 * 거래 라인 금액은 TransactionLimits가 패키지 안에만 보여 transaction.TransactionLimitsSchemaTest가 본다.
 */
@IntegrationTest
class SchemaValueMatchTest {

    @Autowired JdbcTemplate jdbc;
    @Autowired Fixtures fixtures;

    static Stream<Arguments> enumColumns() {
        return Stream.of(
                arguments(LedgerRole.class, "ledger_member", "role", "ck_ledger_member_role_values"),
                arguments(AccountType.class, "account", "type", "ck_account_type_values"),
                arguments(CategoryKind.class, "category", "kind", "ck_category_kind_values"),
                arguments(TransactionType.class, "transaction", "type", "ck_transaction_type_values"),
                arguments(TransactionStatus.class, "transaction", "status", "ck_transaction_status_values"),
                arguments(RefundKind.class, "transaction", "refund_kind", "ck_transaction_refund_kind_values"),
                arguments(ChangeAction.class, "change_log", "action", "ck_change_log_action_values"));
    }

    @ParameterizedTest(name = "{1}.{2}")
    @MethodSource("enumColumns")
    void enumValuesMatchCheckValues(Class<? extends Enum<?>> enumType, String table, String column,
                                    String constraint) {
        List<String> enumValues = Arrays.stream(enumType.getEnumConstants()).map(Enum::name).toList();

        assertThat(checks().allowedValues(table, constraint, column))
                .as("%s의 값과 %s.%s의 CHECK %s의 값 목록이 다르다. enum에 값을 더하거나 빼면 이 CHECK도 바꾼다. %s",
                        enumType.getSimpleName(), table, column, constraint, CHANGE_BOTH)
                .containsExactlyInAnyOrderElementsOf(enumValues);
    }

    @Test
    void currencyCheckAllowsOnlyAccountDefaultCurrency() {
        assertThat(checks().allowedValues("account", "ck_account_currency_values", "currency"))
                .as("Account.DEFAULT_CURRENCY와 ck_account_currency_values가 다르다. %s", CHANGE_BOTH)
                .containsExactly(Account.DEFAULT_CURRENCY);
    }

    static Stream<Arguments> maxLengths() {
        return Stream.of(
                arguments("Category.NAME_MAX_LENGTH", Category.NAME_MAX_LENGTH,
                        "category", "ck_category_name_length", "char_length(name)"),
                arguments("Names.MAX_LENGTH", Names.MAX_LENGTH,
                        "account", "ck_account_name_length", "char_length(name)"),
                arguments("User.DISPLAY_NAME_MAX_LENGTH", User.DISPLAY_NAME_MAX_LENGTH,
                        "users", "ck_users_display_name_length", "char_length(display_name)"),
                arguments("User.EMAIL_MAX_LENGTH", User.EMAIL_MAX_LENGTH,
                        "users", "ck_users_email_length", "char_length(email)"));
    }

    @ParameterizedTest(name = "{0} = {3}")
    @MethodSource("maxLengths")
    void maxLengthMatchesCheck(String constantName, int appMax, String table, String constraint, String expression) {
        assertThat(checks().comparedLong(table, constraint, expression, "<="))
                .as("%s와 %s의 상한이 다르다. %s", constantName, constraint, CHANGE_BOTH)
                .isEqualTo(appMax);
    }

    @Test
    void dateLowerBoundsMatchLedgerDates() {
        LocalDate occurredOnMin = LocalDate.parse(
                checks().comparedValue("transaction", "ck_transaction_occurred_on_min", "occurred_on", ">="));
        LocalDate openingDateMin = LocalDate.parse(
                checks().comparedValue("account", "ck_account_opening_date_min", "opening_date", ">="));
        String mismatch = "LedgerDates의 하한과 ck_transaction_occurred_on_min, ck_account_opening_date_min이 다르다. "
                + CHANGE_BOTH;

        // 두 하한은 같은 규칙이다(P-202, P-206).
        assertThat(openingDateMin).as(mismatch).isEqualTo(occurredOnMin);
        // LedgerDates.MIN_DATE는 밖에 보이지 않는다. DB 하한은 받고 그 전날은 거부하는지 본다.
        assertThatCode(() -> requireInLedgerRange(occurredOnMin)).as(mismatch).doesNotThrowAnyException();
        assertThatThrownBy(() -> requireInLedgerRange(occurredOnMin.minusDays(1))).as(mismatch)
                .isInstanceOf(InvalidRequestException.class);
    }

    @Test
    void openingBalanceRangeMatchesAccountService() {
        String table = "account";
        String constraint = "ck_account_opening_balance_range";
        long min = checks().comparedLong(table, constraint, "opening_balance", ">=");
        long max = checks().comparedLong(table, constraint, "opening_balance", "<=");
        User owner = fixtures.user("balance@example.com");
        UUID ledger = fixtures.personalLedgerId(owner);
        String mismatch = "AccountService의 시작 잔액 범위와 " + constraint + "가 다르다. " + CHANGE_BOTH;

        // AccountService의 상한은 밖에 보이지 않는다. DB 범위의 양 끝은 받고 그 바깥은 거부하는지 본다.
        assertThatCode(() -> createAccount(owner, ledger, "최대", max)).as(mismatch).doesNotThrowAnyException();
        assertThatCode(() -> createAccount(owner, ledger, "최소", min)).as(mismatch).doesNotThrowAnyException();
        assertThatThrownBy(() -> createAccount(owner, ledger, "상한 넘음", max + 1)).as(mismatch)
                .isInstanceOf(InvalidRequestException.class)
                .hasMessageContaining("시작 잔액");
        assertThatThrownBy(() -> createAccount(owner, ledger, "하한 넘음", min - 1)).as(mismatch)
                .isInstanceOf(InvalidRequestException.class)
                .hasMessageContaining("시작 잔액");
    }

    private CheckConstraints checks() {
        return CheckConstraints.of(jdbc);
    }

    /** 오늘(2026-11-26)과 시간대는 하한 판정과 무관하다. */
    private static void requireInLedgerRange(LocalDate date) {
        LedgerDates.requireInRange("occurredOn", "날짜는", date, Clock.fixed(Instant.parse("2026-11-26T00:00:00Z"), ZoneOffset.UTC),
                ZoneId.of("Asia/Seoul"));
    }

    private void createAccount(User owner, UUID ledger, String name, long openingBalance) {
        fixtures.account(owner, ledger, name, AccountType.BANK, openingBalance, LocalDate.of(2026, 11, 1));
    }
}
