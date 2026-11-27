package app.accountbook.api;

import app.accountbook.ledger.LedgerMembership;
import app.accountbook.ledger.LedgerRole;
import app.accountbook.user.UserProfile;
import java.util.List;
import java.util.UUID;

/** 자원 하나라서 ledgers를 {@code items}로 감싸지 않는다(ADR 002 3절은 목록 응답에 적용, #30). */
record MeResponse(UUID id, String email, String displayName, List<MyLedger> ledgers) {

    static MeResponse of(UUID userId, UserProfile profile, List<LedgerMembership> memberships) {
        return new MeResponse(userId, profile.email(), profile.displayName(),
                memberships.stream().map(MyLedger::of).toList());
    }

    /** 스프링이 응답 객체를 로그에 남길 때 이메일과 이름이 나가지 않게 한다(ADR 001 결정 10). */
    @Override
    public String toString() {
        return "MeResponse[]";
    }

    /** @param role 화면은 모르는 값을 보기 전용처럼 다룬다(#30). VIEWER는 2단계에 더한다 */
    record MyLedger(UUID id, String name, LedgerRole role) {

        static MyLedger of(LedgerMembership membership) {
            return new MyLedger(membership.ledgerId(), membership.name(), membership.role());
        }
    }
}
