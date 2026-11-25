package app.accountbook.user;

import app.accountbook.common.PasswordHashBusyException;
import java.time.Duration;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;
import java.util.function.Supplier;
import org.springframework.security.crypto.password.PasswordEncoder;

/**
 * 비밀번호를 해시하고 비교하는 유일한 입구(ADR 001 결정 7, #20). 입력한 그대로의 비밀번호를 받아 정규화까지 한다.
 * 해시 라이브러리는 이 타입과 설정(PasswordEncoderConfig) 밖에서 쓰지 않는다(PasswordEntryPointTest가 막는다).
 *
 * <p>해시 하나가 메모리 19MiB를 쓰므로 동시에 도는 수를 제한한다. 해시와 비교가 자리를 나눠 쓰고,
 * 싼 검사에서 떨어진 요청은 자리를 쓰지 않는다. 상한은 서버 하나의 것이다.
 */
final class PasswordHasher {

    private final PasswordEncoder encoder;
    /** 먼저 온 순서로 준다. 늦게 온 요청이 끼어들어 먼저 온 요청이 시간을 넘기는 일을 막는다. */
    private final Semaphore slots;
    private final Duration maxWait;

    PasswordHasher(PasswordEncoder encoder, PasswordHashProperties properties) {
        this.encoder = encoder;
        this.slots = new Semaphore(properties.maxConcurrent(), true);
        this.maxWait = properties.maxWait();
    }

    /**
     * 새 비밀번호의 Argon2id 해시. 규칙({@link PasswordPolicy})에 맞지 않으면 해시하지 않고 거부한다.
     * 자리가 나지 않으면 {@link PasswordHashBusyException}.
     */
    String hash(String rawPassword) {
        String password = PasswordPolicy.normalizeAndValidate(rawPassword);
        return inSlot(() -> encoder.encode(password));
    }

    /**
     * 저장된 해시의 비밀번호가 맞는가. 정규화할 수 없는 입력({@link PasswordNormalizer})이거나
     * 비교해서는 안 되는 저장값({@link StoredPasswordHash})이면 해시하지 않고 false다.
     * 자리가 나지 않으면 {@link PasswordHashBusyException}.
     */
    boolean matches(String rawPassword, String storedHash) {
        return StoredPasswordHash.isComparable(storedHash)
                && PasswordNormalizer.normalize(rawPassword)
                        .filter(password -> inSlot(() -> encoder.matches(password, storedHash)))
                        .isPresent();
    }

    private <T> T inSlot(Supplier<T> work) {
        acquireSlot();
        try {
            return work.get();
        } finally {
            slots.release();
        }
    }

    private void acquireSlot() {
        try {
            if (!slots.tryAcquire(maxWait.toNanos(), TimeUnit.NANOSECONDS)) {
                throw new PasswordHashBusyException();
            }
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
            throw new PasswordHashBusyException();
        }
    }
}
