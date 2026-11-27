package app.accountbook.category;

import java.util.UUID;

/** 카테고리가 거래에서 쓰이고 있는지 묻는다. category가 선언하고 transaction이 구현한다(ADR 004 결정 5). */
public interface CategoryUsage {

    /** 소프트 삭제·취소된 거래의 라인도 포함한다. */
    boolean isUsed(UUID categoryId);
}
