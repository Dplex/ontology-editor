// 챗봇 창. Alt+Shift+K 로 열고 닫는다. 칸이 둘이다.
//   [문서]     55 의 gemini 가 이 repo 의 PRD·티켓·ADR·intent.md 를 읽고 답한다(/__chat, docs/dev/deploy55.md).
//   [온톨로지] 55 의 gemini 가 반영한 건물 온톨로지(TTL)를 읽고 답한다(/__ask, ADR-0050). 답 끝에 쓴 질의가 붙는다.
//   [문서] 칸의 `/issue 요청` 은 문서·소스를 읽고 GitHub 이슈를 바로 올린다(/__issue, scripts/issue-chat.mjs, docs/dev/deploy55.md).
//
// 앱 코드(src)가 아니다. scripts/run.sh build 가 빌드한 dist/ 에 끼워 넣는다(review-info.js 와 같은 방식) —
// 그래서 개발 서버(5174)에는 없고, 8084·8087 에는 있다. 서버 쪽은 같은 주소의 /__chat·/__ask(scripts/docs-chat.mjs).
// 보내는 것은 질문과 앞선 대화, [온톨로지] 칸에서 고른 건물, 그리고 [온톨로지] 칸이면 지금 화면(window.__oe.view — 보는 층·2D/3D·고른 요소·
// 보기 필터의 id 만, ADR-0050)이다. 서버는 그 건물 TTL 에 있는 id 만 남긴다(scripts/onto-view.mjs). 열어 둔 BIM 자체는 보내지 않는다.
//
// 키는 e.code 로 본다 — 한글 입력 상태면 e.key 가 'ㅏ' 가 된다. 앱의 단축키는 Alt 조합을 받지 않아 겹치지 않고,
// 창 안의 키 입력은 창에서 끊어서 앱 단축키(Delete, 방향키 …)로 새지 않는다.
;(function () {
  if (window.__docsChat) return
  window.__docsChat = true

  var REPO = 'https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/blob/main/'
  var MODES = {
    docs: {
      url: '/__chat', store: 'docs-chat:history', title: '문서 챗봇', sub: 'PRD · ADR · intent.md · 읽기 전용', wait: '문서를 찾는 중…',
      hint: '이 repo 의 <b>PRD·티켓·ADR·intent.md</b> 를 읽고 답합니다. 문서를 고치지는 않습니다.\n\n' +
        '예) "내력벽 정보가 없으면 편집은 어떻게 돼?"\n    "D10 이 걸린 티켓들 알려줘"\n    "OE-BIM-12 수용 기준은?"\n\n' +
        '<b>/issue 요청</b> 으로 보내면 문서·소스를 읽고 GitHub 이슈를 바로 올립니다(라벨도 붙입니다).\n' +
        '예) "/issue 1280 폭에서 편집 툴바의 마지막 편집 이름이 안 보여요"',
    },
    onto: {
      url: '/__ask', store: 'onto-chat:history', title: '온톨로지 질의', sub: '반영한 온톨로지 · 지금 화면(반영 전) · 읽기 전용', wait: '온톨로지를 읽는 중…',
      hint: '[구축하기]·[반영하기] 한 건물 온톨로지를 읽고 답합니다. 건물에서 "지금 화면 (반영 전)" 을 고르면 반영하지 않은 편집까지 본 온톨로지로 답합니다.\n' +
        '답 끝에 쓴 질의가 붙어 다시 돌려 확인할 수 있고,\n' +
        '받는 쪽 DT 파서가 읽지 않는 정보(면적·방번호 같은 ex: 속성)로 답했으면 그렇게 알려 줍니다.\n' +
        '답의 id 옆 [3D] 를 누르면 내보낸 파일 뷰어가 그 반영본을 열고 그 요소를 고릅니다.\n' +
        '편집 화면에서는 답이 끝나면 답의 대상을 열어 둔 BIM 의 3D 에서 골라 그 자리로 가고(🎯 3D 동작), [여기] 로 하나씩 갈 수 있습니다.\n\n' +
        '예) "AHU-1 은 어느 방에 있어?"\n    "2층 회의실에 있는 설비는?"\n    "이 공조기가 공기를 보내는 방은?"\n    "A101호는 어느 층이야?"',
    },
  }
  var mode = 'docs'
  try { mode = sessionStorage.getItem('docs-chat:mode') === 'onto' ? 'onto' : 'docs' } catch (e) { mode = 'docs' }
  var history = load()
  var source = ''
  // "지금 화면 (반영 전)"(ADR-0050). 고르면 묻기 전에 편집 화면(App.vue 의 window.__oe)이 만든 TTL 을 /__ask/screen 에 올리고,
  // 그 토큰으로 묻는다. 토큰은 페이지를 열 때마다 새로 만든다 — sessionStorage 에 두면 탭을 복제했을 때 두 탭이 같은 토큰으로
  // 서로의 화면을 덮어썼다. 올린 TTL 이 같으면 다시 올리지 않지만, 한 시간이 지나면 다시 올린다(서버는 2시간 안 쓰면 지운다).
  var SCREEN = '__screen__'
  var screenToken = Array.from(crypto.getRandomValues(new Uint8Array(24)), function (b) { return 'abcdefghijklmnopqrstuvwxyz0123456789'[b % 36] }).join('')
  var screenSent = ''
  var screenSentAt = 0
  function hasScreen() { return !!(window.__oe && window.__oe.screen) }
  /** 앱이 알려 주는 지금 화면(App.vue 의 viewForChat). 앱이 없거나(문서 뷰어) 깨지면 보내지 않는다 — 질문은 그대로 간다. */
  function currentView() {
    try { return window.__oe && window.__oe.view ? window.__oe.view() || undefined : undefined } catch (e) { return undefined }
  }
  /** 지금 화면의 TTL 을 올리고 source 를 돌려준다. 같은 글이면 다시 올리지 않는다(길이 + FNV-1a). */
  function uploadScreen() {
    var shot = hasScreen() ? window.__oe.screen() : null
    if (!shot) return Promise.reject(new Error('편집 화면에 연 건물이 없다 — BIM 을 먼저 연다'))
    var h = 2166136261
    for (var i = 0; i < shot.ttl.length; i++) { h ^= shot.ttl.charCodeAt(i); h = Math.imul(h, 16777619) }
    var sig = shot.title + '|' + shot.ttl.length + '|' + (h >>> 0)
    if (sig === screenSent && Date.now() - screenSentAt < 60 * 60 * 1000) return Promise.resolve('screen-' + screenToken)
    var q = '?token=' + screenToken + '&title=' + encodeURIComponent(shot.title || '') + '&by=' + encodeURIComponent(shot.by || '')
    return fetch('/__ask/screen' + q, { method: 'POST', headers: { 'content-type': 'text/turtle; charset=utf-8' }, body: shot.ttl })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok) throw new Error(j.error || ('HTTP ' + r.status)); return j }) })
      .then(function (j) { screenSent = sig; screenSentAt = Date.now(); return j.source })
  }
  var root, list, input, sendBtn, status, title, sub, picker, busy = null

  function load() {
    try { return JSON.parse(sessionStorage.getItem(MODES[mode].store) || '[]') } catch (e) { return [] }
  }

  /** 건물(source) → { key, version }. 반영본이면 key 가 있어 답의 id 를 내보낸 파일 뷰어로 잇는다. */
  var sourceInfo = {}
  /**
   * [온톨로지] 답의 `ex:…` 옆에 [여기]·[3D].
   *   [여기] 편집 화면(index.html)이 window.__editor3d 를 열어 두었으면 — 그 화면의 3D 에서 그 요소를 고르고 그 자리로 간다(ADR-0063).
   *          열어 둔 BIM 에 없는 id 면 칩이 그렇게 알린다. 브라우저 안에서만 오가고 서버로는 아무것도 보내지 않는다.
   *   [3D]   그 버전의 TTL·GeoJSON 을 뷰어(viewer.html)로 열고 그 요소를 고른다(ADR-0050).
   */
  function linkIds(html, src) {
    var s = sourceInfo[src]
    var here = !!window.__editor3d
    if ((!s || !s.key) && !here) return html
    return html.replace(/<code>ex:([^<\s]+)<\/code>/g, function (all, id) {
      var local = id.replace(/\\(.)/g, '$1')
      var out = all
      if (here) out += ' <a href="#" data-a="here" data-id="' + esc(local) + '" title="이 편집 화면의 3D 에서 이 요소를 고릅니다">여기</a>'
      if (s && s.key) {
        var href = 'viewer.html?key=' + encodeURIComponent(s.key) + '&v=' + encodeURIComponent(s.version) + '&select=' + encodeURIComponent(local)
        out += ' <a href="' + href + '" target="_blank" rel="noopener" title="내보낸 파일 뷰어에서 이 요소 보기">3D</a>'
      }
      return out
    })
  }
  /** 답 글에 나온 `ex:…` id(이스케이프를 푼 로컬 이름). 같은 것은 한 번. */
  function idsOf(text) {
    var seen = {}
    var out = []
    String(text).replace(/ex:((?:\\.|[A-Za-z0-9_$\-.가-힣])+)/g, function (_, id) {
      var local = id.replace(/\.+$/, '').replace(/\\(.)/g, '$1')
      if (local && !seen[local]) { seen[local] = true; out.push(local) }
      return _
    })
    return out
  }
  /**
   * 편집 화면 3D 를 움직이고 무엇을 했는지 칩으로 남긴다(에테리온 데모의 "뷰어 동작" 칩). `after` 가 있으면 그 말 바로 뒤에 붙인다.
   * 편집 화면이 아니면(viewer.html 등) 아무것도 안 한다.
   */
  function act(ids, after) {
    if (!window.__editor3d || !ids.length) return
    var r
    try { r = window.__editor3d.show(ids) } catch (e) { return }
    var found = r.equipment + r.spaces + r.storeys
    var d = document.createElement('div')
    d.className = 'act' + (found ? '' : ' none')
    d.innerHTML = '🎯 3D 동작 · ' + esc(r.label) +
      (found ? ' <a href="#" data-a="again" data-ids="' + esc(JSON.stringify(ids)) + '" title="같은 대상으로 다시 갑니다">다시 보기</a>' : '')
    // 그 말 뒤에 이미 붙은 칩이 있으면 그 칩들 뒤에 — 위에서 아래로 한 일 순서다
    if (after && after.parentNode === list) {
      var at = after
      while (at.nextSibling && at.nextSibling.classList && at.nextSibling.classList.contains('act')) at = at.nextSibling
      list.insertBefore(d, at.nextSibling)
    } else list.appendChild(d)
    list.scrollTop = list.scrollHeight
  }
  function renderBot(t) { return mode === 'onto' ? linkIds(render(hidePlan(t.text)), t.source) : render(t.text) }
  // 말로 편집 시키기(ADR-0060). gemini 가 답 끝에 붙인 ```oe-edit 블록(JSON)은 글로 보이지 않고, 아래 상자에 사람이 읽을 줄과 [적용] 이 뜬다.
  // 미리보기·적용은 편집 화면(App.vue 의 window.__oe.plan·apply)이 한다 — 이 창은 글을 넘기고 결과를 보일 뿐이다.
  function hidePlan(t) { return String(t).replace(/```oe-edit[\s\S]*?(```|$)/g, '') }
  function showPlan(bot, text) {
    if (!window.__oe || !window.__oe.plan) return
    var p = window.__oe.plan(text)
    if (!p) return
    var box = document.createElement('div')
    box.className = 'plan'
    if (p.error) { box.innerHTML = '<span class="err">⚠ 편집 계획: ' + esc(p.error) + '</span>'; bot.appendChild(box); return }
    var ok = p.preview.every(function (x) { return x.ok })
    box.innerHTML = '<b>편집 계획</b>' + (p.editing ? '' : ' <span class="hint">— [편집] 을 누른 뒤 적용합니다</span>') +
      '<ol>' + p.preview.map(function (x) { return '<li class="' + (x.ok ? '' : 'err') + '">' + esc(x.text) + '</li>' }).join('') + '</ol>' +
      '<button data-plan="apply"' + (ok ? '' : ' disabled title="찾지 못한 대상이 있어 적용하지 않습니다"') + '>적용</button>'
    box.querySelector('[data-plan=apply]').addEventListener('click', function (e) {
      var results = window.__oe.apply(text)
      var done = results.every(function (r) { return r.ok })
      box.insertAdjacentHTML('beforeend', '<ul>' + results.map(function (r) { return '<li class="' + (r.ok ? 'ok' : 'err') + '">' + (r.ok ? '✔ ' : '⚠ ') + esc(r.text) + '</li>' }).join('') + '</ul>' +
        (done ? '<span class="hint">편집 화면의 되돌리기(Ctrl+Z)로 하나씩 되돌립니다</span>' : ''))
      // 적용했거나 편집 모드가 아니라서 막힌 것이 아니면 다시 누르지 못하게 한다(두 번 더하지 않게).
      if (done || results.some(function (r) { return r.ok })) e.target.disabled = true
      list.scrollTop = list.scrollHeight
    })
    bot.appendChild(box)
    list.scrollTop = list.scrollHeight
  }

  var css = [
    '#docs-chat{position:fixed;right:16px;bottom:16px;width:min(460px,calc(100vw - 32px));height:min(680px,calc(100vh - 32px));',
    'display:flex;flex-direction:column;z-index:2147483000;background:#14181f;color:#e6e8eb;border:1px solid #2d3440;',
    'border-radius:10px;box-shadow:0 12px 40px rgba(0,0,0,.45);font:13px/1.55 system-ui,"Malgun Gothic",sans-serif}',
    '#docs-chat header{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid #2d3440;flex-wrap:wrap}',
    '#docs-chat header b{font-size:14px}#docs-chat header small{color:#8b94a3;flex:1}',
    '#docs-chat button{background:#232a35;color:#e6e8eb;border:1px solid #333c4a;border-radius:6px;padding:3px 9px;cursor:pointer;font:inherit}',
    '#docs-chat button:hover{background:#2c3543}#docs-chat button:disabled{opacity:.5;cursor:default}',
    '#docs-chat .tabs{display:flex;gap:4px;width:100%;min-width:0}#docs-chat .tabs button{flex:none;white-space:nowrap}',
    '#docs-chat .tabs button[aria-pressed=true]{background:#1f3a5a;border-color:#3d6ea3}',
    '#docs-chat select{background:#0f1218;color:#e6e8eb;border:1px solid #333c4a;border-radius:6px;padding:2px 6px;font:inherit;flex:1;min-width:0;text-overflow:ellipsis}',
    '#docs-chat .list{flex:1;overflow:auto;padding:12px;display:flex;flex-direction:column;gap:10px}',
    '#docs-chat .msg{padding:8px 10px;border-radius:8px;white-space:pre-wrap;word-break:break-word}',
    '#docs-chat .user{align-self:flex-end;background:#1f3a5a;max-width:85%}',
    '#docs-chat .bot{background:#1b2029;border:1px solid #262d38}',
    '#docs-chat .tool{color:#8b94a3;font-size:12px;padding:0 4px;word-break:break-all}',
    '#docs-chat .err{color:#ff8a80}',
    '#docs-chat .act{align-self:flex-start;font-size:12px;padding:3px 9px;border-radius:999px;background:#1d3324;border:1px solid #2f5a3c;color:#b9e6c4}',
    '#docs-chat .act.none{background:#262d38;border-color:#333c4a;color:#8b94a3}',
    '#docs-chat .plan{margin-top:8px;padding:8px 10px;border:1px solid #3a4a60;border-radius:8px;background:#18202b}',
    '#docs-chat .plan ol,#docs-chat .plan ul{margin:6px 0 6px 18px;padding:0}#docs-chat .plan .ok{color:#9be29b}',
    '#docs-chat code{background:#262d38;padding:0 4px;border-radius:4px;font:12px ui-monospace,Consolas,monospace}',
    '#docs-chat pre{background:#0f1218;padding:8px;border-radius:6px;overflow:auto;margin:4px 0}',
    '#docs-chat pre code{background:none;padding:0}',
    '#docs-chat a{color:#7cb7ff}',
    '#docs-chat .hint{color:#8b94a3;font-size:12px;white-space:pre-wrap}',
    '#docs-chat footer{display:flex;gap:8px;padding:10px 12px;border-top:1px solid #2d3440}',
    '#docs-chat textarea{flex:1;resize:none;height:54px;background:#0f1218;color:#e6e8eb;border:1px solid #333c4a;border-radius:6px;',
    'padding:6px 8px;font:inherit}',
  ].join('')

  function esc(s) {
    return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] })
  }

  // 마크다운은 조금만: 코드 블록·`코드`·**굵게**·제목, 그리고 문서 경로는 GitHub main 의 그 파일로 잇는다.
  function render(md) {
    var parts = String(md).split(/```[^\n]*\n?/)
    return parts.map(function (p, i) {
      if (i % 2) return '<pre><code>' + esc(p.replace(/\n$/, '')) + '</code></pre>'
      return esc(p)
        .replace(/`([^`\n]+)`/g, function (_, c) { return '<code>' + linkPath(c) + '</code>' })
        .replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')
        .replace(/^#{1,6} (.*)$/gm, '<b>$1</b>')
        .replace(/(^|[\s(])((?:docs\/[\w./가-힣-]+|intent|CLAUDE)\.md)(?![^<]*<\/(?:a|code)>)/g, function (_, pre, path) { return pre + linkPath(path) })
        // /issue 답의 이슈 주소(github.sec 만). 다른 주소는 글자 그대로 둔다 — 답 글이 아무 곳으로나 가는 링크를 만들지 않게.
        .replace(/(^|[\s(])(https:\/\/github\.sec\.samsung\.net\/[\w./#?=&-]+)/g, function (_, pre, url) { return pre + '<a href="' + url + '" target="_blank" rel="noopener">' + url + '</a>' })
    }).join('')
  }
  function linkPath(s) {
    var m = /^((?:docs\/[\w./가-힣-]+|intent|CLAUDE)\.md)(.*)$/.exec(s)
    return m ? '<a href="' + REPO + encodeURI(m[1]) + '" target="_blank" rel="noopener">' + m[1] + '</a>' + m[2] : s
  }

  var TOOL_LABEL = {
    docs_map: '🗺️ 지도', docs_search: '🔎 찾기', docs_read: '📖 읽기', docs_ticket: '🎫 티켓', docs_links: '🔗 언급처',
    code_files: '📁 파일', code_search: '🔎 소스 찾기', code_read: '📄 소스 읽기', 'gh issue create': '📮 이슈 올리기',
    onto_sources: '🏢 건물', onto_overview: '🗺️ 한눈에', onto_find: '🔎 찾기', onto_describe: '📇 관계', onto_walk: '🧭 따라가기', onto_query: '🧮 질의',
  }
  function toolLine(name, args) {
    var a = args || {}
    var what = a.query || [a.path, a.section].filter(Boolean).join(' > ') || a.ref ||
      [a.text, a.cls, a.id, a.predicate, a.direction].filter(Boolean).join(' · ') || a.patterns || ''
    return (TOOL_LABEL[name] || '🔧 ' + name) + (what ? ' · ' + what : '')
  }

  function add(cls, html) {
    var d = document.createElement('div')
    d.className = cls
    d.innerHTML = html
    list.appendChild(d)
    list.scrollTop = list.scrollHeight
    return d
  }

  function redraw() {
    list.innerHTML = ''
    if (!history.length) add('hint', MODES[mode].hint)
    history.forEach(function (t) { add('msg ' + (t.role === 'user' ? 'user' : 'bot'), t.role === 'user' ? esc(t.text) : renderBot(t)) })
  }

  function save() { try { sessionStorage.setItem(MODES[mode].store, JSON.stringify(history.slice(-20))) } catch (e) { /* 가득 차면 버린다 */ } }

  function setBusy(b) {
    busy = b
    sendBtn.textContent = b ? '멈추기' : '보내기'
    input.disabled = !!b
    if (!b) input.focus()
  }

  function ask() {
    if (busy) { busy.abort(); return }
    var q = input.value.trim()
    if (!q) return
    input.value = ''
    var prior = history.slice()
    history.push({ role: 'user', text: q })
    save()
    add('msg user', esc(q))
    var bot = add('msg bot', '<span class="hint">' + (mode === 'docs' && /^\/issue(\s|$)/.test(q) ? '문서·소스를 읽고 이슈를 쓰는 중…' : MODES[mode].wait) + '</span>')
    var text = ''
    var started = Date.now()
    var ctl = new AbortController()
    var asked = mode
    // 문서 칸의 `/issue 요청` 은 /__issue 로 간다(scripts/issue-chat.mjs). 문서를 읽어 이슈 초안을 쓰고 서버가 바로 올린다.
    var issue = mode === 'docs' && /^\/issue(\s|$)/.test(q)
    var askedSource = mode === 'onto' ? source : undefined
    // 물은 때의 화면이다. 화면 TTL 을 올리는 동안 사용자가 다른 층으로 옮겨도 질문은 그때 보던 것을 가리킨다.
    var askedView = mode === 'onto' ? currentView() : undefined
    setBusy(ctl)

    var ready = askedSource === SCREEN
      ? (bot.innerHTML = '<span class="hint">지금 화면의 온톨로지를 올리는 중…</span>', uploadScreen().then(function (src) { bot.innerHTML = '<span class="hint">' + MODES.onto.wait + '</span>'; return src }))
      : Promise.resolve(askedSource)
    ready.then(function (src) {
      if (issue) {
        var req = q.replace(/^\/issue\s*/, '')
        if (!req) throw new Error('/issue 뒤에 무엇을 이슈로 할지 적어 주세요')
        return fetch('/__issue', {
          method: 'POST', signal: ctl.signal,
          headers: { 'content-type': 'application/json' },
          // 지금 화면(보는 층·고른 것 id)과 다시 여는 주소(위치 표시 옆 [링크 복사] 와 같은 것)를 같이 보낸다. 서버가 거른다.
          // 앞선 대화는 보내지 않는다 — 이슈에는 이 요청만 들어간다(서버도 붙이지 않는다).
          body: JSON.stringify({ question: req, view: currentView(), link: location.href }),
        })
      }
      return fetch(MODES[asked].url, {
        method: 'POST', signal: ctl.signal,
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ question: q, history: prior, source: src, view: askedView }),
      })
    }).then(function (res) {
      if (!res.ok) return res.json().catch(function () { return {} }).then(function (j) { throw new Error(j.error || ('HTTP ' + res.status)) })
      var reader = res.body.getReader()
      var dec = new TextDecoder()
      var buf = ''
      function pump() {
        return reader.read().then(function (r) {
          if (r.done) return
          buf += dec.decode(r.value, { stream: true })
          var nl
          while ((nl = buf.indexOf('\n')) >= 0) {
            var line = buf.slice(0, nl)
            buf = buf.slice(nl + 1)
            if (line.trim()) onEvent(JSON.parse(line))
          }
          return pump()
        })
      }
      return pump()
    }).catch(function (e) {
      if (e.name === 'AbortError') onEvent({ type: 'error', message: '멈췄다' })
      else onEvent({ type: 'error', message: e.message })
    }).then(function () {
      // 답하는 중에 칸을 바꿨으면 답은 원래 칸의 기록에 남긴다
      if (text && asked === mode) { history.push({ role: 'assistant', text: text, source: askedSource }); save() }
      // [온톨로지] 답이 끝나면 답의 대상을 편집 화면 3D 에서 고르고 그 자리로 간다(편집 화면일 때만, ADR-0063)
      if (text && asked === 'onto' && asked === mode) act(idsOf(text), bot)
      else if (!text && !bot.querySelector('.err')) bot.innerHTML = '<span class="err">답이 비었다</span>'
      if (text && asked === 'onto') showPlan(bot, text)
      status.textContent = ((Date.now() - started) / 1000).toFixed(1) + '초'
      setBusy(null)
    })

    function onEvent(ev) {
      if (ev.type === 'tool') {
        if (bot.parentNode === list) list.insertBefore(Object.assign(document.createElement('div'), { className: 'tool', textContent: toolLine(ev.name, ev.args) }), bot)
      } else if (ev.type === 'text') {
        text = ev.delta === false ? ev.text : text + ev.text
        bot.innerHTML = asked === 'onto' ? linkIds(render(hidePlan(text)), askedSource) : render(text)
      } else if (ev.type === 'error' || ev.type === 'tool_error') {
        var hint = bot.querySelector('.hint')
        if (hint) hint.remove()
        bot.insertAdjacentHTML('beforeend', (bot.textContent ? '\n' : '') + '<span class="err">⚠ ' + esc(ev.message) + '</span>')
      }
      list.scrollTop = list.scrollHeight
    }
  }

  /** 지금 칸의 서버가 되는지 묻고, [온톨로지] 칸이면 건물 목록을 채운다. */
  function check() {
    input.disabled = false
    sendBtn.disabled = false
    picker.style.display = mode === 'onto' ? '' : 'none'
    var want = mode
    fetch(MODES[mode].url).then(function (r) { return r.json() }).then(function (j) {
      if (want !== mode) return
      if (!j.enabled) {
        add('msg bot', '<span class="err">이 서버에서는 챗봇을 쓸 수 없다: ' + esc(j.reason || '') + '</span>')
        input.disabled = true
        sendBtn.disabled = true
        return
      }
      if (mode === 'onto') {
        var list_ = j.sources || []
        list_.forEach(function (s) { sourceInfo[s.source] = { key: s.key, version: s.version } })
        // 기록의 답은 목록이 오기 전에 그렸다 — [3D] 링크를 붙이려고 한 번 더 그린다
        if (history.length) redraw()
        var options = list_.map(function (s) {
          return '<option value="' + esc(s.source) + '">' + esc(s.title + (s.version ? ' · v' + s.version : '') + (s.at ? ' · ' + String(s.at).slice(0, 10) : '')) + '</option>'
        })
        // 편집 화면이 있는 곳(8084)이면 맨 앞에 "지금 화면". 내보낸 파일 뷰어(viewer.html)에는 없다.
        if (hasScreen()) options.unshift('<option value="' + SCREEN + '">지금 화면 (반영 전)</option>')
        picker.innerHTML = options.length ? options.join('') : '<option value="">반영한 건물이 없다 — 편집 화면에서 [구축하기]·[반영하기]</option>'
        var ok = source === SCREEN ? hasScreen() : list_.some(function (s) { return s.source === source })
        if (!ok) source = list_.length ? list_[0].source : hasScreen() ? SCREEN : ''
        picker.value = source
      }
    }).catch(function () {
      add('msg bot', '<span class="err">' + MODES[mode].url + ' 이 없다 — 55 의 8084·8087 에서만 된다</span>')
      input.disabled = true
      sendBtn.disabled = true
    })
  }

  function setMode(m) {
    if (m === mode) return
    if (busy) busy.abort()
    mode = m
    try { sessionStorage.setItem('docs-chat:mode', mode) } catch (e) { /* 그냥 둔다 */ }
    history = load()
    title.textContent = MODES[mode].title
    sub.textContent = MODES[mode].sub
    root.querySelectorAll('.tabs button').forEach(function (b) { b.setAttribute('aria-pressed', String(b.getAttribute('data-a') === 'mode-' + mode)) })
    redraw()
    check()
  }

  function build() {
    var style = document.createElement('style')
    style.textContent = css
    document.head.appendChild(style)
    root = document.createElement('div')
    root.id = 'docs-chat'
    root.innerHTML = '<header><div class="tabs"><button data-a="mode-docs" aria-pressed="' + (mode === 'docs') + '">문서</button>' +
      '<button data-a="mode-onto" aria-pressed="' + (mode === 'onto') + '">온톨로지</button>' +
      '<select title="물어볼 건물(반영한 레이아웃의 현재 버전)"></select></div>' +
      '<b></b><small></small>' +
      '<span class="st hint"></span><button data-a="new" title="대화 지우기">새 대화</button><button data-a="close" title="Alt+Shift+K">✕</button></header>' +
      '<div class="list"></div><footer><textarea placeholder="물어보세요 (Enter 보내기 · Shift+Enter 줄바꿈 · Esc 닫기)"></textarea>' +
      '<button data-a="send">보내기</button></footer>'
    document.body.appendChild(root)
    list = root.querySelector('.list')
    input = root.querySelector('textarea')
    sendBtn = root.querySelector('[data-a=send]')
    status = root.querySelector('.st')
    title = root.querySelector('header b')
    sub = root.querySelector('header small')
    picker = root.querySelector('select')
    title.textContent = MODES[mode].title
    sub.textContent = MODES[mode].sub
    picker.addEventListener('change', function () { source = picker.value })
    root.addEventListener('click', function (e) {
      var a = e.target.getAttribute && e.target.getAttribute('data-a')
      if (a === 'send') ask()
      if (a === 'close') toggle(false)
      if (a === 'new') { if (busy) busy.abort(); history = []; save(); redraw() }
      if (a === 'mode-docs') setMode('docs')
      if (a === 'mode-onto') setMode('onto')
      if (a === 'here' || a === 'again') {
        e.preventDefault()
        var ids = a === 'here' ? [e.target.getAttribute('data-id')] : JSON.parse(e.target.getAttribute('data-ids') || '[]')
        act(ids, e.target.closest('.msg, .act'))
      }
    })
    // 창 안의 키는 앱으로 보내지 않는다(Delete·방향키·Ctrl+Z 가 3D 편집을 건드리지 않게)
    root.addEventListener('keydown', function (e) {
      if (e.altKey && e.shiftKey && e.code === 'KeyK') return
      e.stopPropagation()
      if (e.key === 'Escape') { toggle(false); return }
      if (e.target === input && e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); ask() }
    })
    redraw()
    check()
  }

  var isOpen = false
  function toggle(show) {
    if (!root) build()
    var open = show === undefined ? !isOpen : show
    isOpen = open
    root.style.display = open ? 'flex' : 'none'
    if (open && !input.disabled) input.focus()
  }

  window.addEventListener('keydown', function (e) {
    if (e.altKey && e.shiftKey && !e.ctrlKey && !e.metaKey && e.code === 'KeyK') {
      e.preventDefault()
      e.stopPropagation()
      toggle()
    }
  }, true)
  console.info('[docs-chat] Alt+Shift+K 로 챗봇 열기 — [문서] · [온톨로지]')
})()
