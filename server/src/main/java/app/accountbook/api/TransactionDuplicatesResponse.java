package app.accountbook.api;

import app.accountbook.transaction.TransactionView;
import java.util.List;
import java.util.Map;
import java.util.UUID;

/** 중복 경고의 답(#59 응답 계약). 거래는 만들기 응답(#14)과 같은 모양이고, 같은 거래가 없으면 빈 목록이다. */
record TransactionDuplicatesResponse(List<TransactionResponse> items) {

    /** @param names 장부 구성원의 표시 이름. 입력한 사람({@code createdBy})의 이름이 여기서 붙는다 */
    static TransactionDuplicatesResponse of(List<TransactionView> found, Map<UUID, String> names) {
        return new TransactionDuplicatesResponse(found.stream().map(tx -> TransactionResponse.of(tx, names)).toList());
    }

    /** 스프링이 응답 객체를 로그에 남길 때 가맹점, 메모, 이름이 나가지 않게 한다(ADR 001 결정 10). */
    @Override
    public String toString() {
        return "TransactionDuplicatesResponse[]";
    }
}
