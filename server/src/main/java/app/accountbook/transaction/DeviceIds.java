package app.accountbook.transaction;

import app.accountbook.common.FieldErrorCode;
import app.accountbook.common.InvalidRequestException;
import java.util.Set;
import java.util.regex.Pattern;
import java.util.stream.Collectors;
import java.util.stream.Stream;

/**
 * 변경 이력에 남기는 기기 값의 규칙(P-216, ADR 007 결정 10). 형식이 틀리면 오류이고, 형식은 맞지만 목록에 없으면
 * {@value #UNKNOWN}으로 저장한다. 받은 값은 오류 문구에 넣지 않는다. 형식 검사는 api도 쓴다: 카테고리 삭제(#35)는 서비스가
 * 기기 값을 옮기기 직전에야 보므로 api가 먼저 본다.
 */
public final class DeviceIds {

    static final String UNKNOWN = "unknown";

    /** 형식 오류를 알리는 입력란. 서비스 메서드의 인자 이름이다. */
    static final String FIELD = "deviceId";

    /** 저장하는 값의 목록: 기기 7가지와 브라우저 6가지의 조합(#21). 글자 그대로 비교한다. */
    static final Set<String> KNOWN = Stream.of("iphone", "ipad", "mac", "windows", "android", "linux", "unknown")
            .flatMap(device -> Stream.of("safari", "chrome", "edge", "firefox", "samsung", "unknown")
                    .map(browser -> device + "." + browser))
            .collect(Collectors.toUnmodifiableSet());

    /** DB의 ck_change_log_device_id_format과 같다. 값 전체를 {@code matches()}로 맞춰 본다. */
    private static final Pattern FORMAT = Pattern.compile("[A-Za-z0-9._:-]{1,64}");

    private DeviceIds() {
    }

    /**
     * 요청의 형식 검증 단계에서 부른다. null은 기기 값이 없는 것이라 통과한다. 빈 문자열은 형식 오류다.
     * 입력란은 {@value #FIELD}이고, API가 기기 값을 받은 자리(헤더)의 이름으로 바꿔 알린다.
     */
    public static void requireValidFormat(String deviceId) {
        if (deviceId != null && !FORMAT.matcher(deviceId).matches()) {
            throw new InvalidRequestException(FIELD, FieldErrorCode.INVALID_FORMAT,
                    "기기 값은 영문, 숫자와 . _ : - 만 쓴 1~64자여야 합니다.");
        }
    }

    /**
     * 이력에 저장할 값. 목록에 있는 값과 null은 그대로고 나머지는 {@value #UNKNOWN}이다.
     * 형식이 틀린 값은 {@value #UNKNOWN}으로 바꾸지 않고 여기서도 거부한다.
     */
    static String storable(String deviceId) {
        requireValidFormat(deviceId);
        return deviceId == null || KNOWN.contains(deviceId) ? deviceId : UNKNOWN;
    }
}
