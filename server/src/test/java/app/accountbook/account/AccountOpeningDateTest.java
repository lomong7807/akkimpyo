package app.accountbook.account;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.assertj.core.api.Assertions.catchThrowableOfType;

import app.accountbook.common.InvalidRequestException;
import app.accountbook.common.NotLedgerMemberException;
import app.accountbook.ledger.Ledger;
import app.accountbook.ledger.LedgerRepository;
import app.accountbook.ledger.LedgerRole;
import app.accountbook.stats.BalanceQuery;
import app.accountbook.support.Fixtures;
import app.accountbook.support.IntegrationTest;
import app.accountbook.user.User;
import jakarta.persistence.EntityManager;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.assertj.core.api.ThrowableAssert.ThrowingCallable;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;
import org.springframework.jdbc.core.JdbcTemplate;

/**
 * 계좌 기준일의 범위(P-202, P-206, F-502, F-503): 2000-01-01부터 장부 시간대의 오늘로부터 1년 뒤까지.
 * 만들기와 수정에 걸려 있고 경계값이 실제로 저장되는지 본다. 시계는 테스트가 정한 시각에 멈춰 있다.
 */
@IntegrationTest
@Import(AccountOpeningDateTest.StoppedClockConfig.class)
class AccountOpeningDateTest {

    /** 서울은 이미 다음 날인 2026-11-26 08:30이다. */
    static final String UTC_LATE_EVENING = "2026-11-25T23:30:00Z";
    static final String FIRST_DAY = "2000-01-01";
    static final String SEOUL_TODAY = "2026-11-26";
    static final String LAST_DAY = "2027-11-26";

    @TestConfiguration(proxyBeanMethods = false)
    static class StoppedClockConfig {

        @Bean
        @Primary
        StoppedClock stoppedClock() {
            return new StoppedClock();
        }
    }

    /** 테스트가 정한 시각에 멈춘 시계. */
    static final class StoppedClock extends Clock {

        private Instant now;

        void stopAt(String instant) {
            now = Instant.parse(instant);
        }

        @Override
        public Instant instant() {
            return now;
        }

        @Override
        public ZoneId getZone() {
            return ZoneOffset.UTC;
        }

        @Override
        public Clock withZone(ZoneId zone) {
            return Clock.fixed(now, zone);
        }
    }

    @Autowired AccountService accountService;
    @Autowired BalanceQuery balanceQuery;
    @Autowired LedgerRepository ledgerRepository;
    @Autowired Fixtures fixtures;
    @Autowired EntityManager entityManager;
    @Autowired JdbcTemplate jdbc;
    @Autowired StoppedClock clock;

    User owner;
    UUID ledgerId;

    @BeforeEach
    void setUp() {
        clock.stopAt(UTC_LATE_EVENING);
        owner = fixtures.user("owner@example.com");
        ledgerId = fixtures.personalLedgerId(owner);
    }

    @ParameterizedTest
    @ValueSource(strings = {FIRST_DAY, SEOUL_TODAY, LAST_DAY})
    void create_storesDatesUpToBothEdges(String date) {
        Account created = create(ledgerId, date);

        assertThat(storedDate(created.getId())).isEqualTo(date);
    }

    @ParameterizedTest
    @ValueSource(strings = {"1999-12-31", "2027-11-27", "0001-01-01", "9999-12-31", "+10000-01-01"})
    void create_rejectsDatesOutsideRange(String date) {
        assertRejected(() -> create(ledgerId, date));
        assertThat(accountService.list(owner.getId(), ledgerId)).isEmpty();
    }

    @ParameterizedTest
    @ValueSource(strings = {FIRST_DAY, SEOUL_TODAY, LAST_DAY})
    void update_storesDatesUpToBothEdges(String date) {
        Account account = create(ledgerId, "2026-11-01");

        update(account.getId(), date);

        assertThat(storedDate(account.getId())).isEqualTo(date);
    }

    @ParameterizedTest
    @ValueSource(strings = {"1999-12-31", "2027-11-27", "0001-01-01", "9999-12-31", "+10000-01-01"})
    void update_rejectsDatesOutsideRangeAndKeepsTheAccount(String date) {
        Account account = create(ledgerId, "2026-11-01");
        Map<String, Object> before = storedRow(account.getId());

        assertRejected(() -> accountService.update(owner.getId(), account.getId(),
                new AccountCommand("다른 이름", AccountType.CASH, 5_000, LocalDate.parse(date))));

        assertThat(storedRow(account.getId())).isEqualTo(before);
    }

