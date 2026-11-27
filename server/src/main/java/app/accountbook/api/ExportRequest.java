package app.accountbook.api;

import app.accountbook.common.FieldErrorCode;
import app.accountbook.common.InvalidRequestException;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;

/**
 * 내보내기의 쿼리 값(#57 요청 계약). 있는지, 형식, 날짜의 범위(0001-01-01~9999-12-31)를 보고 틀린 입력란을 모두 모아 한 번에
 * 알린다. 시작일과 종료일의 앞뒤는 조회가 본다. 거래 목록(#15)처럼 빈 값과 같은 이름을 두 번 보낸 값도 형식 오류다.
 *
 * @param format 소문자 {@code csv}만 받는다. 엑셀({@code xlsx})은 다음 PR에서 연다
 * @param from   시작일, {@code to}는 종료일(둘 다 포함). 장부 시간대의 달력 날짜이고 거래의 날짜와 그대로 비교한다(P-202)
 */
record ExportRequest(String format, LocalDate from, LocalDate to) {

    /** 받는 날짜의 범위. 조회가 종료일 다음 날을 구하므로 넘치지 않게 끝을 둔다(dba 검토, #344). */
    private static final LocalDate FIRST = LocalDate.of(1, 1, 1);
    private static final LocalDate LAST = LocalDate.of(9999, 12, 31);

    static ExportRequest of(String format, String from, String to) {
        List<InvalidRequestException> errors = new ArrayList<>();
        if (format == null || !format.equals("csv")) {
            errors.add(new InvalidRequestException("format",
                    format == null ? FieldErrorCode.REQUIRED : FieldErrorCode.INVALID_FORMAT, "format은 csv입니다."));
        }
        Optional<LocalDate> start = date("from", from, errors);
        Optional<LocalDate> end = date("to", to, errors);
        if (!errors.isEmpty()) {
            throw InvalidRequestException.ofAll(errors);
        }
        return new ExportRequest(format, start.orElseThrow(), end.orElseThrow());
    }

    private static Optional<LocalDate> date(String field, String text, List<InvalidRequestException> errors) {
        Optional<LocalDate> parsed = text == null ? Optional.empty() : TransactionListRequest.date(text);
        if (parsed.isEmpty()) {
            errors.add(new InvalidRequestException(field,
                    text == null ? FieldErrorCode.REQUIRED : FieldErrorCode.INVALID_FORMAT, field + "는 YYYY-MM-DD입니다."));
        } else if (parsed.get().isBefore(FIRST) || parsed.get().isAfter(LAST)) {
            errors.add(new InvalidRequestException(field, FieldErrorCode.OUT_OF_RANGE,
                    field + "는 0001-01-01부터 9999-12-31까지입니다."));
            return Optional.empty();
        }
        return parsed;
    }
}
