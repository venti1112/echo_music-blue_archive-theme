/* ------------------------------------------------------------------ */
/*  Path helper (cross-platform, replaces node:path)                  */
/* ------------------------------------------------------------------ */

const joinPath = (...parts) => {
  const raw = parts.filter(Boolean).join("/");
  // Detect Windows from the first part (e.g. "C:\Users\...")
  const isWin = /\\/.test(parts[0] || "");
  const sep = isWin ? "\\" : "/";
  return raw.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/\//g, sep).replace(new RegExp(`\\${sep}$`), "");
};

/* ------------------------------------------------------------------ */
/*  Constants                                                         */
/* ------------------------------------------------------------------ */

const STORAGE_KEY = "ba-theme-settings";

const WALLPAPERS = [
  { id: "arona", label: "Arona", file: "arona.jpg" },
  { id: "pv-2nd", label: "PV 2nd", file: "pv-2nd.png" },
  { id: "pv-3rd", label: "PV 3rd", file: "pv-3rd.png" },
  { id: "pv-4th", label: "PV 4th", file: "pv-4th.png" },
  { id: "shiroko-bike", label: "白子骑行", file: "shiroko-bike.jpg" },
  { id: "shiroko-bike-2", label: "白子骑行 2", file: "shiroko-bike-2.jpg" },
  { id: "yukkai-and-nora", label: "优香与诺亚", file: "yukkai-and-nora.jpg" },
];

const DEFAULT_SETTINGS = {
  sparkEnabled: true,
  sparkColor: "45,175,255",
  sparkScale: 1.5,
  sparkOpacity: 1,
  sparkSpeed: 1,
  sparkMaxTrail: 16,
  sparkAlwaysTrail: false,
  wallpaperEnabled: true,
  wallpaperId: "arona",
  wallpaperBlur: 0,
  wallpaperDim: 0,
  replaceLyricBg: true,
  sidebarFloat: true,
  sidebarBlur: 14,
  playerBlur: 14,
  frostedCards: true,
  cardBlur: 12,
  customWallpaperData: "",
  customWallpaperName: "",
  surfaceOpacity: 0.78,
  fontEnabled: true,
};

const COLOR_PRESETS = [
  { label: "蔚蓝", value: "45,175,255" },
];

/* ------------------------------------------------------------------ */
/*  State                                                             */
/* ------------------------------------------------------------------ */

let runtimeCtx = null;
let state = null;
let sparkApp = null;
let sparkContainer = null;
let wallpaperStyleDispose = null;
let wallpaperObserver = null;
let wallpaperObserverTimer = null;
let headerRafId = 0;
let wallpaperImgW = 0;
let wallpaperImgH = 0;
let fontStyleDispose = null;
let fontGlobalDispose = null;
let surfaceDispose = null;
let settingsDispose = null;
let settingsStyleDispose = null;
let resizeHandler = null;

/* ------------------------------------------------------------------ */
/*  Settings normalization                                            */
/* ------------------------------------------------------------------ */

const normalizeSettings = (v = {}) => {
  const i = v && typeof v === "object" ? v : {};
  const num = (val, min, max, def) => {
    const n = Number(val);
    return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : def;
  };
  return {
    sparkEnabled: typeof i.sparkEnabled === "boolean" ? i.sparkEnabled : DEFAULT_SETTINGS.sparkEnabled,
    sparkColor:
      typeof i.sparkColor === "string" && /^\d{1,3},\d{1,3},\d{1,3}$/.test(i.sparkColor.trim())
        ? i.sparkColor.trim()
        : DEFAULT_SETTINGS.sparkColor,
    sparkScale: num(i.sparkScale, 0.3, 4, DEFAULT_SETTINGS.sparkScale),
    sparkOpacity: num(i.sparkOpacity, 0.1, 1, DEFAULT_SETTINGS.sparkOpacity),
    sparkSpeed: num(i.sparkSpeed, 0.2, 3, DEFAULT_SETTINGS.sparkSpeed),
    sparkMaxTrail: Math.round(num(i.sparkMaxTrail, 1, 64, DEFAULT_SETTINGS.sparkMaxTrail)),
    sparkAlwaysTrail:
      typeof i.sparkAlwaysTrail === "boolean" ? i.sparkAlwaysTrail : DEFAULT_SETTINGS.sparkAlwaysTrail,
    wallpaperEnabled:
      typeof i.wallpaperEnabled === "boolean" ? i.wallpaperEnabled : DEFAULT_SETTINGS.wallpaperEnabled,
    wallpaperId: (WALLPAPERS.some((w) => w.id === i.wallpaperId) || i.wallpaperId === "custom")
      ? i.wallpaperId
      : DEFAULT_SETTINGS.wallpaperId,
    wallpaperBlur: num(i.wallpaperBlur, 0, 20, DEFAULT_SETTINGS.wallpaperBlur),
    wallpaperDim: num(i.wallpaperDim, 0, 0.8, DEFAULT_SETTINGS.wallpaperDim),
    replaceLyricBg:
      typeof i.replaceLyricBg === "boolean" ? i.replaceLyricBg : DEFAULT_SETTINGS.replaceLyricBg,
    frostedCards:
      typeof i.frostedCards === "boolean" ? i.frostedCards : DEFAULT_SETTINGS.frostedCards,
    cardBlur: num(i.cardBlur, 0, 64, DEFAULT_SETTINGS.cardBlur),
    customWallpaperData:
      typeof i.customWallpaperData === "string" ? i.customWallpaperData : DEFAULT_SETTINGS.customWallpaperData,
    customWallpaperName:
      typeof i.customWallpaperName === "string" ? i.customWallpaperName : DEFAULT_SETTINGS.customWallpaperName,
    sidebarFloat:
      typeof i.sidebarFloat === "boolean" ? i.sidebarFloat : DEFAULT_SETTINGS.sidebarFloat,
    sidebarBlur: num(i.sidebarBlur, 0, 64, DEFAULT_SETTINGS.sidebarBlur),
    playerBlur: num(i.playerBlur, 0, 64, DEFAULT_SETTINGS.playerBlur),
    surfaceOpacity: num(i.surfaceOpacity, 0.3, 1, DEFAULT_SETTINGS.surfaceOpacity),
    fontEnabled: typeof i.fontEnabled === "boolean" ? i.fontEnabled : DEFAULT_SETTINGS.fontEnabled,
  };
};

/* ================================================================== */
/*                                                                    */
/*   PART 1 — Click Spark Effect (BASpark from vue-ba-spark)         */
/*                                                                    */
/* ================================================================== */

