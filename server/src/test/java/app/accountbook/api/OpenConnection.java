package app.accountbook.api;

import static org.assertj.core.api.Assertions.assertThat;

import app.accountbook.api.ServerClient.Reply;
import java.io.BufferedInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.Socket;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

/** 연결 하나를 열어 두고 조금씩 쓰고 응답을 하나씩 읽는다. {@link ServerClient#raw}는 다 쓰고 연결이 닫힐 때까지 읽는다. */
final class OpenConnection implements AutoCloseable {

    private final Socket socket;
    private final InputStream in;

    OpenConnection(int port) throws IOException {
        socket = new Socket("localhost", port);
        socket.setSoTimeout(10_000);
        in = new BufferedInputStream(socket.getInputStream());
    }

    OpenConnection send(String text) throws IOException {
        socket.getOutputStream().write(text.getBytes(StandardCharsets.ISO_8859_1));
        socket.getOutputStream().flush();
        return this;
    }

    /** 더 보낼 것이 없다고 알린다. 받는 쪽은 열려 있다. */
    OpenConnection finishSending() throws IOException {
        socket.shutdownOutput();
        return this;
    }

    /** 응답 하나를 끝까지 읽는다. 연결이 닫히기를 기다리지 않는다. */
    Reply reply() throws IOException {
        String statusLine = line();
        assertThat(statusLine).as("응답이 있다").startsWith("HTTP/1.1 ");
        int status = Integer.parseInt(statusLine.split(" ")[1]);
        Map<String, List<String>> headers = new TreeMap<>(String.CASE_INSENSITIVE_ORDER);
        for (String line = line(); !line.isEmpty(); line = line()) {
            String[] header = line.split(": ?", 2);
            headers.put(header[0], List.of(header[1]));
        }
        return new Reply(status, headers, body(headers));
    }

    /** 서버가 연결을 닫았는가. 닫을 때까지 기다린다. */
    boolean isClosedByServer() throws IOException {
        return in.read() < 0;
    }

    @Override
    public void close() throws IOException {
        socket.close();
    }

    private String body(Map<String, List<String>> headers) throws IOException {
        if (!headers.getOrDefault("Transfer-Encoding", List.of()).contains("chunked")) {
            int length = Integer.parseInt(headers.getOrDefault("Content-Length", List.of("0")).getFirst());
            return new String(in.readNBytes(length), StandardCharsets.UTF_8);
        }
        ByteArrayOutputStream body = new ByteArrayOutputStream();
        for (int size = Integer.parseInt(line(), 16); size > 0; size = Integer.parseInt(line(), 16)) {
            body.write(in.readNBytes(size));
            line();
        }
        line();
        return body.toString(StandardCharsets.UTF_8);
    }

    private String line() throws IOException {
        StringBuilder line = new StringBuilder();
        for (int c = in.read(); c != '\n'; c = in.read()) {
            assertThat(c).as("응답이 끝나기 전에 닫히지 않았다: " + line).isNotNegative();
            if (c != '\r') {
                line.append((char) c);
            }
        }
        return line.toString();
    }
}
