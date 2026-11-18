package app.accountbook.common;

import java.time.Instant;
import java.time.temporal.ChronoUnit;

/** DB(TIMESTAMPTZ)의 정밀도인 마이크로초로 자른 현재 시각. 메모리 값과 저장 값이 어긋나지 않게 한다. */
public final class Times {

    private Times() {
    }

    public static Instant now() {
        return Instant.now().truncatedTo(ChronoUnit.MICROS);
    }
}