const createBASparkComponent = (vue, getOpts) => {
  const { defineComponent, ref, reactive, onMounted, onUnmounted, h } = vue;
  return defineComponent({
    name: "BASparkOverlay",
    setup() {
      const opts = getOpts();
      const stats = reactive({
        sparkPool: [], wavePool: [], waves: [], sparks: [], trail: [],
        isDown: false, lastPos: null,
        baseFrameMs: 1000 / 60, maxDeltaMs: 100,
        lastFrameTime: performance.now(),
        eventListeners: {
          mouseup() { stats.isDown = false; },
          mousedown(e) {
            stats.isDown = true;
            stats.lastPos = getPos(e);
            boom(stats.lastPos.x, stats.lastPos.y);
          },
          mousemove(e) {
            if (!stats.isDown && !opts.alwaysTrail) return;
            const p = getPos(e);
            if (!stats.lastPos) stats.lastPos = p;
            if (stats.lastPos && distPos(p, stats.lastPos) > 2) {
              stats.trail.push({ x: p.x, y: p.y, life: 1 });
              stats.lastPos = p;
              if (stats.trail.length > opts.maxTrail) stats.trail.shift();
              if (Math.random() < 0.3) {
                const a = Math.random() * Math.PI * 2;
                const sa = opts.scale / 1.5;
                stats.sparks.push({
                  x: p.x + Math.cos(a) * 10 * opts.scale,
                  y: p.y + Math.sin(a) * 10 * opts.scale,
                  vx: Math.cos(a) * 1.3 * sa, vy: Math.sin(a) * 1.3 * sa,
                  rot: Math.random() * Math.PI * 2, rs: 0.16,
                  s: 9 * opts.scale, a: 0.7, f: 0.95,
                });
              }
            }
          },
        },
      });
      const canvas = ref(null);
      let animId = null;
      const resize = (c) => {
        const dpr = window.devicePixelRatio || 1;
        c.width = window.innerWidth * dpr;
        c.height = window.innerHeight * dpr;
        c.getContext("2d")?.scale(dpr, dpr);
      };
      const getAlpha = (a) => Math.max(0, Math.min(1, a * opts.opacity));
      const getPos = (e) => ({ x: e.clientX, y: e.clientY });
      const distPos = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
      const boom = (x, y) => {
        let wave;
        if (stats.wavePool.length > 0) {
          wave = stats.wavePool.pop();
          Object.assign(wave, { x, y, life: 0, max: 18, r: 0 });
          wave.ring.ang = Math.random() * Math.PI * 2;
          wave.ring.life = 0;
        } else {
          wave = {
            x, y, life: 0, max: 18, r: 0,
            ring: {
              ang: Math.random() * Math.PI * 2,
              segs: [
                { off: -0.25 * Math.PI, len: 1.15 * Math.PI },
                { off: 0, len: 1.15 * Math.PI },
                { off: 0.25 * Math.PI, len: 1.15 * Math.PI },
              ],
              life: 0, maxLife: 30, rs: 0.08,
            },
          };
        }
        stats.waves.push(wave);
        const sa = opts.scale / 1.5;
        for (let i = 0; i < 4; i++) {
          const a = Math.random() * Math.PI * 2;
          const speed = (4.8 + Math.random() * 2) * sa;
          let spark;
          if (stats.sparkPool.length > 0) {
            spark = stats.sparkPool.pop();
            Object.assign(spark, {
              x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed,
              rot: Math.random() * Math.PI * 2, rs: (Math.random() - 0.5) * 0.28,
              s: (4 + Math.random() * 3) * opts.scale, a: 1, f: 0.9,
            });
          } else {
            spark = {
              x, y, vx: Math.cos(a) * speed, vy: Math.sin(a) * speed,
              rot: Math.random() * Math.PI * 2, rs: (Math.random() - 0.5) * 0.28,
              s: (4 + Math.random() * 3) * opts.scale, a: 1, f: 0.9,
            };
          }
          stats.sparks.push(spark);
        }
      };
      const bindEvents = () => {
        window.addEventListener("mousedown", stats.eventListeners.mousedown);
        window.addEventListener("mousemove", stats.eventListeners.mousemove);
        window.addEventListener("mouseup", stats.eventListeners.mouseup);
      };
      const unbindEvents = () => {
        window.removeEventListener("mousedown", stats.eventListeners.mousedown);
        window.removeEventListener("mousemove", stats.eventListeners.mousemove);
        window.removeEventListener("mouseup", stats.eventListeners.mouseup);
      };
      const loop = (now, c) => {
        const dt = Math.min(now - stats.lastFrameTime, stats.maxDeltaMs);
        stats.lastFrameTime = now;
        const fs = (dt / stats.baseFrameMs) * opts.speed;
        const g = c.getContext("2d");
        if (stats.waves.length || stats.sparks.length || stats.trail.length) {
          g.clearRect(0, 0, c.width, c.height);
          g.globalCompositeOperation = "lighter";
          for (let i = stats.trail.length - 1; i >= 0; i--) {
            const t = stats.trail[i];
            t.life -= (opts.alwaysTrail ? 0.085 : stats.isDown ? 0.085 : 0.18) * fs;
            if (t.life <= 0) stats.trail.splice(i, 1);
          }
          if (stats.trail.length > 1) {
            g.beginPath();
            g.moveTo(stats.trail[0].x, stats.trail[0].y);
            stats.trail.forEach((t) => g.lineTo(t.x, t.y));
            g.lineWidth = 5;
            const hd = stats.trail[stats.trail.length - 1];
            const tl = stats.trail[0];
            const gr = g.createLinearGradient(hd.x, hd.y, tl.x, tl.y);
            gr.addColorStop(0, `rgba(${opts.color},1)`);
            gr.addColorStop(1, `rgba(${opts.color},0)`);
            g.shadowColor = `rgba(${opts.color},0.6)`;
            g.shadowBlur = 3;
            g.strokeStyle = gr;
            g.stroke();
            g.shadowColor = "transparent";
          }
          stats.waves.forEach((w, i) => {
            w.life += fs;
            const p = w.life / w.max;
            w.r = 26 * opts.scale * (1 - Math.pow(1 - Math.min(p, 1), 3));
            const al = Math.max(0, 1 - p);
            if (al > 0) {
              g.beginPath(); g.arc(w.x, w.y, w.r, 0, Math.PI * 2);
              g.fillStyle = `rgba(${opts.color},${getAlpha(al)})`; g.fill();
            }
            const r = w.ring;
            r.life += fs;
            const rp = Math.min(r.life / r.maxLife, 1);
            r.ang -= r.rs * fs;
            r.segs.forEach((seg) => {
              const sh = Math.max(0, 1 - rp);
              const ln = seg.len * sh;
              const st = r.ang + seg.off;
              g.beginPath();
              g.arc(w.x, w.y, w.r + 3 * opts.scale, st, st + ln);
              g.lineWidth = 3.7;
              g.strokeStyle = `rgba(245,248,252,${getAlpha(1 - rp)})`;
              g.stroke();
            });
            if (p >= 1 && rp >= 1) { stats.wavePool.push(w); stats.waves.splice(i, 1); }
          });
          stats.sparks.forEach((s, i) => {
            s.x += s.vx * fs; s.y += s.vy * fs;
            s.vx *= Math.pow(s.f, fs); s.vy *= Math.pow(s.f, fs);
            s.rot += s.rs * fs; s.a -= 0.032 * fs;
            if (s.a <= 0) { stats.sparkPool.push(s); stats.sparks.splice(i, 1); return; }
            g.save(); g.translate(s.x, s.y); g.rotate(s.rot);
            g.beginPath(); g.moveTo(0, -s.s);
            g.lineTo(s.s * 0.6, s.s * 0.6); g.lineTo(-s.s * 0.6, s.s * 0.6);
            g.fillStyle = `rgba(255,255,255,${getAlpha(s.a)})`; g.fill();
            g.restore();
          });
          g.globalCompositeOperation = "source-over";
        }
        animId = requestAnimationFrame((n) => loop(n, c));
      };
      onMounted(() => {
        if (!canvas.value) return;
        resize(canvas.value);
        bindEvents();
        resizeHandler = () => canvas.value && resize(canvas.value);
        window.addEventListener("resize", resizeHandler);
        animId = requestAnimationFrame((n) => loop(n, canvas.value));
      });
      onUnmounted(() => {
        unbindEvents();
        if (resizeHandler) { window.removeEventListener("resize", resizeHandler); resizeHandler = null; }
        if (animId) { cancelAnimationFrame(animId); animId = null; }
      });
      return () => h("canvas", {
        ref: canvas,
        style: {
          pointerEvents: "none", position: "fixed", left: "0", top: "0",
          width: "100vw", height: "100vh", zIndex: "100000",
        },
      });
    },
  });
};

