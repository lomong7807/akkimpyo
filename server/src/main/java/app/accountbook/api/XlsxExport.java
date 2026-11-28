package app.accountbook.api;

import java.io.IOException;
import java.io.OutputStream;
import java.util.List;
import org.dhatim.fastexcel.Workbook;
import org.dhatim.fastexcel.Worksheet;

/**
 * 내보내기 행을 엑셀(xlsx, 시트 하나)로 쓴다(#57). 스프링 MVC를 모르고 행과 출력만 받는다. 첫 행은 머리이고 열은 CSV와 같다.
 * 날짜는 날짜 칸({@code yyyy-mm-dd}), 금액과 거래 번호는 숫자 칸이고 나머지는 모두 글자 칸(공유 문자열)이다. 빈 칸은 쓰지 않는다.
 *
 * <p>수식 주입 막기: 가맹점, 메모, 이름은 늘 글자 칸으로 쓰고 수식 칸은 하나도 쓰지 않는다. 글자 칸은 {@code =}로 시작해도
 * 엑셀이 계산하지 않으므로 CSV의 작은따옴표는 붙이지 않는다(원래 글자 그대로).
 */
final class XlsxExport {

    private static final String SHEET = "거래";
    private static final int DATE = ExportRow.HEADER.indexOf("날짜");
    private static final int AMOUNT = ExportRow.HEADER.indexOf("금액");
    private static final int NUMBER = ExportRow.HEADER.indexOf("거래 번호");

    private XlsxExport() {
    }

    static void write(List<ExportRow> rows, OutputStream out) throws IOException {
        Workbook workbook = new Workbook(out, "akkimpyo", "1.0");
        Worksheet sheet = workbook.newWorksheet(SHEET);
        for (int column = 0; column < ExportRow.HEADER.size(); column++) {
            sheet.value(0, column, ExportRow.HEADER.get(column));
        }
        for (int index = 0; index < rows.size(); index++) {
            ExportRow row = rows.get(index);
            List<String> cells = row.cells();
            int at = index + 1;
            for (int column = 0; column < cells.size(); column++) {
                if (column == DATE) {
                    sheet.value(at, column, row.date());
                } else if (column == AMOUNT) {
                    sheet.value(at, column, row.amount());
                } else if (column == NUMBER) {
                    sheet.value(at, column, row.number());
                } else if (cells.get(column) != null) {
                    sheet.value(at, column, cells.get(column));
                }
            }
        }
        if (!rows.isEmpty()) {
            sheet.range(1, DATE, rows.size(), DATE).style().format("yyyy-mm-dd").set();
        }
        workbook.finish();
    }
}
