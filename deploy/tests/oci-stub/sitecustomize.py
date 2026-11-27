# 시험용. instance principal 서명을 아무것도 하지 않는 것으로 바꿔, 자격 없이 진짜 OCI CLI를 대역 서버에 붙인다.
import oci.auth.signers


class FakeSigner(object):
    region = 'ap-chuncheon-1'

    def __init__(self, *args, **kwargs):
        pass

    def __call__(self, request):
        return request

    without_content_headers = __call__


oci.auth.signers.InstancePrincipalsSecurityTokenSigner = FakeSigner