const mountSpark = () => {
  unmountSpark();
  if (!runtimeCtx || !state || !state.settings.sparkEnabled) return;
  const vue = runtimeCtx.vue;
  sparkContainer = document.createElement("div");
  sparkContainer.id = "ba-spark-overlay";
  sparkContainer.style.cssText = "position:fixed;top:0;left:0;width:0;height:0;pointer-events:none;z-index:100000;";
  document.body.appendChild(sparkContainer);
  const getOpts = () => ({
    color: state.settings.sparkColor, scale: state.settings.sparkScale,
    opacity: state.settings.sparkOpacity, speed: state.settings.sparkSpeed,
    maxTrail: state.settings.sparkMaxTrail, alwaysTrail: state.settings.sparkAlwaysTrail,
  });
  const Comp = createBASparkComponent(vue, getOpts);
  sparkApp = vue.createApp({ render: () => vue.h(Comp) });
  sparkApp.mount(sparkContainer);
};

const unmountSpark = () => {
  if (sparkApp) { try { sparkApp.unmount(); } catch {} sparkApp = null; }
  if (sparkContainer) { sparkContainer.remove(); sparkContainer = null; }
  if (resizeHandler) { window.removeEventListener("resize", resizeHandler); resizeHandler = null; }
};

/* ================================================================== */
/*                                                                    */
/*   PART 2 — Wallpaper                                               */
/*                                                                    */
/* ================================================================== */

let cachedWallpaperUrl = null;
let cachedWallpaperId = null;

const getWallpaperFileUrl = async (wallpaperId) => {
  if (cachedWallpaperId === wallpaperId && cachedWallpaperUrl) return cachedWallpaperUrl;
  // Custom wallpaper: use stored data URL
  if (wallpaperId === "custom" && state?.settings?.customWallpaperData) {
    cachedWallpaperUrl = state.settings.customWallpaperData;
    cachedWallpaperId = wallpaperId;
    return cachedWallpaperUrl;
  }
  const wp = WALLPAPERS.find((w) => w.id === wallpaperId) || WALLPAPERS[0];
  const filePath = joinPath(runtimeCtx.descriptor.directory, "assets", "wallpaper", wp.file);
  const result = await runtimeCtx.fs.getFileUrl(filePath);
  if (result.ok) {
    cachedWallpaperUrl = result.url;
    cachedWallpaperId = wallpaperId;
    return result.url;
  }
  return null;
};

