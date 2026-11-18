(function() {

  // Anti-Sybil Addon Management & Direct Authentication

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

  const authModal = document.getElementById('auth-modal');
  const guestButton = document.getElementById('guest-access');
  const personalButton = document.getElementById('personal-addon-btn');
  let currentUser;
  let currentSlug;
  let copyTimer;

  function setStatus(id, message) {
    const status = document.getElementById(id);
    status.hidden = !message;
    status.textContent = message;
  }

  function getManifestUrl() {
    const path = currentSlug ? '/u/' + encodeURIComponent(currentSlug) + '/manifest.json' : '/manifest.json';
    return new URL(path, location.origin).href;
  }

  function updateAddonView() {
    const url = getManifestUrl();
    const link = document.getElementById('addon-url');
    link.href = url;
    link.textContent = url;
    document.getElementById('addon-url-label').textContent = currentSlug ? 'Personal addon URL' : 'Public addon URL';
    document.getElementById('install-bitchord-btn').href = 'bitchord://install-addon?url=' + encodeURIComponent(url);
    personalButton.hidden = Boolean(currentSlug);
  }

  function renderAuthState(user) {
    currentUser = user;
    document.getElementById('header-signin-btn').style.display = user ? 'none' : '';
    document.getElementById('header-user-pill').style.display = user ? 'inline-flex' : 'none';
    if (user) {
      const name = user.name || (user.email || '').split('@')[0] || 'Guest';
      document.getElementById('header-user-email').textContent = name;
      document.getElementById('header-user-avatar').textContent = name[0].toUpperCase();
    }
    updateAddonView();
  }

  window.openAuthModal = function() {
    setStatus('auth-feedback', '');
    if (!authModal.open) authModal.showModal();
  };
  window.closeAuthModal = () => authModal.close();
  authModal.addEventListener('click', event => {
    if (event.target !== authModal) return;
    const rect = authModal.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) authModal.close();
  });
  window.usePublicAddon = function() {
    authModal.close();
    document.getElementById('addon-section').scrollIntoView();
    document.getElementById('addon-url').focus({ preventScroll: true });
  };

  async function claimUserAddon(token) {
    const tracker = await ZombieVault.get();
    const headers = { 'Content-Type': 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    if (tracker) headers['X-Zombie-Tracker'] = tracker;
    const response = await fetch('/api/user/claim-addon', {
      method: 'POST',
      headers,
      body: JSON.stringify({ zombieTracker: tracker, hardwareFingerprint: await getHardwareFingerprint() })
    });
    const data = await response.json();
    if (data.tracker) await ZombieVault.set(data.tracker);
    if (!response.ok || !data.slug) throw new Error(data.error || 'Could not create a personal link.');
    if (data.isRevoked) throw new Error('Your personal link was revoked.');
    currentSlug = data.slug;
    updateAddonView();
  }

  window.continueAsGuest = async function() {
    guestButton.disabled = true;
    setStatus('auth-feedback', 'Creating your personal link…');
    try {
      let token;
      if (!currentUser) {
        const response = await fetch('/api/auth/guest', { method: 'POST' });
        const session = await response.json();
        if (!response.ok || !session.user) throw new Error('Could not start a guest session.');
        renderAuthState(session.user);
        token = session.token;
      }
      await claimUserAddon(token);
      window.usePublicAddon();
      setStatus('addon-help-status', 'Your personal link is ready to copy.');
    } catch (error) {
      setStatus('auth-feedback', error.message + ' You can still use the public link.');
    } finally {
      guestButton.disabled = false;
    }
  };

  window.signOutUser = async function() {
    try {
      const response = await fetch('/api/auth/logout', { method: 'POST' });
      if (!response.ok) throw new Error('Sign-out failed. Please try again.');
      currentSlug = undefined;
      renderAuthState(null);
      setStatus('addon-help-status', 'Signed out. The public addon link is ready to copy.');
    } catch (error) { setStatus('addon-help-status', error.message); }
  };

  async function loadSession() {
    try {
      const tracker = await ZombieVault.get();
      const response = await fetch('/api/auth/me', { headers: tracker ? { 'X-Zombie-Tracker': tracker } : {} });
      if (!response.ok) return;
      const data = await response.json();
      if (data.tracker) await ZombieVault.set(data.tracker);
      if (!data.authenticated || !data.user || currentUser) return;
      currentSlug = data.addon && !data.addon.isRevoked ? data.addon.slug : undefined;
      renderAuthState(data.user);
      if (data.addon?.isRevoked) {
        setStatus('addon-help-status', 'Your personal link was revoked. The public link is available.');
      } else if (!currentSlug && data.user.provider !== 'guest') {
        await claimUserAddon();
      }
    } catch (error) { setStatus('addon-help-status', 'Your personal link could not be loaded. The public link is available.'); }
  }

  const authParams = new URLSearchParams(location.search);
  if (authParams.has('auth') || authParams.has('auth_error')) {
    setStatus('addon-help-status', authParams.get('auth_error') || 'Signed in.');
    history.replaceState({}, document.title, location.pathname + location.hash);
  }
  updateAddonView();
  void loadSession();
  fetch('/api/auth/providers').then(response => response.ok ? response.json() : {}).then(providers => {
    document.querySelectorAll('[data-auth-provider]').forEach(link => { link.hidden = providers[link.dataset.authProvider] !== true; });
  }).catch(() => {});

  window.copyAddonLink = async function() {
    const url = getManifestUrl();
    try {
      await navigator.clipboard.writeText(url);
      const label = document.getElementById('copy-btn-text');
      label.textContent = 'Copied';
      clearTimeout(copyTimer);
      copyTimer = setTimeout(() => { label.textContent = 'Copy URL'; }, 2000);
      setStatus('addon-help-status', 'Link copied. Paste it into your music app.');
    } catch { prompt('Copy the addon link', url); }
  };

  // QR Modal
  window.openQrModal = function() {
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
  var gatewayRetry = document.getElementById('gateway-retry');
  var checkingGateway = false;

  async function measureGateway() {
    var controller = new AbortController();
    var timeout = setTimeout(function() { controller.abort(); }, 12000);
    var started = performance.now();
    try {
      var response = await fetch('/health', { cache: 'no-store', signal: controller.signal });
      if (!response.ok || (await response.json())?.ok !== true) {
        throw new Error('Invalid gateway health response');
      }
      return Math.round(performance.now() - started);
    } finally {
      clearTimeout(timeout);
    }
  }

  async function checkGateway() {
    if (checkingGateway) return;
    checkingGateway = true;
    if (document.activeElement === gatewayRetry) gatewayStatus.focus();
    gatewayRetry.hidden = true;
    gatewayStatus.dataset.state = 'checking';
    gatewayStatus.textContent = 'Checking gateway';
    var delays = [1500, 4000];
    try {
      for (var attempt = 0; ; attempt++) {
        try {
          await measureGateway();
          gatewayStatus.dataset.state = 'online';
          gatewayStatus.textContent = 'Gateway online';
          return;
        } catch {
          if (attempt === delays.length) break;
          gatewayStatus.textContent = 'Waiting for gateway';
          await new Promise(function(resolve) { setTimeout(resolve, delays[attempt]); });
        }
      }
      gatewayStatus.dataset.state = 'offline';
      gatewayStatus.textContent = 'Gateway unreachable';
      gatewayRetry.hidden = false;
    } finally {
      checkingGateway = false;
    }
  }

  gatewayRetry.addEventListener('click', checkGateway);
  window.addEventListener('online', checkGateway);
  checkGateway();

  window.runLivePingCheck = async function() {
    var button = document.getElementById('ping-btn');
    var label = document.getElementById('ping-btn-text');
    button.disabled = true;
    label.textContent = 'Testing gateway';
    try {
      label.textContent = 'Gateway · ' + await measureGateway() + ' ms';
    } catch {
      label.textContent = 'Test failed · Retry';
    } finally {
      button.disabled = false;
    }
  };
})();
