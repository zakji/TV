// Interactive 3D model of the LG OLED G-series "Gallery" TV.
// Bundled with esbuild into app/tv3d.js (three.js tree-shaken).
import {
  WebGLRenderer, Scene, PerspectiveCamera, Group, Mesh, BoxGeometry, PlaneGeometry, CylinderGeometry,
  MeshStandardMaterial, MeshBasicMaterial, CanvasTexture, SRGBColorSpace, Color, PointLight, AmbientLight,
  DirectionalLight, GridHelper, Fog, ShaderMaterial, AdditiveBlending, DoubleSide, MathUtils, RingGeometry,
} from 'three';

const W = 1.846, H = 1.059, D = 0.024; // 83" panel in metres (G-series ~24 mm deep)

export function createTV(container, { onTap } = {}) {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = SRGBColorSpace;
  container.appendChild(renderer.domElement);

  const scene = new Scene();
  scene.fog = new Fog(0x05060d, 4, 9);
  const camera = new PerspectiveCamera(38, 1, 0.1, 50);
  camera.position.set(0, 0.25, 3.35);

  // ---------- lights
  scene.add(new AmbientLight(0x6b7cff, 0.35));
  const key = new DirectionalLight(0xffffff, 1.1);
  key.position.set(2, 3, 4);
  scene.add(key);
  const rimC = new PointLight(0x00f0ff, 6, 6);
  rimC.position.set(-2.2, 0.6, -0.8);
  const rimM = new PointLight(0xff2bd6, 6, 6);
  rimM.position.set(2.2, -0.4, -0.8);
  scene.add(rimC, rimM);

  // ---------- TV
  const tv = new Group();
  scene.add(tv);

  const frameMat = new MeshStandardMaterial({ color: 0x1a1c24, metalness: 0.85, roughness: 0.28 });
  const backMat = new MeshStandardMaterial({ color: 0x2a2d38, metalness: 0.6, roughness: 0.45 });
  const frame = new Mesh(new BoxGeometry(W + 0.012, H + 0.012, D), frameMat);
  tv.add(frame);

  // Back module (slightly inset like the real gallery design)
  const back = new Mesh(new BoxGeometry(W * 0.62, H * 0.5, 0.012), backMat);
  back.position.set(0, -0.12, -D / 2 - 0.006);
  tv.add(back);
  // Flush wall bracket
  const bracket = new Mesh(new BoxGeometry(0.6, 0.3, 0.018), new MeshStandardMaterial({ color: 0x0c0d12, metalness: 0.4, roughness: 0.6 }));
  bracket.position.set(0, 0.05, -D / 2 - 0.021);
  tv.add(bracket);

  // Screen: canvas texture with animated OLED content
  const cv = document.createElement('canvas');
  cv.width = 1024;
  cv.height = 588;
  const ctx = cv.getContext('2d');
  const tex = new CanvasTexture(cv);
  tex.colorSpace = SRGBColorSpace;
  tex.anisotropy = 4;
  const screen = new Mesh(new PlaneGeometry(W - 0.008, H - 0.008), new MeshBasicMaterial({ map: tex, toneMapped: false }));
  screen.position.z = D / 2 + 0.0006;
  tv.add(screen);

  // Glass reflection sheen
  const sheenMat = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    uniforms: { uT: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);} ',
    fragmentShader: `varying vec2 vUv; uniform float uT;
      void main(){ float d = vUv.x*0.8 + vUv.y*0.6 - fract(uT*0.07)*2.4 + 0.4;
      float s = smoothstep(0.0,0.06,d)*smoothstep(0.16,0.06,d);
      gl_FragColor = vec4(vec3(0.55,0.8,1.0)*s*0.18, s*0.18); }`,
  });
  const sheen = new Mesh(new PlaneGeometry(W - 0.008, H - 0.008), sheenMat);
  sheen.position.z = D / 2 + 0.0012;
  tv.add(sheen);

  // Neon edge glow behind TV (bias lighting)
  const glowMat = new ShaderMaterial({
    transparent: true,
    depthWrite: false,
    blending: AdditiveBlending,
    side: DoubleSide,
    uniforms: { uT: { value: 0 }, uA: { value: new Color(0x00f0ff) }, uB: { value: new Color(0xff2bd6) } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);} ',
    fragmentShader: `varying vec2 vUv; uniform float uT; uniform vec3 uA; uniform vec3 uB;
      float box(vec2 p, vec2 b){ vec2 d=abs(p)-b; return length(max(d,0.0))+min(max(d.x,d.y),0.0); }
      void main(){ vec2 p=(vUv-0.5)*vec2(1.45,1.0);
        float d = box(p, vec2(0.372,0.255));
        float g = exp(-max(d,0.0)*9.0) * step(0.0,d+0.02);
        vec3 c = mix(uA,uB, 0.5+0.5*sin(uT*0.6 + vUv.x*3.0));
        gl_FragColor = vec4(c*g, g*0.9); }`,
  });
  const glow = new Mesh(new PlaneGeometry(W * 1.9, H * 1.9 * 1.0), glowMat);
  glow.position.z = -0.08;
  tv.add(glow);

  // Floor: neon grid + reflection ring
  const grid = new GridHelper(14, 42, 0xff2bd6, 0x1b2a55);
  grid.position.y = -0.95;
  grid.material.transparent = true;
  grid.material.opacity = 0.35;
  scene.add(grid);
  const ring = new Mesh(new RingGeometry(0.9, 0.93, 96), new MeshBasicMaterial({ color: 0x00f0ff, transparent: true, opacity: 0.5 }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = -0.94;
  scene.add(ring);
  const pillar = new Mesh(new CylinderGeometry(0.004, 0.004, 0.4, 8), new MeshBasicMaterial({ color: 0x00f0ff, transparent: true, opacity: 0.25 }));
  pillar.position.y = -0.75;
  scene.add(pillar);

  // ---------- screen content
  let screenInfo = { model: 'G5', price: null, shop: '', label: 'SCANNING…', accent: '#ff2bd6' };
  function drawScreen(t) {
    const w = cv.width, h = cv.height;
    // OLED perfect black base + flowing aurora
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, w, h);
    const acc = screenInfo.accent;
    for (let i = 0; i < 3; i++) {
      const x = w * (0.5 + 0.38 * Math.sin(t * 0.25 + i * 2.1));
      const y = h * (0.5 + 0.32 * Math.cos(t * 0.2 + i * 1.7));
      const g = ctx.createRadialGradient(x, y, 0, x, y, w * 0.55);
      const col = i === 0 ? acc : i === 1 ? '#00f0ff' : '#5b2bff';
      g.addColorStop(0, col + '88');
      g.addColorStop(1, '#00000000');
      ctx.fillStyle = g;
      ctx.fillRect(0, 0, w, h);
    }
    // scanlines
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    for (let y = 0; y < h; y += 4) ctx.fillRect(0, y, w, 1);
    // text
    ctx.textAlign = 'center';
    ctx.shadowColor = acc;
    ctx.shadowBlur = 24;
    ctx.fillStyle = '#fff';
    ctx.font = '700 44px Orbitron, system-ui, sans-serif';
    ctx.fillText(`LG OLED evo ${screenInfo.model} · 83"`, w / 2, h * 0.3);
    ctx.font = '900 150px Orbitron, system-ui, sans-serif';
    ctx.fillText(screenInfo.price ? '€' + Math.round(screenInfo.price).toLocaleString('nl-NL') : '— — —', w / 2, h * 0.6);
    ctx.shadowBlur = 0;
    ctx.font = '500 38px "Space Grotesk", system-ui, sans-serif';
    ctx.fillStyle = 'rgba(255,255,255,0.8)';
    ctx.fillText(screenInfo.label, w / 2, h * 0.78);
    ctx.font = '600 24px Orbitron, system-ui';
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillText('TAP TO SWITCH MODEL', w / 2, h * 0.93);
    tex.needsUpdate = true;
  }

  // ---------- controls (custom, iOS friendly: vertical page scroll still works)
  const el = renderer.domElement;
  el.style.touchAction = 'pan-y';
  let rotY = -0.35, rotX = 0.06, velY = reduced ? 0 : 0.0025, zoom = 3.35, targetZoom = 3.35;
  let dragging = false, lastX = 0, lastY = 0, moved = 0, lastInteract = 0;
  const pointers = new Map();
  let pinchStart = 0, zoomStart = zoom, tiltStartY = 0, rotXStart = 0;

  el.addEventListener('pointerdown', (e) => {
    pointers.set(e.pointerId, e);
    el.setPointerCapture?.(e.pointerId);
    if (pointers.size === 1) {
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      moved = 0;
    } else if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      pinchStart = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      zoomStart = targetZoom;
      tiltStartY = (a.clientY + b.clientY) / 2;
      rotXStart = rotX;
    }
    lastInteract = performance.now();
  });
  el.addEventListener('pointermove', (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, e);
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      targetZoom = MathUtils.clamp(zoomStart * (pinchStart / d), 1.9, 5.2);
      rotX = MathUtils.clamp(rotXStart + ((a.clientY + b.clientY) / 2 - tiltStartY) * 0.005, -0.5, 0.6);
      moved += 10;
    } else if (dragging) {
      const dx = e.clientX - lastX;
      const dy = e.clientY - lastY;
      lastX = e.clientX;
      lastY = e.clientY;
      moved += Math.abs(dx) + Math.abs(dy);
      velY = dx * 0.006;
      rotY += dx * 0.009;
      if (e.pointerType === 'mouse') rotX = MathUtils.clamp(rotX + dy * 0.005, -0.5, 0.6);
    }
    lastInteract = performance.now();
  });
  const end = (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size === 0) {
      if (dragging && moved < 6 && e.type === 'pointerup') onTap?.();
      dragging = false;
    }
  };
  el.addEventListener('pointerup', end);
  el.addEventListener('pointercancel', end);
  el.addEventListener('wheel', (e) => {
    if (!e.ctrlKey && Math.abs(e.deltaY) < 40) return;
    e.preventDefault();
    targetZoom = MathUtils.clamp(targetZoom + e.deltaY * 0.002, 1.9, 5.2);
  }, { passive: false });
  el.addEventListener('dblclick', () => { rotY = 0; rotX = 0.06; targetZoom = 3.35; velY = 0; });

  // ---------- loop
  let visible = true, raf = 0, t0 = performance.now(), lastDraw = 0;
  const io = new IntersectionObserver(([en]) => { visible = en.isIntersecting; if (visible) loop(); });
  io.observe(container);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) loop(); });

  function resize() {
    const w = container.clientWidth, h = container.clientHeight;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // Keep the whole TV in frame on narrow phones
    camera.fov = w / h < 1 ? 52 : 38;
    camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(container);
  resize();

  function loop() {
    cancelAnimationFrame(raf);
    if (!visible || document.hidden) return;
    raf = requestAnimationFrame(loop);
    const now = performance.now();
    const t = (now - t0) / 1000;
    if (!dragging) {
      // inertia, then gentle auto-rotate after idle
      velY *= 0.95;
      const idle = now - lastInteract > 2500;
      if (idle && !reduced) velY += (0.0022 - velY) * 0.02;
      rotY += velY;
    }
    zoom += (targetZoom - zoom) * 0.12;
    tv.rotation.y = rotY;
    tv.rotation.x = rotX;
    tv.position.y = reduced ? 0 : Math.sin(t * 0.9) * 0.025;
    camera.position.z = zoom;
    camera.lookAt(0, 0, 0);
    sheenMat.uniforms.uT.value = t;
    glowMat.uniforms.uT.value = t;
    ring.scale.setScalar(1 + Math.sin(t * 1.5) * 0.04);
    ring.material.opacity = 0.35 + Math.sin(t * 1.5) * 0.15;
    if (now - lastDraw > 40) {
      drawScreen(t);
      lastDraw = now;
    }
    renderer.render(scene, camera);
  }
  drawScreen(0);
  loop();

  return {
    setInfo(info) {
      screenInfo = { ...screenInfo, ...info };
      drawScreen((performance.now() - t0) / 1000);
    },
    spin() {
      velY = 0.18;
      lastInteract = performance.now();
    },
  };
}
