package app.accountbook.user;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.params.provider.Arguments.argumentSet;
import static org.mockito.Mockito.CALLS_REAL_METHODS;
import static org.mockito.Mockito.mockStatic;

import java.text.Normalizer;
import java.text.Normalizer.Form;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.Arguments;
import org.junit.jupiter.params.provider.MethodSource;
import org.mockito.MockedStatic;

/** 비밀번호 정규화(ADR 001 결정 7). 가입의 규칙 검사는 UserServiceTest가 본다. 스프링 컨텍스트 없이 돈다. */
class PasswordNormalizerTest {

    static Stream<Arguments> inputsWithNormalizedForm() {
        return Stream.of(
                argumentSet("바뀔 것이 없는 값", "abcd1234", "abcd1234"),
                argumentSet("조합형 한글은 그대로", "비밀번호abc1", "비밀번호abc1"),
                argumentSet("분해형 한글", Normalizer.normalize("비밀번호abc1", Form.NFD), "비밀번호abc1"),
                argumentSet("전각 영문·숫자", "ａｂｃｄ１２３４", "abcd1234"),
                argumentSet("반각 가타카나와 탁점", "ｶﾞabc123", "ガabc123"),
                argumentSet("합자", "ﬁabc123", "fiabc123"),
                argumentSet("앞뒤 공백은 지우지 않는다", " abc1234 ", " abc1234 "),
                argumentSet("전각 공백과 줄바꿈 없는 공백은 일반 공백이 된다", "　abc1234 ", " abc1234 "),
                argumentSet("보충 평면 글자", "a1😀", "a1😀"));
    }

    @ParameterizedTest
    @MethodSource("inputsWithNormalizedForm")
    void normalize_returnsNfkcForm(String raw, String normalized) {
        assertThat(PasswordNormalizer.normalize(raw)).contains(normalized);
    }

    // --- 정규화 전 상한 512자(UTF-16 단위): 넘으면 정규화하지 않는다 ---

    @Test
    void normalize_normalizesInputOfMaxRawLength() {
        // U+FDFA는 NFKC에서 가장 많이 늘어난다(1자 → 18자). 상한까지 채워도 1만 자를 넘지 않는다.
        String raw = "ﷺ".repeat(512);
        try (MockedStatic<Normalizer> normalizer = mockStatic(Normalizer.class, CALLS_REAL_METHODS)) {
            assertThat(PasswordNormalizer.normalize(raw)).hasValueSatisfying(
                    normalized -> assertThat(normalized).hasSize(512 * 18));
            normalizer.verify(() -> Normalizer.normalize(raw, Form.NFKC));
        }
    }

    @Test
    void normalize_doesNotNormalizeInputOverMaxRawLength() {
        try (MockedStatic<Normalizer> normalizer = mockStatic(Normalizer.class, CALLS_REAL_METHODS)) {
            assertThat(PasswordNormalizer.normalize("a".repeat(513))).isEmpty();
            normalizer.verifyNoInteractions();
        }
    }

    @Test
    void normalize_countsRawLengthInUtf16Units() {
        // 😀는 글자 하나지만 UTF-16으로는 2단위다.
        assertThat(PasswordNormalizer.normalize("😀".repeat(256))).isPresent();
        assertThat(PasswordNormalizer.normalize("😀".repeat(256) + "a")).isEmpty();
    }

    // --- 잘못된 유니코드: 해시할 수 없다 ---

    static Stream<Arguments> inputsWithUnpairedSurrogate() {
        return Stream.of(
                argumentSet("뒤에 붙은 상위 서로게이트", "password1\uD800"),
                argumentSet("앞에 붙은 하위 서로게이트", "\uDC00password1"),
                argumentSet("가운데", "pass\uD83Dword1"),
                argumentSet("순서가 뒤집힌 쌍", "pass\uDE00\uD83Dword1"));
    }

    @ParameterizedTest
    @MethodSource("inputsWithUnpairedSurrogate")
    void normalize_rejectsUnpairedSurrogateWithoutNormalizing(String raw) {
        try (MockedStatic<Normalizer> normalizer = mockStatic(Normalizer.class, CALLS_REAL_METHODS)) {
            assertThat(PasswordNormalizer.normalize(raw)).isEmpty();
            normalizer.verifyNoInteractions();
        }
    }

    @Test
    void normalize_rejectsNull() {
        assertThat(PasswordNormalizer.normalize(null)).isEmpty();
    }
}
