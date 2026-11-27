package app.accountbook.transaction;

import java.util.Set;

public enum ChangeAction {
    CREATE,
    UPDATE,
    CANCEL,
    /** 승인취소 되돌리기(F-226). 상태가 취소에서 취소 직전 상태로 돌아간다. */
    UNCANCEL,
    DELETE,
    RESTORE,
    /** 사람이 휴지통에서 완전히 지웠다(F-231). */
    PURGE,
    /** 휴지통에서 30일이 지나 서버가 완전히 지웠다(F-232). 바꾼 사람이 없다(ADR 007 결정 6). */
    AUTO_PURGE;

    /** 완전 삭제 기록. 이 기록이 있는 거래 id는 다시 쓸 수 없다(ADR 007 결정 7). */
    static final Set<ChangeAction> PURGES = Set.of(PURGE, AUTO_PURGE);
}
