package app.accountbook.user;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import app.accountbook.common.InvalidRequestException;
import app.accountbook.common.PasswordHashBusyException;
import java.time.Duration;
import java.util.List;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.stream.IntStream;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.util.ReflectionTestUtils;

/**
 * 동시에 도는 해시의 상한(ADR 001 결정 7). 시간을 재지 않고 문(GatedPasswordEncoder)과 스레드 상태로 겹치는 순간을 만든다.
 */
@Timeout(30)
class PasswordHasherLimitTest {

    private static final String STORED =
            "$argon2id$v=19$m=256,t=1,p=1$YWNjb3VudC1ib29rLXRzdA$vHygWA0jNvBLxOELjrkU6R1OAPyuN/Ro9FrihcYD2KI";
    /** 테스트 안에서는 끝나지 않는 기다림. */
    private static final Duration LONG = Duration.ofMinutes(5);
    /** 자리가 나지 않는 것을 확인할 때 쓰는 짧은 기다림. */
    private static final Duration SHORT = Duration.ofMillis(50);

    private final GatedPasswordEncoder encoder = new GatedPasswordEncoder();

    @AfterEach
    void finishHeldHashes() {
        encoder.open(1_000);
    }

    @Test
    void fifthHashWaitsForSlotAndRunsWhenOneIsFree() throws Exception {
        PasswordHasher hasher = hasher(4, LONG);
        List<RunningTask<String>> four = IntStream.rangeClosed(1, 4)
                .mapToObj(i -> RunningTask.start(() -> hasher.hash("password" + i)))
                .toList();
        encoder.awaitEntered(4);

        RunningTask<String> fifth = RunningTask.start(() -> hasher.hash("password5"));
        fifth.awaitWaitingForSlot();
        assertThat(encoder.order()).hasSize(4).doesNotContain("password5");

        encoder.open(1);
        encoder.awaitEntered(1);
        assertThat(encoder.order()).endsWith("password5");

        encoder.open(4);
        assertThat(fifth.result()).isEqualTo("hash");
        for (RunningTask<String> one : four) {
            assertThat(one.result()).isEqualTo("hash");
        }
        assertThat(encoder.maxRunning()).isEqualTo(4);
    }

    @Test
    void failsWhenNoSlotIsFreeWithinMaxWait() throws Exception {
        PasswordHasher hasher = hasher(1, SHORT);
        RunningTask.start(() -> hasher.hash("password1"));
        encoder.awaitEntered(1);

        long startedAt = System.nanoTime();
        assertThatThrownBy(() -> hasher.hash("password2"))
                .isExactlyInstanceOf(PasswordHashBusyException.class)
                .hasMessage("지금 요청이 많습니다. 잠시 뒤 다시 시도해 주세요.")
                .hasNoCause();

        // 바로 포기하지 않고 정한 시간을 기다렸다. 해시는 시작하지 않았다.
        assertThat(System.nanoTime() - startedAt).isGreaterThanOrEqualTo(SHORT.toNanos());
        assertThat(encoder.order()).containsExactly("password1");
    }

    @Test
    void hashAndMatchesShareSlots() throws Exception {
        PasswordHasher hasher = hasher(1, SHORT);
        RunningTask<String> hashing = RunningTask.start(() -> hasher.hash("password1"));
        encoder.awaitEntered(1);
        assertThatThrownBy(() -> hasher.matches("password2", STORED)).isInstanceOf(PasswordHashBusyException.class);
        encoder.open(1);
        hashing.result();

        RunningTask<Boolean> matching = RunningTask.start(() -> hasher.matches("password3", STORED));
        encoder.awaitEntered(1);
        assertThatThrownBy(() -> hasher.hash("password4")).isInstanceOf(PasswordHashBusyException.class);
        encoder.open(1);
        assertThat(matching.result()).isTrue();
        assertThat(encoder.order()).containsExactly("password1", "password3");
    }

