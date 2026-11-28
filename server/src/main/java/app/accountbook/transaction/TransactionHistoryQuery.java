package app.accountbook.transaction;

import app.accountbook.common.NotFoundException;
import app.accountbook.ledger.LedgerAccess;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * 거래 하나의 변경 이력(F-228, P-216, #47). 휴지통의 거래도 볼 수 있다. 없는 거래, 다른 장부의 거래(내가 그 장부의
 * 구성원이어도), 완전히 지운 거래는 구분하지 않고 {@link NotFoundException}이다. 그 거래의 이력만 준다.
 */
@Component
@Transactional(readOnly = true)
public class TransactionHistoryQuery {

    private final TransactionRepository transactionRepository;
    private final ChangeLogRepository changeLogRepository;
    private final LedgerAccess ledgerAccess;

    TransactionHistoryQuery(TransactionRepository transactionRepository, ChangeLogRepository changeLogRepository,
                            LedgerAccess ledgerAccess) {
        this.transactionRepository = transactionRepository;
        this.changeLogRepository = changeLogRepository;
        this.ledgerAccess = ledgerAccess;
    }

    /** 오래된 것부터(F-228. version 순이고 기록 시각도 같은 순서다, ADR 007 결정 7). 구성원 확인이 거래 확인보다 먼저다. */
    public List<TransactionChange> history(UUID actorId, UUID ledgerId, UUID transactionId) {
        ledgerAccess.requireMember(actorId, ledgerId);
        if (transactionId == null || !transactionRepository.existsByIdAndLedgerId(transactionId, ledgerId)) {
            throw new NotFoundException();
        }
        return changeLogRepository.findByTransactionIdAndLedgerIdOrderByVersionAsc(transactionId, ledgerId).stream()
                .map(TransactionChange::of)
                .toList();
    }
}
