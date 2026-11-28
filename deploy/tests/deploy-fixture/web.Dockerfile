# 배포 스크립트 시험용 웹 이미지. 운영 웹 이미지와 같은 기본 이미지(Caddy, busybox)이고 /srv/assets에 판마다 다른 파일이 있다.
FROM caddy:2.11.9-alpine@sha256:003a97808e781aa9f7e75cc2f43d34d461099031faf5e20faefb9f61126836f0
COPY web.Caddyfile /etc/caddy/Caddyfile
ARG VERSION=v1
RUN mkdir -p /srv/assets \
    && echo "$VERSION" >/srv/index.html \
    && echo "// $VERSION" >"/srv/assets/index-$VERSION.js"
USER 10001:10001
ARG REVISION=""
LABEL org.opencontainers.image.revision="$REVISION"
