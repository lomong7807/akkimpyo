# `# syntax=` 지시문은 두지 않는다. 두면 빌드할 때마다 Docker Hub에서 프런트엔드 이미지를 태그로 받는다.

# 21.0.13.1+2(2026-11-20)는 arm64 이미지가 아직 없어, JDK와 JRE 모두 arm64가 있는 21.0.13+9를 쓴다(2026-11-24 확인).
# digest는 여러 아키텍처를 묶은 인덱스의 값이다. JDK와 JRE는 같은 버전으로 함께 올린다.
FROM eclipse-temurin:21.0.13_9-jdk-noble@sha256:bc12ebd88ffa6dda0092940e179365b05aef8d813b867f9df5a1f168c9a44feb AS build
WORKDIR /src

# build.gradle을 바꾸지 않고 이 이미지를 빌드할 때만 쓰는 Gradle 설정.
# - jar 안의 파일 시각과 순서를 고정한다. Gradle 8의 기본값은 빌드 시각을 넣어, 같은 커밋도 jar가 매번 달라진다.
# - 내장 dependencies 태스크는 jar를 내려받지 않으므로 실제로 내려받는 태스크를 둔다.
COPY <<'GRADLE' /image.init.gradle
allprojects {
    tasks.withType(AbstractArchiveTask).configureEach {
        preserveFileTimestamps = false
        reproducibleFileOrder = true
    }
    tasks.register('downloadDependencies') {
        doLast { [configurations.compileClasspath, configurations.runtimeClasspath]*.files }
    }
}
GRADLE

# Gradle 파일이 그대로면 소스만 바뀌었을 때 이 레이어(Gradle과 의존성)를 다시 쓴다.
COPY gradlew settings.gradle build.gradle ./
COPY gradle ./gradle
RUN ./gradlew --no-daemon --console=plain --init-script /image.init.gradle downloadDependencies

# 테스트는 ci.yml이 돌린다. 여기서는 jar만 만든다.
COPY . .
# 파일 시각을 고정해, 서버 코드가 그대로면 커밋이 달라도 jar 레이어(약 51MB)가 같게 한다.
RUN ./gradlew --no-daemon --console=plain --init-script /image.init.gradle bootJar \
    && mv build/libs/*.jar /app.jar \
    && touch -d @0 /app.jar


FROM eclipse-temurin:21.0.13_9-jre-noble@sha256:b4f9d2a0bc273417cf5219b7b832bbf0493ed500b7b57d5001d9f83374659060

# 힙 상한을 컨테이너 메모리 한도의 비율로 정한다. 컨테이너에서 이 변수를 주면 값 전체가 바뀐다.
# 60은 #52 초안의 한도 1GB에서 힙 약 600MB다. 힙 밖은 기동 직후 약 170MB였다(2026-11-24 로컬 측정).
ENV JDK_JAVA_OPTIONS="-XX:MaxRAMPercentage=60.0"

# 하위 폴더에 두면 폴더 시각이 레이어에 들어가 위에서 고정한 것이 소용없어진다.
COPY --from=build /app.jar /app.jar

# /etc/passwd에 없는 번호를 쓴다. useradd는 /etc/shadow에 실행한 날짜를 남겨 빌드마다 내용이 달라진다.
USER 10001:10001
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/app.jar"]

# version은 기본 이미지에서 물려받은 값(Ubuntu 버전)이라 비운다.
ARG REVISION=""
LABEL org.opencontainers.image.title="akkimpyo-server" \
      org.opencontainers.image.source="https://github.com/lomong7807/akkimpyo" \
      org.opencontainers.image.version="" \
      org.opencontainers.image.revision="$REVISION"
