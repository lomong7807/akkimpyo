package app.accountbook.account;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doReturn;

import app.accountbook.common.DuplicateAccountNameException;
import app.accountbook.support.Fixtures;
import app.accountbook.support.IntegrationTest;
import app.accountbook.user.User;
import java.time.LocalDate;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.test.context.bean.override.mockito.MockitoSpyBean;

/**
 * 동시 요청: 두 요청이 모두 "같은 이름 없음"을 본 뒤 저장하는 경우.
 * 앱 검사가 못 본 것으로 만들어, DB 유니크 위반(uq_account_name)이 같은 사용자 오류로 바뀌는지 본다.
 */
@IntegrationTest
class AccountNameRaceTest {

    @Autowired AccountService accountService;
    @Autowired Fixtures fixtures;
    @MockitoSpyBean AccountRepository accountRepository;

    User owner;
    UUID ledgerId;

    @BeforeEach
    void setUp() {
        owner = fixtures.user("owner@example.com");
        ledgerId = fixtures.personalLedgerId(owner);
        doReturn(false).when(accountRepository).existsByLedgerIdAndNameAndIdNot(any(), any(), any());
    }

    @Test
    void create_translatesUniqueViolationToDuplicateName() {
        accountService.create(owner.getId(), ledgerId, command("생활비"));

        assertThatThrownBy(() -> accountService.create(owner.getId(), ledgerId, command("생활비")))
                .isInstanceOf(DuplicateAccountNameException.class);
    }

    @Test
    void update_translatesUniqueViolationToDuplicateName() {
        accountService.create(owner.getId(), ledgerId, command("생활비"));
        Account savings = accountService.create(owner.getId(), ledgerId, command("비상금"));

        assertThatThrownBy(() -> accountService.update(owner.getId(), savings.getId(), command("생활비")))
                .isInstanceOf(DuplicateAccountNameException.class);
    }

    private static AccountCommand command(String name) {
        return new AccountCommand(name, AccountType.BANK, 0, LocalDate.of(2026, 11, 1));
    }
}
