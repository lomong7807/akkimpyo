package app.accountbook.support;

import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.classic.spi.ThrowableProxyUtil;
import ch.qos.logback.core.read.ListAppender;
import java.util.stream.Collectors;
import org.slf4j.LoggerFactory;

/** 닫을 때까지 모든 로거의 로그를 운영과 같은 기본 수준으로 모은다. */
public final class CapturedLogs implements AutoCloseable {

    private final Logger root = (Logger) LoggerFactory.getLogger(Logger.ROOT_LOGGER_NAME);
    private final ListAppender<ILoggingEvent> appender = new ListAppender<>();

    private CapturedLogs() {
        appender.start();
        root.addAppender(appender);
    }

    public static CapturedLogs start() {
        return new CapturedLogs();
    }

    /** 모은 로그 전부: 로거 이름, 문구, 예외와 그 원인 사슬. */
    public String text() {
        return appender.list.stream()
                .map(event -> event.getLoggerName() + " " + event.getFormattedMessage() + "\n"
                        + ThrowableProxyUtil.asString(event.getThrowableProxy()))
                .collect(Collectors.joining("\n"));
    }

    @Override
    public void close() {
        root.detachAppender(appender);
        appender.stop();
    }
}
