# shellcheck shell=bash
# 복원 훈련(restore-drill)과 백업 시험(deploy/tests/suite)이 서버를 띄울 때 source해서 같이 쓴다. 운영 서버에는 설치하지 않는다.
# macOS 기본 bash(3.2)에서도 돈다.

# create_server [docker create의 인자...]: 서버가 요구하는 환경 변수를 더해 서버 컨테이너를 만든다.
# 서버가 요구하는 변수가 늘면 여기만 고친다. DB 변수는 부르는 쪽마다 값이 달라 인자로 준다.
# 괄호로 감싼 함수라 변수가 부르는 쪽에 남지 않는다.
create_server() (
  # 이번 한 번만 쓸 키를 만든다. 운영 키는 쓰지 않는다. 값이 명령줄에 보이지 않게 이름만 넘긴다.
  ACCESS_TOKEN_SIGNING_KEY=$(openssl rand -base64 32) || exit
  export ACCESS_TOKEN_SIGNING_KEY
  docker create --env ACCESS_TOKEN_SIGNING_KEY --env WEB_ORIGIN=http://localhost "$@" >/dev/null
)