    @Test
    void cheapRejectionsDoNotNeedSlot() throws Exception {
        PasswordHasher hasher = hasher(1, SHORT);
        RunningTask.start(() -> hasher.hash("password1"));
        encoder.awaitEntered(1);

        // 자리가 필요했다면 PasswordHashBusyException이 난다.
        assertThatThrownBy(() -> hasher.hash("abc1234")).isInstanceOf(InvalidRequestException.class);
        assertThatThrownBy(() -> hasher.hash("a1" + "x".repeat(511))).isInstanceOf(InvalidRequestException.class);
        assertThat(hasher.matches("password1", "{noop}password1")).isFalse();
        assertThat(hasher.matches("password1", null)).isFalse();
        assertThat(hasher.matches("a".repeat(513), STORED)).isFalse();
        assertThat(hasher.matches(null, STORED)).isFalse();
    }

    @Test
    void slotIsReturnedWhenHashFails() {
        PasswordHasher hasher = new PasswordHasher(new FailingEncoder(), new PasswordHashProperties(1, SHORT));

        // 자리가 하나라, 돌려주지 않았다면 다음 것이 PasswordHashBusyException이 된다.
        assertThatThrownBy(() -> hasher.hash("password1")).isInstanceOf(IllegalStateException.class);
        assertThatThrownBy(() -> hasher.matches("password1", STORED)).isInstanceOf(OutOfMemoryError.class);
        assertThatThrownBy(() -> hasher.hash("password1")).isInstanceOf(IllegalStateException.class);
    }

    @Test
    void interruptedWaiterFailsTheSameWayAndStaysInterrupted() throws Exception {
        PasswordHasher hasher = hasher(1, LONG);
        RunningTask<String> holder = RunningTask.start(() -> hasher.hash("password1"));
        encoder.awaitEntered(1);
        AtomicBoolean interrupted = new AtomicBoolean();
        RunningTask<String> waiter = RunningTask.start(() -> {
            try {
                return hasher.hash("password2");
            } finally {
                interrupted.set(Thread.currentThread().isInterrupted());
            }
        });
        waiter.awaitWaitingForSlot();

        waiter.thread().interrupt();

        assertThatThrownBy(waiter::result).isExactlyInstanceOf(PasswordHashBusyException.class);
        assertThat(interrupted).isTrue();
        // 기다리다 끝난 것은 자리를 쓰지도 잃지도 않는다.
        encoder.open(2);
        holder.result();
        assertThat(hasher.hash("password3")).isEqualTo("hash");
        assertThat(encoder.order()).containsExactly("password1", "password3");
    }

    @Test
    void waitersGetSlotInArrivalOrder() throws Exception {
        PasswordHasher hasher = hasher(1, LONG);
        RunningTask.start(() -> hasher.hash("password1"));
        encoder.awaitEntered(1);
        for (String password : List.of("password2", "password3", "password4")) {
            RunningTask.start(() -> hasher.hash(password)).awaitWaitingForSlot();
        }

        for (int i = 0; i < 3; i++) {
            encoder.open(1);
            encoder.awaitEntered(1);
        }

        assertThat(encoder.order()).containsExactly("password1", "password2", "password3", "password4");
        // 줄이 있을 때 새로 온 요청이 끼어드는 틈은 만들어 시험할 수 없어 설정으로 고정한다.
        assertThat(ReflectionTestUtils.getField(hasher, "slots")).hasFieldOrPropertyWithValue("fair", true);
    }

    private PasswordHasher hasher(int maxConcurrent, Duration maxWait) {
        return new PasswordHasher(encoder, new PasswordHashProperties(maxConcurrent, maxWait));
    }

    private static final class FailingEncoder implements PasswordEncoder {

        @Override
        public String encode(CharSequence rawPassword) {
            throw new IllegalStateException("해시 실패");
        }

        @Override
        public boolean matches(CharSequence rawPassword, String encodedPassword) {
            throw new OutOfMemoryError("해시 실패");
        }
    }
}
