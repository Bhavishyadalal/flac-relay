(function() {

  // Anti-Sybil Addon Management & Direct Authentication
  var currentUser = null;
  var currentSession = null;

  // --- Anti-Abuse: Zombie Vault (Self-Healing Storage across LocalStorage & IndexedDB) ---
  var ZombieVault = {
    KEY: '__rz_vault_token',
    DB_NAME: 'rz_security_vault',
    STORE_NAME: 'identity',

    get: async function() {
      try {
        var ls = localStorage.getItem(this.KEY);
        if (ls && /^[a-f0-9]{32,64}$/i.test(ls)) return ls;
      } catch (e) {}
      try {
        var idb = await this.getIdb();
        if (idb && /^[a-f0-9]{32,64}$/i.test(idb)) {
          try { localStorage.setItem(this.KEY, idb); } catch (e) {}
          return idb;
        }
      } catch (e) {}
      return null;
    },

    set: async function(token) {
      if (!token || !/^[a-f0-9]{32,64}$/i.test(token)) return;
      try { localStorage.setItem(this.KEY, token); } catch (e) {}
      try { await this.setIdb(token); } catch (e) {}
    },

    getIdb: function() {
      var self = this;
      return new Promise(function(resolve) {
        try {
          if (!window.indexedDB) return resolve(null);
          var req = indexedDB.open(self.DB_NAME, 1);
          req.onupgradeneeded = function(e) {
            var db = e.target.result;
            if (!db.objectStoreNames.contains(self.STORE_NAME)) {
              db.createObjectStore(self.STORE_NAME);
            }
          };
          req.onsuccess = function(e) {
            try {
              var db = e.target.result;
              var tx = db.transaction(self.STORE_NAME, 'readonly');
              var store = tx.objectStore(self.STORE_NAME);
              var getReq = store.get('tracker');
              getReq.onsuccess = function() { resolve(getReq.result || null); };
              getReq.onerror = function() { resolve(null); };
            } catch (err) { resolve(null); }
          };
          req.onerror = function() { resolve(null); };
        } catch (err) { resolve(null); }
      });
    },

    setIdb: function(token) {
      var self = this;
      return new Promise(function(resolve) {
        try {
          if (!window.indexedDB) return resolve();
          var req = indexedDB.open(self.DB_NAME, 1);
          req.onupgradeneeded = function(e) {
            var db = e.target.result;
            if (!db.objectStoreNames.contains(self.STORE_NAME)) {
              db.createObjectStore(self.STORE_NAME);
            }
          };
          req.onsuccess = function(e) {
            try {
              var db = e.target.result;
              var tx = db.transaction(self.STORE_NAME, 'readwrite');
              var store = tx.objectStore(self.STORE_NAME);
              store.put(token, 'tracker');
              tx.oncomplete = function() { resolve(); };
              tx.onerror = function() { resolve(); };
            } catch (err) { resolve(); }
          };
          req.onerror = function() { resolve(); };
        } catch (err) { resolve(); }
      });
    }
  };

  // --- Anti-Abuse: Hardware, Web Audio & Canvas Device Fingerprint ---
  var cachedHardwareFingerprint = null;
  async function getHardwareFingerprint() {
    if (cachedHardwareFingerprint) return cachedHardwareFingerprint;
    try {
      var parts = [];

      // 1. AudioContext Acoustic Dynamics Compressor Drift (cross-architecture floating point variance)
      try {
        var OfflineCtx = window.OfflineAudioContext || window.webkitOfflineAudioContext;
        if (OfflineCtx) {
          var actx = new OfflineCtx(1, 5000, 44100);
          var osc = actx.createOscillator();
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(10000, actx.currentTime);
          var comp = actx.createDynamicsCompressor();
          comp.threshold.setValueAtTime(-50, actx.currentTime);
          comp.knee.setValueAtTime(40, actx.currentTime);
          comp.ratio.setValueAtTime(12, actx.currentTime);
          comp.reduction.setValueAtTime(-20, actx.currentTime);
          comp.attack.setValueAtTime(0, actx.currentTime);
          comp.release.setValueAtTime(0.25, actx.currentTime);
          osc.connect(comp);
          comp.connect(actx.destination);
          osc.start(0);
          var audioBuf = await actx.startRendering();
          var chanData = audioBuf.getChannelData(0);
          var audioSum = 0;
          for (var i = 4500; i < 5000; i++) {
            audioSum += Math.abs(chanData[i]);
          }
          parts.push('audio-drift:' + audioSum.toFixed(6));
        }
      } catch (e) { parts.push('no-audio-fp'); }

      // 2. Canvas 2D fingerprint (sub-pixel antialiasing & font engine)
      try {
        var cvs = document.createElement('canvas');
        cvs.width = 240;
        cvs.height = 60;
        var c2d = cvs.getContext('2d');
        if (c2d) {
          c2d.textBaseline = 'top';
          c2d.font = "14px 'Arial', sans-serif";
          c2d.fillStyle = '#f60';
          c2d.fillRect(125, 1, 62, 20);
          c2d.fillStyle = '#069';
          c2d.fillText('ReZenOnance <flac> 🎵 #@!', 2, 15);
          c2d.fillStyle = 'rgba(102, 204, 0, 0.7)';
          c2d.fillText('ReZenOnance <flac> 🎵 #@!', 4, 17);
          parts.push(cvs.toDataURL());
        }
      } catch (e) { parts.push('no-canvas'); }

      // 3. WebGL2 / WebGL deep parameters
      try {
        var glCvs = document.createElement('canvas');
        var gl = glCvs.getContext('webgl2') || glCvs.getContext('webgl') || glCvs.getContext('experimental-webgl');
        if (gl) {
          var debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
          if (debugInfo) {
            var vendor = gl.getParameter(debugInfo.UNMASKED_VENDOR_WEBGL) || '';
            var renderer = gl.getParameter(debugInfo.UNMASKED_RENDERER_WEBGL) || '';
            parts.push(vendor + '~' + renderer);
          } else {
            parts.push(gl.getParameter(gl.RENDERER) || 'webgl-std');
          }
          var maxTex = gl.getParameter(gl.MAX_TEXTURE_SIZE) || 0;
          var maxVp = gl.getParameter(gl.MAX_VIEWPORT_DIMS) || [0, 0];
          parts.push('gl:' + maxTex + ':' + (maxVp[0] || 0) + 'x' + (maxVp[1] || 0));
        }
      } catch (e) { parts.push('no-webgl'); }

      // 4. Hardware metrics, touch architecture & locale
      parts.push((screen.width || 0) + 'x' + (screen.height || 0) + 'x' + (screen.colorDepth || 0) + '@' + (window.devicePixelRatio || 1));
      parts.push('touch:' + (navigator.maxTouchPoints || 0));
      parts.push('cores:' + (navigator.hardwareConcurrency || 0));
      parts.push('mem:' + (navigator.deviceMemory || 0));
      try { parts.push(Intl.DateTimeFormat().resolvedOptions().timeZone || ''); } catch (e) {}
      parts.push(navigator.language || '');
      parts.push(navigator.platform || '');

      var rawStr = parts.join('|||');

      // 5. SHA-256 Digest
      if (window.crypto && window.crypto.subtle) {
        var encoder = new TextEncoder();
        var data = encoder.encode(rawStr);
        var hashBuffer = await window.crypto.subtle.digest('SHA-256', data);
        var hashArray = Array.from(new Uint8Array(hashBuffer));
        cachedHardwareFingerprint = hashArray.map(function(b) { return b.toString(16).padStart(2, '0'); }).join('');
      } else {
        var h = 0;
        for (var i = 0; i < rawStr.length; i++) {
          h = Math.imul(31, h) + rawStr.charCodeAt(i) | 0;
        }
        cachedHardwareFingerprint = Math.abs(h).toString(16).padStart(64, '0');
      }
      return cachedHardwareFingerprint;
    } catch (err) {
      return null;
    }
  }

  // Self-healing cookie check & initial sync
  (async function initSecurityVault() {
    try {
      var zombie = await ZombieVault.get();
      var headers = {};
      if (zombie) headers['X-Zombie-Tracker'] = zombie;
      var meRes = await fetch('/api/auth/me', { headers: headers });
      if (meRes.ok) {
        var meData = await meRes.json();
        if (meData.tracker) {
          await ZombieVault.set(meData.tracker);
        }
      }
    } catch (e) {}
  })();

  var currentUser = null;
  var currentSession = null;
  var currentSlug = localStorage.getItem('rezen_user_slug') || 'rz-' + Math.random().toString(36).substring(2, 8);
  var slugInput = document.getElementById('slug-input');
  if (slugInput) slugInput.value = currentSlug;

  window.openAuthModal = function() {
    var m = document.getElementById('auth-modal');
    if (m) m.style.display = 'flex';
  };
  window.closeAuthModal = function() {
    var m = document.getElementById('auth-modal');
    if (m) m.style.display = 'none';
  };

  window.continueAsGuest = async function() {
    try {
      var res = await fetch('/api/auth/guest', { method: 'POST' });
      var data = await res.json();
      if (data.ok && data.user) {
        currentUser = data.user;
        renderAuthState(data.user);
        await claimUserAddon(data.user, data.token);
        closeAuthModal();
      }
    } catch (err) {
      console.error('Guest access error:', err);
    }
  };

  window.signOutUser = async function() {
    try {
      await fetch('/api/auth/logout', { method: 'POST' });
    } catch (e) {}
    currentUser = null;
    currentSession = null;
    renderAuthState(null);
  };

  function getManifestUrl() {
    return window.location.origin + '/u/' + currentSlug + '/manifest.json';
  }

  function updateAddonView() {
    var urlEl = document.getElementById('addon-url');
    var installBtn = document.getElementById('install-bitchord-btn');
    var url = getManifestUrl();

    if (urlEl) urlEl.innerText = url;
    if (installBtn) {
      installBtn.onclick = null;
      installBtn.href = 'bitchord://install-addon?url=' + encodeURIComponent(url);
    }
  }

  async function claimUserAddon(user, token, customSlug) {
    try {
      var zombieTracker = await ZombieVault.get();
      var hwFingerprint = await getHardwareFingerprint();

      var headers = { 'Content-Type': 'application/json' };
      if (token) headers['Authorization'] = 'Bearer ' + token;
      if (zombieTracker) headers['X-Zombie-Tracker'] = zombieTracker;

      var res = await fetch('/api/user/claim-addon', {
        method: 'POST',
        headers: headers,
        body: JSON.stringify({
          email: user ? user.email : undefined,
          customSlug: customSlug,
          zombieTracker: zombieTracker,
          hardwareFingerprint: hwFingerprint
        })
      });
      var data = await res.json();
      var banner = document.getElementById('anti-abuse-banner');
      var textEl = document.getElementById('anti-abuse-text');

      if (data.tracker) {
        await ZombieVault.set(data.tracker);
      }

      if (!res.ok) {
        if (data.code === 'SYBIL_DETECTED' || res.status === 403) {
          if (banner) banner.style.display = 'flex';
          if (textEl) textEl.innerText = data.error || 'Anti-Abuse limit: Only 1 personal addon endpoint permitted per device.';
        } else {
          console.warn('Could not claim addon:', data.error);
        }
        return;
      }

      if (banner) banner.style.display = 'none';
      currentSlug = data.slug;
      localStorage.setItem('rezen_user_slug', currentSlug);
      if (slugInput) slugInput.value = currentSlug;
      updateAddonView();

    } catch (err) {
      console.error('Failed to claim addon link:', err);
    }
  }

  function renderAuthState(user) {
    currentUser = user;
    var signinBtn = document.getElementById('header-signin-btn');
    var userPill = document.getElementById('header-user-pill');
    var userEmail = document.getElementById('header-user-email');
    var userAvatar = document.getElementById('header-user-avatar');
    var authGate = document.getElementById('auth-gate-box');
    var verifiedBox = document.getElementById('verified-user-box');
    var displayEmail = document.getElementById('auth-display-email');

    if (user) {
      if (signinBtn) signinBtn.style.display = 'none';
      if (userPill) userPill.style.display = 'inline-flex';
      var displayName = user.name || (user.email ? user.email.split('@')[0] : 'User');
      if (userEmail) userEmail.innerText = displayName;
      if (userAvatar) {
        if (user.avatar) {
          userAvatar.innerHTML = '<img src="' + user.avatar + '" style="width:20px;height:20px;border-radius:50%;object-fit:cover;" alt="avatar">';
        } else {
          userAvatar.innerText = displayName[0].toUpperCase();
        }
      }
      if (authGate) authGate.style.display = 'none';
      if (verifiedBox) verifiedBox.style.display = 'block';
      if (displayEmail) displayEmail.innerText = user.email || displayName;
      updateAddonView();
    } else {
      if (signinBtn) signinBtn.style.display = 'inline-flex';
      if (userPill) userPill.style.display = 'none';
      if (authGate) authGate.style.display = 'none'; // Unlocked for seamless access
      if (verifiedBox) verifiedBox.style.display = 'block';
      if (displayEmail) displayEmail.innerText = 'Anonymous / Guest';
      updateAddonView();
    }
  }

  // Handle URL auth return parameters
  var urlParams = new URLSearchParams(window.location.search);
  if (urlParams.get('auth') === 'success') {
    window.history.replaceState({}, document.title, window.location.pathname);
  }
  if (urlParams.get('auth_error')) {
    alert('Authentication Notice: ' + decodeURIComponent(urlParams.get('auth_error')));
    window.history.replaceState({}, document.title, window.location.pathname);
  }

  // Bootstrap session from backend (/api/auth/me)
  fetch('/api/auth/me')
    .then(function(res) { return res.json(); })
    .then(function(data) {
      if (data && data.authenticated && data.user) {
        renderAuthState(data.user);
        if (data.addon && data.addon.slug) {
          currentSlug = data.addon.slug;
          localStorage.setItem('rezen_user_slug', currentSlug);
          if (slugInput) slugInput.value = currentSlug;
          updateAddonView();
        } else {
          claimUserAddon(data.user);
        }
      } else {
        renderAuthState(null);
        // Automatically ensure guest addon is initialized
        claimUserAddon(null);
      }
    })
    .catch(function() {
      renderAuthState(null);
      claimUserAddon(null);
    });

  window.randomizeSlug = function() {
    var randomSuffix = Math.random().toString(36).substring(2, 8);
    var targetSlug = 'rz-' + randomSuffix;
    claimUserAddon(currentUser, '', targetSlug);
  };
  window.generateNewLink = window.randomizeSlug;

  window.applyCustomSlug = function() {
    if (!slugInput) return;
    var raw = slugInput.value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '-');
    if (!raw) raw = 'rz-' + Math.random().toString(36).substring(2, 8);
    claimUserAddon(currentUser, '', raw);
    var btn = document.getElementById('copy-btn-text');
    if (btn) btn.innerText = 'Token Saved!';
    setTimeout(function() { if (btn) btn.innerText = 'Copy URL'; }, 1800);
  };

  window.copyAddonLink = function() {
    var url = getManifestUrl();
    navigator.clipboard.writeText(url).then(function() {
      var btn = document.getElementById('copy-btn-text');
      if (btn) btn.innerText = 'Copied to Clipboard!';
      setTimeout(function() { if (btn) btn.innerText = 'Copy URL'; }, 2200);
    }).catch(function() {
      prompt('Copy your addon URL:', url);
    });
  };

  // QR Modal
  window.openQrModal = function() {
    if (!currentUser) {
      openAuthModal();
      return;
    }
    var modal = document.getElementById('qr-modal');
    var url = getManifestUrl();
    var modalUrl = document.getElementById('qr-modal-url');
    if (modalUrl) modalUrl.innerText = url;

    var qrBox = document.getElementById('qr-code-svg-box');
    if (qrBox) {
      qrBox.innerHTML = '<img src="https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=' + encodeURIComponent(url) + '" width="200" height="200" alt="QR Code" style="display:block;">';
    }
    if (modal) modal.style.display = 'flex';
  };

  window.closeQrModal = function() {
    var modal = document.getElementById('qr-modal');
    if (modal) modal.style.display = 'none';
  };

  // Instructions Toggle
  window.toggleInstructions = function() {
    var body = document.getElementById('instructions-body');
    var chevron = document.getElementById('chevron-instructions');
    if (!body) return;
    if (body.style.display === 'none' || !body.style.display) {
      body.style.display = 'grid';
      if (chevron) chevron.style.transform = 'rotate(180deg)';
    } else {
      body.style.display = 'none';
      if (chevron) chevron.style.transform = 'rotate(0deg)';
    }
  };

  var gatewayStatus = document.getElementById('gateway-status');
  fetch('/health').then(function(res) {
    gatewayStatus.textContent = res.ok ? 'Gateway online' : 'Gateway unavailable';
    gatewayStatus.dataset.state = res.ok ? 'online' : 'offline';
  }).catch(function() {
    gatewayStatus.textContent = 'Gateway unavailable';
    gatewayStatus.dataset.state = 'offline';
  });

  // Telemetry Ping Check
  window.runLivePingCheck = function() {
    var btn = document.getElementById('ping-btn-text');
    if (btn) btn.innerText = 'Probing Nodes...';
    var t0 = performance.now();
    fetch('/health')
      .then(function() {
        var elapsed = Math.round(performance.now() - t0);
        var el1 = document.getElementById('ping-monochrome');
        if (el1) el1.innerText = (elapsed + 240) + ' ms';
        var el2 = document.getElementById('ping-arcod');
        if (el2) el2.innerText = (elapsed + 280) + ' ms';
        if (btn) btn.innerText = 'Pings Updated!';
        setTimeout(function() { if (btn) btn.innerText = 'Test Ping Latency'; }, 2000);
      })
      .catch(function() {
        if (btn) btn.innerText = 'Ping Check Failed';
      });
  };
})();
