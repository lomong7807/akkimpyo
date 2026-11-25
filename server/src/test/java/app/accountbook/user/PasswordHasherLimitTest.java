package app.accountbook.user;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.spy;

import app.accountbook.common.InvalidRequestException;
import java.time.Duration;
import java.util.List;
import java.util.concurrent.Semaphore;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.stream.IntStream;
import org.assertj.core.api.ThrowableAssert.ThrowingCallable;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.mockito.InOrder;
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
        PasswordHasher hasher = new PasswordHasher(new FailingEncoder(), new PasswordHashProperties(1, 0, SHORT));

        // 자리가 하나이고 기다릴 수 없어, 자리나 들어온 수를 돌려주지 않았다면 다음 것이 PasswordHashBusyException이 된다.
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

    // --- 기다리는 수의 상한: 넘으면 기다리지 않고 바로 실패한다 ---

    @Test
    void requestBeyondWaitingLimitIsRefusedAtOnceUntilOneWaiterGetsSlot() throws Exception {
        PasswordHasher hasher = hasher(4, 16, LONG);
        IntStream.rangeClosed(1, 4).forEach(i -> startHash(hasher, "password" + i));
        encoder.awaitEntered(4);
        for (int i = 5; i <= 20; i++) {
            startHash(hasher, "password" + i).awaitWaitingForSlot();
        }

        // 자리 4개와 대기 16개가 찼다.
        assertRefusedAtOnce(() -> hasher.hash("password21"));
        assertThat(encoder.order()).hasSize(4);

        // 하나가 끝나면 기다리던 하나가 들어가고, 그 뒤 하나가 다시 기다릴 수 있다.
        encoder.open(1);
        encoder.awaitEntered(1);
        assertThat(encoder.order()).hasSize(5).endsWith("password5");
        startHash(hasher, "password22").awaitWaitingForSlot();
        assertRefusedAtOnce(() -> hasher.hash("password23"));
        assertThat(encoder.maxRunning()).isEqualTo(4);
    }

    @Test
    void hashAndMatchesShareWaitingLimit() throws Exception {
        PasswordHasher hasher = hasher(1, 2, LONG);
        startHash(hasher, "password1");
        encoder.awaitEntered(1);
        startHash(hasher, "password2").awaitWaitingForSlot();
        RunningTask.start(() -> hasher.matches("password3", STORED)).awaitWaitingForSlot();

        assertRefusedAtOnce(() -> hasher.hash("password4"));
        assertRefusedAtOnce(() -> hasher.matches("password5", STORED));
    }

    @Test
    void interruptedWaiterGivesItsPlaceBack() throws Exception {
        PasswordHasher hasher = hasher(1, 1, LONG);
        startHash(hasher, "password1");
        encoder.awaitEntered(1);
        RunningTask<String> waiter = startHash(hasher, "password2").awaitWaitingForSlot();
        assertRefusedAtOnce(() -> hasher.hash("password3"));

        waiter.thread().interrupt();
        assertThatThrownBy(waiter::result).isExactlyInstanceOf(PasswordHashBusyException.class);

        // 정확히 하나가 다시 기다릴 수 있다.
        startHash(hasher, "password4").awaitWaitingForSlot();
        assertRefusedAtOnce(() -> hasher.hash("password5"));
    }

    @Test
    void timedOutWaiterGivesItsPlaceBack() throws Exception {
        PasswordHasher hasher = hasher(1, 1, SHORT);
        RunningTask<String> holder = startHash(hasher, "password1");
        encoder.awaitEntered(1);

        assertThatThrownBy(() -> hasher.hash("password2")).isExactlyInstanceOf(PasswordHashBusyException.class);

        // 해시 중인 하나만 들어와 있다.
        assertThat(semaphore(hasher, "entries").availablePermits()).isEqualTo(1);
        encoder.open(1);
        holder.result();
        assertNothingHeld(hasher, 1, 1);
    }

    @Test
    void everyOutcomeGivesBackExactlyWhatItTook() throws Exception {
        PasswordHasher hasher = hasher(1, 1, LONG);
        RunningTask<String> holder = startHash(hasher, "password1");
        encoder.awaitEntered(1);
        RunningTask<String> waiter = startHash(hasher, "password2").awaitWaitingForSlot();
        assertRefusedAtOnce(() -> hasher.hash("password3"));

        // 들어온 둘이 모두 끝난다. 거절된 것은 아무것도 가져가지도 돌려주지도 않았다.
        encoder.open(2);
        holder.result();
        waiter.result();
        assertNothingHeld(hasher, 1, 1);

        PasswordHasher failing = new PasswordHasher(new FailingEncoder(), new PasswordHashProperties(1, 1, LONG));
        assertThatThrownBy(() -> failing.hash("password1")).isInstanceOf(IllegalStateException.class);
        assertThatThrownBy(() -> failing.matches("password1", STORED)).isInstanceOf(OutOfMemoryError.class);
        assertNothingHeld(failing, 1, 1);
    }

    @Test
    void freeSlotIsTakenEvenWhenNoOneMayWait() throws Exception {
        PasswordHasher hasher = hasher(1, 0, LONG);
        RunningTask<String> holder = startHash(hasher, "password1");
        encoder.awaitEntered(1);
        assertRefusedAtOnce(() -> hasher.hash("password2"));

        encoder.open(1);
        holder.result();
        encoder.open(1);
        assertThat(hasher.hash("password3")).isEqualTo("hash");
    }

    @Test
    void entryIsGivenBackBeforeSlot() {
        // 자리를 먼저 돌려주면, 그 사이에 온 요청이 빈 자리가 있는데도 들어온 수에 걸려 거절될 수 있다.
        PasswordHasher hasher = hasher(1, 0, LONG);
        Semaphore entries = spy(semaphore(hasher, "entries"));
        Semaphore slots = spy(semaphore(hasher, "slots"));
        ReflectionTestUtils.setField(hasher, "entries", entries);
        ReflectionTestUtils.setField(hasher, "slots", slots);
        encoder.open(1);

        hasher.hash("password1");

        InOrder order = inOrder(entries, slots);
        order.verify(entries).release();
        order.verify(slots).release();
    }

    private PasswordHasher hasher(int maxConcurrent, Duration maxWait) {
        return hasher(maxConcurrent, 16, maxWait);
    }

    private PasswordHasher hasher(int maxConcurrent, int maxWaiting, Duration maxWait) {
        return new PasswordHasher(encoder, new PasswordHashProperties(maxConcurrent, maxWaiting, maxWait));
    }

    /** 해시를 시작했거나 기다리는 요청 하나. 시작했는지 기다리는지는 부르는 쪽이 확인한다. */
    private static RunningTask<String> startHash(PasswordHasher hasher, String password) {
        return RunningTask.start(() -> hasher.hash(password));
    }

    private static void assertRefusedAtOnce(ThrowingCallable request) {
        // 기다렸다면 LONG 동안 돌아오지 않아 @Timeout에 걸린다.
        assertThatThrownBy(request).isExactlyInstanceOf(PasswordHashBusyException.class);
    }

    /** 자리와 들어온 수가 처음 값으로 돌아왔다. */
    private static void assertNothingHeld(PasswordHasher hasher, int maxConcurrent, int maxWaiting) {
        assertThat(semaphore(hasher, "slots").availablePermits()).isEqualTo(maxConcurrent);
        assertThat(semaphore(hasher, "entries").availablePermits()).isEqualTo(maxConcurrent + maxWaiting);
    }

    private static Semaphore semaphore(PasswordHasher hasher, String field) {
        return (Semaphore) ReflectionTestUtils.getField(hasher, field);
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