    /**
     * 마지막으로 저장되는 날짜가 last이고 그다음 날은 거부된다. 만들기와 수정이 같다.
     * 서울 자정은 UTC 15:00이다. 오늘이 2월 29일이면 1년 뒤는 다음 해 2월 28일이고, 윤일을 지나는 1년은 366일이다.
     */
    @ParameterizedTest
    @CsvSource(textBlock = """
            # 장부 시간대,         서버 시계,             last
            Asia/Seoul,          2026-11-25T14:59:59Z, 2027-11-25
            Asia/Seoul,          2026-11-25T15:00:00Z, 2027-11-26
            Asia/Seoul,          2026-11-25T23:30:00Z, 2027-11-26
            Asia/Seoul,          2028-02-29T03:00:00Z, 2029-02-28
            Asia/Seoul,          2028-02-28T15:00:00Z, 2029-02-28
            Asia/Seoul,          2027-02-28T03:00:00Z, 2028-02-28
            Asia/Seoul,          2027-11-25T03:00:00Z, 2028-11-25
            America/Los_Angeles, 2026-11-25T07:59:59Z, 2027-11-24
            America/Los_Angeles, 2026-11-25T08:00:00Z, 2027-11-25
            America/Los_Angeles, 2026-11-25T23:30:00Z, 2027-11-25
            Pacific/Auckland,    2026-11-25T10:59:59Z, 2027-11-25
            Pacific/Auckland,    2026-11-25T11:00:00Z, 2027-11-26
            """)
    void lastDayIsOneCalendarYearFromTodayInTheLedgerZone(String zone, String now, LocalDate last) {
        UUID zonedLedgerId = ledgerIn(zone);
        clock.stopAt(now);
        String dayAfter = last.plusDays(1).toString();

        assertRejected(() -> create(zonedLedgerId, dayAfter));
        Account account = create(zonedLedgerId, last.toString());
        assertThat(storedDate(account.getId())).isEqualTo(last.toString());

        assertRejected(() -> update(account.getId(), dayAfter));
        update(account.getId(), FIRST_DAY);
        update(account.getId(), last.toString());
        assertThat(storedDate(account.getId())).isEqualTo(last.toString());
    }

    /** 구성원이 아닌 사람과 없는 계좌에는 범위 오류가 아니라 구성원 아님이 나간다. */
    @Test
    void membershipIsCheckedBeforeTheDate() {
        User outsider = fixtures.user("outsider@example.com");
        Account account = create(ledgerId, SEOUL_TODAY);
        AccountCommand outOfRange = command("생활비", "1999-12-31");

        assertThatThrownBy(() -> accountService.create(outsider.getId(), ledgerId, outOfRange))
                .isInstanceOf(NotLedgerMemberException.class);
        assertThatThrownBy(() -> accountService.update(outsider.getId(), account.getId(), outOfRange))
                .isInstanceOf(NotLedgerMemberException.class);
        assertThatThrownBy(() -> accountService.update(owner.getId(), UUID.randomUUID(), outOfRange))
                .isInstanceOf(NotLedgerMemberException.class);
    }

    /** 기준일은 다른 입력란의 오류와 함께 알린다. 같은 이름은 형식이 모두 맞을 때만 본다(#13). */
    @Test
    void dateIsReportedWithOtherFieldsAndBeforeDuplicateName() {
        create(ledgerId, SEOUL_TODAY);
        LocalDate outOfRange = LocalDate.of(1999, 12, 31);

        assertThat(rejectedFields(new AccountCommand("생활비", null, 0, outOfRange)))
                .containsExactly("type:REQUIRED", "openingDate:OUT_OF_RANGE");
        assertThat(rejectedFields(new AccountCommand("  ", AccountType.BANK, Long.MAX_VALUE, outOfRange)))
                .containsExactly("name:REQUIRED", "openingBalance:OUT_OF_RANGE", "openingDate:OUT_OF_RANGE");
        assertThat(rejectedFields(new AccountCommand(null, null, (Long) null, null)))
                .containsExactly("name:REQUIRED", "type:REQUIRED", "openingBalance:REQUIRED", "openingDate:REQUIRED");
        assertRejected(() -> accountService.create(owner.getId(), ledgerId, command("생활비", "1999-12-31")));
    }

