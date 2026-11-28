package app.accountbook.transaction;

import java.util.Set;
import java.util.UUID;

/**
 * 거래 목록의 필터(F-216~F-219, #62). 필터끼리는 그리고, 한 필터 안의 값끼리는 또는이다(기능정의서 8.2의 46번). 빈 집합과
 * null은 그 필터를 켜지 않은 것이다. 계좌와 카테고리는 거래의 라인 하나가 둘 다 맞아야 한다(분할 거래의 줄은 모두 같은
 * 계좌다, P-212).
 *
 * @param accountIds  이 계좌의 라인이 있는 거래. 이체는 보내는 계좌나 받는 계좌 중 하나가 맞으면 든다. 숨긴 계좌도 된다
 * @param categoryIds 이 카테고리의 라인이 있는 거래. 이체의 라인에는 카테고리가 없어 이 필터를 켜면 이체는 빠진다
 * @param types       거래 종류. 환불과 돌려받음은 지출이다(F-218)
 * @param status      거래 상태. null이면 모두다
 */
public record TransactionFilter(Set<UUID> accountIds, Set<UUID> categoryIds, Set<TransactionType> types,
                                TransactionStatus status) {

    /** 아무것도 거르지 않는다. */
    public static final TransactionFilter NONE = new TransactionFilter(Set.of(), Set.of(), Set.of(), null);

    public TransactionFilter {
        accountIds = Set.copyOf(accountIds);
        categoryIds = Set.copyOf(categoryIds);
        types = Set.copyOf(types);
    }
}
