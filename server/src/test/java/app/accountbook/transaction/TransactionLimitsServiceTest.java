package app.accountbook.transaction;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import app.accountbook.account.Account;
import app.accountbook.account.AccountType;
import app.accountbook.common.InvalidRequestException;
import app.accountbook.ledger.Ledger;
import app.accountbook.ledger.LedgerRepository;
import app.accountbook.ledger.LedgerRole;
import app.accountbook.support.Fixtures;
import app.accountbook.support.IntegrationTest;
import app.accountbook.transaction.TransactionCommand.Entry;
import app.accountbook.transaction.TransactionCommand.Transfer;
import app.accountbook.transaction.TransactionView.Line;
import app.accountbook.user.User;
import jakarta.persistence.EntityManager;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.time.ZoneOffset;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.TestConfiguration;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Import;
import org.springframework.context.annotation.Primary;

/**
 * 금액(P-201)과 날짜(P-202) 범위가 거래 만들기와 수정에 걸려 있고, 경계값이 실제로 저장되는지 확인한다.
 * 경계 자체는 {@link TransactionLimitsTest}가 본다. 시계는 UTC 2026-11-25 23:30(서울 2026-11-26 08:30)에 멈춰 있다.
 */
@IntegrationTest
@Import(TransactionLimitsServiceTest.FixedClock.class)
class TransactionLimitsServiceTest {

    static final long MAX_AMOUNT = 9_999_999_999L;
    static final LocalDate SEOUL_TODAY = LocalDate.of(2026, 11, 26);
    static final LocalDate LAST_DAY = LocalDate.of(2027, 11, 26);
    static final String DEVICE = "iphone-1";

    @TestConfiguration(proxyBeanMethods = false)
    static class FixedClock {

        @Bean
        @Primary
        Clock fixedClock() {
            return Clock.fixed(Instant.parse("2026-11-25T23:30:00Z"), ZoneOffset.UTC);
        }
    }

    @Autowired TransactionService transactionService;
    @Autowired TransactionRepository transactionRepository;
    @Autowired LedgerRepository ledgerRepository;
    @Autowired Fixtures fixtures;
    @Autowired EntityManager entityManager;

    User owner;
    UUID ledgerId;
    Account cash;
    Account bank;

    @BeforeEach
    void setUp() {
        owner = fixtures.user("owner@example.com");
        ledgerId = fixtures.personalLedgerId(owner);
        cash = fixtures.account(owner, ledgerId, "현금", AccountType.CASH, 0, LocalDate.of(2026, 11, 1));
        bank = fixtures.account(owner, ledgerId, "국민은행", AccountType.BANK, 0, LocalDate.of(2026, 11, 1));
    }

    private Entry expense(UUID id, LocalDate on, LocalTime time, long amount) {
        return new Entry(id, TransactionType.EXPENSE, on, time, cash.getId(), null, amount, false, null, null,
                null);
    }

    private TransactionView create(TransactionCommand cmd) {
        return transactionService.create(owner.getId(), ledgerId, cmd, DEVICE);
    }

    /** 영속성 컨텍스트를 비워 다음 조회가 DB에 저장된 값을 읽게 한다. */
    private TransactionView reload(UUID id) {
        entityManager.flush();
        entityManager.clear();
        return transactionService.get(owner.getId(), id);
    }

    @Test
    void create_storesOneWonAndMaxAmount() {
        UUID one = UUID.randomUUID();
        UUID max = UUID.randomUUID();
        UUID transfer = UUID.randomUUID();

        create(expense(one, SEOUL_TODAY, null, 1));
        create(expense(max, SEOUL_TODAY, null, MAX_AMOUNT));
        create(new Transfer(transfer, SEOUL_TODAY, null, bank.getId(), cash.getId(), MAX_AMOUNT, null));

        assertThat(reload(one).lines()).extracting(Line::amount).containsExactly(-1L);
        assertThat(reload(max).lines()).extracting(Line::amount).containsExactly(-MAX_AMOUNT);
        assertThat(reload(transfer).lines()).extracting(Line::amount)
                .containsExactlyInAnyOrder(-MAX_AMOUNT, MAX_AMOUNT);
    }

    @Test
    void create_rejectsAmountOutOfRange() {
        assertThatThrownBy(() -> create(expense(UUID.randomUUID(), SEOUL_TODAY, null, 0)))
                .isInstanceOf(InvalidRequestException.class);
        assertThatThrownBy(() -> create(expense(UUID.randomUUID(), SEOUL_TODAY, null, -1)))
                .isInstanceOf(InvalidRequestException.class);
        assertThatThrownBy(() -> create(expense(UUID.randomUUID(), SEOUL_TODAY, null, MAX_AMOUNT + 1)))
                .isInstanceOf(InvalidRequestException.class);
        assertThatThrownBy(() -> create(new Transfer(UUID.randomUUID(), SEOUL_TODAY, null, bank.getId(),
                cash.getId(), MAX_AMOUNT + 1, null)))
                .isInstanceOf(InvalidRequestException.class);
        assertThat(transactionRepository.count()).isZero();
    }

