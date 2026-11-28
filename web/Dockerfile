# `# syntax=` 지시문은 두지 않는다. 두면 빌드할 때마다 Docker Hub에서 프런트엔드 이미지를 태그로 받는다.

# Node는 ci.yml과 같은 버전을 쓴다. digest는 여러 아키텍처를 묶은 인덱스의 값이다.
FROM node:24.3.0-bookworm-slim@sha256:8225b1806c6e37dced949224b5c0d8278a2fe593967288620e0af69b2cbc4539 AS build
WORKDIR /src

COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

COPY . .
RUN npm run build


FROM caddy:2.11.9-alpine@sha256:003a97808e781aa9f7e75cc2f43d34d461099031faf5e20faefb9f61126836f0

COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=build /src/dist /srv

# 인증서(/data)와 설정(/config)을 아래 사용자가 쓸 수 있게 한다. 운영 compose의 이름 있는 볼륨은 처음 붙을 때
# 이 폴더의 소유자를 물려받는다(#52).
RUN chown -R 10001:10001 /data /config

# Docker는 컨테이너 안의 1024 미만 포트도 root 없이 열게 한다(ip_unprivileged_port_start=0).
USER 10001:10001

# Caddy 이미지에서 물려받은 라벨 중 이 이미지와 맞지 않는 것을 바꾼다.
ARG REVISION=""
LABEL org.opencontainers.image.title="akkimpyo-web" \
      org.opencontainers.image.description="" \
      org.opencontainers.image.documentation="" \
      org.opencontainers.image.licenses="" \
      org.opencontainers.image.source="https://github.com/lomong7807/akkimpyo" \
      org.opencontainers.image.url="" \
      org.opencontainers.image.vendor="" \
      org.opencontainers.image.version="" \
      org.opencontainers.image.revision="$REVISION"
