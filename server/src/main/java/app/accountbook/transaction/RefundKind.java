package app.accountbook.transaction;

/**
 * 지출 거래의 환불 구분(이슈 #8, 계약 #102). 일반 지출과 수입·이체는 값이 없다(null).
 * 두 구분 모두 라인 금액이 양수라 그 카테고리의 지출 합계를 줄이고, 수입 합계에는 들어가지 않는다.
 */
public enum RefundKind {
    /** 환불(F-206). */
    REFUND,
    /** 돌려받음(F-207). 한 명이 결제하고 친구에게 돌려받은 돈(C-30). */
    REIMBURSEMENT
}
