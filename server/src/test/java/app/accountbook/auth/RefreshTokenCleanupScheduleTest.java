package app.accountbook.auth;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.ZoneId;
import java.time.ZonedDateTime;
import org.junit.jupiter.api.Test;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.scheduling.support.CronExpression;

/** refresh token 정리가 매일 04:30(Asia/Seoul)에 한 번 돈다(#132). 휴지통 자동 삭제(04:00)와 겹치지 않는다. DB 없이 설정만 본다. */
class RefreshTokenCleanupScheduleTest {

    static final ZoneId SEOUL = ZoneId.of("Asia/Seoul");

    @Test
    void 매일_서울_시각_4시_30분에_돌고_설정으로_바꾸거나_끌_수_있다() throws NoSuchMethodException {
        Scheduled scheduled = RefreshTokenCleanup.class.getDeclaredMethod("run").getAnnotation(Scheduled.class);

        assertThat(scheduled.zone()).isEqualTo("Asia/Seoul");
        assertThat(scheduled.cron()).isEqualTo("${accountbook.refresh-token-cleanup.cron:0 30 4 * * *}");
    }

    @Test
    void 다음_실행은_서울의_다음_4시_30분이고_하루에_한_번이다() {
        CronExpression cron = CronExpression.parse(RefreshTokenCleanup.CRON);

        assertThat(cron.next(ZonedDateTime.of(2026, 11, 30, 4, 29, 59, 0, SEOUL)))
                .isEqualTo(ZonedDateTime.of(2026, 11, 30, 4, 30, 0, 0, SEOUL));
        assertThat(cron.next(ZonedDateTime.of(2026, 12, 31, 4, 30, 0, 0, SEOUL)))
                .isEqualTo(ZonedDateTime.of(2027, 1, 1, 4, 30, 0, 0, SEOUL));
    }
}
