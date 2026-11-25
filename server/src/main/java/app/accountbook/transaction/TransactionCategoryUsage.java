package app.accountbook.transaction;

import app.accountbook.category.CategoryUsage;
import java.util.UUID;
import org.springframework.stereotype.Component;

/** 거래 라인이 카테고리를 참조하는지 답한다. 트랜잭션을 열지 않고 부른 쪽의 트랜잭션에 참여한다. */
@Component
class TransactionCategoryUsage implements CategoryUsage {

    private final TransactionLineRepository lineRepository;

    TransactionCategoryUsage(TransactionLineRepository lineRepository) {
        this.lineRepository = lineRepository;
    }

    @Override
    public boolean isUsed(UUID categoryId) {
        return lineRepository.existsByCategoryId(categoryId);
    }
}
