package app.accountbook.api;

import app.accountbook.transaction.TrashPage;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.jspecify.annotations.Nullable;

/**
 * 휴지통의 한 쪽(#47 응답 계약). 거래는 만들기 응답(#14)과 같은 모양이고 {@code deletedAt}과 {@code purgeAt}이 채워져 온다.
 * 지운 사람은 {@code updatedBy}다(휴지통의 거래는 고칠 수 없어 마지막 이력이 지우기다). 영구 삭제까지 남은 날은 화면이
 * {@code purgeAt}으로 센다. 마지막 쪽이면 {@code nextCursor}가 null이다.
 *
 * @param nextCursor {@link TrashCursor}. 다음 요청에 그대로 보낸다
 */
record TrashResponse(List<TransactionResponse> items, @Nullable String nextCursor) {

    /** @param names 장부 구성원의 표시 이름. 쪽마다 한 번 읽는다 */
    static TrashResponse of(TrashPage page, Map<UUID, String> names, String nextCursor) {
        return new TrashResponse(page.items().stream().map(tx -> TransactionResponse.of(tx, names)).toList(),
                nextCursor);
    }

    /** 스프링이 응답 객체를 로그에 남길 때 가맹점, 메모, 이름이 나가지 않게 한다(ADR 001 결정 10). */
    @Override
    public String toString() {
        return "TrashResponse[]";
    }
}
