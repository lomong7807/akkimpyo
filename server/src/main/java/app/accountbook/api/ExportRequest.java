package app.accountbook.api;

import app.accountbook.common.FieldErrorCode;
import app.accountbook.common.InvalidRequestException;
import java.io.IOException;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import org.springframework.http.MediaType;

/**
 * 내보내기의 쿼리 값(#57 요청 계약). 여기서는 있는지와 형식만 보고, 틀린 입력란을 모두 모아 한 번에 알린다. 시작일과 종료일의
 * 앞뒤는 조회가 본다. 거래 목록(#15)처럼 빈 값({@code from=})과 같은 이름을 두 번 보낸 값도 형식 오류다.
 *
 * @param format 소문자 {@code csv}와 {@code xlsx}만 받는다
 * @param from   시작일(포함). 장부 시간대의 달력 날짜이고 거래의 날짜와 그대로 비교한다(P-202)
 * @param to     종료일(포함)
 */
record ExportRequest(Format format, LocalDate from, LocalDate to) {

    static ExportRequest of(String format, String from, String to) {
        List<InvalidRequestException> errors = new ArrayList<>();
        Optional<Format> chosen = Arrays.stream(Format.values())
                .filter(candidate -> candidate.extension().equals(format))
                .findFirst();
        if (chosen.isEmpty()) {
            errors.add(new InvalidRequestException("format",
                    format == null ? FieldErrorCode.REQUIRED : FieldErrorCode.INVALID_FORMAT, "format은 csv나 xlsx입니다."));
        }
        Optional<LocalDate> start = date("from", from, errors);
        Optional<LocalDate> end = date("to", to, errors);
        if (!errors.isEmpty()) {
            throw InvalidRequestException.ofAll(errors);
        }
        return new ExportRequest(chosen.orElseThrow(), start.orElseThrow(), end.orElseThrow());
    }

    private static Optional<LocalDate> date(String field, String text, List<InvalidRequestException> errors) {
        Optional<LocalDate> parsed = text == null ? Optional.empty() : TransactionListRequest.date(text);
        if (parsed.isEmpty()) {
            errors.add(new InvalidRequestException(field,
                    text == null ? FieldErrorCode.REQUIRED : FieldErrorCode.INVALID_FORMAT, field + "는 YYYY-MM-DD입니다."));
        }
        return parsed;
    }

    /** 파일 형식. 쿼리 값과 확장자는 이름의 소문자다. */
    enum Format {
        CSV(new MediaType("text", "csv", StandardCharsets.UTF_8), CsvExport::write),
        XLSX(MediaType.parseMediaType("application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"),
                XlsxExport::write);

        final MediaType contentType;
        private final FileWriter writer;

        Format(MediaType contentType, FileWriter writer) {
            this.contentType = contentType;
            this.writer = writer;
        }

        String extension() {
            return name().toLowerCase(Locale.ROOT);
        }

        void write(List<ExportRow> rows, OutputStream out) throws IOException {
            writer.write(rows, out);
        }
    }

    @FunctionalInterface
    private interface FileWriter {
        void write(List<ExportRow> rows, OutputStream out) throws IOException;
    }
}
