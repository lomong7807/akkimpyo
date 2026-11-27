# 시험용 Object Storage 대역. 받은 요청을 한 줄씩 출력한다.
# 객체 생성만 되는 자격을 흉내 낸다: 이미 있는 이름에 PUT하거나 denied 버킷에 PUT하면 404다.
import base64
import hashlib
import http.server
import json
import urllib.parse

objects = {}


class Handler(http.server.BaseHTTPRequestHandler):
    def handle_any(self):
        url = urllib.parse.urlsplit(self.path)
        parts = url.path.split('/', 6)  # /n/<ns>/b/<bucket>/o[/<name>]
        bucket = parts[4]
        name = urllib.parse.unquote(parts[6]) if len(parts) > 6 else ''
        body = self.rfile.read(int(self.headers.get('content-length') or 0))
        status, reply = self.answer(bucket, name, body, urllib.parse.parse_qs(url.query))
        print(self.command, bucket, name, status, flush=True)
        self.send_response(status)
        self.send_header('content-length', str(len(reply)))
        self.end_headers()
        if self.command != 'HEAD':
            self.wfile.write(reply)

    def answer(self, bucket, name, body, query):
        if self.command == 'PUT':
            sha256 = base64.b64encode(hashlib.sha256(body).digest()).decode()
            if self.headers.get('opc-content-sha256') != sha256:
                return 400, b'{"code": "UnmatchedContentSha256", "message": ""}'
            if bucket == 'denied' or (bucket, name) in objects:
                return 404, b'{"code": "BucketNotFound", "message": ""}'
            objects[bucket, name] = body
            return 200, b''
        if self.command in ('GET', 'HEAD') and name:
            return (200, objects[bucket, name]) if (bucket, name) in objects else (404, b'')
        if self.command == 'GET':
            prefix = query['prefix'][0]
            names = sorted(n for b, n in objects if b == bucket and n.startswith(prefix))
            return 200, json.dumps({'objects': [{'name': n} for n in names], 'prefixes': []}).encode()
        return 404, b''

    do_GET = do_PUT = do_HEAD = do_POST = do_DELETE = handle_any

    def log_message(self, *args):
        pass


http.server.ThreadingHTTPServer(('0.0.0.0', 8000), Handler).serve_forever()
