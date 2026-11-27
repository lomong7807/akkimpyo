package app.accountbook.api;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.boot.context.properties.bind.DefaultValue;
import org.springframework.util.unit.DataSize;

/**
 * 요청 본문의 상한(#21). 모든 경로에 하나다. 잘못된 값이면 서버가 뜨지 않는다.
 * 요청마다 본문을 메모리에 담으므로 올리면 서버 메모리 상한(#52)도 같이 본다.
 *
 * @param maxSize 이 크기까지 받는다. 1KB 이상 1MB 이하이고 단위를 붙여 적는다(예: {@code 64KB}). 단위가 없으면 바이트다
 */
@ConfigurationProperties("accountbook.request-body")
record RequestBodyProperties(@DefaultValue("64KB") DataSize maxSize) {

    private static final DataSize SMALLEST = DataSize.ofKilobytes(1);
    private static final DataSize LARGEST = DataSize.ofMegabytes(1);

    RequestBodyProperties {
        if (maxSize.compareTo(SMALLEST) < 0 || maxSize.compareTo(LARGEST) > 0) {
            throw new IllegalArgumentException(
                    "accountbook.request-body.max-size는 1KB 이상 1MB 이하여야 합니다: " + maxSize);
        }
    }
}
