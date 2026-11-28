package app.accountbook.user;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import app.accountbook.common.DuplicateEmailException;
import app.accountbook.support.IntegrationTest;
import com.zaxxer.hikari.HikariDataSource;
import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Timeout;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.TestPropertySource;
import org.springframework.test.context.bean.override.convention.TestBean;
import org.springframework.transaction.annotation.Propagation;
import org.springframework.transaction.annotation.Transactional;

/**
 * 가입의 해시와 로그인의 비교는 DB 트랜잭션 밖에서 한다(#20, #12). 해시하는 동안과 해시 자리를 기다리는 동안 DB 연결을 잡지 않는다.
 * 연결이 하나뿐인 풀에서 해시를 붙잡아 두고 다른 일이 되는지 본다. 하나라도 연결을 잡고 있으면 2초 뒤 실패한다.
 * 가입이 실제로 커밋하므로 테스트 트랜잭션 없이 돌고, 커밋된 가입은 끝에 지운다.
 */
@IntegrationTest
@Transactional(propagation = Propagation.NOT_SUPPORTED)
@TestPropertySource(properties = {
        "spring.datasource.hikari.maximum-pool-size=1",
        "spring.datasource.hikari.connection-timeout=2000"})
@Timeout(60)
class SignupHashOutsideTransactionTest {

    private static final List<String> EMAILS = List.of(
            "outside1@example.com", "outside2@example.com", "outside3@example.com");

    /** "held"로 시작하는 비밀번호의 해시만 붙잡는다. 자리는 둘이다. */
    private static final GatedPasswordEncoder ENCODER =
            new GatedPasswordEncoder(password -> password.startsWith("held"));

    @TestBean PasswordHasher passwordHasher;

    @Autowired UserService userService;
    @Autowired JdbcTemplate jdbc;
    @Autowired HikariDataSource dataSource;

    static PasswordHasher passwordHasher() {
        return new PasswordHasher(ENCODER, new PasswordHashProperties(2, 16, Duration.ofMinutes(5)));
    }

    private final List<RunningTask<User>> started = new ArrayList<>();
    private final List<RunningTask<Optional<UUID>>> logins = new ArrayList<>();

    /** 붙잡은 해시를 놓아 가입 스레드를 모두 끝낸 뒤 지운다. 남은 스레드가 연결과 잠금을 쥐고 있으면 다른 테스트가 멈춘다. */
    @AfterEach
    void finishAndDeleteSignups() throws InterruptedException {
        ENCODER.open(100);
        for (RunningTask<User> signup : started) {
            signup.awaitFinished();
        }
        for (RunningTask<Optional<UUID>> login : logins) {
            login.awaitFinished();
        }
        ENCODER.reset();
        EMAILS.forEach(email -> SignupRows.delete(jdbc, email));
    }

    @Test
    void hashingAndWaitingForSlotHoldNoConnection() throws Exception {
        startSignup(EMAILS.get(0), "held-pass-1", "하나");
        startSignup(EMAILS.get(1), "held-pass-2", "둘");
        ENCODER.awaitEntered(2);
        startSignup(EMAILS.get(2), "held-pass-3", "셋").awaitWaitingForSlot();

        // 둘은 해시하는 중이고 하나는 자리를 기다린다. 하나뿐인 연결을 아무도 잡고 있지 않다.
        assertThat(dataSource.getMaximumPoolSize()).isEqualTo(1);
        assertThat(dataSource.getHikariPoolMXBean().getActiveConnections()).isZero();
        assertThat(jdbc.queryForObject("select 1", Integer.class)).isEqualTo(1);

        ENCODER.open(3);
        for (RunningTask<User> signup : started) {
            assertThat(jdbc.queryForObject("select count(*) from users where id = ?", Integer.class,
                    signup.result().getId())).isEqualTo(1);
        }
        assertThat(ENCODER.sawTransaction()).isFalse();
    }

    @Test
    void signupFinishedWhileAnotherIsHashingWins() throws Exception {
        String email = EMAILS.get(0);
        List<Long> before = SignupRows.counts(jdbc);
        // 중복 확인을 지나 해시하는 중이다.
        RunningTask<User> hashing = startSignup(email, "held-pass-1", "먼저 확인");
        ENCODER.awaitEntered(1);

        userService.createUser(" OUTSIDE1@Example.com ", "password1", "먼저 저장");
        ENCODER.open(1);

        assertThatThrownBy(hashing::result).isExactlyInstanceOf(DuplicateEmailException.class);
        assertThat(jdbc.queryForList("select display_name from users where email = ?", String.class, email))
                .containsExactly("먼저 저장");
        assertThat(SignupRows.counts(jdbc)).containsExactly(
                before.get(0) + 1, before.get(1) + 1, before.get(2) + 1, before.get(3) + 17);
    }

    @Test
    void comparingAndWaitingForSlotHoldNoConnection() throws Exception {
        UUID userId = userService.createUser(EMAILS.get(0), "password1", "하나").getId();

        RunningTask<Optional<UUID>> known = startLogin(EMAILS.get(0), "held-pass-1");
        RunningTask<Optional<UUID>> unknown = startLogin("nobody@example.com", "held-pass-2");
        ENCODER.awaitEntered(2);
        RunningTask<Optional<UUID>> waiting = startLogin(EMAILS.get(0), "held-pass-3").awaitWaitingForSlot();

        assertThat(dataSource.getHikariPoolMXBean().getActiveConnections()).isZero();
        assertThat(jdbc.queryForObject("select 1", Integer.class)).isEqualTo(1);

        ENCODER.open(3);
        // 이 인코더는 무엇이든 맞다고 한다. 가짜 저장값과 맞아도 로그인되지 않는다.
        assertThat(known.result()).contains(userId);
        assertThat(unknown.result()).isEmpty();
        assertThat(waiting.result()).contains(userId);
        assertThat(ENCODER.sawTransaction()).isFalse();
    }

    private RunningTask<Optional<UUID>> startLogin(String email, String password) {
        RunningTask<Optional<UUID>> login = RunningTask.start(() -> userService.authenticate(email, password));
        logins.add(login);
        return login;
    }

    private RunningTask<User> startSignup(String email, String password, String displayName) {
        RunningTask<User> signup = RunningTask.start(() -> userService.createUser(email, password, displayName));
        started.add(signup);
        return signup;
    }
}