const applyWallpaper = async () => {
  wallpaperStyleDispose?.();
  wallpaperStyleDispose = null;
  surfaceDispose?.();
  surfaceDispose = null;
  wallpaperObserver?.disconnect();
  wallpaperObserver = null;
  if (wallpaperObserverTimer) {
    clearTimeout(wallpaperObserverTimer);
    wallpaperObserverTimer = null;
  }
  if (!runtimeCtx || !state || !state.settings.wallpaperEnabled) return;

  const url = await getWallpaperFileUrl(state.settings.wallpaperId);
  if (!url) return;

  // 加载壁纸图原始尺寸用于 cover 精确对齐
  const img = new Image();
  img.onload = () => {
    wallpaperImgW = img.naturalWidth;
    wallpaperImgH = img.naturalHeight;
  };
  img.src = url;

  const { wallpaperBlur, wallpaperDim } = state.settings;
  const blurPx = wallpaperBlur > 0 ? `blur(${wallpaperBlur}px)` : "none";

  /*
   * 三重保险方案，确保壁纸可见：
   *
   * 1) body::before 伪元素放壁纸（body 自建层叠上下文，z-index:-2 不会被根背景遮住）
   * 2) CSS 层面：强制所有关键容器 background: transparent !important
   *    （.main-layout / .sidebar / .player-bar / #app 等均有 opaque 背景色）
   * 3) JS 层面：直接操作 DOM 元素的 style 属性 + MutationObserver 拦截 Vue 重渲染
   *
   * 原因：EchoMusic 的 MainLayout 用 bg-bg-main（= var(--color-bg-main)）作不透明底色，
   * Sidebar / PlayerBar 各自 scoped style 里也有 background: var(--color-bg-sidebar/player)。
   * 仅靠 ctx.theme.surface.set() 降低 opacity 变量不够——Vue 组件的 scoped CSS
   * 在初始化后可能用更高优先级的规则覆盖。
   */
  const css = `
html {
  background: transparent !important;
}
body {
  position: relative !important;
  z-index: 0 !important;
  background: transparent !important;
}
body::before {
  content: "" !important;
  position: fixed !important;
  inset: 0 !important;
  z-index: -2 !important;
  background-image: url("${url}") !important;
  background-size: cover !important;
  background-position: center !important;
  background-repeat: no-repeat !important;
  ${blurPx !== "none" ? `filter: ${blurPx} !important;` : ""}
  pointer-events: none !important;
}
body::after {
  content: "" !important;
  position: fixed !important;
  inset: 0 !important;
  z-index: -1 !important;
  background: rgba(0,0,0,${wallpaperDim}) !important;
  pointer-events: none !important;
}
#app, .app-root, .echo-app {
  background: transparent !important;
}
.main-layout,
.bg-bg-main,
.bg-bg-sidebar,
.bg-bg-card {
  background: transparent !important;
  background-color: transparent !important;
}` + (state.settings.sidebarFloat ? '' : `
.sidebar {
  background: transparent !important;
  background-color: transparent !important;
}
`) + (state.settings.playerBlur > 0 ? `
.player-bar-container {
  background: transparent !important;
  background-color: transparent !important;
}
` : `
.player-bar,
.player-bar-container {
  background: transparent !important;
  background-color: transparent !important;
}
`) + `.main-content {
  background: transparent !important;
  background-color: transparent !important;
}
.echo-surface-translucent .main-layout,` + (state.settings.sidebarFloat ? '' : `
.echo-surface-translucent .sidebar,`) + (state.settings.playerBlur > 0 ? '' : `
.echo-surface-translucent .player-bar,`) + `
.ba-dummy-unused {
  backdrop-filter: none !important;
  -webkit-backdrop-filter: none !important;
}` + (state.settings.replaceLyricBg ? `
.lyric-page {
  background-image: url("${url}") !important;
  background-size: cover !important;
  background-position: center !important;
  background-repeat: no-repeat !important;
  background-color: transparent !important;
  ${blurPx !== "none" ? `filter: ${blurPx} !important;` : ""}
}
.lyric-page::before {
  content: "" !important;
  position: absolute !important;
  inset: 0 !important;
  z-index: 0 !important;
  background: rgba(0,0,0,${wallpaperDim}) !important;
  pointer-events: none !important;
}
.lyric-page .lyric-blur-bg {
  display: none !important;
}` : '') + (state.settings.sidebarFloat ? `
.sidebar-wrapper {
  padding: 8px !important;
  padding-left: 8px !important;
  padding-right: 0 !important;
  margin-right: 8px !important;
  overflow: visible !important;
}
body .sidebar {
  border-radius: 14px !important;
  border: none !important;
  backdrop-filter: blur(${state.settings.sidebarBlur}px) !important;
  -webkit-backdrop-filter: blur(${state.settings.sidebarBlur}px) !important;
  box-shadow: 0 2px 24px rgba(0,0,0,0.18), inset 0 1px 0 rgba(255,255,255,0.12), 0 0 0 1px rgba(255,255,255,0.06) !important;
  overflow: hidden !important;
}
` : '') + (state.settings.playerBlur > 0 ? `
body .player-bar {
  backdrop-filter: blur(${state.settings.playerBlur}px) !important;
  -webkit-backdrop-filter: blur(${state.settings.playerBlur}px) !important;
}
}` : '') + `
body .explore-header::before,
body .rank-toolbar::before,
body .new-song-toolbar::before,
body .search-song-toolbar::before,
body .song-list-sticky::before,
body .comment-main-tabs::before {
  background: transparent !important;
  background-color: transparent !important;
}
body .sliver-header-background {
  background: transparent !important;
  background-color: transparent !important;
}
body .bg-bg-main,
body .bg-bg-card {
  background: transparent !important;
  background-color: transparent !important;
}
body .plugin-management-page,
body .personal-fm-view,
body .profile-page,
body .fm-play-sticky,
body .fm-panel {
  background: transparent !important;
  background-color: transparent !important;
}
` + (state.settings.frostedCards ? `
body .home-feature-card,
body .settings-card,
body .cloud-info-card,
body .plugin-card,
body .login-panel-card,
body .route-error-card,
body .error-shell,
body .explore-header,
body .rank-toolbar,
body .new-song-toolbar,
body .search-song-toolbar,
body .song-list-sticky,
body .comment-main-tabs,
body .sliver-header-root,
body .search-pinned-tabs,
body .search-suggestions-panel,
body .tb-suggestions,
body .rec-playlist-item,
body .add-playlist-item,
body .playlist-picker-item,
body .plugin-settings-section,
body .plugin-management-page,
body .song-context-menu,
body .drawer-panel,
body .dialog-content,
body .toast-card,
body .card-container,
body .profile-archive-card,
body .radio-card,
body .fm-play-sticky,
body .fm-panel {
  background: color-mix(in srgb, var(--surface-card-base, #fff) 12%, transparent) !important;
}
/* 吸顶表头/工具栏：本体透明；::before 用 absolute 画壁纸，由 JS 实时同步
   background-position 使其与视口壁纸(body::before)像素对齐，避免错位，
   同时遮挡滚到背后的列表行。overflow:hidden 裁剪超出表头的部分。 */
body .song-list-sticky,
body .sliver-header-root,
body .explore-header,
body .rank-toolbar,
body .new-song-toolbar,
body .search-song-toolbar,
body .comment-main-tabs,
body .search-pinned-tabs {
  background: transparent !important;
  background-color: transparent !important;
}
/* 表头 ::before 用 absolute 画壁纸，由 JS 每帧 rAF 同步 background-position
   与视口 body::before 对齐。rAF 在绘制前执行，零滞后。 */
body .song-list-sticky::before,
body .sliver-header-root::before,
body .explore-header::before,
body .rank-toolbar::before,
body .new-song-toolbar::before,
body .search-song-toolbar::before,
body .comment-main-tabs::before,
body .search-pinned-tabs::before {
  content: "" !important;
  position: absolute !important;
  top: 0 !important;
  left: 0 !important;
  right: 0 !important;
  bottom: 0 !important;
  width: 100% !important;
  height: 100% !important;
  transform: none !important;
  background-image:
    linear-gradient(rgba(0,0,0,${wallpaperDim}), rgba(0,0,0,${wallpaperDim})),
    url("${url}") !important;
  background-size: var(--ba-hdr-size, 100vw 100vh), var(--ba-hdr-size, 100vw 100vh) !important;
  background-repeat: no-repeat, no-repeat !important;
  background-position: var(--ba-hdr-pos, center center), var(--ba-hdr-pos, center center) !important;
  z-index: -1 !important;
  pointer-events: none !important;
}
` : '') + `
.ba-frosted {
  backdrop-filter: blur(${state.settings.cardBlur}px) !important;
  -webkit-backdrop-filter: blur(${state.settings.cardBlur}px) !important;
}
`;

  wallpaperStyleDispose = runtimeCtx.css.inject(css, { id: "ba-wallpaper" });

  // Activate surface system (opacity near 0; sidebar gets tint for frosted glass when float)
  surfaceDispose = runtimeCtx.theme.surface.set({
    enabled: true,
    mainOpacity: 0.01,
    sidebarOpacity: state.settings.sidebarFloat ? 0.3 : 0.01,
    cardOpacity: 0.08,
    elevatedOpacity: 0.12,
    dialogOpacity: 0.15,
    playerOpacity: 0.01,
  });

  // Direct DOM manipulation: strip backgrounds from key elements
  const stripSelectors = [
    ".main-layout",
    ".player-bar",
    ".main-content",
    ".plugin-management-page",
    ".personal-fm-view",
    ".profile-page",
    ".fm-play-sticky",
    ".fm-panel",
    ".sliver-header-background",
    ...(state.settings.sidebarFloat ? [] : [".sidebar"]),
    ...(state.settings.playerBlur > 0 ? [] : [".player-bar"]),
  ];
  const sidebarTintLight = "rgba(255,255,255,0.12)";
  const sidebarTintDark = "rgba(40,40,44,0.45)";
  const playerTintLight = "rgba(255,255,255,0.15)";
  const playerTintDark = "rgba(40,40,44,0.5)";
  const applyFrostedTint = () => {
    const isDark = document.documentElement.classList.contains("dark");
    if (state.settings.sidebarFloat) {
      const tint = isDark ? sidebarTintDark : sidebarTintLight;
      for (const el of document.querySelectorAll(".sidebar")) {
        if (el.style.backgroundColor !== tint) el.style.backgroundColor = tint;
      }
    }
    if (state.settings.playerBlur > 0) {
      const tint = isDark ? playerTintDark : playerTintLight;
      for (const el of document.querySelectorAll(".player-bar")) {
        if (el.style.backgroundColor !== tint) el.style.backgroundColor = tint;
      }
    }
  };
  const frostedCardSelectors = [
    ".home-feature-card", ".settings-card", ".cloud-info-card", ".plugin-card",
    ".login-panel-card", ".route-error-card", ".error-shell",
    ".search-suggestions-panel", ".tb-suggestions",
    ".rec-playlist-item", ".add-playlist-item", ".playlist-picker-item",
    ".plugin-settings-section", ".plugin-management-page",
    ".song-context-menu", ".drawer-panel", ".dialog-content",
    ".toast-card", ".card-container",
    ".profile-archive-card", ".radio-card", ".fm-play-sticky",
    ".fm-panel", ".fm-now-panel",
  ];
  const applyFrostedCards = () => {
    const blurVal = `blur(${state.settings.cardBlur}px)`;
    for (const sel of frostedCardSelectors) {
      for (const el of document.querySelectorAll(sel)) {
        if (state.settings.frostedCards) {
          if (!el.classList.contains("ba-frosted")) el.classList.add("ba-frosted");
          el.style.setProperty("background", "color-mix(in srgb, var(--surface-card-base, #fff) 12%, transparent)", "important");
          el.style.setProperty("backdrop-filter", blurVal, "important");
          el.style.setProperty("-webkit-backdrop-filter", blurVal, "important");
        } else {
          el.classList.remove("ba-frosted");
          el.style.removeProperty("background");
          el.style.removeProperty("backdrop-filter");
          el.style.removeProperty("-webkit-backdrop-filter");
        }
      }
    }
  };
  const stripBackgrounds = () => {
    for (const sel of stripSelectors) {
      for (const el of document.querySelectorAll(sel)) {
        el.style.setProperty("background", "transparent", "important");
        el.style.setProperty("background-color", "transparent", "important");
      }
    }
    applyFrostedTint();
    applyFrostedCards();
  };
  stripBackgrounds();

  // ---- 吸顶表头壁纸对齐：rAF 循环每帧同步 ----
  // rAF 在每帧绘制前执行，读到的 getBoundingClientRect 是当帧最新位置，
  // 写入 CSS 变量后当帧绘制生效 → 零滞后。比 scroll 事件（绘制后派发）更早。
  const HEADER_SELECTORS = [
    ".song-list-sticky", ".sliver-header-root", ".explore-header",
    ".rank-toolbar", ".new-song-toolbar", ".search-song-toolbar",
    ".comment-main-tabs", ".search-pinned-tabs",
  ];
  const syncHeaderBg = () => {
    if (!state.settings.wallpaperEnabled || !state.settings.frostedCards) {
      headerRafId = requestAnimationFrame(syncHeaderBg);
      return;
    }
    if (wallpaperImgW && wallpaperImgH) {
      const cw = document.documentElement.clientWidth;
      const ch = document.documentElement.clientHeight;
      const scale = Math.max(cw / wallpaperImgW, ch / wallpaperImgH);
      const drawnW = wallpaperImgW * scale;
      const drawnH = wallpaperImgH * scale;
      const bgOffsetX = (cw - drawnW) / 2;
      const bgOffsetY = (ch - drawnH) / 2;
      for (const sel of HEADER_SELECTORS) {
        for (const el of document.querySelectorAll(sel)) {
          const rect = el.getBoundingClientRect();
          if (rect.width === 0 || rect.height === 0) continue;
          const posX = bgOffsetX - rect.left;
          const posY = bgOffsetY - rect.top;
          el.style.setProperty("--ba-hdr-pos", `${posX}px ${posY}px`);
          el.style.setProperty("--ba-hdr-size", `${drawnW}px ${drawnH}px`);
        }
      }
    }
    headerRafId = requestAnimationFrame(syncHeaderBg);
  };
  headerRafId = requestAnimationFrame(syncHeaderBg);

  // MutationObserver: intercept Vue re-renders that restore backgrounds
  const appEl = document.getElementById("app");
  if (appEl) {
    wallpaperObserver = new MutationObserver(() => {
      if (wallpaperObserverTimer) clearTimeout(wallpaperObserverTimer);
      wallpaperObserverTimer = setTimeout(stripBackgrounds, 16);
    });
    wallpaperObserver.observe(appEl, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["style", "class"],
    });
  }
};

