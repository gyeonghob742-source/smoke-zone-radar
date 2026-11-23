# encoding: utf-8
# 흡연구역 좌표 보정 스크립트 (카카오 로컬 API)
#
# 사용법 (프로젝트 폴더에서):
#   KAKAO_REST_KEY=내_REST_API_키 ruby tools/geocode_kakao.rb
#
# - data/smoking-areas.js 의 주소를 카카오 주소 검색으로 다시 찾아 lat/lng 를 고친다.
# - 주소로 못 찾으면 "구 + 이름" 키워드 검색을 한 번 더 해본다.
# - 찾은 곳은 verified: true, 못 찾은 곳은 verified: false 가 붙는다.
#   (앱은 verified: false 인 곳을 목록에만 보여주고 알림에서는 뺀다)
# - REST API 키는 developers.kakao.com > 내 애플리케이션 > 앱 키에서 확인. 코드에 직접 적지 말 것.
require 'json'
require 'net/http'
require 'uri'

KEY = ENV['KAKAO_REST_KEY'].to_s.strip
abort('KAKAO_REST_KEY 환경변수를 넣어주세요. 예) KAKAO_REST_KEY=abcd1234 ruby tools/geocode_kakao.rb') if KEY.empty?

ROOT = File.expand_path('..', __dir__)
PATH = File.join(ROOT, 'data', 'smoking-areas.js')
src = File.read(PATH, encoding: 'utf-8')
header = src[0...src.index('window.SMOKING_AREAS')]
arr = JSON.parse(src[src.index('[')..src.rindex(']')])

def kakao(path, query)
  uri = URI("https://dapi.kakao.com#{path}?query=#{URI.encode_www_form_component(query)}")
  req = Net::HTTP::Get.new(uri)
  req['Authorization'] = "KakaoAK #{KEY}"
  res = Net::HTTP.start(uri.host, uri.port, use_ssl: true) { |h| h.request(req) }
  raise "카카오 API 오류 #{res.code}: #{res.body[0, 200]}" unless res.is_a?(Net::HTTPSuccess)
  JSON.parse(res.body)['documents'] || []
end

ok = fail = 0
arr.each_with_index do |s, i|
  next if s['verified'] == true
  addr = s['address'].to_s.gsub(/\A"+|"+\z/, '').strip
  doc = nil
  begin
    doc = kakao('/v2/local/search/address.json', addr).first unless addr.empty?
    doc ||= kakao('/v2/local/search/keyword.json', "#{s['gu']} #{s['name']}").first
  rescue => e
    warn "  ! #{s['name']}: #{e.message}"
    sleep 1
  end
  if doc
    s['lat'] = doc['y'].to_f.round(6)
    s['lng'] = doc['x'].to_f.round(6)
    s['verified'] = true
    ok += 1
  else
    s['verified'] = false
    fail += 1
  end
  print "\r#{i + 1}/#{arr.size} 처리 중 (찾음 #{ok} · 못 찾음 #{fail})"
  sleep 0.08
end
puts

header = header.sub(/^\/\/ ⚠️.*\n(\/\/ .*tools\/geocode_kakao.*\n)?/, "// ✅ 좌표: 카카오 로컬 API로 보정함 (#{Time.now.strftime('%Y-%m-%d')}). verified: false 는 위치 미확인.\n")
File.write(PATH, header + 'window.SMOKING_AREAS = ' + JSON.pretty_generate(arr) + ";\n", encoding: 'utf-8')
puts "완료! 찾음 #{ok}곳, 못 찾음 #{fail}곳 → data/smoking-areas.js 저장"
