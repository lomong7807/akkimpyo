package app.accountbook.common;

/** 대상이 없거나, 호출자가 구성원이 아닌 장부의 것이다. 두 경우를 구분하지 않는다. */
public class NotFoundException extends RuntimeException {

    public NotFoundException() {
        super("대상을 찾을 수 없습니다.");
    }
}
