import os, sys
os.chdir("/Users/eyleen.c/Desktop/Claude - MY \u65c5\u904a2026")
import http.server, socketserver
PORT = 8765
handler = http.server.SimpleHTTPRequestHandler
with socketserver.TCPServer(("", PORT), handler) as httpd:
    httpd.serve_forever()
