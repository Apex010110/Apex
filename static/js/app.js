/* ================================================================
   APEX AI — app.js
   Three.js 3D Cosmos Background + Full Chat Logic
   ================================================================ */

(() => {
  'use strict';

  /* ============================================================
     SECTION 1 — Three.js Cosmos Background
     ============================================================ */

  const canvas   = document.getElementById('cosmos');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setClearColor(0x020409, 1);

  const scene  = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(62, window.innerWidth / window.innerHeight, 0.1, 3000);
  camera.position.z = 1;

  // Subtle exponential fog for depth
  scene.fog = new THREE.FogExp2(0x020409, 0.0006);

  /* ──────────────────────────────────────────────
     1a. Star Field — 18 000 points
  ────────────────────────────────────────────── */
  const STAR_N   = 18000;
  const starPos  = new Float32Array(STAR_N * 3);
  const starCol  = new Float32Array(STAR_N * 3);
  const starSz   = new Float32Array(STAR_N);

  // Colour palette: blue-white, warm, cyan, pink, lavender
  const palette = [
    [0.78, 0.90, 1.00],
    [1.00, 0.96, 0.86],
    [0.60, 0.95, 1.00],
    [1.00, 0.75, 0.92],
    [0.82, 0.70, 1.00],
    [0.70, 1.00, 0.96],
  ];

  for (let i = 0; i < STAR_N; i++) {
    const r     = 280 + Math.random() * 900;
    const theta = Math.random() * Math.PI * 2;
    const phi   = Math.acos(2 * Math.random() - 1);
    starPos[i * 3]     = r * Math.sin(phi) * Math.cos(theta);
    starPos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
    starPos[i * 3 + 2] = r * Math.cos(phi);

    const c = palette[Math.floor(Math.random() * palette.length)];
    const b = 0.55 + Math.random() * 0.45;
    starCol[i * 3]     = c[0] * b;
    starCol[i * 3 + 1] = c[1] * b;
    starCol[i * 3 + 2] = c[2] * b;

    // A few bright "giant" stars
    starSz[i] = Math.random() < 0.04 ? 3.2 + Math.random() * 2.5 : 0.7 + Math.random() * 1.6;
  }

  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute('position', new THREE.BufferAttribute(starPos, 3));
  starGeo.setAttribute('color',    new THREE.BufferAttribute(starCol, 3));
  starGeo.setAttribute('size',     new THREE.BufferAttribute(starSz,  1));

  const starMat = new THREE.PointsMaterial({
    size:          1.3,
    vertexColors:  true,
    transparent:   true,
    opacity:       0.88,
    sizeAttenuation: true,
  });

  const stars = new THREE.Points(starGeo, starMat);
  scene.add(stars);

  /* ──────────────────────────────────────────────
     1b. Nebula Clouds (coloured particle volumes)
  ────────────────────────────────────────────── */
  function makeNebula(count, rgb, centerRadius, spreadRadius, flatY) {
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(count * 3);
    const col = new Float32Array(count * 3);

    for (let i = 0; i < count; i++) {
      const r     = centerRadius + (Math.random() - 0.5) * spreadRadius;
      const theta = Math.random() * Math.PI * 2;
      const phi   = Math.acos(2 * Math.random() - 1);
      pos[i * 3]     = r * Math.sin(phi) * Math.cos(theta);
      pos[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta) * (flatY || 1);
      pos[i * 3 + 2] = r * Math.cos(phi);

      const b = 0.40 + Math.random() * 0.60;
      col[i * 3]     = rgb[0] * b;
      col[i * 3 + 1] = rgb[1] * b;
      col[i * 3 + 2] = rgb[2] * b;
    }

    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color',    new THREE.BufferAttribute(col, 3));

    const mat = new THREE.PointsMaterial({
      size:          5,
      vertexColors:  true,
      transparent:   true,
      opacity:       0.13,
      sizeAttenuation: true,
    });

    return new THREE.Points(geo, mat);
  }

  const neb1 = makeNebula(2200, [0.00, 0.96, 1.00], 420, 200, 0.45); // cyan
  const neb2 = makeNebula(1800, [0.70, 0.31, 1.00], 520, 220, 0.50); // purple
  const neb3 = makeNebula(1200, [1.00, 0.00, 0.67], 360, 160, 0.55); // magenta
  const neb4 = makeNebula(900,  [0.20, 0.80, 0.40], 480, 180, 0.35); // green

  neb1.rotation.set( 0.30,  0.80,  0.10);
  neb2.rotation.set(-0.40,  1.20,  0.30);
  neb3.rotation.set( 0.60, -0.50,  0.80);
  neb4.rotation.set(-0.20,  0.40, -0.60);

  scene.add(neb1, neb2, neb3, neb4);

  /* ──────────────────────────────────────────────
     1c. Spiral Galaxy (background)
  ────────────────────────────────────────────── */
  function makeGalaxy(arms, perArm) {
    const total = arms * perArm;
    const pos   = new Float32Array(total * 3);
    const col   = new Float32Array(total * 3);
    const sz    = new Float32Array(total);
    let idx = 0;

    for (let arm = 0; arm < arms; arm++) {
      const baseAngle = (arm / arms) * Math.PI * 2;
      for (let j = 0; j < perArm; j++) {
        const t       = j / perArm;
        const r       = 55 + t * 540;
        const twist   = t * Math.PI * 4.5;
        const scatter = (1 - t * 0.6) * 22;
        const angle   = baseAngle + twist + (Math.random() - 0.5) * 0.7;

        pos[idx * 3]     = Math.cos(angle) * r + (Math.random() - 0.5) * scatter;
        pos[idx * 3 + 1] = (Math.random() - 0.5) * scatter * 0.25;
        pos[idx * 3 + 2] = Math.sin(angle) * r + (Math.random() - 0.5) * scatter;

        // Hot white core → cooler blue outer
        if (t < 0.2) {
          col[idx * 3] = 1.0; col[idx * 3 + 1] = 0.92; col[idx * 3 + 2] = 0.70;
          sz[idx] = 1.8 + Math.random() * 1.2;
        } else {
          const heat = 1 - t;
          col[idx * 3]     = 0.30 + heat * 0.50;
          col[idx * 3 + 1] = 0.55 + heat * 0.30;
          col[idx * 3 + 2] = 0.75 + heat * 0.20;
          sz[idx] = 0.4 + Math.random() * 0.9;
        }
        idx++;
      }
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('color',    new THREE.BufferAttribute(col, 3));
    geo.setAttribute('size',     new THREE.BufferAttribute(sz,  1));

    const mat = new THREE.PointsMaterial({
      size:          0.85,
      vertexColors:  true,
      transparent:   true,
      opacity:       0.72,
      sizeAttenuation: true,
    });

    return new THREE.Points(geo, mat);
  }

  const galaxy = makeGalaxy(5, 2400);
  galaxy.rotation.x = Math.PI / 2.8;
  galaxy.position.set(580, -80, -380);
  scene.add(galaxy);

  /* ──────────────────────────────────────────────
     1d. Shooting Stars
  ────────────────────────────────────────────── */
  const shooters = [];

  function spawnShooter() {
    const length = 28 + Math.random() * 70;
    const dir = new THREE.Vector3(
      (Math.random() - 0.5) * 1.8,
      -(0.25 + Math.random() * 0.75),
      (Math.random() - 0.5) * 0.4
    ).normalize();

    const origin = new THREE.Vector3(
      (Math.random() - 0.5) * 700,
       120 + Math.random() * 220,
      -180 - Math.random() * 220
    );

    const pts = new Float32Array([
      origin.x, origin.y, origin.z,
      origin.x + dir.x * length,
      origin.y + dir.y * length,
      origin.z + dir.z * length,
    ]);

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pts, 3));
    const mat = new THREE.LineBasicMaterial({
      color: 0xb8e0ff,
      transparent: true,
      opacity: 0,
    });

    const line = new THREE.Line(geo, mat);
    line.userData.life    = 0;
    line.userData.maxLife = 0.48 + Math.random() * 0.55;
    line.userData.vel     = dir.multiplyScalar(3.5 + Math.random() * 4.5);

    scene.add(line);
    shooters.push(line);
  }

  /* ──────────────────────────────────────────────
     1e. Resize handler
  ────────────────────────────────────────────── */
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  /* ──────────────────────────────────────────────
     1f. Mouse parallax
  ────────────────────────────────────────────── */
  let mx = 0, my = 0;
  document.addEventListener('mousemove', e => {
    mx = (e.clientX / window.innerWidth  - 0.5) * 2;
    my = (e.clientY / window.innerHeight - 0.5) * 2;
  });

  /* ──────────────────────────────────────────────
     1g. Animation Loop
  ────────────────────────────────────────────── */
  const clock      = new THREE.Clock();
  let   lastShoot  = 0;

  function animate() {
    requestAnimationFrame(animate);
    const t = clock.getElapsedTime();

    // Slow rotation of the star sphere
    stars.rotation.y = t * 0.009;
    stars.rotation.x = t * 0.003;

    // Nebula rotation
    neb1.rotation.y =  t * 0.007;
    neb2.rotation.y = -t * 0.005;
    neb3.rotation.y =  t * 0.011;
    neb4.rotation.y = -t * 0.008;

    // Galaxy spin
    galaxy.rotation.y = t * 0.014;

    // Camera drift toward mouse
    camera.position.x += (mx * 9  - camera.position.x) * 0.018;
    camera.position.y += (-my * 6 - camera.position.y) * 0.018;
    camera.lookAt(scene.position);

    // Shooting stars
    if (t - lastShoot > 2.2 + Math.random() * 3.8) {
      lastShoot = t;
      spawnShooter();
    }

    for (let i = shooters.length - 1; i >= 0; i--) {
      const s = shooters[i];
      s.userData.life += 0.018;
      const progress = s.userData.life / s.userData.maxLife;
      s.material.opacity = Math.sin(progress * Math.PI) * 0.85;
      s.position.add(s.userData.vel);
      if (s.userData.life >= s.userData.maxLife) {
        scene.remove(s);
        s.geometry.dispose();
        s.material.dispose();
        shooters.splice(i, 1);
      }
    }

    renderer.render(scene, camera);
  }

  animate();


  /* ============================================================
     SECTION 2 — Chat Logic
     ============================================================ */

  const chatEl    = document.getElementById('chat');
  const msgEl     = document.getElementById('msg');
  const typingEl  = document.getElementById('typing');
  const sourcesEl = document.getElementById('sources');
  const sidEl     = document.getElementById('sid');
  const clearBtn  = document.getElementById('clearBtn');
  const modeBtns  = Array.from(document.querySelectorAll('.mode-btn'));
  const formEl    = document.getElementById('composer');

  let mode      = 'chat';
  let sessionId = (typeof crypto !== 'undefined' && crypto.randomUUID)
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);

  sidEl.textContent = sessionId.slice(0, 8).toUpperCase();

  /* ── Helpers ── */
  function esc(s) {
    return (s || '').replace(/[&<>"']/g, ch => (
      { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[ch]
    ));
  }

  function nowLabel() {
    return new Date().toLocaleTimeString('en-US', {
      hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit',
    });
  }

  /* ── Add message to chat ── */
  function addMsg(text, who) {
    const el = document.createElement('div');
    el.className = `bubble ${who}`;
    el.setAttribute('role', 'article');

    if (who === 'bot') {
      el.innerHTML = `
        <div class="avatar-wrap">
          <div class="bot-avatar">
            <div class="avatar-ring"></div>
            <span class="avatar-label">AI</span>
          </div>
        </div>
        <div class="msg-body">
          <div class="msg-header">
            <span class="msg-name">APEX AI</span>
            <span class="msg-badge">NEURAL</span>
          </div>
          <div class="msg-text">${esc(text)}</div>
          <div class="msg-time">${nowLabel()}</div>
        </div>`;
    } else {
      el.innerHTML = `
        <div class="msg-body">
          <div class="msg-header">
            <span class="msg-name">YOU</span>
            <span class="msg-badge">TX</span>
          </div>
          <div class="msg-text">${esc(text)}</div>
          <div class="msg-time">${nowLabel()}</div>
        </div>`;
    }

    chatEl.appendChild(el);
    el.scrollIntoView({ behavior: 'smooth', block: 'end' });
  }

  /* ── Auto-resize textarea ── */
  function resize() {
    msgEl.style.height = '1px';
    msgEl.style.height = Math.min(148, msgEl.scrollHeight) + 'px';
  }
  msgEl.addEventListener('input', resize);
  resize();

  /* ── Mode switching ── */
  modeBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      modeBtns.forEach(b => { b.classList.remove('active'); b.setAttribute('aria-selected', 'false'); });
      btn.classList.add('active');
      btn.setAttribute('aria-selected', 'true');
      mode = btn.dataset.mode;
      msgEl.placeholder = {
        rag:      'Search the web for information\u2026',
        akinator: 'Think of a person. Say \u201Cstart\u201D or answer yes\u202Fno\u2026',
        chat:     'Transmit your message across the cosmos\u2026',
      }[mode] || 'Transmit your message\u2026';
      sourcesEl.classList.add('hidden');
    });
  });

  /* ── Send message ── */
  formEl.addEventListener('submit', async e => {
    e.preventDefault();
    const text = (msgEl.value || '').trim();
    if (!text) return;

    addMsg(text, 'me');
    msgEl.value = '';
    resize();

    typingEl.classList.remove('hidden');
    sourcesEl.classList.add('hidden');
    sourcesEl.innerHTML = '';

    try {
      const resp = await fetch('/api/chat', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ session_id: sessionId, message: text, mode }),
      });

      if (!resp.ok) {
        throw new Error(`HTTP ${resp.status}`);
      }

      const data = await resp.json();
      sessionId = data.session_id || sessionId;
      sidEl.textContent = sessionId.slice(0, 8).toUpperCase();

      addMsg(data.reply || '(no reply)', 'bot');

      if (data.sources && data.sources.length) {
        sourcesEl.classList.remove('hidden');
        sourcesEl.innerHTML =
          '<strong style="color:rgba(0,245,255,0.55);font-family:var(--font-head);font-size:9px;letter-spacing:2px;">SCAN SOURCES</strong>&nbsp; ' +
          data.sources
            .map(s => `<a class="source-link" href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.title || s.url)}</a>`)
            .join(' &nbsp;·&nbsp; ');
      }
    } catch (err) {
      addMsg('Signal lost: ' + err.message, 'bot');
    } finally {
      typingEl.classList.add('hidden');
    }
  });

  /* ── Enter = send, Shift+Enter = newline ── */
  msgEl.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      formEl.dispatchEvent(new Event('submit', { cancelable: true }));
    }
  });

  /* ── Clear conversation ── */
  clearBtn.addEventListener('click', () => {
    chatEl.innerHTML = '';
    sourcesEl.classList.add('hidden');
    addMsg('Channel cleared. Awaiting new transmission.', 'bot');
  });

})();
