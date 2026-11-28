package app.accountbook.ledger;

import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class LedgerService {

    private final LedgerMemberRepository memberRepository;

    LedgerService(LedgerMemberRepository memberRepository) {
        this.memberRepository = memberRepository;
    }

    /**
     * 호출자가 구성원인 장부와 호출자의 권한(#30, F-009). 먼저 속한 장부가 앞이고, 같은 시각이면 장부 id 순이다.
     * 장부 수와 무관하게 조회 한 번이다. 없으면 빈 목록이다.
     */
    @Transactional(readOnly = true)
    public List<LedgerMembership> memberships(UUID actorId) {
        return memberRepository.findMemberships(actorId);
    }
}
