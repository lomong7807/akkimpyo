package app.accountbook.transaction;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.ZoneId;
import java.time.ZonedDateTime;
import org.junit.jupiter.api.Test;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.scheduling.support.CronExpression;

/** 30일 자동 삭제가 매일 04:00(Asia/Seoul)에 돈다(#9). DB 없이 설정만 본다. */
class TrashAutoPurgeScheduleTest {

    static final ZoneId SEOUL = ZoneId.of("Asia/Seoul");

    @Test
    void 매일_서울_시각_4시에_돌고_설정으로_바꾸거나_끌_수_있다() throws NoSuchMethodException {
        Scheduled scheduled = TrashAutoPurge.class.getDeclaredMethod("run").getAnnotation(Scheduled.class);

        assertThat(scheduled.zone()).isEqualTo("Asia/Seoul");
        assertThat(scheduled.cron()).isEqualTo("${accountbook.trash-purge.cron:0 0 4 * * *}");
    }

    @Test
    void 다음_실행은_서울의_다음_4시다() {
        CronExpression cron = CronExpression.parse(TrashAutoPurge.CRON);

        assertThat(cron.next(ZonedDateTime.of(2026, 11, 30, 3, 59, 59, 0, SEOUL)))
                .isEqualTo(ZonedDateTime.of(2026, 11, 30, 4, 0, 0, 0, SEOUL));
        assertThat(cron.next(ZonedDateTime.of(2026, 12, 31, 4, 0, 0, 0, SEOUL)))
                .isEqualTo(ZonedDateTime.of(2027, 1, 1, 4, 0, 0, 0, SEOUL));
    }
}
