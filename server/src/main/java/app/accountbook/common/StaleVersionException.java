package app.accountbook.common;

/** 요청의 version이 저장된 version과 다르다. 다른 곳에서 먼저 바꿨으므로 아무것도 바꾸지 않는다. */
public class StaleVersionException extends RuntimeException {

    public StaleVersionException() {
        super("다른 곳에서 먼저 바뀌었습니다. 최신 내용을 다시 불러와 주세요.");
    }
}
