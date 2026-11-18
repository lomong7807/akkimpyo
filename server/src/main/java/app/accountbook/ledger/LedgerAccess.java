package app.accountbook.ledger;

import app.accountbook.common.NotLedgerMemberException;
import app.accountbook.common.NotLedgerOwnerException;
import java.util.UUID;
import org.springframework.stereotype.Component;

/** 호출자(actorId)가 장부에 접근할 수 있는지 확인한다. 모든 서비스가 장부 데이터를 다루기 전에 부른다. */
@Component
public class LedgerAccess {

    private final LedgerMemberRepository memberRepository;

    LedgerAccess(LedgerMemberRepository memberRepository) {
        this.memberRepository = memberRepository;
    }

    public boolean isMember(UUID actorId, UUID ledgerId) {
        return memberRepository.existsByLedgerIdAndUserId(ledgerId, actorId);
    }

    /** 구성원이 아니면(장부가 없어도) {@link NotLedgerMemberException}. */
    public void requireMember(UUID actorId, UUID ledgerId) {
        if (!isMember(actorId, ledgerId)) {
            throw new NotLedgerMemberException();
        }
    }

    /** OWNER가 아니면(구성원이 아니거나 장부가 없어도) {@link NotLedgerOwnerException}. */
    public void requireOwner(UUID actorId, UUID ledgerId) {
        boolean owner = memberRepository.findByLedgerIdAndUserId(ledgerId, actorId)
                .map(member -> member.getRole() == LedgerRole.OWNER)
                .orElse(false);
        if (!owner) {
            throw new NotLedgerOwnerException();
        }
    }
}
