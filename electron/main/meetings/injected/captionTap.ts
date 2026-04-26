/**
 * Caption tap injected into the Google Meet page via Playwright's
 * `addInitScript`. Posts every utterance back to the host process via
 * `window.wosCaption(...)` (exposed binding).
 *
 * Design notes (April 2026):
 *  - There is NO public Meet caption API; we must scrape the DOM. The most
 *    stable container has been `[jsname="tgaKEf"]` for the past several
 *    months — we anchor on that and skip everything else.
 *  - Earlier versions of this script also harvested `[aria-live="polite"]
 *    span` and `[class*="KcIKyf"]`, which dragged in icon-font ligatures
 *    ("mic_none", "videocam") plus device-name announcements ("MacBook Pro
 *    Microphone (Built-in)"). That noise polluted both the live captions
 *    panel AND the post-meeting transcript. Fixed by tightening selectors
 *    AND filtering Material Icons text nodes by their parent class.
 *  - We never auto-press the 'c' key any more — it's flaky (often fires
 *    before Meet has bound the shortcut) and leaks into focused text fields.
 *    Instead we observe passively and let the user toggle CC themselves; if
 *    no captions arrive within 8s we surface a UI hint.
 */
export const CAPTION_TAP_SCRIPT = `
(() => {
  if (window.__wosCaptionTapInstalled) return;
  window.__wosCaptionTapInstalled = true;

  // Anchor selector — the live caption strip in current Meet builds. If Google
  // changes this we need to adapt; everything else is too noisy.
  const CAPTION_CONTAINER_SELECTORS = [
    '[jsname="tgaKEf"]',
    'div[role="region"][aria-label*="captions" i]',
    'div[role="region"][aria-label*="Captions" i]',
  ];

  // Material Icons text nodes (icon ligatures rendered as text) and obvious
  // device-name strings we never want in the transcript.
  const NOISE_PATTERNS = [
    /\\bmic_none\\b/, /\\bmic_off\\b/, /\\bvideocam\\b/, /\\bvideocam_off\\b/,
    /\\bclosed_caption\\b/, /\\bvolume_/, /\\bspeaker\\b/i,
    /\\b(MacBook|AirPods|Bluetooth|HDMI|Built-in)\\b/i,
    /^\\s*$/,
  ];

  function isNoise(text) {
    if (!text || text.length < 3) return true;
    for (const re of NOISE_PATTERNS) if (re.test(text)) return true;
    return false;
  }

  function isInsideIcon(node) {
    let el = node;
    while (el && el !== document.body) {
      if (el.classList && (
        el.classList.contains('material-icons') ||
        el.classList.contains('material-symbols-outlined') ||
        el.classList.contains('google-symbols')
      )) return true;
      const tag = (el.tagName || '').toLowerCase();
      if (tag === 'i' || tag === 'svg') return true;
      el = el.parentElement;
    }
    return false;
  }

  function findContainers() {
    const out = [];
    for (const sel of CAPTION_CONTAINER_SELECTORS) {
      for (const el of document.querySelectorAll(sel)) out.push(el);
    }
    return out;
  }

  function extract() {
    const containers = findContainers();
    if (!containers.length) return '';
    const parts = [];
    for (const container of containers) {
      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, null);
      let node;
      while ((node = walker.nextNode())) {
        if (isInsideIcon(node.parentElement)) continue;
        const text = (node.textContent || '').trim();
        if (!text || isNoise(text)) continue;
        parts.push(text);
      }
    }
    return parts.join(' ').replace(/\\s+/g, ' ').trim();
  }

  let last = '';
  let buffer = [];
  let timer = null;
  let firstCaptionAt = 0;

  function flush() {
    if (!buffer.length || typeof window.wosCaption !== 'function') return;
    const text = buffer.join(' ').replace(/\\s+/g, ' ').trim();
    buffer = [];
    if (!text || isNoise(text)) return;
    if (!firstCaptionAt) firstCaptionAt = Date.now();
    window.wosCaption({ text: text, timestamp: Date.now(), url: location.href });
  }

  const observer = new MutationObserver(() => {
    const text = extract();
    if (!text || text === last || isNoise(text)) return;
    last = text;
    buffer.push(text);
    if (timer) clearTimeout(timer);
    timer = setTimeout(flush, 800);
  });

  function ensureRecordingBanner() {
    if (document.getElementById('__wos_recording_banner')) return;
    const banner = document.createElement('div');
    banner.id = '__wos_recording_banner';
    banner.textContent = 'WOS is transcribing this meeting locally on the host machine.';
    Object.assign(banner.style, {
      position: 'fixed',
      top: '0',
      left: '0',
      right: '0',
      zIndex: '2147483647',
      padding: '6px 12px',
      background: '#dc2626',
      color: '#fff',
      font: '600 12px/1.4 system-ui, -apple-system, sans-serif',
      letterSpacing: '0.02em',
      textAlign: 'center',
      pointerEvents: 'none',
      boxShadow: '0 2px 8px rgba(0,0,0,0.25)',
    });
    (document.body || document.documentElement).appendChild(banner);
  }

  function ensureCaptionsHint() {
    if (firstCaptionAt) return;
    if (document.getElementById('__wos_captions_hint')) return;
    const hint = document.createElement('div');
    hint.id = '__wos_captions_hint';
    hint.textContent = 'Tip: click "CC" in the Meet toolbar to enable captions for transcript capture.';
    Object.assign(hint.style, {
      position: 'fixed',
      bottom: '12px',
      left: '50%',
      transform: 'translateX(-50%)',
      zIndex: '2147483647',
      padding: '8px 14px',
      background: 'rgba(17,24,39,0.92)',
      color: '#fff',
      borderRadius: '999px',
      font: '500 12px/1.4 system-ui, -apple-system, sans-serif',
      boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
      pointerEvents: 'none',
    });
    (document.body || document.documentElement).appendChild(hint);
    setTimeout(() => { try { hint.remove(); } catch {} }, 12000);
  }

  function postChatNoticeOnce() {
    try {
      if (window.sessionStorage.getItem('__wos_chat_notice_posted') === '1') return false;
    } catch { /* sessionStorage may be blocked */ }
    const compose = document.querySelector('textarea[aria-label*="message" i], textarea[aria-label*="chat" i], div[contenteditable="true"][aria-label*="message" i]');
    if (!compose) return false;
    const text = 'Heads up: WOS is transcribing this meeting locally on my machine for note-taking. Let me know if you would like me to stop.';
    if (compose.tagName === 'TEXTAREA') {
      compose.focus();
      compose.value = text;
      compose.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      compose.focus();
      document.execCommand && document.execCommand('insertText', false, text);
    }
    try { window.sessionStorage.setItem('__wos_chat_notice_posted', '1'); } catch { /* ignore */ }
    return true;
  }

  function install() {
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    ensureRecordingBanner();
    setTimeout(ensureCaptionsHint, 8000);
    setInterval(ensureRecordingBanner, 4000);
    let chatTries = 0;
    const chatTimer = setInterval(() => {
      chatTries++;
      if (chatTries > 20) { clearInterval(chatTimer); return; }
      if (postChatNoticeOnce() === true) clearInterval(chatTimer);
    }, 3000);
  }

  if (document.body) install();
  else window.addEventListener('DOMContentLoaded', install, { once: true });
})();
`
