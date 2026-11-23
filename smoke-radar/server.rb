# encoding: utf-8
require 'webrick'

root = File.expand_path(File.dirname(__FILE__))
port = 3000

# MIME Types
mime_types = WEBrick::HTTPUtils::DefaultMimeTypes
mime_types['js'] = 'application/javascript'
mime_types['css'] = 'text/css'
mime_types['html'] = 'text/html'
mime_types['json'] = 'application/json'
mime_types['webmanifest'] = 'application/manifest+json'
mime_types['svg'] = 'image/svg+xml'

server = WEBrick::HTTPServer.new(
  Port: port,
  DocumentRoot: root,
  MimeTypes: mime_types,
  Logger: WEBrick::Log.new($stderr, WEBrick::Log::INFO),
  AccessLog: [],
  RequestCallback: proc { |req, res|
    res['Cache-Control'] = 'no-store, no-cache, must-revalidate'
    res['Pragma'] = 'no-cache'
  }
)

trap('INT') { server.shutdown }
trap('TERM') { server.shutdown }

puts "=================================================="
puts "🚀 스모크 존 레이더 로컬 서버가 켜졌어요!"
puts "👉 브라우저 접속 주소: http://localhost:#{port}"
puts "=================================================="

server.start
