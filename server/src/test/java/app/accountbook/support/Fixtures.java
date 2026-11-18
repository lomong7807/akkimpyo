package app.accountbook.support;

import app.accountbook.ledger.LedgerMember;
import app.accountbook.ledger.LedgerMemberRepository;
import app.accountbook.ledger.LedgerRole;
import app.accountbook.user.User;
import app.accountbook.user.UserService;
import java.util.UUID;
import org.springframework.boot.test.context.TestComponent;

/** 서비스 테스트에서 반복되는 준비 작업. {@link IntegrationTest}가 등록한다. */
@TestComponent
public class Fixtures {

    private final UserService userService;
    private final LedgerMemberRepository memberRepository;

    Fixtures(UserService userService, LedgerMemberRepository memberRepository) {
        this.userService = userService;
        this.memberRepository = memberRepository;
    }

    /** 가입과 같다: 사용자, 개인 장부, OWNER 구성원, 기본 카테고리가 함께 생긴다. */
    public User user(String email) {
        return userService.createUser(email, "{noop}password", email.substring(0, email.indexOf('@')));
    }

    /** 가입 시 생긴 개인 장부(그 사용자가 OWNER인 장부)의 id. */
    public UUID personalLedgerId(User user) {
        return memberRepository.findByUserId(user.getId()).stream()
                .filter(member -> member.getRole() == LedgerRole.OWNER)
                .map(LedgerMember::getLedgerId)
                .findFirst()
                .orElseThrow();
    }

    /** 초대 기능(2단계) 없이 장부에 구성원을 직접 넣는다. */
    public void addMember(UUID ledgerId, User user, LedgerRole role) {
        memberRepository.save(LedgerMember.of(ledgerId, user.getId(), role));
    }
}
