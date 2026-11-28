package app.accountbook.transaction;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import app.accountbook.common.InvalidRequestException;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.time.ZoneOffset;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

/** P-201(금액 범위)과 P-202(날짜 범위)의 경계. DB와 스프링 없이 돌고, 시계는 고정한다. */
class TransactionLimitsTest {

    static final ZoneId SEOUL = ZoneId.of("Asia/Seoul");

    /** 서울의 그 날짜 정오에 멈춘 시계. */
    private static Clock seoulNoon(LocalDate today) {
        return Clock.fixed(today.atTime(12, 0).atZone(SEOUL).toInstant(), ZoneOffset.UTC);
    }

    @ParameterizedTest
    @ValueSource(longs = {1L, 12_000L, 9_999_999_999L})
    void amount_acceptsOneWonThroughMax(long amount) {
        assertThatCode(() -> TransactionLimits.requireAmountInRange(amount)).doesNotThrowAnyException();
    }

    @ParameterizedTest
    @ValueSource(longs = {0L, -1L, -9_999_999_999L, 10_000_000_000L, Long.MAX_VALUE, Long.MIN_VALUE})
    void amount_rejectsZeroNegativeAndAboveMax(long amount) {
        assertThatThrownBy(() -> TransactionLimits.requireAmountInRange(amount))
                .isInstanceOf(InvalidRequestException.class)
                .hasMessage("금액은 1원부터 9,999,999,999원까지 입력할 수 있습니다.");
    }

    @Test
    void date_acceptsFirstDayOf2000AndRejectsTheDayBefore() {
        Clock clock = seoulNoon(LocalDate.of(2026, 11, 25));

        assertAccepted(LocalDate.of(2000, 1, 1), clock);
        assertRejected(LocalDate.of(1999, 12, 31), clock);
    }

    @Test
    void date_acceptsOneYearFromTodayAndRejectsTheDayAfter() {
        Clock clock = seoulNoon(LocalDate.of(2026, 11, 25));

        assertAccepted(LocalDate.of(2026, 11, 25), clock);
        assertAccepted(LocalDate.of(2027, 11, 25), clock);
        assertRejected(LocalDate.of(2027, 11, 26), clock);
    }

    /** 서버 시계가 UTC 2026-11-25 23:30이면 서울은 이미 2026-11-26 08:30이다. */
    @Test
    void date_todayIsTheLedgerZoneDateNotTheUtcDate() {
        Clock utcLateEvening = Clock.fixed(Instant.parse("2026-11-25T23:30:00Z"), ZoneOffset.UTC);

        assertAccepted(LocalDate.of(2027, 11, 26), utcLateEvening);
        assertRejected(LocalDate.of(2027, 11, 27), utcLateEvening);
    }

    /** 서울 자정 직전(UTC 14:59)은 아직 전날이고, 자정(UTC 15:00)부터 다음 날이다. */
    @Test
    void date_todayChangesAtSeoulMidnight() {
        Clock beforeMidnight = Clock.fixed(Instant.parse("2026-11-25T14:59:59Z"), ZoneOffset.UTC);
        Clock atMidnight = Clock.fixed(Instant.parse("2026-11-25T15:00:00Z"), ZoneOffset.UTC);

        assertAccepted(LocalDate.of(2027, 11, 25), beforeMidnight);
        assertRejected(LocalDate.of(2027, 11, 26), beforeMidnight);
        assertAccepted(LocalDate.of(2027, 11, 26), atMidnight);
    }

    /** 시계 자체의 시간대는 결과에 영향을 주지 않는다. 장부 시간대만 쓴다. */
    @Test
    void date_usesTheLedgerZoneWhateverTheClockZoneIs() {
        Instant instant = Instant.parse("2026-11-25T23:30:00Z");
        Clock newYorkClock = Clock.fixed(instant, ZoneId.of("America/New_York"));

        assertAccepted(LocalDate.of(2027, 11, 26), newYorkClock);
        assertThatThrownBy(() -> TransactionLimits.requireDateInRange(LocalDate.of(2027, 11, 26),
                Clock.fixed(instant, SEOUL), ZoneOffset.UTC))
                .isInstanceOf(InvalidRequestException.class);
    }

    /** 오늘이 2월 29일이면 1년 뒤는 다음 해 2월 28일이다(plusYears는 없는 날짜를 그 달의 마지막 날로 맞춘다). */
    @Test
    void date_oneYearFromLeapDayIsFebruary28() {
        Clock leapDay = seoulNoon(LocalDate.of(2028, 2, 29));

        assertAccepted(LocalDate.of(2029, 2, 28), leapDay);
        assertRejected(LocalDate.of(2029, 3, 1), leapDay);
    }

    /** 오늘이 윤년 전해의 2월 28일이면 1년 뒤는 2월 28일이고 2월 29일은 범위 밖이다. */
    @Test
    void date_oneYearFromFebruary28BeforeLeapYearExcludesLeapDay() {
        Clock clock = seoulNoon(LocalDate.of(2027, 2, 28));

        assertAccepted(LocalDate.of(2028, 2, 28), clock);
        assertRejected(LocalDate.of(2028, 2, 29), clock);
    }

    /**
     * 1년은 달력으로 센다. 윤일(2028-02-29)을 지나는 1년은 366일이라, 365일로 세면 끝날(2028-06-15)이 범위 밖이 된다
     * (#14 테스트 보강, 거래 쪽만 365일로 바꿔도 실패하게).
     */
    @Test
    void date_oneYearAcrossLeapDayIsCountedOnTheCalendar() {
        Clock clock = seoulNoon(LocalDate.of(2027, 6, 15));

        assertAccepted(LocalDate.of(2028, 6, 15), clock);
        assertRejected(LocalDate.of(2028, 6, 16), clock);
    }

    @Test
    void date_rejectsFarOutOfRangeValues() {
        Clock clock = seoulNoon(LocalDate.of(2026, 11, 25));

        assertRejected(LocalDate.MIN, clock);
        assertRejected(LocalDate.MAX, clock);
    }

    private static void assertAccepted(LocalDate date, Clock clock) {
        assertThatCode(() -> TransactionLimits.requireDateInRange(date, clock, SEOUL)).doesNotThrowAnyException();
    }

    private static void assertRejected(LocalDate date, Clock clock) {
        assertThatThrownBy(() -> TransactionLimits.requireDateInRange(date, clock, SEOUL))
                .isInstanceOf(InvalidRequestException.class)
                .hasMessage("날짜는 2000-01-01부터 오늘로부터 1년 뒤까지 입력할 수 있습니다.");
    }
}
