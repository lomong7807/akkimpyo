package app.accountbook.transaction;

import app.accountbook.common.InvalidRequestException;
import java.util.regex.Pattern;

/**
 * 변경 이력에 남는 기기 값의 형식(P-216, ADR 007 결정 10). 형식만 보고, 화면이 보내는 값의 목록에 있는지는 보지 않는다.
 * 받은 값을 고치지 않으며 오류 문구에 넣지 않는다.
 */
final class DeviceIds {

    /** DB의 ck_change_log_device_id_format과 같다. 값 전체를 {@code matches()}로 맞춰 본다. */
    private static final Pattern FORMAT = Pattern.compile("[A-Za-z0-9._:-]{1,64}");

    private DeviceIds() {
    }

    /** null은 기기 값이 없는 것이라 통과한다. 빈 문자열은 형식 오류다. */
    static void requireValidFormat(String deviceId) {
        if (deviceId != null && !FORMAT.matcher(deviceId).matches()) {
            throw new InvalidRequestException("기기 값은 영문, 숫자와 . _ : - 만 쓴 1~64자여야 합니다.");
        }
    }
}
