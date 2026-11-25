package app.accountbook.user;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;

import app.accountbook.common.DuplicateEmailException;
import app.accountbook.common.InvalidRequestException;
import app.accountbook.support.IntegrationTest;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;

/** 해시보다 싼 검사와 중복 확인을 먼저 한다(ADR 001 결정 7). 거기서 떨어진 가입은 해시를 돌리지 않는다. */
@IntegrationTest
class SignupHashOrderTest {

    @Autowired UserService userService;
    @MockitoSpyBean PasswordEncoder passwordEncoder;

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
