// 문서 챗봇 창. Alt+Shift+K 로 열고 닫는다. 55 의 gemini 가 이 repo 의 PRD·티켓·ADR·intent.md 를 읽고 답한다(ADR-0001).
//
// 앱 코드(src)가 아니다. scripts/run.sh build 가 빌드한 dist/ 에 끼워 넣는다(review-info.js 와 같은 방식) —
// 그래서 개발 서버(5174)에는 없고, 8084·8087 에는 있다. 서버 쪽은 같은 주소의 /__chat(scripts/docs-chat.mjs).
// 앱 상태(열어 둔 BIM, 고른 요소)는 보내지 않는다. 질문과 앞선 대화만 보낸다.
//
// 키는 e.code 로 본다 — 한글 입력 상태면 e.key 가 'ㅏ' 가 된다. 앱의 단축키는 Alt 조합을 받지 않아 겹치지 않고,
// 창 안의 키 입력은 창에서 끊어서 앱 단축키(Delete, 방향키 …)로 새지 않는다.
;(function () {
  if (window.__docsChat) return
  window.__docsChat = true

  var REPO = 'https://github.sec.samsung.net/IoT-Solution/bim-to-dt-ontology/blob/main/'
  var STORE = 'docs-chat:history'
  var history = []
  try { history = JSON.parse(sessionStorage.getItem(STORE) || '[]') } catch (e) { history = [] }
  var root, list, input, sendBtn, status, busy = null

  var css = [
    '#docs-chat{position:fixed;right:16px;bottom:16px;width:min(460px,calc(100vw - 32px));height:min(680px,calc(100vh - 32px));',
    'display:flex;flex-direction:column;z-index:2147483000;background:#14181f;color:#e6e8eb;border:1px solid #2d3440;',
    'border-radius:10px;box-shadow:0 12px 40px rgba(0,0,0,.45);font:13px/1.55 system-ui,"Malgun Gothic",sans-serif}',
    '#docs-chat header{display:flex;align-items:center;gap:8px;padding:10px 12px;border-bottom:1px solid #2d3440}',
    '#docs-chat header b{font-size:14px}#docs-chat header small{color:#8b94a3;flex:1}',
    '#docs-chat button{background:#232a35;color:#e6e8eb;border:1px solid #333c4a;border-radius:6px;padding:3px 9px;cursor:pointer;font:inherit}',
    '#docs-chat button:hover{background:#2c3543}#docs-chat button:disabled{opacity:.5;cursor:default}',
    '#docs-chat .list{flex:1;overflow:auto;padding:12px;display:flex;flex-direction:column;gap:10px}',
    '#docs-chat .msg{padding:8px 10px;border-radius:8px;white-space:pre-wrap;word-break:break-word}',
    '#docs-chat .user{align-self:flex-end;background:#1f3a5a;max-width:85%}',
    '#docs-chat .bot{background:#1b2029;border:1px solid #262d38}',
    '#docs-chat .tool{color:#8b94a3;font-size:12px;padding:0 4px}',
    '#docs-chat .err{color:#ff8a80}',
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
    }).join('')
  }
  function linkPath(s) {
    var m = /^((?:docs\/[\w./가-힣-]+|intent|CLAUDE)\.md)(.*)$/.exec(s)
    return m ? '<a href="' + REPO + encodeURI(m[1]) + '" target="_blank" rel="noopener">' + m[1] + '</a>' + m[2] : s
  }

  var TOOL_LABEL = { docs_map: '🗺️ 지도', docs_search: '🔎 찾기', docs_read: '📖 읽기', docs_ticket: '🎫 티켓', docs_links: '🔗 언급처' }
  function toolLine(name, args) {
    var a = args || {}
    var what = a.query || [a.path, a.section].filter(Boolean).join(' > ') || a.id || a.ref || ''
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
    if (!history.length) {
      add('hint', '이 repo 의 <b>PRD·티켓·ADR·intent.md</b> 를 읽고 답합니다. 문서를 고치지는 않습니다.\n\n' +
        '예) "내력벽 정보가 없으면 편집은 어떻게 돼?"\n    "D10 이 걸린 티켓들 알려줘"\n    "OE-BIM-12 수용 기준은?"')
    }
    history.forEach(function (t) { add('msg ' + (t.role === 'user' ? 'user' : 'bot'), t.role === 'user' ? esc(t.text) : render(t.text)) })
  }

  function save() { try { sessionStorage.setItem(STORE, JSON.stringify(history.slice(-20))) } catch (e) { /* 가득 차면 버린다 */ } }

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
    var bot = add('msg bot', '<span class="hint">문서를 찾는 중…</span>')
    var text = ''
    var started = Date.now()
    var ctl = new AbortController()
    setBusy(ctl)

    fetch('/__chat', {
      method: 'POST', signal: ctl.signal,
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ question: q, history: prior }),
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
      if (text) { history.push({ role: 'assistant', text: text }); save() }
      else if (!bot.querySelector('.err')) bot.innerHTML = '<span class="err">답이 비었다</span>'
      status.textContent = ((Date.now() - started) / 1000).toFixed(1) + '초'
      setBusy(null)
    })

    function onEvent(ev) {
      if (ev.type === 'tool') {
        list.insertBefore(Object.assign(document.createElement('div'), { className: 'tool', textContent: toolLine(ev.name, ev.args) }), bot)
      } else if (ev.type === 'text') {
        text = ev.delta === false ? ev.text : text + ev.text
        bot.innerHTML = render(text)
      } else if (ev.type === 'error' || ev.type === 'tool_error') {
        var hint = bot.querySelector('.hint')
        if (hint) hint.remove()
        bot.insertAdjacentHTML('beforeend', (bot.textContent ? '\n' : '') + '<span class="err">⚠ ' + esc(ev.message) + '</span>')
      }
      list.scrollTop = list.scrollHeight
    }
  }

  function build() {
    var style = document.createElement('style')
    style.textContent = css
    document.head.appendChild(style)
    root = document.createElement('div')
    root.id = 'docs-chat'
    root.innerHTML = '<header><b>문서 챗봇</b><small>PRD · ADR · intent.md · 읽기 전용</small>' +
      '<span class="st hint"></span><button data-a="new" title="대화 지우기">새 대화</button><button data-a="close" title="Alt+Shift+K">✕</button></header>' +
      '<div class="list"></div><footer><textarea placeholder="물어보세요 (Enter 보내기 · Shift+Enter 줄바꿈 · Esc 닫기)"></textarea>' +
      '<button data-a="send">보내기</button></footer>'
    document.body.appendChild(root)
    list = root.querySelector('.list')
    input = root.querySelector('textarea')
    sendBtn = root.querySelector('[data-a=send]')
    status = root.querySelector('.st')
    root.addEventListener('click', function (e) {
      var a = e.target.getAttribute && e.target.getAttribute('data-a')
      if (a === 'send') ask()
      if (a === 'close') toggle(false)
      if (a === 'new') { if (busy) busy.abort(); history = []; save(); redraw() }
    })
    // 창 안의 키는 앱으로 보내지 않는다(Delete·방향키·Ctrl+Z 가 3D 편집을 건드리지 않게)
    root.addEventListener('keydown', function (e) {
      if (e.altKey && e.shiftKey && e.code === 'KeyK') return
      e.stopPropagation()
      if (e.key === 'Escape') { toggle(false); return }
      if (e.target === input && e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); ask() }
    })
    redraw()
    fetch('/__chat').then(function (r) { return r.json() }).then(function (j) {
      if (!j.enabled) {
        add('msg bot', '<span class="err">이 서버에서는 챗봇을 쓸 수 없다: ' + esc(j.reason || '') + '</span>')
        input.disabled = true
        sendBtn.disabled = true
      }
    }).catch(function () {
      add('msg bot', '<span class="err">/__chat 이 없다 — 55 의 8084·8087 에서만 된다</span>')
      input.disabled = true
      sendBtn.disabled = true
    })
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
  console.info('[docs-chat] Alt+Shift+K 로 문서 챗봇 열기')
})()
