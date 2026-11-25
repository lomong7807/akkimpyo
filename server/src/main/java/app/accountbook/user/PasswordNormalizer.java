package app.accountbook.user;

import java.nio.charset.StandardCharsets;
import java.text.Normalizer;
import java.util.Optional;

/**
 * 입력한 비밀번호를 유니코드 NFKC로 맞춘다(ADR 001 결정 7). 비밀번호를 받는 모든 곳이 규칙 검사와 해시보다 먼저 이것을 거친다.
 * 같은 글자를 조합형과 분해형으로, 전각과 반각으로 넣어도 같은 비밀번호가 된다. 앞뒤 공백을 지우지 않는다.
 * 저장된 해시는 다시 만들 수 없으므로 정규화 방식을 바꾸면 이미 가입한 사람이 로그인하지 못한다.
 */
final class PasswordNormalizer {

    /**
     * 정규화 전 입력의 상한(UTF-16 단위). NFKC는 글자 수를 최대 18배로 늘리므로 정규화보다 먼저 본다.
     * NFKC로 72자가 되는 입력은 길어도 360단위라 규칙에 맞는 비밀번호는 걸리지 않는다.
     */
    static final int MAX_RAW_LENGTH = 512;

    private PasswordNormalizer() {
    }

    /**
     * 정규화한 비밀번호. 받을 수 없는 입력(null, {@value #MAX_RAW_LENGTH}자 초과, 짝 없는 서로게이트)이면 정규화하지 않고 빈 값을 준다.
     * 무엇으로 답할지는 부르는 쪽이 정한다. 가입은 규칙 오류로, 로그인은 다른 실패와 같은 응답으로 답해야 하기 때문이다.
     */
    static Optional<String> normalize(String raw) {
        if (raw == null || raw.length() > MAX_RAW_LENGTH || !isWellFormed(raw)) {
            return Optional.empty();
        }
        return Optional.of(Normalizer.normalize(raw, Normalizer.Form.NFKC));
    }

    /** 짝 없는 서로게이트는 UTF-8로 바꿀 수 없어 해시할 때 예외가 난다. */
    private static boolean isWellFormed(String raw) {
        return StandardCharsets.UTF_8.newEncoder().canEncode(raw);
    }
}
