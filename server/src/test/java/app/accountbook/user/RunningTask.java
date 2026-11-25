package app.accountbook.user;

import static org.awaitility.Awaitility.await;

import java.time.Duration;
import java.util.Arrays;
import java.util.concurrent.Callable;
import java.util.concurrent.ExecutionException;
import java.util.concurrent.FutureTask;
import java.util.concurrent.TimeUnit;

/** 다른 스레드에서 도는 일. 겹치는 순간을 시간이 아니라 스레드 상태로 확인하는 테스트가 쓴다. */
record RunningTask<T>(Thread thread, FutureTask<T> future) {

    static <T> RunningTask<T> start(Callable<T> task) {
        FutureTask<T> future = new FutureTask<>(task);
        Thread thread = new Thread(future);
        thread.setDaemon(true);
        thread.start();
        return new RunningTask<>(thread, future);
    }

    /** 결과. 일이 예외로 끝났으면 그 예외를 그대로 던진다. */
    T result() throws Exception {
        try {
            return future.get(10, TimeUnit.SECONDS);
        } catch (ExecutionException e) {
            if (e.getCause() instanceof Exception cause) {
                throw cause;
            }
            throw e;
        }
    }

    /** 성공하든 실패하든 끝날 때까지 기다린다. */
    void awaitFinished() throws InterruptedException {
        thread.join(Duration.ofSeconds(10));
    }

    /** 해시 자리를 기다릴 때까지 본다: 입구 안에서 시간을 정해 기다리는 상태다. 해시 중에는 이 상태가 아니다(문은 시간 없이 기다린다). */
    RunningTask<T> awaitWaitingForSlot() {
        await().pollInterval(Duration.ofMillis(5)).atMost(Duration.ofSeconds(10)).until(() ->
                thread.getState() == Thread.State.TIMED_WAITING
                        && Arrays.stream(thread.getStackTrace())
                                .anyMatch(frame -> frame.getClassName().equals(PasswordHasher.class.getName())));
        return this;
    }
}
