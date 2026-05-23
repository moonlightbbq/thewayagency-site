/* ===============================================
   THE WAY AGENCY  -  AI chat widget (shared module)
   Extracted from app.js so BOTH the marketing pages and the standalone
   intake page can load a single source. Public surface: window.TWAChat
   { init(opts), open(), toggle(), isReady(), onReady(cb) }
   opts: { autoBubble=true, autoEngage=true }
   =============================================== */
(function () {
  'use strict';
  if (window.TWAChat && window.TWAChat.__loaded) return;

  var PHONE = '(502) 413-5335';

  // Self-contained helpers (copied from app.js; no app.js dependency) ----------
  function createElement(tag, attrs, children) {
    const el = document.createElement(tag);
    if (attrs) Object.entries(attrs).forEach(([k, v]) => {
      if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
      else el.setAttribute(k, v);
    });
    if (children) {
      if (typeof children === 'string') el.innerHTML = children;
      else if (Array.isArray(children)) children.forEach(c => el.appendChild(c));
    }
    return el;
  }

  function track(event, params) {
    try {
      window.dataLayer = window.dataLayer || [];
      window.dataLayer.push(Object.assign({ event: event }, params || {}));
    } catch (e) {}
  }

  // Module-level closure handles (assigned once the widget renders) ------------
  var widget = null;
  var ready = false;
  var queuedOpen = false;

  function initChatWidget(opts) {
    opts = opts || {};

    var SAGE_API = 'https://sage.thewayagency.com';

    // Check kill switch status before rendering — hide bubble if chat is disabled
    var statusController = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var statusTimeout = setTimeout(function() { if (statusController) statusController.abort(); }, 3000);
    fetch(SAGE_API + '/api/status', statusController ? { signal: statusController.signal } : {})
      .then(function(r) { clearTimeout(statusTimeout); return r.json(); })
      .then(function(data) { if (data && data.chatEnabled === false) return; renderChatWidget(opts); })
      .catch(function() { clearTimeout(statusTimeout); /* fail closed — do not render chat */ });

    function renderChatWidget(opts) {

    var chatSessionId = localStorage.getItem('twa_chat_sid') || '';
    var chatMessages = [];
    var chatResumeData = null; // populated from /api/chat/resume
    var isSending = false;
    var isOpen = false;
    var hasOpened = false;

    // Restore message history from localStorage
    try {
      var saved = localStorage.getItem('twa_chat_messages');
      if (saved) chatMessages = JSON.parse(saved);
    } catch(e) {}

    // If we have a sessionId but no messages (e.g. cache cleared), try server resume
    if (chatSessionId && chatMessages.length === 0) {
      fetch(SAGE_API + '/api/chat/resume/' + chatSessionId)
        .then(function(r) { return r.ok ? r.json() : null; })
        .then(function(data) {
          if (data && data.messages && data.messages.length > 0) {
            chatMessages = data.messages;
            chatResumeData = data;
            saveState();
          }
        }).catch(function() {});
    }

    function saveState() {
      try {
        localStorage.setItem('twa_chat_sid', chatSessionId);
        localStorage.setItem('twa_chat_messages', JSON.stringify(chatMessages));
      } catch(e) {}
    }

    // Detect product from URL
    function detectProduct() {
      var p = location.pathname.toLowerCase();
      if (p.includes('/auto')) return 'auto';
      if (p.includes('/home') || p.includes('/homeowner')) return 'home';
      if (p.includes('/commercial') || p.includes('/business')) return 'commercial';
      if (p.includes('/life')) return 'life';
      if (p.includes('/health')) return 'health';
      if (p.includes('/renters')) return 'renters';
      return '';
    }

    // Agent name lookup
    var AGENT_NAMES = {
      'sheilia-royal': 'Sheilia Royal',
      'audrey-lillpop': 'Audrey Lillpop',
      'kelly-mccallister': 'Kelly McCallister',
      'jill-boone': 'Jill Boone'
    };

    // ─── Styles (all inline via <style> tag) ─────
    var style = document.createElement('style');
    style.textContent = [
      '.twa-cb-bubble{position:fixed;bottom:calc(20px + env(safe-area-inset-bottom, 0px));right:20px;z-index:1002;width:56px;height:56px;border-radius:50%;background:#173358;color:#fff;border:none;cursor:pointer;box-shadow:0 4px 16px rgba(0,0,0,.25);display:flex;align-items:center;justify-content:center;transition:transform .2s;-webkit-tap-highlight-color:transparent}',
      '.twa-cb-bubble:hover{transform:scale(1.08)}',
      '.twa-cb-panel{position:fixed;bottom:86px;right:20px;z-index:1003;width:360px;height:480px;max-width:calc(100% - 40px);background:#fff;border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,.18);display:none;flex-direction:column;overflow:hidden}',
      '.twa-cb-panel.open{display:flex}',
      '@media(max-width:767px){.twa-cb-panel.open{position:fixed;top:0;left:0;right:0;bottom:0;width:100%;height:100%;max-width:100%;border-radius:0;z-index:1003}.twa-cb-bubble{bottom:calc(80px + env(safe-area-inset-bottom, 0px))}.twa-cb-input{padding-bottom:env(safe-area-inset-bottom, 0px)}.twa-cb-action-btn{padding:14px 20px;font-size:15px;min-height:48px}.twa-cb-powered{display:none}}',
      '@media(max-width:767px) and (max-height:500px){.twa-cb-header{padding:8px 16px;font-size:14px}.twa-cb-msg{padding:6px 10px;font-size:13px}.twa-cb-input input{padding:8px 14px}}',
      '.twa-cb-header{background:linear-gradient(135deg,#173358,#1a4a7a);color:#fff;padding:14px 16px;font-weight:600;font-size:15px;display:flex;justify-content:space-between;align-items:center;flex-shrink:0}',
      '.twa-cb-close{background:none;border:none;color:#fff;cursor:pointer;font-size:22px;padding:10px;line-height:1;min-width:44px;min-height:44px;display:flex;align-items:center;justify-content:center;-webkit-tap-highlight-color:transparent}',
      '.twa-cb-msgs{flex:1;overflow-y:auto;padding:16px;display:flex;flex-direction:column;gap:8px;-webkit-overflow-scrolling:touch}',
      '.twa-cb-msg{max-width:85%;padding:10px 14px;border-radius:12px;font-size:14px;line-height:1.5;word-wrap:break-word;white-space:pre-wrap}',
      '.twa-cb-msg.bot{align-self:flex-start;background:#f1f5f9;color:#1e293b;border-bottom-left-radius:4px}',
      '.twa-cb-msg.user{align-self:flex-end;background:#1a6fb5;color:#fff;border-bottom-right-radius:4px}',
      '.twa-cb-msg.error{align-self:flex-start;background:#fef2f2;color:#dc2626;border:1px solid #fecaca;font-size:13px}',
      '.twa-cb-typing{align-self:flex-start;padding:10px 14px;display:flex;gap:4px;align-items:center}',
      '.twa-cb-typing span{width:6px;height:6px;background:#94a3b8;border-radius:50%;animation:twaCbBounce .6s infinite alternate}',
      '.twa-cb-typing span:nth-child(2){animation-delay:.2s}',
      '.twa-cb-typing span:nth-child(3){animation-delay:.4s}',
      '@keyframes twaCbBounce{from{transform:translateY(0)}to{transform:translateY(-6px)}}',
      '.twa-cb-input{display:flex;border-top:1px solid #e2e8f0;flex-shrink:0}',
      '.twa-cb-input input{flex:1;border:none;padding:12px 14px;font-size:16px;outline:none;background:transparent}',
      '.twa-cb-input button{background:none;border:none;padding:0 14px;cursor:pointer;color:#1a6fb5;font-size:18px}',
      '.twa-cb-input button:disabled{color:#cbd5e1;cursor:not-allowed}',
      '.twa-cb-actions{display:flex;flex-direction:column;gap:8px;margin-top:8px;align-self:flex-start;max-width:85%}',
      '.twa-cb-action-btn{padding:10px 16px;border-radius:8px;border:none;font-size:13px;font-weight:600;cursor:pointer;text-align:center;transition:background .15s}',
      '.twa-cb-action-btn.primary{background:#1a6fb5;color:#fff}',
      '.twa-cb-action-btn.primary:hover{background:#173358}',
      '.twa-cb-action-btn.secondary{background:#f1f5f9;color:#173358;border:1px solid #e2e8f0}',
      '.twa-cb-action-btn.secondary:hover{background:#e2e8f0}',
      '.twa-cb-action-btn:disabled{opacity:.6;cursor:not-allowed}',
      '.twa-cb-powered{text-align:center;font-size:10px;color:#94a3b8;padding:4px 0 8px;flex-shrink:0}',
      '.twa-cb-bubble:active{transform:scale(0.95)}',
      '.twa-cb-input button:active:not(:disabled){color:#173358}',
      '.twa-cb-action-btn:active:not(:disabled){opacity:0.8}'
    ].join('');
    document.head.appendChild(style);

    // ─── Build DOM ───────────────────────────────
    var bubble = createElement('button', { class: 'twa-cb-bubble', 'aria-label': 'Chat with us' },
      '<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>');

    var panel = document.createElement('div');
    panel.className = 'twa-cb-panel';
    panel.setAttribute('id', 'twaChatPanel');

    var header = document.createElement('div');
    header.className = 'twa-cb-header';
    header.innerHTML = '<span>The Way Agency</span><div style="display:flex;gap:8px;align-items:center;"><button class="twa-cb-new" aria-label="New chat" title="New chat" style="background:rgba(255,255,255,0.2);border:none;color:#fff;border-radius:4px;padding:8px 12px;font-size:12px;cursor:pointer;min-height:44px;display:flex;align-items:center;-webkit-tap-highlight-color:transparent">New</button><button class="twa-cb-close" aria-label="Close chat">&times;</button></div>';

    var msgsArea = document.createElement('div');
    msgsArea.className = 'twa-cb-msgs';

    var inputBar = document.createElement('div');
    inputBar.className = 'twa-cb-input';
    var inputField = document.createElement('input');
    inputField.type = 'text';
    inputField.placeholder = 'Type a message...';
    inputField.setAttribute('aria-label', 'Type a message');
    var sendBtn = document.createElement('button');
    sendBtn.setAttribute('aria-label', 'Send');
    sendBtn.innerHTML = '<svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/></svg>';
    inputBar.appendChild(inputField);
    inputBar.appendChild(sendBtn);

    var powered = document.createElement('div');
    powered.className = 'twa-cb-powered';
    powered.innerHTML = '<a href="/privacy.html" target="_blank" style="color:#94a3b8;text-decoration:underline;">Privacy Policy</a>';

    panel.appendChild(header);
    panel.appendChild(msgsArea);
    panel.appendChild(inputBar);
    panel.appendChild(powered);

    document.body.appendChild(panel);
    if (opts.autoBubble !== false) document.body.appendChild(bubble);

    // ─── Message rendering ───────────────────────
    function formatChatText(text) {
      // Lightweight markdown: bold, line breaks. Escape HTML first for safety.
      return (text || '')
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
        .replace(/\n/g, '<br>');
    }

    function addMessageEl(role, text) {
      var el = document.createElement('div');
      el.className = 'twa-cb-msg ' + role;
      if (role === 'assistant') {
        el.innerHTML = formatChatText(text);
      } else {
        el.textContent = text;
      }
      msgsArea.appendChild(el);
      msgsArea.scrollTop = msgsArea.scrollHeight;
      return el;
    }

    function addErrorEl(text) {
      var el = document.createElement('div');
      el.className = 'twa-cb-msg error';
      el.textContent = text;
      msgsArea.appendChild(el);
      msgsArea.scrollTop = msgsArea.scrollHeight;
    }

    function showTyping() {
      var el = document.createElement('div');
      el.className = 'twa-cb-typing';
      el.id = 'twaCbTyping';
      el.innerHTML = '<span></span><span></span><span></span>';
      msgsArea.appendChild(el);
      msgsArea.scrollTop = msgsArea.scrollHeight;
    }

    function hideTyping() {
      var el = msgsArea.querySelector('#twaCbTyping');
      if (el) el.remove();
    }

    function addConfirmationCard(actionData) {
      var agentSlug = (actionData && actionData.agent) || '';
      var agentName = AGENT_NAMES[agentSlug] || 'Our team';
      var card = document.createElement('div');
      card.style.cssText = 'margin:8px 0;padding:12px 14px;background:#f0fdf4;border:1px solid #bbf7d0;border-radius:10px;font-size:13px;color:#166534;line-height:1.5;';
      card.innerHTML = '<div style="display:flex;align-items:center;gap:6px;margin-bottom:4px;font-weight:600;"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#166534" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><path d="M22 4 12 14.01l-3-3"/></svg> Info submitted</div>' +
        agentName + ' will reach out within one business day.';
      msgsArea.appendChild(card);
      msgsArea.scrollTop = msgsArea.scrollHeight;
      track('chatbot_lead_submitted', { category: 'conversion', agent: agentSlug });
    }

    // Restore saved messages into the DOM
    function restoreMessages() {
      chatMessages.forEach(function(m) {
        addMessageEl(m.role, m.text);
        if (m.action) addConfirmationCard(m.action);
      });
    }

    // ─── Streaming chat ──────────────────────────
    async function sendMessage(text) {
      if (!text.trim() || isSending) return;
      isSending = true;
      sendBtn.disabled = true;
      inputField.value = '';

      // Add user message
      chatMessages.push({ role: 'user', text: text });
      addMessageEl('user', text);
      saveState();
      track('chatbot_message_sent', { category: 'engagement' });

      showTyping();

      var botText = '';
      var botEl = null;
      var actionData = null;

      var chatAbort = new AbortController();
      var chatAbortTimer = setTimeout(function() { chatAbort.abort(); }, 45000);

      try {
        var response = await fetch(SAGE_API + '/api/chat/message', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: chatAbort.signal,
          body: JSON.stringify({
            sessionId: chatSessionId,
            message: text,
            page: location.pathname,
            product: detectProduct()
          })
        });

        if (!response.ok) {
          throw new Error('HTTP ' + response.status);
        }

        var reader = response.body.getReader();
        var decoder = new TextDecoder();
        var buffer = '';

        hideTyping();
        botEl = addMessageEl('bot', '');

        while (true) {
          var result = await reader.read();
          if (result.done) break;

          buffer += decoder.decode(result.value, { stream: true });
          var lines = buffer.split('\n');
          buffer = lines.pop() || '';

          for (var i = 0; i < lines.length; i++) {
            var line = lines[i].trim();
            if (!line.startsWith('data: ')) continue;
            var jsonStr = line.slice(6);
            try {
              var chunk = JSON.parse(jsonStr);
              if (chunk.sessionId) {
                chatSessionId = chunk.sessionId;
              }
              if (chunk.text) {
                botText += chunk.text;
                // Hide JSON action block from display as it streams in
                var displayText = botText.replace(/\s*\{"action"\s*:\s*"(?:connect_agent|update_lead)"[\s\S]*$/m, '').trim();
                botEl.innerHTML = formatChatText(displayText);
                msgsArea.scrollTop = msgsArea.scrollHeight;
              }
              if (chunk.done) {
                if (chunk.action === 'connect_agent' && chunk.data) {
                  actionData = chunk.data;
                  track('chatbot_agent_suggested', { category: 'engagement', agent: chunk.data.agent || '' });
                }
              }
            } catch(pe) { /* skip malformed lines */ }
          }
        }

        // Process any remaining buffer
        if (buffer.trim().startsWith('data: ')) {
          try {
            var lastChunk = JSON.parse(buffer.trim().slice(6));
            if (lastChunk.sessionId) chatSessionId = lastChunk.sessionId;
            if (lastChunk.text) {
              botText += lastChunk.text;
              if (botEl) botEl.innerHTML = formatChatText(botText);
            }
            if (lastChunk.done && lastChunk.action === 'connect_agent' && lastChunk.data) {
              actionData = lastChunk.data;
              track('chatbot_agent_suggested', { category: 'engagement', agent: lastChunk.data.agent || '' });
            }
          } catch(pe2) {}
        }

        if (botText) {
          // Strip the JSON action block from visible text
          botText = botText.replace(/\s*\{"action"\s*:\s*"(?:connect_agent|update_lead)"[\s\S]*?\}\s*$/m, '').trim();
          if (botEl) botEl.innerHTML = formatChatText(botText);
          var msgEntry = { role: 'bot', text: botText };
          if (actionData) msgEntry.action = actionData;
          chatMessages.push(msgEntry);
          saveState();
        }

        if (actionData) {
          addConfirmationCard(actionData);
        }

      } catch(err) {
        hideTyping();
        if (botText && botEl) {
          // Partial response received before error
          chatMessages.push({ role: 'bot', text: botText });
          saveState();
          addErrorEl('Connection lost. Partial response shown above.');
        } else {
          addErrorEl('Connection issue \u2014 please call us at ' + PHONE);
        }
      } finally {
        clearTimeout(chatAbortTimer);
        isSending = false;
        sendBtn.disabled = false;
        inputField.focus();
      }
    }

    // ─── New chat (reset) ─────────────────────────
    function resetChat() {
      chatSessionId = '';
      chatMessages = [];
      localStorage.removeItem('twa_chat_sid');
      localStorage.removeItem('twa_chat_messages');
      msgsArea.innerHTML = '';
      hasOpened = false;
      // Show fresh welcome
      var welcome = afterHours ? afterHoursWelcome : defaultWelcome;
      chatMessages.push({ role: 'bot', text: welcome });
      addMessageEl('bot', welcome);
      saveState();
      inputField.focus();
    }

    header.querySelector('.twa-cb-new').addEventListener('click', function(e) {
      e.stopPropagation();
      resetChat();
    });

    // ─── After-hours detection (Eastern Time) ────
    function isAfterHours() {
      var now = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/New_York' }));
      var day = now.getDay(); // 0=Sun, 6=Sat
      var hour = now.getHours();
      var min = now.getMinutes();
      if (day === 0 || day === 6) return true; // weekend
      if (hour < 8 || (hour === 8 && min < 30)) return true; // before 9:00 AM
      if (hour >= 17) return true; // after 5 PM
      return false;
    }

    var afterHours = isAfterHours();
    var afterHoursWelcome = 'Hey there! You\u2019ve reached us after hours. I\u2019m an AI assistant \u2014 I can get your info to a licensed agent who will reach out first thing next business day. What can I help you with?';
    var defaultWelcome = 'Hi! I\u2019m an AI assistant for The Way Agency \u2014 I can collect your info and connect you with a licensed agent. What are you looking for today?';

    // ─── Toggle panel ────────────────────────────
    function openChat() {
      isOpen = true;
      panel.classList.add('open');
      track('chatbot_opened', { category: 'engagement', afterHours: afterHours });
      if (!hasOpened) {
        hasOpened = true;
        if (chatMessages.length === 0) {
          var welcome = afterHours ? afterHoursWelcome : defaultWelcome;
          chatMessages.push({ role: 'bot', text: welcome });
          addMessageEl('bot', welcome);
          saveState();
        } else {
          restoreMessages();
          // If we resumed from server and a lead was submitted, show confirmation card
          if (chatResumeData && chatResumeData.agentName) {
            addConfirmationCard({ agentName: chatResumeData.agentName, reference: chatResumeData.reference });
          }
        }
      }
      // On mobile, hide sticky CTA and prevent body scroll while chat is open
      if (window.innerWidth <= 767) {
        var cta = document.getElementById('stickyMobileCTA');
        if (cta) cta.style.display = 'none';
        document.body.style.overflow = 'hidden';
      }
      inputField.focus();
    }

    function closeChat() {
      isOpen = false;
      panel.classList.remove('open');
      // Restore sticky CTA and body scroll on mobile
      if (window.innerWidth <= 767) {
        var cta = document.getElementById('stickyMobileCTA');
        if (cta) cta.style.display = '';
        document.body.style.overflow = '';
        panel.style.height = '';
        panel.style.top = '';
      }
    }

    function toggleChat() {
      if (isOpen) closeChat();
      else openChat();
    }

    // ─── Event listeners ─────────────────────────
    if (opts.autoBubble !== false) bubble.addEventListener('click', toggleChat);
    header.querySelector('.twa-cb-close').addEventListener('click', closeChat);
    document.addEventListener('keydown', function(e) { if (e.key === 'Escape' && isOpen) closeChat(); });

    sendBtn.addEventListener('click', function() { sendMessage(inputField.value); });
    inputField.addEventListener('keydown', function(e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        sendMessage(inputField.value);
      }
    });

    // ─── After-hours auto-engage ──────────────────
    if (opts.autoEngage !== false && afterHours && chatMessages.length === 0) {
      if (window.innerWidth > 767) {
        // Desktop: auto-open chat after 3 seconds
        setTimeout(function() { if (!isOpen) openChat(); }, 3000);
      } else {
        // Mobile: pulsing dot on bubble + dismissable toast
        var dot = document.createElement('span');
        dot.style.cssText = 'position:absolute;top:2px;right:2px;width:12px;height:12px;background:#ef4444;border-radius:50%;border:2px solid #173358;animation:twaCbPulse 1.5s ease infinite;';
        bubble.style.position = 'relative';
        bubble.appendChild(dot);
        var style = document.createElement('style');
        style.textContent = '@keyframes twaCbPulse{0%,100%{transform:scale(1);opacity:1}50%{transform:scale(1.3);opacity:.7}}';
        document.head.appendChild(style);

        var toast = document.createElement('div');
        toast.style.cssText = 'position:fixed;bottom:calc(84px + env(safe-area-inset-bottom,0px));right:20px;background:#173358;color:#fff;padding:10px 16px;border-radius:20px;font-family:Montserrat,Arial,sans-serif;font-size:13px;font-weight:500;box-shadow:0 4px 14px rgba(0,0,0,.25);z-index:1002;opacity:0;transform:translateY(10px);transition:all .3s ease;cursor:pointer;';
        toast.textContent = 'After hours? Chat with us!';
        document.body.appendChild(toast);
        setTimeout(function() { toast.style.opacity = '1'; toast.style.transform = 'translateY(0)'; }, 500);
        setTimeout(function() { toast.style.opacity = '0'; toast.style.transform = 'translateY(10px)'; setTimeout(function() { toast.remove(); }, 300); }, 5500);
        toast.addEventListener('click', function() { toast.remove(); dot.remove(); openChat(); });
        bubble.addEventListener('click', function() { dot.remove(); toast.remove(); }, { once: true });
      }
    }

    // ─── Virtual keyboard resize handling ────────
    if (window.visualViewport) {
      var vpHandler = function() {
        if (!isOpen || window.innerWidth > 767) return;
        var vv = window.visualViewport;
        panel.style.height = vv.height + 'px';
        panel.style.top = vv.offsetTop + 'px';
        msgsArea.scrollTop = msgsArea.scrollHeight;
      };
      window.visualViewport.addEventListener('resize', vpHandler);
      window.visualViewport.addEventListener('scroll', vpHandler);
    }

    // Expose closure handles to the module so external launchers can drive it
    widget = { openChat: openChat, closeChat: closeChat, toggleChat: toggleChat, get isOpen() { return isOpen; } };
    ready = true;
    if (queuedOpen) { queuedOpen = false; openChat(); }
    } // end renderChatWidget
  }

  // Public surface --------------------------------------------------------------
  window.TWAChat = {
    __loaded: true,
    // No opts => default auto-init for marketing pages (suppressed on app paths).
    // Explicit opts => caller-driven init (e.g. intake uses a custom launcher).
    init: function (opts) {
      if (opts === undefined) {
        var path = window.location.pathname;
        if (path.indexOf('/intake') === 0 || path.indexOf('/portal') === 0 ||
            path.indexOf('/partner') === 0 || path.indexOf('/admin') === 0) return;
        initChatWidget({ autoBubble: true, autoEngage: true });
      } else {
        initChatWidget(opts);
      }
    },
    open: function () { if (widget) { widget.openChat(); } else { queuedOpen = true; } },
    toggle: function () { if (widget) { widget.toggleChat(); } },
    isReady: function () { return ready; },
    onReady: function (cb) { if (ready) { cb(); } }
  };
})();
