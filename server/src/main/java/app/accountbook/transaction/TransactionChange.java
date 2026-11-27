package app.accountbook.transaction;

import app.accountbook.transaction.TransactionView.Line;
import java.time.Instant;
import java.time.LocalDate;
import java.time.LocalTime;
import java.util.List;
import java.util.UUID;

/**
 * 거래의 변경 이력 1행을 형식 버전대로 해석한 것(F-228, P-216, #47). 저장된 JSON을 그대로 넘기지 않는다(ADR 007 결정 4).
 *
 * @param actorId  바꾼 사람. 서버가 한 일과 탈퇴한 사람은 null이다(ADR 007 결정 5, 6)
 * @param deviceId 저장된 기기 값(ADR 007 결정 10). 탈퇴로 비워졌거나 완전 삭제 기록이면 null이다
 * @param at       기록한 시각. 한 거래 안에서 version 순서와 같은 순서다
 * @param before   바뀌기 전 값. {@code CREATE}면 null이다
 * @param after    바뀐 뒤 값. 완전 삭제 기록이면 null이다
 */
public record TransactionChange(ChangeAction action, UUID actorId, String deviceId, Instant at, Value before,
                                Value after) {

    static TransactionChange of(ChangeLog log) {
        return new TransactionChange(log.getAction(), log.getActorId(), log.getDeviceId(), log.getCreatedAt(),
                Value.of(ChangeLogValue.read(log.getFormatVersion(), log.getBeforeValue())),
                Value.of(ChangeLogValue.read(log.getFormatVersion(), log.getAfterValue())));
    }

    /** 스프링이나 로그가 이 값을 찍을 때 가맹점과 메모가 나가지 않게 한다(ADR 001 결정 10). */
    @Override
    public String toString() {
        return "TransactionChange[" + action + "]";
    }

    /**
     * 그 시점 거래의 값 가운데 사람이 바꾸는 것. 거래 id, 장부, 만든 사람, version, 기록 시각은 뺐다.
     *
     * @param paidBy  사용자 id. 탈퇴로 비워졌으면 null이다
     * @param deleted 휴지통에 있었는가
     * @param lines   분개 라인. 순서는 뜻이 없다(ADR 007 결정 4)
     */
    public record Value(TransactionType type, LocalDate occurredOn, LocalTime occurredTime, String payee, String memo,
                        TransactionStatus status, UUID paidBy, boolean deleted, List<Line> lines) {

        public Value {
            lines = List.copyOf(lines);
        }

        static Value of(ChangeLogValue stored) {
            return stored == null ? null : new Value(stored.type(), stored.occurredOn(), stored.occurredTime(),
                    stored.payee(), stored.memo(), stored.status(), stored.paidBy(), stored.deleted(),
                    stored.lines().stream()
                            .map(line -> new Line(line.accountId(), line.categoryId(), line.amount()))
                            .toList());
        }

        @Override
        public String toString() {
            return "Value[]";
        }
    }
}
