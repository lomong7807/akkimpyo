package app.accountbook.api;

import java.io.IOException;
import java.io.OutputStream;
import java.io.OutputStreamWriter;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.stream.Collectors;

/**
 * 내보내기 행을 CSV(RFC 4180)로 쓴다(#57). 스프링 MVC를 모르고 행과 출력만 받으며 출력은 닫지 않는다. 엑셀에서 한글이 깨지지
 * 않게 UTF-8 BOM을 맨 앞에 둔다(P-228). 첫 줄은 머리이고 줄 끝은 CRLF다. 쉼표, 큰따옴표, 줄바꿈이 든 칸은 큰따옴표로 감싸고
 * 안의 큰따옴표는 두 번 쓴다.
 *
 * <p>수식 주입 막기: {@code = + - @}, 탭, CR로 시작하는 칸은 앞에 작은따옴표({@code '})를 붙여 스프레드시트가 수식이 아니라
 * 글자로 읽게 한다(OWASP CSV Injection 권고). 열을 가리지 않고 모든 칸에 건다. 날짜, 시각, 금액, 정해진 글자(유형, 상태, 머리)는
 * 이 글자로 시작하지 않아 그대로다. 붙인 작은따옴표는 파일을 연 화면에도 보인다(security 검토, #57).
 */
final class CsvExport {

    /** 칸 맨 앞에 오면 스프레드시트가 수식으로 읽을 수 있는 글자. */
    private static final String FORMULA_START = "=+-@\t\r";

    private CsvExport() {
    }

    static void write(List<ExportRow> rows, OutputStream out) throws IOException {
        Writer writer = new OutputStreamWriter(out, StandardCharsets.UTF_8);
        writer.write('\uFEFF');
        line(writer, ExportRow.HEADER);
        for (ExportRow row : rows) {
            line(writer, row.cells());
        }
        writer.flush();
    }

    private static void line(Writer writer, List<String> cells) throws IOException {
        writer.write(cells.stream().map(CsvExport::cell).collect(Collectors.joining(",", "", "\r\n")));
    }

    /** 칸 하나. {@code null}은 빈 칸이다. */
    static String cell(String value) {
        if (value == null || value.isEmpty()) {
            return "";
        }
        String text = FORMULA_START.indexOf(value.charAt(0)) >= 0 ? "'" + value : value;
        boolean quoted = text.chars().anyMatch(c -> c == ',' || c == '"' || c == '\r' || c == '\n');
        return quoted ? '"' + text.replace("\"", "\"\"") + '"' : text;
    }
}
