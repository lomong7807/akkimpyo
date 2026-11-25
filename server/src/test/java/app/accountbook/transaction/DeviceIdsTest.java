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

/** 기기 값의 형식과 목록(이슈 #21, ADR 007 결정 10). DB와 스프링 없이 돈다. */
class DeviceIdsTest {

    static final String ALLOWED = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789._:-";

    static final String MESSAGE = "기기 값은 영문, 숫자와 . _ : - 만 쓴 1~64자여야 합니다.";

    /** 화면이 보낼 값의 목록(#21의 frontend 댓글). */
    static final List<String> SENT_BY_WEB = Stream.of("iphone", "ipad", "mac", "windows", "android", "linux", "unknown")
            .flatMap(device -> Stream.of("safari", "chrome", "edge", "firefox", "samsung", "unknown")
                    .map(browser -> device + "." + browser))
            .toList();

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

    @Test
    void 목록은_화면이_보내는_값_42가지다() {
        assertThat(SENT_BY_WEB).hasSize(42);
        assertThat(DeviceIds.KNOWN).containsExactlyInAnyOrderElementsOf(SENT_BY_WEB);
    }

    @Test
    void 목록에_있는_값은_그대로_저장할_값이다() {
        assertThat(SENT_BY_WEB).allSatisfy(deviceId -> assertThat(DeviceIds.storable(deviceId)).isEqualTo(deviceId));
    }

    /** 글자 그대로 비교한다. 대소문자를 맞추거나 앞부분만 보지 않는다. */
    @ParameterizedTest
    @ValueSource(strings = {
            "iphone.opera", "pixel.chrome", "iphone", "safari", "unknown",
            "IPHONE.safari", "iphone.Safari", "iphone-safari", "iphone.safari.18", "safari.iphone", ".", "iphone.",
            "3f0c7a52-9d1e-4b7b-8c55-0e6f1a2b3c4d", "a", ":-"})
    void 목록에_없는_값은_unknown으로_저장한다(String deviceId) {
        assertThat(DeviceIds.storable(deviceId)).isEqualTo("unknown");
    }

    @Test
    void 기기_값이_없으면_없는_채로_저장한다() {
        assertThat(DeviceIds.storable(null)).isNull();
    }

    /** 형식이 틀린 값은 목록에도 없지만 unknown이 아니라 오류다. 형식 검증을 빠뜨린 경로가 생겨도 조용히 저장되지 않는다. */
    @Test
    void 형식이_틀린_값은_unknown으로_바꾸지_않는다() {
        assertThatThrownBy(() -> DeviceIds.storable("iphone.safari\n"))
                .isExactlyInstanceOf(InvalidRequestException.class)
                .hasMessage(MESSAGE);
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
                .hasMessage(MESSAGE);
    }
}