    private List<String> rejectedFields(AccountCommand command) {
        InvalidRequestException e = catchThrowableOfType(InvalidRequestException.class,
                () -> accountService.create(owner.getId(), ledgerId, command));
        return e.errors().stream().map(error -> error.field() + ":" + error.code()).toList();
    }

    /** 앱 검사를 거치지 않고 들어온 상한 밖의 기준일. 하한 밖은 DB 제약(ck_account_opening_date_min)이 막는다. */
    @ParameterizedTest
    @ValueSource(strings = {"2028-11-26", "9999-12-31", "+10000-01-01"})
    void storedDateAboveRangeIsStillReadable(String date) {
        UUID accountId = insertAccount(date, 1_000);
        fixtures.expense(owner, ledgerId, accountId, null, LocalDate.parse(SEOUL_TODAY), 300);

        assertThat(accountService.list(owner.getId(), ledgerId)).singleElement()
                .satisfies(account -> {
                    assertThat(account.getId()).isEqualTo(accountId);
                    assertThat(account.getOpeningDate()).isEqualTo(LocalDate.parse(date));
                });
        // 기준일 앞의 거래는 잔액에 들어가지 않는다(P-206).
        assertThat(balanceQuery.balance(owner.getId(), accountId)).isEqualTo(1_000);
        assertThat(balanceQuery.balances(owner.getId(), ledgerId)).isEqualTo(Map.of(accountId, 1_000L));
    }

    /** 요청이 기준일을 함께 보내므로 저장된 값 그대로라도 범위 밖이면 거부되고, 범위 안으로 고치면 저장된다. */
    @Test
    void storedDateAboveRangeMustBeFixedWhenUpdating() {
        UUID accountId = insertAccount("2028-11-26", 1_000);
        Map<String, Object> before = storedRow(accountId);

        assertRejected(() -> accountService.update(owner.getId(), accountId,
                new AccountCommand("새 이름", AccountType.BANK, 1_000, LocalDate.parse("2028-11-26"))));
        assertThat(storedRow(accountId)).isEqualTo(before);

        accountService.update(owner.getId(), accountId,
                new AccountCommand("새 이름", AccountType.BANK, 1_000, LocalDate.parse(LAST_DAY)));
        assertThat(storedDate(accountId)).isEqualTo(LAST_DAY);
    }

    private static void assertRejected(ThrowingCallable call) {
        assertThatThrownBy(call)
                .isInstanceOf(InvalidRequestException.class)
                .hasMessage("기준일은 2000-01-01부터 오늘로부터 1년 뒤까지 입력할 수 있습니다.");
    }

    private Account create(UUID targetLedgerId, String date) {
        return accountService.create(owner.getId(), targetLedgerId, command("생활비", date));
    }

    private void update(UUID accountId, String date) {
        accountService.update(owner.getId(), accountId, command("생활비", date));
    }

    private static AccountCommand command(String name, String date) {
        return new AccountCommand(name, AccountType.BANK, 0, LocalDate.parse(date));
    }

    /** owner가 소유자인, 시간대가 zone인 새 장부. */
    private UUID ledgerIn(String zone) {
        UUID id = ledgerRepository.saveAndFlush(Ledger.of("장부", zone)).getId();
        fixtures.addMember(id, owner, LedgerRole.OWNER);
        return id;
    }

    /** 앱 검사와 엔터티를 거치지 않고 DB에 바로 넣는다. */
    private UUID insertAccount(String openingDate, long openingBalance) {
        UUID id = UUID.randomUUID();
        jdbc.update("""
                insert into account (id, ledger_id, name, type, opening_balance, opening_date, created_at)
                values (?, ?, '생활비', 'BANK', ?, ?, now())
                """, id, ledgerId, openingBalance, LocalDate.parse(openingDate));
        return id;
    }

    /** 영속성 컨텍스트를 거치지 않고 DB에 저장된 값을 읽는다. */
    private String storedDate(UUID accountId) {
        return storedRow(accountId).get("opening_date").toString();
    }

    private Map<String, Object> storedRow(UUID accountId) {
        entityManager.flush();
        return jdbc.queryForMap("select * from account where id = ?", accountId);
    }
}