const removeWallpaper = () => {
  wallpaperObserver?.disconnect();
  wallpaperObserver = null;
  if (wallpaperObserverTimer) {
    clearTimeout(wallpaperObserverTimer);
    wallpaperObserverTimer = null;
  }
  if (headerRafId) {
    cancelAnimationFrame(headerRafId);
    headerRafId = 0;
  }
  wallpaperImgW = 0;
  wallpaperImgH = 0;
  wallpaperStyleDispose?.();
  wallpaperStyleDispose = null;
  surfaceDispose?.();
  surfaceDispose = null;
  // Clean up frosted card effects
  const fcSels = [
    ".home-feature-card", ".settings-card", ".cloud-info-card", ".plugin-card",
    ".login-panel-card", ".route-error-card", ".error-shell",
    ".explore-header", ".rank-toolbar", ".new-song-toolbar", ".search-song-toolbar",
    ".song-list-sticky", ".comment-main-tabs", ".sliver-header-root", ".search-pinned-tabs",
    ".search-suggestions-panel", ".tb-suggestions",
    ".rec-playlist-item", ".add-playlist-item", ".playlist-picker-item",
    ".plugin-settings-section", ".plugin-management-page",
    ".song-context-menu", ".drawer-panel", ".dialog-content",
    ".toast-card", ".card-container",
    ".profile-archive-card", ".radio-card", ".fm-play-sticky",
    ".fm-panel",
  ];
  for (const sel of fcSels) {
    for (const el of document.querySelectorAll(sel)) {
      el.classList.remove("ba-frosted");
      el.style.removeProperty("background");
      el.style.removeProperty("backdrop-filter");
      el.style.removeProperty("-webkit-backdrop-filter");
    }
  }
};

/* ================================================================== */
/*                                                                    */
/*   PART 3 — Font Replacement (Blueaka)                             */
/*                                                                    */
/* ================================================================== */

