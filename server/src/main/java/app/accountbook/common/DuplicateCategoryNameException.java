package app.accountbook.common;

/** 같은 상위 아래(최상위끼리 포함)에 같은 이름의 카테고리가 이미 있다. */
public class DuplicateCategoryNameException extends RuntimeException {

    public DuplicateCategoryNameException() {
        super("같은 이름의 카테고리가 있습니다.");
    }
}
