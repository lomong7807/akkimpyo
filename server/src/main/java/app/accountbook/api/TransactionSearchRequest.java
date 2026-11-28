package app.accountbook.api;

import app.accountbook.common.FieldErrorCode;
import app.accountbook.common.InvalidRequestException;
import app.accountbook.common.UserText;
import app.accountbook.transaction.TransactionFilter;
import app.accountbook.transaction.TransactionKey;
import app.accountbook.transaction.TransactionSearch;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.util.MultiValueMap;

/**
 * 거래 검색의 쿼리 값(#64 요청 계약). 형식을 보고 틀린 입력란을 모두 모아 한 번에 알린다. 필터는 거래 목록(#62)과 같은
 * 이름과 규칙이다({@link TransactionListRequest#filter}). {@code q}는 저장할 때처럼 맞추고({@link UserText#searchText})
 * 비었거나 공백류뿐이면 없는 것이다. {@code from}과 {@code to}는 내보내기(#57)와 같은 형식과 범위이고({@link ExportRequest#date})
 * 빈 값은 형식 오류다. 조건이 하나도 없는지와 시작일·종료일의 앞뒤는 조회가 본다.
 *
 * @param after cursor의 키. 첫 쪽이면 null
 */
record TransactionSearchRequest(TransactionSearch search, TransactionFilter filter, TransactionKey after) {

    static TransactionSearchRequest of(UUID ledgerId, String q, String from, String to, String cursor,
                                       MultiValueMap<String, String> query) {
        List<InvalidRequestException> errors = new ArrayList<>();
        String text = null;
        try {
            text = UserText.searchText(q, TransactionSearch.MAX_TEXT_LENGTH, "q");
        } catch (InvalidRequestException e) {
            errors.add(e);
        }
        Optional<LocalDate> start = from == null ? Optional.empty() : ExportRequest.date("from", from, errors);
        Optional<LocalDate> end = to == null ? Optional.empty() : ExportRequest.date("to", to, errors);
        Optional<TransactionFilter> filter = TransactionListRequest.filter(query, errors);
        TransactionSearch search = new TransactionSearch(text, start.orElse(null), end.orElse(null));
        Optional<TransactionKey> after = Optional.empty();
        // 검색어·기간·필터를 읽지 못했으면 cursor가 그 검색의 것인지 알 수 없어 보지 않는다.
        if (cursor != null && errors.isEmpty()) {
            after = TransactionCursor.decode(cursor, ledgerId, search, filter.orElseThrow());
            if (after.isEmpty()) {
                errors.add(new InvalidRequestException("cursor", FieldErrorCode.INVALID_FORMAT,
                        "이 검색에서 받은 cursor가 아닙니다."));
            }
        }
        if (!errors.isEmpty()) {
            throw InvalidRequestException.ofAll(errors);
        }
        return new TransactionSearchRequest(search, filter.orElseThrow(), after.orElse(null));
    }
}
