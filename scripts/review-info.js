// 55 검토 판(8087)에만 붙는 정보 창. Alt+Shift+R 을 누르면 이 판에 들어간 PR·브랜치·이슈를 alert 로 보인다.
//
// 앱 코드(src)가 아니다. review55.sh 가 빌드한 dist/ 에 `window.__REVIEW__ = {...}` 를 앞에 붙여 끼워 넣는다.
// 그래서 main 판(8084)·개발 서버에는 이 파일도 단축키도 없다.
// 키는 e.code 로 본다 — 한글 입력 상태면 e.key 가 'ㄱ' 이 된다. 앱의 단축키는 Alt 조합을 받지 않아 겹치지 않는다.
;(function () {
  var info = window.__REVIEW__
  if (!info) return
  function text() {
    var lines = ['검토 판 (review ' + info.review.slice(0, 7) + ' · ' + info.built + ')', 'main ' + info.main.slice(0, 7), '']
    if (!info.prs.length) lines.push('들어간 PR 없음 (main 그대로)')
    info.prs.forEach(function (p) {
      lines.push('#' + p.number + '  ' + p.branch + '  (' + p.author + ')')
      lines.push('    ' + p.title)
      if (p.issues.length) lines.push('    이슈: ' + p.issues.map(function (n) { return '#' + n }).join(' '))
    })
    if (info.skipped.length) lines.push('', '충돌로 뺀 PR: ' + info.skipped.map(function (n) { return '#' + n }).join(' '))
    return lines.join('\n')
  }
  window.addEventListener('keydown', function (e) {
    if (e.altKey && e.shiftKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyR') {
      e.preventDefault()
      alert(text())
    }
  })
  console.info('[review] ' + text().split('\n')[0] + ' — Alt+Shift+R 로 들어간 PR 보기')
})()
