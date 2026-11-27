package app.accountbook.transaction;

import app.accountbook.account.AccountUsage;
import java.util.UUID;
import org.springframework.stereotype.Component;

/** 거래 라인이 계좌를 참조하는지 답한다. 트랜잭션을 열지 않고 부른 쪽의 트랜잭션에 참여한다. */
@Component
class TransactionAccountUsage implements AccountUsage {

    private final TransactionLineRepository lineRepository;

    TransactionAccountUsage(TransactionLineRepository lineRepository) {
        this.lineRepository = lineRepository;
    }

    @Override
    public boolean isUsed(UUID accountId) {
        return lineRepository.existsByAccountId(accountId);
    }
}