const resolveFontCss = async () => {
  const dir = runtimeCtx.descriptor.directory;
  const fontBase = joinPath(dir, "assets", "fonts");

  // Read both CSS files
  const [regularResult, boldResult] = await Promise.all([
    runtimeCtx.fs.readTextFile(joinPath(fontBase, "Blueaka", "Blueaka.css")),
    runtimeCtx.fs.readTextFile(joinPath(fontBase, "Blueaka_Bold", "Blueaka_Bold.css")),
  ]);

  let regularCss = regularResult?.ok ? regularResult.content : "";
  let boldCss = boldResult?.ok ? boldResult.content : "";

  // Collect all unique relative URLs from both files
  const urlRegex = /url\("(\.\/[^"]+)"\)/g;
  const relPaths = new Set();
  let m;
  while ((m = urlRegex.exec(regularCss))) relPaths.add(m[1]);
  urlRegex.lastIndex = 0;
  while ((m = urlRegex.exec(boldCss))) relPaths.add(m[1]);

  // Resolve all file URLs in parallel
  const entries = [...relPaths].map((rel) => {
    const isBold = boldCss.includes(`"${rel}"`);
    const subDir = isBold ? "Blueaka_Bold" : "Blueaka";
    const fileName = rel.replace("./", "");
    return { rel, absPath: joinPath(fontBase, subDir, fileName) };
  });

  const urlResults = await Promise.all(
    entries.map((e) => runtimeCtx.fs.getFileUrl(e.absPath).then((r) => ({ rel: e.rel, url: r?.ok ? r.url : null }))),
  );

  // Replace relative URLs with file:// URLs
  for (const { rel, url } of urlResults) {
    if (!url) continue;
    const replacement = `url("${url}")`;
    // Replace in whichever CSS file contains this path
    if (regularCss.includes(`"${rel}"`)) {
      regularCss = regularCss.split(`"${rel}"`).join(url);
    }
    if (boldCss.includes(`"${rel}"`)) {
      boldCss = boldCss.split(`"${rel}"`).join(url);
    }
  }

  return regularCss + "\n" + boldCss;
};

const applyFont = async () => {
  fontStyleDispose?.();
  fontGlobalDispose?.();
  fontStyleDispose = null;
  fontGlobalDispose = null;
  if (!runtimeCtx || !state || !state.settings.fontEnabled) return;

  try {
    const fontCss = await resolveFontCss();
    if (!fontCss) return;

    // Inject @font-face declarations
    fontStyleDispose = runtimeCtx.css.inject(fontCss, { id: "ba-font-face" });

    // Apply Blueaka font globally
    const globalFontCss = `
html, body, input, textarea, select, button,
.echo-app, .sidebar, .main-content, .player-bar,
.song-title, .artist-name, .lyric-line, .lyric-line *,
.playlist-item, .search-input, .dialog-content,
*, *::before, *::after {
  font-family: "Blueaka", "Segoe UI", "Microsoft YaHei", sans-serif !important;
}`;
    fontGlobalDispose = runtimeCtx.css.inject(globalFontCss, { id: "ba-font-global" });
  } catch (e) {
    runtimeCtx.toast?.warning?.("Blueaka 字体加载失败: " + (e?.message || e));
  }
};

const removeFont = () => {
  fontStyleDispose?.();
  fontGlobalDispose?.();
  fontStyleDispose = null;
  fontGlobalDispose = null;
};

/* ------------------------------------------------------------------ */
/*  Master apply                                                      */
/* ------------------------------------------------------------------ */

const applyAll = async () => {
  if (!state) return;
  // Spark
  if (state.settings.sparkEnabled) mountSpark();
  else unmountSpark();
  // Wallpaper
  await applyWallpaper();
  // Font
  await applyFont();
};

const persistSettings = async () => {
  if (!runtimeCtx || !state) return;
  await runtimeCtx.storage.set(STORAGE_KEY, { ...state.settings });
};

const updateSettings = async (patch) => {
  if (!state) return;
  const prev = { ...state.settings };
  state.settings = normalizeSettings({ ...state.settings, ...patch });

  // Spark toggle
  if (state.settings.sparkEnabled !== prev.sparkEnabled) {
    state.settings.sparkEnabled ? mountSpark() : unmountSpark();
  } else if (state.settings.sparkEnabled) {
    // Re-mount spark with new params
    unmountSpark();
    mountSpark();
  }

  // Wallpaper changes
  const wpChanged =
    state.settings.wallpaperEnabled !== prev.wallpaperEnabled ||
    state.settings.wallpaperId !== prev.wallpaperId ||
    state.settings.wallpaperBlur !== prev.wallpaperBlur ||
    state.settings.wallpaperDim !== prev.wallpaperDim ||
    state.settings.replaceLyricBg !== prev.replaceLyricBg ||
    state.settings.sidebarFloat !== prev.sidebarFloat ||
    state.settings.sidebarBlur !== prev.sidebarBlur ||
    state.settings.playerBlur !== prev.playerBlur ||
    state.settings.frostedCards !== prev.frostedCards ||
    state.settings.cardBlur !== prev.cardBlur ||
    state.settings.customWallpaperData !== prev.customWallpaperData;
  if (wpChanged) {
    if (state.settings.customWallpaperData !== prev.customWallpaperData) {
      cachedWallpaperUrl = null;
      cachedWallpaperId = null;
    }
    if (!state.settings.wallpaperEnabled) removeWallpaper();
    await applyWallpaper();
  }

  // Font changes
  const fontChanged = state.settings.fontEnabled !== prev.fontEnabled;
  if (fontChanged) {
    if (!state.settings.fontEnabled) removeFont();
    await applyFont();
  }

  void persistSettings();
};

/* ------------------------------------------------------------------ */
/*  Settings CSS                                                      */
/* ------------------------------------------------------------------ */

