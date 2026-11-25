package app.accountbook.user;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.reset;
import static org.mockito.Mockito.spy;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;

import app.accountbook.common.DuplicateEmailException;
import app.accountbook.common.InvalidRequestException;
import app.accountbook.common.PasswordHashBusyException;
import app.accountbook.ledger.LedgerRepository;
import app.accountbook.support.IntegrationTest;
import java.time.Duration;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.crypto.argon2.Argon2PasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.bean.override.convention.TestBean;

/** 해시보다 싼 검사와 중복 확인을 먼저 한다(ADR 001 결정 7). 거기서 떨어진 가입은 해시를 돌리지 않는다. */
@IntegrationTest
class SignupHashOrderTest {

    @Autowired UserService userService;
    @Autowired UserRepository userRepository;
    @Autowired LedgerRepository ledgerRepository;
    @TestBean PasswordHasher passwordHasher;

    private static final PasswordEncoder passwordEncoder = spy(new Argon2PasswordEncoder(16, 32, 1, 256, 1));

    static PasswordHasher passwordHasher() {
        return new PasswordHasher(passwordEncoder, new PasswordHashProperties(4, Duration.ofSeconds(2)));
    }

    @BeforeEach
    void forgetEarlierHashes() {
        reset(passwordEncoder);
    }

    @Test
    void createUser_hashesOnceOnSuccess() {
        userService.createUser("once@example.com", "password1", "주인");

        verify(passwordEncoder, times(1)).encode("password1");
    }

    @Test
    void createUser_doesNotHashWhenEmailIsInvalid() {
        assertThatThrownBy(() -> userService.createUser("not-an-email", "password1", "주인"))
                .isInstanceOf(InvalidRequestException.class);

        verify(passwordEncoder, never()).encode(any());
    }

    @Test
    void createUser_doesNotHashWhenDisplayNameIsInvalid() {
        assertThatThrownBy(() -> userService.createUser("name@example.com", "password1", "   "))
                .isInstanceOf(InvalidRequestException.class);

        verify(passwordEncoder, never()).encode(any());
    }

    @Test
    void createUser_doesNotHashWhenPasswordIsInvalid() {
        assertThatThrownBy(() -> userService.createUser("short@example.com", "abc1234", "주인"))
                .isInstanceOf(InvalidRequestException.class);

        verify(passwordEncoder, never()).encode(any());
    }

    @Test
    void createUser_doesNotHashWhenEmailIsAlreadyUsed() {
        userService.createUser("taken@example.com", "password1", "처음");

        assertThatThrownBy(() -> userService.createUser("taken@example.com", "password2", "두번째"))
                .isInstanceOf(DuplicateEmailException.class);

        verify(passwordEncoder, times(1)).encode(any());
    }

    @Test
    void createUser_checksPasswordRuleBeforeDuplicateEmail() {
        userService.createUser("taken@example.com", "password1", "처음");

        // 규칙 오류다. 이미 가입된 이메일인지는 싼 검사를 모두 지난 요청만 알 수 있다.
        assertThatThrownBy(() -> userService.createUser("taken@example.com", "abc1234", "두번째"))
                .isInstanceOf(InvalidRequestException.class);
    }

    @Test
    void createUser_savesNothingWhenHashFails() {
        long usersBefore = userRepository.count();
        long ledgersBefore = ledgerRepository.count();
        doThrow(new PasswordHashBusyException()).when(passwordEncoder).encode("password1");

        assertThatThrownBy(() -> userService.createUser("busy@example.com", "password1", "주인"))
                .isInstanceOf(PasswordHashBusyException.class);
        assertThat(userRepository.count()).isEqualTo(usersBefore);
        assertThat(ledgerRepository.count()).isEqualTo(ledgersBefore);
    }

    @Test
    void createUser_hashesNormalizedPassword() {
        userService.createUser("normalized@example.com", "ａｂｃｄ１２３４", "주인");

        verify(passwordEncoder, times(1)).encode(any());
        verify(passwordEncoder).encode("abcd1234");
    }

    @Test
    void createUser_doesNotHashWhenPasswordIsTooLongToNormalize() {
        assertThatThrownBy(() -> userService.createUser("toolong@example.com", "a1" + "x".repeat(511), "주인"))
                .isInstanceOf(InvalidRequestException.class);

        verify(passwordEncoder, never()).encode(any());
    }

    @Test
    void createUser_doesNotHashPasswordWithUnpairedSurrogate() {
        assertThatThrownBy(() -> userService.createUser("surrogate@example.com", "password1\uD800", "주인"))
                .isInstanceOf(InvalidRequestException.class);

        verify(passwordEncoder, never()).encode(any());
    }
}
