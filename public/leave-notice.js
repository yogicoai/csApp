/*
 * Yogibo 고객센터 휴무 팝업 — cafe24 에 한 번만 심는다.
 *   <script src="https://<셀프가이드 서버>/leave-notice.js" defer></script>
 * 연차 관리에 지정한 휴무 기간(며칠 전부터 상담이 다시 열릴 때까지)에만 /api/notice/leave 가 팝업 내용을 주고,
 * 그 밖에는 아무것도 띄우지 않는다. '오늘 하루 보지 않기'는 이 브라우저에 그날만 기억한다.
 * 연차 관리 화면의 미리보기도 이 스크립트를 그대로 돌려 홈페이지에 뜨는 모습을 보여 준다.
 */
(function () {
  var script = document.currentScript;
  if (!script || window.__yogiboLeaveNotice) return;
  window.__yogiboLeaveNotice = true;
  var base = new URL(script.src).origin;
  // 미리보기 — 관리 화면의 미리보기 틀(srcdoc iframe) 안에서만, 넘겨받은 내용을 받아 오지 않고 바로 띄우며 닫아도 기억하지 않는다.
  // 쇼핑몰 주소는 about:srcdoc 일 수 없고 글자(string)만 받으므로 게시글 속 요소로 흉내 낼 수 없다.
  var given = window.__yogiboLeaveNoticePreview;
  var preview =
    window.location.href === "about:srcdoc" && given && typeof given.id === "string" && typeof given.html === "string"
      ? given
      : null;

  function kstToday() {
    return new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);
  }

  function dismissedToday(key) {
    try {
      return window.localStorage.getItem(key) === kstToday();
    } catch {
      return false;
    }
  }

  function remember(key) {
    try {
      window.localStorage.setItem(key, kstToday());
    } catch {
      /* 저장이 막힌 브라우저는 닫기만 한다 */
    }
  }

  function show(notice) {
    var key = "yogibo-leave-notice:" + notice.id;
    if (!preview && dismissedToday(key)) return;

    var overlay = document.createElement("div");
    overlay.id = "yogibo-leave-notice";
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-modal", "true");
    overlay.setAttribute("aria-label", "고객센터 휴무 안내");
    overlay.style.cssText =
      "position:fixed;inset:0;z-index:2147483000;background:rgba(15,23,32,.55);display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box";

    var box = document.createElement("div");
    box.style.cssText =
      "width:100%;max-width:560px;max-height:92vh;display:flex;flex-direction:column;background:#fff;box-shadow:0 18px 50px rgba(0,0,0,.3)";

    var content = document.createElement("div");
    content.style.cssText = "overflow:auto;-webkit-overflow-scrolling:touch";
    content.innerHTML = notice.html;

    var bar = document.createElement("div");
    bar.style.cssText =
      "display:flex;border-top:1px solid #e5e9ee;font:500 14px/1 Pretendard,'Apple SD Gothic Neo','Malgun Gothic',sans-serif";

    function button(label, onClick) {
      var el = document.createElement("button");
      el.type = "button";
      el.textContent = label;
      el.style.cssText = "flex:1;padding:14px 10px;border:0;background:#fff;color:#4b5563;cursor:pointer;font:inherit";
      el.addEventListener("click", onClick);
      return el;
    }

    function close() {
      document.removeEventListener("keydown", onKey);
      overlay.remove();
    }

    function onKey(event) {
      if (event.key === "Escape") close();
    }

    var today = button("오늘 하루 보지 않기", function () {
      if (!preview) remember(key);
      close();
    });
    today.style.borderRight = "1px solid #e5e9ee";
    bar.appendChild(today);
    bar.appendChild(button("닫기", close));

    box.appendChild(content);
    box.appendChild(bar);
    overlay.appendChild(box);
    overlay.addEventListener("click", function (event) {
      if (event.target === overlay) close();
    });
    document.addEventListener("keydown", onKey);
    document.body.appendChild(overlay);
  }

  function load() {
    if (preview) return show(preview);
    fetch(base + "/api/notice/leave", { credentials: "omit" })
      .then(function (response) {
        return response.ok ? response.json() : null;
      })
      .then(function (data) {
        if (data && data.notice && data.notice.html) show(data.notice);
      })
      .catch(function () {
        /* 공지를 못 받아도 쇼핑몰 화면에는 영향이 없게 */
      });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", load);
  else load();
})();
