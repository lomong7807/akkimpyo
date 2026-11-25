package app.accountbook.transaction;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import app.accountbook.common.InvalidRequestException;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;
import java.util.stream.IntStream;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;

/** 기기 값의 형식(이슈 #21, ADR 007 결정 10). DB와 스프링 없이 돈다. */
class DeviceIdsTest {

    static final String ALLOWED = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._:-";

    @Test
    void 한_글자로는_정해진_글자만_받는다() {
        Set<Integer> accepted = IntStream.rangeClosed(0, Character.MAX_VALUE).boxed()
                .filter(ch -> accepts(Character.toString(ch)))
                .collect(Collectors.toSet());

        assertThat(accepted).isEqualTo(ALLOWED.chars().boxed().collect(Collectors.toSet()));
    }

    @Test
    void 예순네_글자까지_받는다() {
        assertThat(accepts("a".repeat(64))).isTrue();
        assertRejected("a".repeat(65));
    }

    /** 앞뒤 공백을 지우고 받지 않는다. 끝의 줄바꿈류도 값의 일부로 본다. */
    @ParameterizedTest
    @ValueSource(strings = {
            "",
            " ", " iphone.safari", "iphone.safari ", "iphone safari", "iphone safari", "iphone　safari",
            "iphone/safari", "iphone.safari;", "iphone+safari",
            "아이폰.safari", "iphóne.safari", "ｉphone.safari", "iphone.safari١",
            "iphone.safari📱",
            "abc\n", "abc\r\n", "abc\r", "abc\u0085", "abc ", "\nabc", "abc\ndef",
            "abc\tdef", "abc\u0000", "abc\u007F", "abc​"})
    void 정해진_글자가_아닌_것이_하나라도_있으면_거부한다(String deviceId) {
        assertRejected(deviceId);
    }

    /** 사람이 한 변경에서도 기기 값을 꼭 보내라고 정한 문서가 없다. 없는 것과 빈 값은 다르다. */
    @Test
    void 기기_값이_없는_것은_받는다() {
        assertThatCode(() -> DeviceIds.requireValidFormat(null)).doesNotThrowAnyException();
    }

    /** 화면이 보낼 값의 목록(#21의 frontend 댓글). 서버는 이 목록이 아니라 형식만 본다. */
    @Test
    void 화면이_보내는_값_42가지를_모두_받는다() {
        List<String> sentByWeb = Stream.of("iphone", "ipad", "mac", "windows", "android", "linux", "unknown")
                .flatMap(device -> Stream.of("safari", "chrome", "edge", "firefox", "samsung", "unknown")
                        .map(browser -> device + "." + browser))
                .toList();

        assertThat(sentByWeb).hasSize(42).allMatch(DeviceIdsTest::accepts);
    }

    private static boolean accepts(String deviceId) {
        try {
            DeviceIds.requireValidFormat(deviceId);
            return true;
        } catch (InvalidRequestException e) {
            return false;
        }
    }

    /** 문구는 고정이고 입력값이 들어가지 않는다. */
    private static void assertRejected(String deviceId) {
        assertThatThrownBy(() -> DeviceIds.requireValidFormat(deviceId))
                .isExactlyInstanceOf(InvalidRequestException.class)
                .hasMessage("기기 값은 영문, 숫자와 . _ : - 만 쓴 1~64자여야 합니다.");
    }
}
