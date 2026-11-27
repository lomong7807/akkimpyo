package app.accountbook.category;

import java.util.Set;
import java.util.UUID;

/**
 * 카테고리 삭제(F-512)가 거래에 묻고 시키는 일. category가 선언하고 transaction이 구현한다(ADR 004 결정 5).
 * 트랜잭션을 열지 않고 부른 쪽의 트랜잭션에 참여한다. 구성원을 확인하지 않으므로 {@link CategoryService}가 확인한 뒤에 부른다.
 */
public interface CategoryUsage {

    /** 그 카테고리들을 쓰는 거래 수. 휴지통과 취소한 거래도 센다. 라인이 여럿인 거래도 하나로 센다. */
    long countTransactions(UUID ledgerId, Set<UUID> categoryIds);

    /**
     * 그 카테고리들의 라인(휴지통, 취소 포함)을 모두 옮기고 옮긴 거래마다 version을 올려 이력을 하나 남긴다(P-216, P-217).
     * 부르는 쪽이 그 카테고리들을 먼저 잠근다. movedBy는 이력의 바꾼 사람이고, 기기 값의 형식이 틀리면 아무것도 바꾸지 않는다.
     */
    void moveLines(UUID ledgerId, Set<UUID> categoryIds, UUID targetCategoryId, UUID movedBy, String deviceId);
}