    @Test
    void create_storesFirstAndLastAllowedDate() {
        UUID first = UUID.randomUUID();
        UUID last = UUID.randomUUID();

        create(expense(first, LocalDate.of(2000, 1, 1), null, 1_000));
        create(expense(last, LAST_DAY, null, 1_000));

        assertThat(reload(first).occurredOn()).isEqualTo(LocalDate.of(2000, 1, 1));
        assertThat(reload(last).occurredOn()).isEqualTo(LAST_DAY);
    }

    /** 서버 시계의 UTC 날짜(2026-11-25)가 아니라 서울 날짜(2026-11-26)에서 1년을 센다. */
    @Test
    void create_rejectsDateOutOfRange() {
        assertThatThrownBy(() -> create(expense(UUID.randomUUID(), LocalDate.of(1999, 12, 31), null, 1_000)))
                .isInstanceOf(InvalidRequestException.class);
        assertThatThrownBy(() -> create(expense(UUID.randomUUID(), LAST_DAY.plusDays(1), null, 1_000)))
                .isInstanceOf(InvalidRequestException.class);
        assertThatThrownBy(() -> create(new Transfer(UUID.randomUUID(), LAST_DAY.plusDays(1), null, bank.getId(),
                cash.getId(), 1_000, null)))
                .isInstanceOf(InvalidRequestException.class);
        assertThat(transactionRepository.count()).isZero();
    }

    /** "오늘"은 그 장부의 시간대로 정한다. 서울은 2026-11-26이지만 로스앤젤레스 장부는 아직 2026-11-25(15:30)다. */
    @Test
    void create_countsTheYearFromTodayInTheLedgerZone() {
        UUID laLedgerId = ledgerRepository.saveAndFlush(Ledger.of("장부", "America/Los_Angeles")).getId();
        fixtures.addMember(laLedgerId, owner, LedgerRole.OWNER);
        UUID from = fixtures.account(owner, laLedgerId, "은행", AccountType.BANK, 0, SEOUL_TODAY).getId();
        UUID to = fixtures.account(owner, laLedgerId, "현금", AccountType.CASH, 0, SEOUL_TODAY).getId();
        LocalDate lastDay = LocalDate.of(2027, 11, 25);
        UUID id = UUID.randomUUID();

        assertThatThrownBy(() -> transactionService.create(owner.getId(), laLedgerId,
                new Transfer(UUID.randomUUID(), lastDay.plusDays(1), null, from, to, 1_000, null), DEVICE))
                .isInstanceOf(InvalidRequestException.class);
        transactionService.create(owner.getId(), laLedgerId,
                new Transfer(id, lastDay, null, from, to, 1_000, null), DEVICE);

        assertThat(reload(id).occurredOn()).isEqualTo(lastDay);
    }

    @Test
    void update_appliesTheSameLimits() {
        UUID id = UUID.randomUUID();
        create(expense(id, SEOUL_TODAY, null, 1_000));

        assertThatThrownBy(() -> transactionService.update(owner.getId(), id, 1,
                expense(id, SEOUL_TODAY, null, MAX_AMOUNT + 1), DEVICE))
                .isInstanceOf(InvalidRequestException.class);
        assertThatThrownBy(() -> transactionService.update(owner.getId(), id, 1,
                expense(id, SEOUL_TODAY, null, 0), DEVICE))
                .isInstanceOf(InvalidRequestException.class);
        assertThatThrownBy(() -> transactionService.update(owner.getId(), id, 1,
                expense(id, LAST_DAY.plusDays(1), null, 1_000), DEVICE))
                .isInstanceOf(InvalidRequestException.class);
        assertThatThrownBy(() -> transactionService.update(owner.getId(), id, 1,
                expense(id, LocalDate.of(1999, 12, 31), null, 1_000), DEVICE))
                .isInstanceOf(InvalidRequestException.class);
        TransactionView unchanged = reload(id);
        assertThat(unchanged.version()).isEqualTo(1);
        assertThat(unchanged.occurredOn()).isEqualTo(SEOUL_TODAY);
        assertThat(unchanged.lines()).extracting(Line::amount).containsExactly(-1_000L);

        transactionService.update(owner.getId(), id, 1, expense(id, LAST_DAY, null, MAX_AMOUNT), DEVICE);

        TransactionView updated = reload(id);
        assertThat(updated.version()).isEqualTo(2);
        assertThat(updated.occurredOn()).isEqualTo(LAST_DAY);
        assertThat(updated.lines()).extracting(Line::amount).containsExactly(-MAX_AMOUNT);
    }

    /** 입력한 날짜와 시각은 시간대 변환 없이 그대로 남는다. 시각을 비우면 시각 없음이다. */
    @Test
    void create_storesDateAndTimeAsEnteredAndKeepsMissingTime() {
        UUID withTime = UUID.randomUUID();
        UUID withoutTime = UUID.randomUUID();

        create(expense(withTime, SEOUL_TODAY, LocalTime.of(23, 59), 1_000));
        create(expense(withoutTime, SEOUL_TODAY, null, 1_000));

        TransactionView stored = reload(withTime);
        assertThat(stored.occurredOn()).isEqualTo(SEOUL_TODAY);
        assertThat(stored.occurredTime()).isEqualTo(LocalTime.of(23, 59));
        assertThat(reload(withoutTime).occurredTime()).isNull();
    }
}
