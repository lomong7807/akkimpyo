package app.accountbook.user;

import org.springframework.security.crypto.password.PasswordEncoder;

/**
 * 비밀번호를 해시하고 비교하는 유일한 입구(ADR 001 결정 7, #20). 입력한 그대로의 비밀번호를 받아 정규화까지 한다.
 * 해시 라이브러리는 이 타입과 설정(PasswordEncoderConfig) 밖에서 쓰지 않는다(PasswordEntryPointTest가 막는다).
 */
final class PasswordHasher {

    private final PasswordEncoder encoder;

    PasswordHasher(PasswordEncoder encoder) {
        this.encoder = encoder;
    }

    /** 새 비밀번호의 Argon2id 해시. 규칙({@link PasswordPolicy})에 맞지 않으면 해시하지 않고 거부한다. */
    String hash(String rawPassword) {
        return encoder.encode(PasswordPolicy.normalizeAndValidate(rawPassword));
    }

    /**
     * 저장된 해시의 비밀번호가 맞는가. 정규화할 수 없는 입력({@link PasswordNormalizer})이거나
     * 비교해서는 안 되는 저장값({@link StoredPasswordHash})이면 해시하지 않고 false다.
     */
    boolean matches(String rawPassword, String storedHash) {
        return StoredPasswordHash.isComparable(storedHash)
                && PasswordNormalizer.normalize(rawPassword)
                        .filter(password -> encoder.matches(password, storedHash))
                        .isPresent();
    }
}
