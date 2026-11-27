# 백업 시험을 돌리는 환경. 운영 서버와 같은 Ubuntu 도구(GNU coreutils, flock)를 쓴다.
FROM docker:29.9.2-cli@sha256:5e6baf67325a79f64ed3bed6863954d5e05d0f3d4e57cbdb14809346814bbfdb AS docker

FROM ubuntu:24.04@sha256:562111b88caa79c71391c0c4d3c2114a7d5c35915c20561fd893cb1e07929e6b
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl openssl shellcheck systemd tzdata \
    && rm -rf /var/lib/apt/lists/*
COPY --from=docker /usr/local/bin/docker /usr/local/bin/docker

# age는 deploy/backup.md의 서버 설치와 같은 버전이다.
RUN set -eu; \
    case "$(dpkg --print-architecture)" in \
      arm64) sum=6b8dc4333c53a5a57c9e5834e3a48f92605d7154014cd07269ff3327db5d37f4 ;; \
      amd64) sum=cbe24006683f8eb669266162894b9a522a1af52f2665fbc63a4bb032ed26ac10 ;; \
    esac; \
    curl -fsSLo /tmp/age.tar.gz \
      "https://github.com/FiloSottile/age/releases/download/v1.3.2/age-v1.3.2-linux-$(dpkg --print-architecture).tar.gz"; \
    echo "$sum  /tmp/age.tar.gz" | sha256sum -c -; \
    mkdir -p /opt/akkimpyo/bin; \
    tar -xzf /tmp/age.tar.gz -C /opt/akkimpyo/bin --strip-components=1 age/age age/age-keygen; \
    rm /tmp/age.tar.gz
