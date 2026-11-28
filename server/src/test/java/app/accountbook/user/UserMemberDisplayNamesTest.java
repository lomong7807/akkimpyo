package app.accountbook.user;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import app.accountbook.common.NotLedgerMemberException;
import app.accountbook.ledger.LedgerRole;
import app.accountbook.support.Fixtures;
import app.accountbook.support.IntegrationTest;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;

/** 거래 응답의 사람 값에 붙이는 이름(#14). 그 장부의 지금 구성원의 것만 준다. */
@IntegrationTest
class UserMemberDisplayNamesTest {

    @Autowired UserService userService;
    @Autowired Fixtures fixtures;

    @Test
    void 장부의_구성원_이름만_한_번에_준다() {
        User owner = fixtures.user("owner@example.com");
        User member = fixtures.user("member@example.com");
        User stranger = fixtures.user("stranger@example.com");
        UUID ledgerId = fixtures.personalLedgerId(owner);
        fixtures.addMember(ledgerId, member, LedgerRole.MEMBER);

        assertThat(userService.memberDisplayNames(member.getId(), ledgerId))
                .isEqualTo(Map.of(owner.getId(), "owner", member.getId(), "member"));
        assertThatThrownBy(() -> userService.memberDisplayNames(stranger.getId(), ledgerId))
                .isInstanceOf(NotLedgerMemberException.class);
    }
}
