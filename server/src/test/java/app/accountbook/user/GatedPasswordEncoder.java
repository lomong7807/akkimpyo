package app.accountbook.user;

import java.util.List;
import java.util.concurrent.CopyOnWriteArrayList;
import java.util.concurrent.Semaphore;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;
import org.springframework.security.crypto.password.PasswordEncoder;

/** 문을 열어 줄 때까지 해시를 붙잡아 두는 테스트용 인코더. 동시에 몇 개가 도는지 센다. */
final class GatedPasswordEncoder implements PasswordEncoder {

    private final Semaphore gate = new Semaphore(0);
    private final Semaphore entered = new Semaphore(0);
    private final AtomicInteger running = new AtomicInteger();
    private final AtomicInteger maxRunning = new AtomicInteger();
    private final List<String> order = new CopyOnWriteArrayList<>();

    @Override
    public String encode(CharSequence rawPassword) {
        order.add(rawPassword.toString());
        maxRunning.accumulateAndGet(running.incrementAndGet(), Math::max);
        entered.release();
        try {
            gate.acquire();
        } catch (InterruptedException e) {
            throw new IllegalStateException(e);
        } finally {
            running.decrementAndGet();
        }
        return "hash";
    }

    @Override
    public boolean matches(CharSequence rawPassword, String encodedPassword) {
        encode(rawPassword);
        return true;
    }

    /** 붙잡은 해시를 이 수만큼 끝나게 한다. */
    void open(int count) {
        gate.release(count);
    }

    /** 해시가 이 수만큼 새로 시작할 때까지 기다린다. */
    void awaitEntered(int count) throws InterruptedException {
        if (!entered.tryAcquire(count, 10, TimeUnit.SECONDS)) {
            throw new AssertionError("해시가 " + count + "개 시작하지 않았다. 지금까지: " + order);
        }
    }

    int maxRunning() {
        return maxRunning.get();
    }

    /** 해시를 시작한 순서대로의 비밀번호. */
    List<String> order() {
        return order;
    }
}
