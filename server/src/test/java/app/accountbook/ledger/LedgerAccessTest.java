package app.accountbook.ledger;

import static org.assertj.core.api.Assertions.assertThatCode;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import app.accountbook.common.NotLedgerMemberException;
import app.accountbook.common.NotLedgerOwnerException;
import app.accountbook.support.Fixtures;
import app.accountbook.support.IntegrationTest;
import app.accountbook.user.User;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

@IntegrationTest
class LedgerAccessTest {

    @Autowired LedgerAccess ledgerAccess;
    @Autowired Fixtures fixtures;

    @Test
    void requireMember_rejectsOutsider() {
        User owner = fixtures.user("owner@example.com");
        User outsider = fixtures.user("outsider@example.com");
        UUID ledgerId = fixtures.personalLedgerId(owner);

        assertThatCode(() -> ledgerAccess.requireMember(owner.getId(), ledgerId)).doesNotThrowAnyException();
        assertThatThrownBy(() -> ledgerAccess.requireMember(outsider.getId(), ledgerId))
                .isInstanceOf(NotLedgerMemberException.class);
        // 존재하지 않는 장부도 같은 예외다. 장부가 있는지 드러내지 않는다.
        assertThatThrownBy(() -> ledgerAccess.requireMember(owner.getId(), UUID.randomUUID()))
                .isInstanceOf(NotLedgerMemberException.class);
    }

    @Test
    void requireOwner_rejectsMember() {
        User owner = fixtures.user("owner@example.com");
        User member = fixtures.user("member@example.com");
        UUID ledgerId = fixtures.personalLedgerId(owner);
        fixtures.addMember(ledgerId, member, LedgerRole.MEMBER);

        assertThatCode(() -> ledgerAccess.requireOwner(owner.getId(), ledgerId)).doesNotThrowAnyException();
        assertThatCode(() -> ledgerAccess.requireMember(member.getId(), ledgerId)).doesNotThrowAnyException();
        assertThatThrownBy(() -> ledgerAccess.requireOwner(member.getId(), ledgerId))
                .isInstanceOf(NotLedgerOwnerException.class);
    }
}