const SETTINGS_CSS = `
.dialog-content.plugin-settings-dialog:has(.echo-ba-theme-settings) { width: min(620px, 94vw); }
.echo-ba-theme-settings { display: grid; gap: 14px; min-width: 0; }
.echo-ba-section { display: grid; gap: 12px; padding: 14px; border: 1px solid var(--border-subtle); border-radius: 14px; background: var(--control-muted-bg); }
.echo-ba-section-title { color: var(--color-text-main); font-size: 13px; font-weight: 800; display: flex; align-items: center; gap: 8px; }
.echo-ba-section-badge { padding: 2px 8px; border-radius: 999px; font-size: 10px; font-weight: 700; background: color-mix(in srgb, var(--color-primary) 12%, transparent); color: var(--color-primary); }
.echo-ba-field { display: grid; grid-template-columns: minmax(0,1fr) minmax(140px,220px); align-items: center; gap: 14px; }
.echo-ba-field.is-switch { grid-template-columns: minmax(0,1fr) auto; }
.echo-ba-field.is-wide { grid-template-columns: 1fr; }
.echo-ba-copy { display: grid; gap: 3px; min-width: 0; }
.echo-ba-label { color: var(--color-text-main); font-size: 12px; font-weight: 700; }
.echo-ba-desc { color: color-mix(in srgb, var(--color-text-main) 56%, transparent); font-size: 11px; line-height: 1.5; }
.echo-ba-host-select, .echo-ba-host-slider { width: 100%; justify-self: end; }
.echo-ba-color-row { display: flex; gap: 6px; flex-wrap: wrap; }
.echo-ba-color-btn { display: flex; align-items: center; gap: 5px; padding: 3px 9px; border: 1px solid var(--control-border); border-radius: 999px; background: var(--control-muted-bg); color: var(--color-text-main); font-size: 11px; font-weight: 600; cursor: pointer; }
.echo-ba-color-btn:hover { border-color: color-mix(in srgb, var(--color-primary) 40%, var(--control-border)); }
.echo-ba-color-btn.is-active { border-color: color-mix(in srgb, var(--color-primary) 50%, transparent); background: color-mix(in srgb, var(--color-primary) 10%, transparent); }
.echo-ba-color-dot { width: 11px; height: 11px; border-radius: 50%; flex: none; }
.echo-ba-wp-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(110px, 1fr)); gap: 8px; }
.echo-ba-wp-card { position: relative; border-radius: 10px; overflow: hidden; border: 2px solid transparent; cursor: pointer; aspect-ratio: 16/10; background: var(--control-muted-bg); transition: border-color 0.15s; }
.echo-ba-wp-card:hover { border-color: color-mix(in srgb, var(--color-primary) 40%, transparent); }
.echo-ba-wp-card.is-active { border-color: var(--color-primary); }
.echo-ba-wp-card img { width: 100%; height: 100%; object-fit: cover; display: block; }
.echo-ba-wp-card-label { position: absolute; bottom: 0; left: 0; right: 0; padding: 3px 6px; background: rgba(0,0,0,0.55); color: #fff; font-size: 10px; font-weight: 600; text-align: center; }
.echo-ba-actions { display: flex; gap: 8px; justify-content: flex-end; }
.echo-ba-upload-btn { padding: 5px 12px; border-radius: 8px; border: 1px solid var(--control-border); background: var(--control-muted-bg); color: var(--color-text-main); font-size: 11px; font-weight: 600; cursor: pointer; transition: border-color 0.15s; }
.echo-ba-upload-btn:hover { border-color: color-mix(in srgb, var(--color-primary) 40%, var(--control-border)); background: color-mix(in srgb, var(--color-primary) 6%, transparent); }
.echo-ba-remove-btn { padding: 5px 10px; border-radius: 8px; border: 1px solid color-mix(in srgb, var(--state-danger, #e53) 30%, var(--control-border)); background: color-mix(in srgb, var(--state-danger, #e53) 6%, transparent); color: color-mix(in srgb, var(--state-danger, #e53) 80%, var(--color-text-main)); font-size: 11px; font-weight: 600; cursor: pointer; }
.echo-ba-remove-btn:hover { background: color-mix(in srgb, var(--state-danger, #e53) 12%, transparent); }
@media (max-width: 640px) {
  .echo-ba-field, .echo-ba-field.is-switch, .echo-ba-field.is-wide { grid-template-columns: 1fr; }
  .echo-ba-host-select, .echo-ba-host-slider { justify-self: stretch; }
}
`;

/* ------------------------------------------------------------------ */
/*  Settings component                                                */
/* ------------------------------------------------------------------ */

