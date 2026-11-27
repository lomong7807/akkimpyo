// 서버·웹 이미지의 빌드 정의. image.yml(올리기)과 image-check.yml(PR 확인)이 같이 쓴다.
// 로컬 확인: REVISION=$(git rev-parse HEAD) docker buildx bake --file docker-bake.hcl --load

// 커밋 SHA 전체. 태그는 이 값 하나만 쓰고 latest는 만들지 않는다.
variable "REVISION" {
  default = ""
}

// 커밋 시각(초). 이미지 생성 시각과 레이어 안의 파일 시각에 빌드 시각 대신 쓴다.
variable "SOURCE_DATE_EPOCH" {
  default = ""
}

group "default" {
  targets = ["server", "web"]
}

target "_common" {
  platforms = ["linux/arm64"]
  args = {
    REVISION          = REVISION
    SOURCE_DATE_EPOCH = SOURCE_DATE_EPOCH
  }
  // provenance에는 빌드 시각과 실행 정보가 들어가 다시 돌릴 때마다 올린 이미지의 digest가 달라진다.
  attest = [
    "type=provenance,disabled=true",
    "type=sbom,disabled=true",
  ]
}

target "server" {
  inherits = ["_common"]
  context  = "server"
  tags     = ["ghcr.io/lomong7807/akkimpyo-server:${REVISION}"]
}

target "web" {
  inherits = ["_common"]
  context  = "web"
  tags     = ["ghcr.io/lomong7807/akkimpyo-web:${REVISION}"]
}
