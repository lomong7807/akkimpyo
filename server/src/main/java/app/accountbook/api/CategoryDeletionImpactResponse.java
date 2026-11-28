package app.accountbook.api;

import app.accountbook.category.Category;
import java.util.List;
import java.util.UUID;

/**
 * 카테고리를 지우면 생기는 일(#35 응답 계약). 화면은 이것으로 삭제 확인 문구를 만든다(F-512).
 *
 * @param transactionCount 옮겨질 거래 수. 하위, 휴지통, 취소한 거래를 포함하고 라인이 여럿이어도 거래 하나로 센다
 * @param childCount       함께 지워질 하위 수. 하위는 하위를 갖지 않는다
 */
record CategoryDeletionImpactResponse(long transactionCount, long childCount) {

    /** {@code categories}는 {@code CategoryService.list}의 결과이고 그 가운데 이 카테고리의 하위를 센다. */
    static CategoryDeletionImpactResponse of(UUID categoryId, long transactionCount, List<Category> categories) {
        return new CategoryDeletionImpactResponse(transactionCount,
                categories.stream().filter(category -> categoryId.equals(category.getParentId())).count());
    }
}