const createSettingsComponent = (ctx) => {
  const { defineComponent, h, defineAsyncComponent, ref, computed } = ctx.vue;
  return defineComponent({
    name: "BAThemeSettings",
    setup() {
      const Button = defineAsyncComponent(ctx.ui.components.Button);
      const Select = defineAsyncComponent(ctx.ui.components.Select);
      const Slider = defineAsyncComponent(ctx.ui.components.Slider);
      const Switch = defineAsyncComponent(ctx.ui.components.Switch);

      // Wallpaper thumbnail URLs (loaded lazily)
      const wallpaperThumbs = ref({});
      const loadWallpaperThumbs = async () => {
        const dir = ctx.descriptor.directory;
        for (const wp of WALLPAPERS) {
          const r = await ctx.fs.getFileUrl(joinPath(dir, "assets", "wallpaper", wp.file));
          if (r?.ok) wallpaperThumbs.value = { ...wallpaperThumbs.value, [wp.id]: r.url };
        }
      };
      loadWallpaperThumbs();

      // Custom wallpaper upload handler
      const handleUploadCustomWallpaper = (event) => {
        const file = event.target.files?.[0];
        if (!file) return;
        event.target.value = "";
        const reader = new FileReader();
        reader.onload = (e) => {
          const img = new Image();
          img.onload = () => {
            const MAX = 1920;
            let w = img.width, h = img.height;
            if (Math.max(w, h) > MAX) {
              const ratio = MAX / Math.max(w, h);
              w = Math.round(w * ratio);
              h = Math.round(h * ratio);
            }
            const canvas = document.createElement("canvas");
            canvas.width = w;
            canvas.height = h;
            const cx = canvas.getContext("2d");
            cx.drawImage(img, 0, 0, w, h);
            const dataUrl = canvas.toDataURL("image/jpeg", 0.82);
            updateSettings({
              customWallpaperData: dataUrl,
              customWallpaperName: file.name,
              wallpaperId: "custom",
            });
          };
          img.src = e.target.result;
        };
        reader.readAsDataURL(file);
      };
      const fileInputRef = { current: null };

      const sw = (key) =>
        h(Switch, {
          modelValue: Boolean(state.settings[key]),
          "onUpdate:modelValue": (v) => updateSettings({ [key]: Boolean(v) }),
        });

      const sl = (key, min, max, step, suffix) =>
        h(Slider, {
          class: "echo-ba-host-slider",
          modelValue: state.settings[key], min, max, step,
          showValue: true, valueSuffix: suffix,
          "onUpdate:modelValue": (v) => updateSettings({ [key]: Number(v) }),
        });

      const field = (label, desc, control, opts = {}) =>
        h("div", { class: ["echo-ba-field", opts.sw ? "is-switch" : "", opts.wide ? "is-wide" : ""] }, [
          h("span", { class: "echo-ba-copy" }, [
            h("span", { class: "echo-ba-label" }, label),
            desc ? h("span", { class: "echo-ba-desc" }, desc) : null,
          ]),
          control,
        ]);

      const renderSparkSection = () =>
        h("section", { class: "echo-ba-section" }, [
          h("div", { class: "echo-ba-section-title" }, ["✨ 点击粒子特效", h("span", { class: "echo-ba-section-badge" }, "BASpark")]),
          field("启用特效", "点击任意位置产生粒子爆炸和拖尾", sw("sparkEnabled"), { sw: true }),
          field("颜色", null,
            h("div", { class: "echo-ba-color-row" },
              COLOR_PRESETS.map((p) =>
                h("button", {
                  class: ["echo-ba-color-btn", state.settings.sparkColor === p.value ? "is-active" : ""],
                  type: "button",
                  onClick: () => updateSettings({ sparkColor: p.value }),
                }, [h("span", { class: "echo-ba-color-dot", style: { background: `rgb(${p.value})` } }), p.label]),
              ),
            ),
            { wide: true },
          ),
          field("粒子大小", null, sl("sparkScale", 0.3, 4, 0.1, "x")),
          field("透明度", null, sl("sparkOpacity", 0.1, 1, 0.05, "")),
          field("动画速度", null, sl("sparkSpeed", 0.2, 3, 0.1, "x")),
          field("拖尾长度", null, sl("sparkMaxTrail", 1, 64, 1, "")),
          field("始终显示拖尾", "无需按住鼠标", sw("sparkAlwaysTrail"), { sw: true }),
        ]);

      const renderWallpaperSection = () =>
        h("section", { class: "echo-ba-section" }, [
          h("div", { class: "echo-ba-section-title" }, ["🖼️ 角色壁纸"]),
          field("启用壁纸", "在页面背景显示蔚蓝档案角色图", sw("wallpaperEnabled"), { sw: true }),
          field("选择壁纸", null,
            h("div", { class: "echo-ba-wp-grid" }, [
              ...WALLPAPERS.map((wp) =>
                h("div", {
                  class: ["echo-ba-wp-card", state.settings.wallpaperId === wp.id ? "is-active" : ""],
                  onClick: () => updateSettings({ wallpaperId: wp.id }),
                }, [
                  wallpaperThumbs.value[wp.id]
                    ? h("img", { src: wallpaperThumbs.value[wp.id], alt: wp.label, loading: "lazy" })
                    : null,
                  h("span", { class: "echo-ba-wp-card-label" }, wp.label),
                ]),
              ),
              h("div", {
                class: ["echo-ba-wp-card", state.settings.wallpaperId === "custom" ? "is-active" : ""],
                onClick: () => {
                  if (state.settings.customWallpaperData) {
                    updateSettings({ wallpaperId: "custom" });
                  } else if (fileInputRef.current) {
                    fileInputRef.current.click();
                  }
                },
              }, [
                state.settings.customWallpaperData
                  ? h("img", { src: state.settings.customWallpaperData, alt: "自定义", loading: "lazy" })
                  : h("div", { style: "display:flex;align-items:center;justify-content:center;height:100%;font-size:28px;opacity:0.5;" }, "＋"),
                h("span", { class: "echo-ba-wp-card-label" },
                  state.settings.customWallpaperName || "自定义壁纸",
                ),
              ]),
            ]),
            { wide: true },
          ),
          h("div", { style: "display:flex;gap:8px;align-items:center;padding:2px 0 4px;" }, [
            h("input", {
              type: "file",
              accept: "image/*",
              style: "display:none;",
              ref: (el) => { fileInputRef.current = el?.$el || el; },
              onChange: handleUploadCustomWallpaper,
            }),
            h("button", {
              type: "button",
              class: "echo-ba-upload-btn",
              onClick: () => fileInputRef.current?.click(),
            }, "📁 上传自定义壁纸"),
            ...(state.settings.customWallpaperData
              ? [h("button", {
                  type: "button",
                  class: "echo-ba-remove-btn",
                  onClick: () => updateSettings({
                    customWallpaperData: "",
                    customWallpaperName: "",
                    wallpaperId: state.settings.wallpaperId === "custom" ? "arona" : state.settings.wallpaperId,
                  }),
                }, "✕ 移除")]
              : []),
          ]),
          field("模糊度", "背景模糊程度", sl("wallpaperBlur", 0, 20, 1, "px")),
          field("遮罩暗度", "背景变暗以提高文字可读性", sl("wallpaperDim", 0, 0.8, 0.05, "")),
          field("替换播放页背景", "封面模式与纯色模式的歌词页背景均替换为壁纸", sw("replaceLyricBg"), { sw: true }),
          field("悬浮侧边栏", "侧边栏变为悬浮磨砂玻璃卡片", sw("sidebarFloat"), { sw: true }),
          ...(state.settings.sidebarFloat
            ? [field("侧边栏模糊度", "磨砂玻璃的模糊程度", sl("sidebarBlur", 0, 64, 2, "px"))]
            : []),
          field("播放器栏模糊度", "底部播放器栏磨砂玻璃模糊程度", sl("playerBlur", 0, 64, 2, "px")),
          field("卡片磨砂效果", "各卡片、列表、工具栏等元素变为半透明磨砂玻璃", sw("frostedCards"), { sw: true }),
          ...(state.settings.frostedCards
            ? [field("卡片模糊度", "磨砂卡片的背景模糊程度", sl("cardBlur", 0, 64, 2, "px"))]
            : []),
        ]);

      const renderFontSection = () =>
        h("section", { class: "echo-ba-section" }, [
          h("div", { class: "echo-ba-section-title" }, ["🔤 Blueaka 字体"]),
          field("启用字体替换", "将全局字体替换为蔚蓝档案官方 Blueaka 字体", sw("fontEnabled"), { sw: true }),
          h("div", { class: "echo-ba-desc", style: "padding: 0 2px;" },
            "字体来源：kivo.wiki — 包含 Blueaka Regular (400) 和 Bold (700) 两个权重，覆盖中日韩字符集。",
          ),
        ]);

      const reset = () => updateSettings({ ...DEFAULT_SETTINGS });

      return () =>
        h("div", { class: "echo-ba-theme-settings" }, [
          renderSparkSection(),
          renderWallpaperSection(),
          renderFontSection(),
          h("div", { class: "echo-ba-actions" }, [
            h(Button, { type: "button", variant: "ghost", size: "xs", onClick: reset },
              { default: () => "恢复默认" }),
          ]),
        ]);
    },
  });
};

/* ------------------------------------------------------------------ */
/*  Plugin lifecycle                                                  */
/* ------------------------------------------------------------------ */

export async function activate(ctx) {
  runtimeCtx = ctx;
  state = ctx.vue.reactive({
    settings: normalizeSettings(await ctx.storage.get(STORAGE_KEY)),
  });

  settingsStyleDispose = ctx.css.inject(SETTINGS_CSS, { id: "ba-theme-settings" });
  settingsDispose = ctx.ui.settings.define({
    title: "Venti1112的主题包",
    description: "点击特效 + 角色壁纸 + Blueaka 字体 + 一大堆模糊",
    component: createSettingsComponent(ctx),
  });

  await applyAll();
}

export function deactivate() {
  unmountSpark();
  removeWallpaper();
  removeFont();
  settingsDispose?.();
  settingsStyleDispose?.();
  settingsDispose = null;
  settingsStyleDispose = null;
  cachedWallpaperUrl = null;
  cachedWallpaperId = null;
  runtimeCtx = null;
  state = null;
}
