package app.accountbook.user;

import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 저장된 값이 비교해도 되는 비밀번호 해시인지 라이브러리에 넘기기 전에 판정한다(#20).
 * 라이브러리는 앞에 다른 글자가 붙은 값과 argon2i, argon2d도 비교하고, 형식이 깨진 값에서는 예외를 던지거나 로그를 남기며,
 * 저장값에 적힌 매개변수만큼 메모리와 시간을 그대로 쓴다.
 */
final class StoredPasswordHash {

    /**
     * 비교해 주는 매개변수의 상한. 해시 한 번이 쓰는 메모리와 시간이 이것을 넘지 않는다.
     * PasswordEncoderConfig의 값을 올리면 같이 올린다(올리지 않으면 새 해시를 비교하지 못해 테스트가 실패한다).
     * 내릴 때는 그대로 두어 그 전에 저장한 값을 계속 비교한다.
     */
    static final int MAX_MEMORY_KIB = 19_456;
    static final int MAX_ITERATIONS = 2;
    static final int MAX_PARALLELISM = 1;

    /** salt 16바이트(22자)와 해시 32바이트(43자). 숫자는 int를 넘지 않게 9자리까지만 본다. */
    private static final Pattern ARGON2ID = Pattern.compile(
            "\\$argon2id\\$v=19\\$m=([1-9][0-9]{0,8}),t=([1-9][0-9]{0,8}),p=([1-9][0-9]{0,8})"
                    + "\\$[A-Za-z0-9+/]{22}\\$[A-Za-z0-9+/]{43}");

    private StoredPasswordHash() {
    }

    static boolean isComparable(String stored) {
        if (stored == null) {
            return false;
        }
        Matcher matcher = ARGON2ID.matcher(stored);
        return matcher.matches()
                && Integer.parseInt(matcher.group(1)) <= MAX_MEMORY_KIB
                && Integer.parseInt(matcher.group(2)) <= MAX_ITERATIONS
                && Integer.parseInt(matcher.group(3)) <= MAX_PARALLELISM;
    }
}
