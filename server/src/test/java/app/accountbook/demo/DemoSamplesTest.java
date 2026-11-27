package app.accountbook.demo;

import static org.assertj.core.api.Assertions.assertThat;

import app.accountbook.demo.DemoSamples.Sample;
import app.accountbook.transaction.TransactionType;
import java.time.LocalDate;
import java.time.YearMonth;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

/** 데모 거래의 날짜와 값(#349). DB를 쓰지 않는다. */
class DemoSamplesTest {

    /** 해의 첫날(이번 달 거래가 모두 1일, 지난달은 지난해 12월), 짧은 2월 뒤의 달 끝, 윤년 2월 29일, 해의 끝, 달의 중간. */
    @ParameterizedTest
    @ValueSource(strings = {"2026-01-01", "2026-03-31", "2028-02-29", "2026-12-31", "2026-11-27"})
    void 거래는_지난달_1일부터_오늘까지이고_두_달에_걸친다(LocalDate today) {
        List<LocalDate> dates = DemoSamples.SAMPLES.stream().map(sample -> sample.date(today)).toList();

        assertThat(dates).allMatch(date -> !date.isBefore(DemoSamples.openingDate(today)) && !date.isAfter(today));
        assertThat(dates).anyMatch(date -> YearMonth.from(date).equals(YearMonth.from(today)));
        assertThat(dates).anyMatch(date -> YearMonth.from(date).equals(YearMonth.from(today).minusMonths(1)));
    }

    @Test
    void 지난달의_없는_날은_그_달의_마지막_날이다() {
        Sample monthEnd = DemoSamples.SAMPLES.stream().filter(sample -> sample.day() == 31).findFirst().orElseThrow();

        assertThat(monthEnd.monthsAgo()).isEqualTo(1);
        assertThat(monthEnd.date(LocalDate.of(2026, 3, 15))).isEqualTo(LocalDate.of(2026, 2, 28));
        assertThat(monthEnd.date(LocalDate.of(2028, 3, 15))).isEqualTo(LocalDate.of(2028, 2, 29));
    }

    @Test
    void 지출_수입_이체가_섞인_20건쯤이고_금액은_입력_범위_안이다() {
        assertThat(DemoSamples.SAMPLES).hasSizeBetween(18, 24)
                .extracting(Sample::type).contains(TransactionType.values());
        assertThat(DemoSamples.SAMPLES).allSatisfy(sample -> {
            assertThat(sample.amount()).isBetween(1L, 9_999_999_999L);
            assertThat(sample.monthsAgo()).isBetween(0, 1);
            assertThat(sample.text()).isNotBlank().isEqualTo(sample.text().strip());
            if (sample.type() == TransactionType.TRANSFER) {
                assertThat(sample.category()).isNull();
                assertThat(sample.toAccount()).isNotNull().isNotEqualTo(sample.account());
            } else {
                assertThat(sample.category()).isNotBlank();
                assertThat(sample.toAccount()).isNull();
            }
        });
    }
}
