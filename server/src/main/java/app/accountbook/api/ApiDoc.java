package app.accountbook.api;

/** 컨트롤러의 문서 어노테이션이 함께 쓰는 값(ADR 003 결정 7). 오류 응답의 내용은 문서 테스트가 {@link ErrorCode}에서 만든다. */
final class ApiDoc {

    /** 그 동작이 409로 답할 수 있다. 문서의 Error409는 409로 나가는 code를 모두 적는다. */
    static final String CONFLICT = "#/components/responses/Error409";
    /** 거래 목록과 검색의 필터(#62). */
    static final String ANY_OF = "같은 이름을 여러 번 보내면 그중 하나라도 맞는 거래";
    static final String STATUS = "한 번만 보낸다. 없으면 상태로 거르지 않는다";
    static final String ONCE_PAYEE = "한 번만 보낸다. 없으면 빈 가맹점과 같다";

    private ApiDoc() {
    }
}
