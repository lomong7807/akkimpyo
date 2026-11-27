# 배포 스크립트 시험용 서버 이미지. 운영 서버 이미지와 같은 기본 이미지라 curl이 있다(상태 확인이 컨테이너 안의 curl을 쓴다).
FROM eclipse-temurin:21.0.13_9-jre-noble@sha256:b4f9d2a0bc273417cf5219b7b832bbf0493ed500b7b57d5001d9f83374659060
COPY health-server.pl /health-server.pl
ARG HEALTH=up
ENV HEALTH=$HEALTH
USER 10001:10001
ENTRYPOINT ["perl", "/health-server.pl"]
ARG REVISION=""
LABEL org.opencontainers.image.revision="$REVISION"
