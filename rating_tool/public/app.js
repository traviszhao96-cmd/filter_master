const app = document.querySelector('#app');

const state = {
  session: null,
  config: null,
  rules: { filters: [], scenes: [] },
  images: [],
  sceneSets: [],
  selectedSceneSetId: 'filter_rating',
  ratings: { own: {}, aggregate: {} },
  annotations: { own: { images: {}, filters: {} }, aggregate: { images: {}, filters: {} } },
  selectedImageId: null,
  activeFilterId: null,
  layoutMode: 'preview',
  listMode: 'all',
  filterMode: 'recommended',
  sourceFilter: 'all',
  filterQuery: '',
  query: '',
  recommendationShuffleSeed: Math.random().toString(36).slice(2),
  originalImage: null,
  lutCache: new Map(),
  previewRunId: 0,
  saving: false,
  annotationSaving: false,
  annotationSaveTimer: null,
  annotationPendingPayload: null,
  annotationSavePromise: null,
  annotationSaveQueued: false,
  refreshing: false,
  refreshStatus: '',
  debug: false,
  debugEvents: [],
  sceneDiagnostics: null
};

window.__sceneLutDebug = {
  events: state.debugEvents,
  state: () => ({
    url: window.location.href,
    layoutMode: state.layoutMode,
    selectedSceneSetId: state.selectedSceneSetId,
    selectedImageId: state.selectedImageId,
    activeFilterId: state.activeFilterId,
    imageCount: state.images.length,
    sceneSets: state.sceneSets
  })
};

const UNKNOWN_SCENE_FALLBACK_FILTER_IDS = [
  'ai_portrait_soft',
  'ai_forest_fresh',
  'lut_店主推荐_709日系奶油低饱和_e882a24171',
  'lut_filter-lut_自然11_1918e5af72',
  'lut_filter-lut_质感11_d4e9593069'
];
const RECOMMENDATION_CANDIDATE_LIMIT = 5;
const RECOMMENDATION_PROMOTED_LIMIT = 3;
const FILTER_RATING_SCENE_SET_ID = 'filter_rating';
const FILTER_ANNOTATION_SCENE_SET_ID = 'filter_annotation';
const VALID_LAYOUT_MODES = new Set(['preview', 'immersive', 'annotate']);
const DEFAULT_SCENE_SETS = [
  { id: FILTER_RATING_SCENE_SET_ID, name: '滤镜打分场景', description: '用于同事打星评分的当前主场景库。', count: 0 },
  { id: 'acceptance', name: '验收场景', description: '用于后续验证推荐规则和 APK 端表现。', count: 0 },
  { id: FILTER_ANNOTATION_SCENE_SET_ID, name: '滤镜标注场景', description: '用于给滤镜写风格、色相和风险描述。', count: 0 }
];
const PRODUCT_SCENE_LABELS = {
  portrait_single: { zh: '人像', en: 'Portrait' },
  food_closeup: { zh: '美食', en: 'Food' },
  sunset_sunrise: { zh: '日落', en: 'Sunset' },
  night_neon: { zh: '夜景', en: 'Night' },
  forest_greenery: { zh: '绿植', en: 'Greenery' },
  beach_sea: { zh: '海边', en: 'Beach' },
  street_vehicle: { zh: '街景', en: 'Street' },
  architecture: { zh: '建筑', en: 'Architecture' },
  sky_cloud: { zh: '天空', en: 'Sky' },
  pet: { zh: '宠物', en: 'Pet' },
  flower_macro: { zh: '花草', en: 'Flower' },
  auto_show: { zh: '车辆', en: 'Auto' },
  mountain: { zh: '山景', en: 'Mountain' },
  lake_river: { zh: '湖河', en: 'Lake' },
  waterfall: { zh: '瀑布', en: 'Waterfall' },
  snow: { zh: '雪景', en: 'Snow' },
  document: { zh: '文档', en: 'Document' },
  indoor_home: { zh: '室内', en: 'Indoor' }
};
const FILTER_TAG_GROUPS = {
  filterStyleTags: ['natural', 'film', 'fresh', 'soft', 'retro', 'cinematic', 'black_white', 'clean', 'high_texture'],
  riskTags: ['skin_tone_risk', 'shadow_crush', 'highlight_clip', 'over_saturation', 'green_shift', 'magenta_shift', 'text_legibility_risk', 'too_stylized'],
};
const FILTER_TAG_LABELS = {
  natural: '自然真实',
  film: '胶片感',
  fresh: '清新',
  soft: '柔和',
  retro: '复古',
  cinematic: '电影感',
  black_white: '黑白',
  clean: '干净通透',
  high_texture: '质感强',
  skin_tone_risk: '肤色风险',
  shadow_crush: '暗部死黑',
  highlight_clip: '高光过曝',
  over_saturation: '过饱和',
  green_shift: '偏绿风险',
  magenta_shift: '偏洋红风险',
  text_legibility_risk: '文字可读性风险',
  too_stylized: '风格过重'
};
const FALLBACK_FILTER_ATTRIBUTE_OPTIONS = {
  style: ['自然', '胶片', '清新', '柔和', '复古', '电影感', '黑白', '干净'],
  saturation: ['低饱和', '略降饱和', '自然饱和', '略增饱和', '高饱和'],
  contrast: ['低对比', '略低对比', '自然对比', '略高对比', '高对比'],
  hue: ['偏绿', '偏洋红', '青橙', '中性'],
  colorTemp: ['偏冷', '中性', '偏暖']
};

const api = {
  async get(path) {
    const response = await fetch(path, { credentials: 'same-origin' });
    return parseResponse(response);
  },
  async post(path, body = {}) {
    const response = await fetch(path, {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
    return parseResponse(response);
  }
};

async function parseResponse(response) {
  const contentType = response.headers.get('content-type') || '';
  const data = contentType.includes('application/json') ? await response.json() : await response.text();
  if (!response.ok) {
    const message = typeof data === 'object' ? data.error || response.statusText : data;
    throw new Error(message);
  }
  return data;
}

function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function addDebugEvent(type, detail = {}) {
  const item = {
    at: new Date().toLocaleTimeString('zh-CN', { hour12: false }),
    type,
    detail
  };
  state.debugEvents.unshift(item);
  state.debugEvents = state.debugEvents.slice(0, 20);
  window.__sceneLutDebug.events = state.debugEvents;
  if (state.debug) console.info('[Scene LUT debug]', type, detail);
}

window.addEventListener('error', (event) => {
  addDebugEvent('window-error', {
    message: event.message,
    source: event.filename,
    line: event.lineno,
    column: event.colno
  });
});

window.addEventListener('unhandledrejection', (event) => {
  addDebugEvent('promise-rejection', {
    message: event.reason?.message || String(event.reason || '')
  });
});

function filterById(id) {
  return state.rules.filters.find((filter) => filter.id === id);
}

function hashString(value) {
  let hash = 2166136261;
  for (const char of String(value)) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function stableRandomOrder(values, seed) {
  return [...values]
    .map((value, index) => ({
      value,
      order: hashString(`${seed}:${value}:${index}`)
    }))
    .sort((a, b) => a.order - b.order)
    .map((item) => item.value);
}

function promoteRandomRecommendations(ids, image) {
  const candidates = ids.slice(0, RECOMMENDATION_CANDIDATE_LIMIT);
  if (candidates.length <= RECOMMENDATION_PROMOTED_LIMIT) return candidates;
  const seed = `${state.recommendationShuffleSeed}:${state.session?.user?.id || 'guest'}:${image?.id || ''}`;
  const promoted = new Set(stableRandomOrder(candidates, seed).slice(0, RECOMMENDATION_PROMOTED_LIMIT));
  return [
    ...candidates.filter((id) => promoted.has(id)),
    ...candidates.filter((id) => !promoted.has(id))
  ];
}

function selectedImage() {
  return state.images.find((image) => image.id === state.selectedImageId) || null;
}

function ownRating(imageId = state.selectedImageId) {
  return state.ratings.own[imageId] || { filters: {}, allBad: false, note: '' };
}

function filterStrengthLabel(filter) {
  return `应用 ${Number(filter?.defaultStrength ?? 100)}%`;
}

function completionStatus(imageId) {
  const rating = ownRating(imageId);
  const hasPositive = Object.values(rating.filters || {}).some((value) => Number(value) > 0);
  return hasPositive ? 'done' : 'open';
}

function isImageComplete(imageId = state.selectedImageId) {
  return completionStatus(imageId) !== 'open';
}

function normalizeSceneSets(sceneSets = [], images = state.images) {
  const byId = new Map(DEFAULT_SCENE_SETS.map((sceneSet) => [sceneSet.id, { ...sceneSet, count: 0 }]));
  for (const sceneSet of sceneSets || []) {
    if (!sceneSet?.id) continue;
    byId.set(sceneSet.id, {
      ...(byId.get(sceneSet.id) || {}),
      ...sceneSet,
      count: Number(sceneSet.count || 0)
    });
  }
  for (const item of byId.values()) item.count = 0;
  for (const image of images || []) {
    const id = image.sceneSetId || FILTER_RATING_SCENE_SET_ID;
    if (!byId.has(id)) byId.set(id, { id, name: image.sceneSetName || id, description: '', count: 0 });
    byId.get(id).count += 1;
  }
  return [...byId.values()];
}

function sceneSetById(id) {
  return state.sceneSets.find((sceneSet) => sceneSet.id === id) || state.sceneSets[0] || DEFAULT_SCENE_SETS[0];
}

function sceneSetImages(sceneSetId = state.selectedSceneSetId) {
  return state.images.filter((image) => (image.sceneSetId || FILTER_RATING_SCENE_SET_ID) === sceneSetId);
}

function currentSceneSetImages() {
  return sceneSetImages(state.selectedSceneSetId);
}

function applyRouteState() {
  const params = new URLSearchParams(window.location.search);
  const mode = params.get('mode');
  const sceneSetId = params.get('sceneSet');
  state.debug = params.get('debug') === '1' || localStorage.getItem('scene-lut-debug') === '1';
  if (VALID_LAYOUT_MODES.has(mode)) state.layoutMode = mode;
  if (sceneSetId) state.selectedSceneSetId = sceneSetId;
  if (state.layoutMode === 'annotate') state.selectedSceneSetId = FILTER_ANNOTATION_SCENE_SET_ID;
  if (state.selectedSceneSetId === FILTER_ANNOTATION_SCENE_SET_ID) state.layoutMode = 'annotate';
}

function routeForLayoutMode(mode) {
  const params = new URLSearchParams(window.location.search);
  params.set('mode', mode);
  if (mode === 'annotate') {
    params.set('sceneSet', FILTER_ANNOTATION_SCENE_SET_ID);
  } else if (params.get('sceneSet') === FILTER_ANNOTATION_SCENE_SET_ID) {
    params.set('sceneSet', FILTER_RATING_SCENE_SET_ID);
  }
  return `?${params.toString()}`;
}

function routeForSceneSet(sceneSetId) {
  const params = new URLSearchParams(window.location.search);
  params.set('sceneSet', sceneSetId);
  params.set('mode', sceneSetId === FILTER_ANNOTATION_SCENE_SET_ID ? 'annotate' : 'preview');
  return `?${params.toString()}`;
}

function routeForDebug(enabled = !state.debug) {
  const params = new URLSearchParams(window.location.search);
  if (enabled) params.set('debug', '1');
  else params.delete('debug');
  const query = params.toString();
  return `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`;
}

function syncRouteState() {
  const params = new URLSearchParams(window.location.search);
  params.set('mode', state.layoutMode);
  params.set('sceneSet', state.selectedSceneSetId);
  const nextUrl = `${window.location.pathname}?${params.toString()}${window.location.hash}`;
  window.history.replaceState(null, '', nextUrl);
}

function ensureSelectedSceneSet() {
  if (!state.sceneSets.some((sceneSet) => sceneSet.id === state.selectedSceneSetId)) {
    state.selectedSceneSetId = FILTER_RATING_SCENE_SET_ID;
  }
}

function ensureSelectedImageForSceneSet() {
  ensureSelectedSceneSet();
  const scopedImages = currentSceneSetImages();
  if (scopedImages.some((image) => image.id === state.selectedImageId)) return;
  state.selectedImageId = scopedImages[0]?.id || null;
}

function visibleImages() {
  const query = state.query.trim().toLowerCase();
  return currentSceneSetImages().filter((image) => {
    if (state.listMode === 'open' && completionStatus(image.id) !== 'open') return false;
    if (state.listMode === 'done' && completionStatus(image.id) === 'open') return false;
    if (!query) return true;
    const haystack = [
      image.filename,
      image.relativePath,
      image.directory,
      ...image.tags,
      ...image.sceneMatches.flatMap((scene) => [scene.displayName, scene.sceneId, productSceneLabel(scene)])
    ]
      .join(' ')
      .toLowerCase();
    return haystack.includes(query);
  });
}

function recommendedFilterIdsForImage(image) {
  const aggregate = state.ratings.aggregate?.[image?.id]?.filters || {};
  const recommended = (image?.recommendedFilterIds || []).filter((id) => {
    const item = aggregate[id];
    return !(item?.count > 0 && Number(item.average) <= 0);
  });
  if (recommended.length) return promoteRandomRecommendations(recommended, image);
  return promoteRandomRecommendations(UNKNOWN_SCENE_FALLBACK_FILTER_IDS.filter((id) => filterById(id)), image);
}

async function init() {
  renderLoading();
  const session = await api.get('/api/session');
  state.session = session;
  applyRouteState();
  if (!session.user) {
    renderLogin(session);
    return;
  }
  await loadWorkspace();
  renderApp();
}

async function loadWorkspace() {
  const [config, rules, imagesResponse, ratings, annotations] = await Promise.all([
    api.get('/api/config'),
    api.get('/api/rules'),
    api.get('/api/images'),
    api.get('/api/ratings'),
    api.get('/api/annotations')
  ]);
  state.config = config;
  state.rules = rules;
  state.images = imagesResponse.images || [];
  state.sceneSets = normalizeSceneSets(imagesResponse.sceneSets || [], state.images);
  state.ratings = ratings;
  state.annotations = annotations;
  state.sceneDiagnostics = state.debug
    ? await api.get('/api/debug/scene-library').catch((error) => ({ error: error.message }))
    : null;
  ensureSelectedImageForSceneSet();
  if (!filterById(state.activeFilterId)) {
    state.activeFilterId = pickDefaultFilter(selectedImage())?.id || null;
  }
}

function renderLoading() {
  app.innerHTML = '<div class="loading">正在加载评分台...</div>';
}

function renderLogin(session) {
  if (session.larkEnabled) {
    app.innerHTML = `
      <main class="login-shell">
        <section class="login-panel">
          <h1 class="login-title">Scene LUT 评分台</h1>
          <p class="login-subtitle">使用飞书账号登录，开始对本地场景库里的图片滤镜效果打分。</p>
          <div class="login-actions">
            <button class="primary-btn lark-login-btn" id="larkLogin" type="button">飞书 Lark 登录</button>
          </div>
          ${renderLoginDebug()}
        </section>
      </main>
    `;

    document.querySelector('#larkLogin').addEventListener('click', () => {
      const next = `${window.location.pathname}${window.location.search}${window.location.hash}`;
      window.location.href = `/auth/lark?next=${encodeURIComponent(next)}`;
    });
    return;
  }

  app.innerHTML = `
    <main class="login-shell">
      <section class="login-panel">
        <h1 class="login-title">Scene LUT 评分台</h1>
        <p class="login-subtitle">登录后开始对本地场景库里的图片滤镜效果打分。</p>
        <form id="loginForm">
          <div class="field">
            <label for="loginName">姓名</label>
            <input id="loginName" name="name" autocomplete="name" required />
          </div>
          ${
            session.accessCodeRequired
              ? `<div class="field">
                  <label for="accessCode">访问码</label>
                  <input id="accessCode" name="accessCode" type="password" autocomplete="current-password" required />
                </div>`
              : ''
          }
          <div class="login-actions">
            <button class="primary-btn" type="submit">进入评分台</button>
          </div>
          <div class="error-text" id="loginError"></div>
          ${renderLoginDebug()}
        </form>
      </section>
    </main>
  `;

  document.querySelector('#loginForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const error = document.querySelector('#loginError');
    error.textContent = '';
    try {
      await api.post('/api/login', {
        name: form.get('name'),
        accessCode: form.get('accessCode') || ''
      });
      await init();
    } catch (err) {
      error.textContent = err.message === 'bad_access_code' ? '访问码不正确。' : '登录失败，请重试。';
    }
  });
}

function renderLoginDebug() {
  if (!state.debug) return '';
  const next = `${window.location.pathname}${window.location.search}${window.location.hash}`;
  return `
    <div class="login-debug">
      <strong>调试信息</strong>
      <span>当前入口：${escapeHtml(next || '/')}</span>
      <span>登录后会回到当前入口；如果要直接进滤镜标注，请使用 <code>?mode=annotate&amp;sceneSet=filter_annotation&amp;debug=1</code>。</span>
    </div>
  `;
}

function renderApp() {
  if (!state.images.length) {
    renderEmptyLibrary();
    return;
  }

  ensureSelectedImageForSceneSet();
  const scopedImages = currentSceneSetImages();
  const doneCount = scopedImages.filter((image) => completionStatus(image.id) !== 'open').length;
  const progress = scopedImages.length ? Math.round((doneCount / scopedImages.length) * 100) : 0;
  const image = selectedImage();
  const rating = image ? ownRating(image.id) : { filters: {}, allBad: false, note: '' };

  app.innerHTML = `
    <div class="app-shell">
      <header class="topbar">
        <div class="brand">
          <div class="brand-mark" aria-hidden="true"></div>
          <div class="brand-text">
            <h1 class="brand-title">Scene LUT 评分台</h1>
            <div class="brand-path" title="${escapeHtml(state.config.sceneLibraryDir)}">${escapeHtml(
              state.config.sceneLibraryDir
            )}</div>
          </div>
        </div>
        <div class="top-actions">
          <button class="secondary-btn" id="helpBtn" type="button">使用说明</button>
          ${renderLayoutSwitcher()}
          <a class="secondary-btn" href="/api/export/ratings.csv" target="_blank" rel="noreferrer">导出 CSV</a>
          <a class="secondary-btn" href="/api/export/ratings.json" target="_blank" rel="noreferrer">导出 JSON</a>
          <a class="secondary-btn" href="/api/export/annotations.json" target="_blank" rel="noreferrer">导出滤镜标注</a>
          <button class="secondary-btn" id="reloadBtn" type="button" ${state.refreshing ? 'disabled' : ''}>${
            state.refreshing ? '刷新中...' : '刷新场景库'
          }</button>
          <a class="secondary-btn" href="${routeForDebug(!state.debug)}">${state.debug ? '关闭调试' : '调试'}</a>
          ${state.refreshStatus ? `<div class="top-status">${escapeHtml(state.refreshStatus)}</div>` : ''}
          <div class="user-chip" title="${escapeHtml(state.session.user.name)}"><span>${escapeHtml(
            state.session.user.name
          )}</span></div>
          <button class="icon-btn" id="logoutBtn" type="button" title="退出">退出</button>
        </div>
      </header>
      <main class="workspace">
        ${renderSidebar(doneCount, progress)}
        <section class="main-panel ${panelModeClass()}">
          ${renderMainPanelContent(image, rating)}
        </section>
      </main>
      ${renderDebugPanel()}
    </div>
  `;

  bindAppEvents();
  if (image && (isFilterAnnotationContext() || state.layoutMode === 'preview' || state.layoutMode === 'immersive')) {
    loadSelectedImageAndRenderPreviews();
  }
  // Auto-show welcome on first visit
  if (!isFilterAnnotationContext() && !sessionStorage.getItem('lut-welcome-shown')) {
    setTimeout(() => showWelcomePopup(), 400);
    sessionStorage.setItem('lut-welcome-shown', '1');
  }
}

function renderLayoutSwitcher() {
  return `
    <div class="segmented layout-switcher" data-layout-switch>
      ${layoutSegmentButton('preview', '大图选片', isFilterAnnotationContext() ? '' : state.layoutMode)}
      ${layoutSegmentButton('immersive', '沉浸选片', isFilterAnnotationContext() ? '' : state.layoutMode)}
      ${layoutSegmentButton('annotate', '滤镜标注', isFilterAnnotationContext() ? 'annotate' : state.layoutMode)}
    </div>
  `;
}

function layoutSegmentButton(value, label, active) {
  return `<a class="${value === active ? 'active' : ''}" href="${routeForLayoutMode(value)}" data-layout-value="${value}">${label}</a>`;
}

function isFilterAnnotationContext() {
  return state.layoutMode === 'annotate' || state.selectedSceneSetId === FILTER_ANNOTATION_SCENE_SET_ID;
}

function panelModeClass() {
  if (state.layoutMode === 'immersive') return 'immersive-panel';
  if (isFilterAnnotationContext()) return 'single-panel';
  return '';
}

function renderMainPanelContent(image, rating) {
  if (isFilterAnnotationContext()) {
    return renderFilterAnnotationWorkbench(image);
  }
  if (state.layoutMode === 'immersive') {
    if (!image) return renderEmptySceneSetPanel();
    return renderFilterSection(image, rating, { immersive: true });
  }
  if (!image) return renderEmptySceneSetPanel();
  return `
    ${renderReviewStage(image, rating)}
    ${renderFilterSection(image, rating)}
  `;
}

function renderDebugPanel() {
  if (!state.debug) return '';
  const filterAnnotationImages = state.images.filter((image) => image.sceneSetId === FILTER_ANNOTATION_SCENE_SET_ID);
  const diagnostics = state.sceneDiagnostics || {};
  const filterDiag = diagnostics.filterAnnotation || {};
  const supported = diagnostics.supportedImageExtensions || state.config?.supportedImageExtensions || [];
  const stableFormats = diagnostics.browserRecommendedImageExtensions || state.config?.browserRecommendedImageExtensions || [];
  const warnings = [];
  for (const image of filterDiag.images || []) {
    if (!image.browserPreviewStable) warnings.push(`${image.filename} 的格式 ${image.extension} 浏览器预览可能不稳定`);
  }

  return `
    <aside class="debug-panel">
      <div class="debug-head">
        <strong>调试面板</strong>
        <a href="${routeForDebug(false)}">关闭</a>
      </div>
      <div class="debug-grid">
        <span>URL</span><code>${escapeHtml(window.location.href)}</code>
        <span>布局</span><code>${escapeHtml(state.layoutMode)}</code>
        <span>场景集</span><code>${escapeHtml(state.selectedSceneSetId)}</code>
        <span>当前图</span><code>${escapeHtml(state.selectedImageId || 'none')}</code>
        <span>图片总数</span><code>${state.images.length}</code>
        <span>滤镜标注图</span><code>${filterAnnotationImages.length}</code>
        <span>支持格式</span><code>${escapeHtml(supported.join(', '))}</code>
        <span>建议格式</span><code>${escapeHtml(stableFormats.join(', '))}</code>
      </div>
      <div class="debug-actions">
        <a class="primary-btn" href="?mode=annotate&sceneSet=filter_annotation&debug=1">进入滤镜标注</a>
        <a class="secondary-btn" href="/api/debug/scene-library" target="_blank" rel="noreferrer">打开场景诊断 JSON</a>
      </div>
      ${
        diagnostics.error
          ? `<div class="debug-error">诊断接口失败：${escapeHtml(diagnostics.error)}</div>`
          : `<div class="debug-section">
              <strong>滤镜标注场景文件</strong>
              <div>图片 ${Number(filterDiag.images?.length || 0)}，sidecar ${Number(filterDiag.sidecars?.length || 0)}，忽略 ${Number(filterDiag.ignored?.length || 0)}</div>
              ${
                warnings.length
                  ? `<div class="debug-warning">${warnings.map(escapeHtml).join('<br />')}</div>`
                  : '<div class="debug-ok">当前滤镜标注图格式适合浏览器预览。</div>'
              }
              <div class="debug-file-list">
                ${(filterDiag.images || [])
                  .map((item) => `<code>${escapeHtml(item.relPath)}</code>`)
                  .join('')}
              </div>
            </div>`
      }
      <div class="debug-section">
        <strong>最近事件</strong>
        <div class="debug-event-list">
          ${
            state.debugEvents.length
              ? state.debugEvents
                  .map(
                    (item) =>
                      `<div><code>${escapeHtml(item.at)}</code> ${escapeHtml(item.type)} ${escapeHtml(
                        JSON.stringify(item.detail || {})
                      )}</div>`
                  )
                  .join('')
              : '<span>暂无事件</span>'
          }
        </div>
      </div>
    </aside>
  `;
}

function renderEmptyLibrary() {
  const dir = state.config?.sceneLibraryDir || '';
  app.innerHTML = `
    <div class="app-shell">
      <header class="topbar">
        <div class="brand">
          <div class="brand-mark" aria-hidden="true"></div>
          <div class="brand-text">
            <h1 class="brand-title">Scene LUT 评分台</h1>
            <div class="brand-path">${escapeHtml(dir)}</div>
          </div>
        </div>
        <div class="top-actions">
          <button class="secondary-btn" id="reloadBtn" type="button" ${state.refreshing ? 'disabled' : ''}>${
            state.refreshing ? '刷新中...' : '刷新场景库'
          }</button>
          ${state.refreshStatus ? `<div class="top-status">${escapeHtml(state.refreshStatus)}</div>` : ''}
          <button class="icon-btn" id="logoutBtn" type="button">退出</button>
        </div>
      </header>
      <main class="workspace">
        <section class="empty-state">
          <div>
            <strong>当前场景库没有图片。</strong><br />
            把图片放到 <code>${escapeHtml(dir)}</code>，或启动时设置 <code>SCENE_LIBRARY_DIR</code>。
          </div>
        </section>
      </main>
    </div>
  `;
  document.querySelector('#reloadBtn').addEventListener('click', async () => {
    await refreshSceneLibrary();
  });
  document.querySelector('#logoutBtn').addEventListener('click', logout);
}

function renderSidebar(doneCount, progress) {
  const images = visibleImages();
  const scopedImages = currentSceneSetImages();
  const sceneSet = sceneSetById(state.selectedSceneSetId);
  return `
    <aside class="sidebar">
      <div class="sidebar-head">
        <div class="progress-row">
          <div>
            <div class="progress-title">${escapeHtml(sceneSet.name || '场景库')}</div>
            <div class="progress-caption">${escapeHtml(sceneSet.description || '')}</div>
          </div>
          <div class="progress-count">${doneCount}/${scopedImages.length}</div>
        </div>
        <div class="progress-track"><div class="progress-fill" style="width: ${progress}%"></div></div>
      </div>
      <div class="scene-set-switch" data-scene-set-switch>
        ${state.sceneSets.map(renderSceneSetButton).join('')}
      </div>
      <div class="segmented" data-segment="listMode">
        ${segmentButton('all', '全部', state.listMode)}
        ${segmentButton('open', '未完成', state.listMode)}
        ${segmentButton('done', '已完成', state.listMode)}
      </div>
      <div class="image-list">
        ${images.length ? images.map(renderImageItem).join('') : renderEmptyImageList(sceneSet)}
      </div>
    </aside>
  `;
}

function renderSceneSetButton(sceneSet) {
  return `
    <a class="scene-set-tab ${sceneSet.id === state.selectedSceneSetId ? 'active' : ''}" href="${routeForSceneSet(sceneSet.id)}" data-scene-set-id="${escapeHtml(
      sceneSet.id
    )}">
      <span>${escapeHtml(sceneSet.name)}</span>
      <strong>${Number(sceneSet.count || 0)}</strong>
    </a>
  `;
}

function renderEmptyImageList(sceneSet) {
  return `
    <div class="empty-list">
      <strong>${escapeHtml(sceneSet.name || '当前场景集')}暂无图片</strong>
      <span>把图片放到对应目录后刷新场景库。</span>
    </div>
  `;
}

function renderEmptySceneSetPanel() {
  const sceneSet = sceneSetById(state.selectedSceneSetId);
  return `
    <section class="empty-state">
      <div>
        <strong>${escapeHtml(sceneSet.name || '当前场景集')}暂无图片。</strong><br />
        后续可以把图片放到 <code>${escapeHtml(sceneSet.name || '')}</code> 对应目录，再点击刷新场景库。
      </div>
    </section>
  `;
}

function segmentButton(value, label, active) {
  return `<button class="${value === active ? 'active' : ''}" type="button" data-value="${value}">${label}</button>`;
}

function renderImageItem(image) {
  const status = completionStatus(image.id);
  const scenes =
    image.labelStatus === 'reference'
      ? '滤镜标注参考图'
      : ((image.productTags || []).map(t => `#${t}`).join(' ') || image.sceneMatches.map(productSceneLabel).join(' / ') || image.directory || '未匹配场景');
  return `
    <button class="image-item ${image.id === state.selectedImageId ? 'active' : ''}" type="button" data-image-id="${escapeHtml(
      image.id
    )}">
      <img class="image-thumb" src="${image.url}" alt="" loading="lazy" />
      <div>
        <div class="image-name">${escapeHtml(image.filename)}</div>
        <div class="image-meta">${escapeHtml(scenes)}</div>
      </div>
      <span class="status-dot ${status === 'done' ? 'done' : status === 'bad' ? 'bad' : ''}" title="${statusLabel(
        status
      )}"></span>
    </button>
  `;
}

function statusLabel(status) {
  if (status === 'done') return '已打分';
  return '未开始';
}

function renderImageSignalGroups(image, labelLimit = 12) {
  if (image.labelStatus === 'reference') {
    return `
      <div class="signal-groups">
        <div class="signal-group">
          <div class="signal-title">滤镜标注参考图</div>
          <div class="tag-row">
            <span class="chip strong">不打 ML Kit 标签</span>
            <span class="chip">不参与产品场景推荐</span>
          </div>
        </div>
      </div>
    `;
  }

  const productTags = image.productTags || [];
  const labels = (image.labels || []).slice(0, labelLimit);
  return `
    <div class="signal-groups">
      <div class="signal-group">
        <div class="signal-title">产品标签 v2 · ${productTags.length}</div>
        <div class="tag-row">
          ${
            productTags.length
              ? productTags
                  .map((tag) => `<span class="chip strong">#${escapeHtml(tag)}</span>`)
                  .join('')
              : '<span class="chip">未打产品标签</span>'
          }
        </div>
      </div>
      <div class="signal-group">
        <div class="signal-title">ML Kit 原始标签 · ${image.labelStatus === 'labeled' ? image.labels.length : 0}</div>
        <div class="tag-row">
          ${
            image.labelStatus === 'labeled'
              ? labels.map(renderMlKitChip).join('')
              : '<span class="chip">未打 ML Kit 标签</span>'
          }
        </div>
      </div>
    </div>
  `;
}

function productSceneLabel(scene) {
  const info = PRODUCT_SCENE_LABELS[scene?.sceneId] || null;
  if (info) return `${info.zh} / ${info.en}`;
  return scene?.displayName || scene?.sceneId || '';
}

function renderMlKitChip(label) {
  const suffix = label.confidence === null ? '' : ` ${(label.confidence * 100).toFixed(0)}%`;
  const index = label.index === null ? '' : `#${label.index} `;
  return `<span class="chip">${escapeHtml(index + (label.label || 'Label') + suffix)}</span>`;
}

function formatSceneScore(score) {
  const value = Number(score || 0);
  if (!Number.isFinite(value)) return '';
  return value >= 1000 ? value.toFixed(0) : value.toFixed(1);
}

function renderImageHeader(image) {
  return `
    <section class="image-header">
      <div class="image-title-row">
        <div>
          <h2 class="image-title">${escapeHtml(image.filename)}</h2>
          <div class="image-subtitle">${escapeHtml(image.relativePath)}</div>
        </div>
      </div>
      ${renderImageSignalGroups(image, 8)}
    </section>
  `;
}

function renderReviewStage(image, rating) {
  const activeFilter = filterById(state.activeFilterId);
  return `
    <section class="review-stage">
      <aside class="preview-side">
        <div class="preview-side-header">
          <div class="image-title-row">
            <div>
              <h2 class="image-title">${escapeHtml(image.filename)}</h2>
              <div class="image-subtitle">${escapeHtml(image.relativePath)}</div>
            </div>
          </div>
          ${renderImageSignalGroups(image, 12)}
        </div>
        <div class="preview-side-filters">
          <div>
            <div class="side-title">原图</div>
            <img class="original-img" src="${image.url}" alt="${escapeHtml(image.filename)}" />
          </div>
          <div>
            <div class="side-title">当前滤镜</div>
            <div class="active-filter-name">${escapeHtml(activeFilter?.attrLabel || activeFilter?.displayName || '原图')}</div>
            ${
              activeFilter?.attrLabel && activeFilter?.displayName
                ? `<div class="active-filter-original">${escapeHtml(activeFilter.displayName)}</div>`
                : ''
            }
            <div class="active-filter-detail">
              ${escapeHtml(activeFilter ? activeFilter.id : '')}
            </div>
            ${activeFilter ? renderQuickRating(activeFilter, rating) : ''}
          </div>
          <div class="completion-box">
            <textarea class="note-input" id="noteInput" placeholder="备注">${escapeHtml(rating.note || '')}</textarea>
          </div>
        </div>
      </aside>
      <div class="preview-wrap">
        <canvas class="main-canvas" id="mainCanvas" width="1280" height="860"></canvas>
        <button class="preview-original-btn" id="originalBtn" type="button">原图</button>
      </div>
    </section>
  `;
}

function renderQuickRating(filter, rating) {
  const qv = Number(rating.filters?.[filter.id] ?? 0);
  const qRated = filter.id in (rating.filters || {});
  return `<div class="quick-rating" role="group" aria-label="评分">
    <span class="quick-rating-label">评分</span>
    <button class="zero-btn" type="button" data-rate-filter="${escapeHtml(filter.id)}" data-rating="0">0</button>
    ${[1, 2, 3, 4, 5]
      .map(
        (star) =>
          `<button class="star-btn ${qv >= star ? 'on' : ''}" type="button" data-rate-filter="${escapeHtml(
            filter.id
          )}" data-rating="${star}">★</button>`
      )
      .join('')}
    ${qRated ? `<span class="rating-desc-inline">${escapeHtml(RATING_DESCRIPTIONS[qv] || '')}</span>` : ''}
  </div>`;
}

function renderFilterSection(image, rating, options = {}) {
  const immersive = Boolean(options.immersive);
  const recommended = new Set(recommendedFilterIdsForImage(image));
  const effectiveMode = state.filterMode === 'recommended' && recommended.size ? 'recommended' : 'all';
  const filters = visibleFiltersForImage(image);
  const sources = state.rules.lutSources || [];
  return `
    <section class="filter-section ${immersive ? 'immersive-filter-section' : ''}">
      <div class="filter-toolbar">
        <div>
          <div class="filter-toolbar-title">${immersive ? escapeHtml(image.filename) : '滤镜评分'}</div>
          <div class="filter-toolbar-subtitle">${filters.length}/${state.rules.filters.length} 个 LUT</div>
        </div>
        <div class="filter-controls">
          <select class="source-select" id="sourceFilter" ${effectiveMode === 'recommended' ? 'disabled' : ''}>
            <option value="all" ${state.sourceFilter === 'all' ? 'selected' : ''}>全部来源</option>
            ${sources
              .map(
                (source) =>
                  `<option value="${escapeHtml(source.id)}" ${
                    state.sourceFilter === source.id ? 'selected' : ''
                  }>${escapeHtml(source.name)} (${source.count})</option>`
              )
              .join('')}
          </select>
        <div class="segmented" data-segment="filterMode">
          ${segmentButton('recommended', '推荐', effectiveMode)}
          ${segmentButton('all', '全部', effectiveMode)}
        </div>
        </div>
      </div>
      <div class="filter-grid ${immersive ? 'immersive-filter-grid' : ''}">
        ${filters
          .map((filter) => renderFilterCard(filter, rating, recommended.has(filter.id), { immersive }))
          .join('')}
      </div>
    </section>
  `;
}

function visibleFiltersForImage(image) {
  const recommended = new Set(recommendedFilterIdsForImage(image));
  const effectiveMode = state.filterMode === 'recommended' && recommended.size ? 'recommended' : 'all';
  return filterVisibleFilters(sortedFilters(image), recommended, effectiveMode);
}

function sortedFilters(image) {
  const recommended = recommendedFilterIdsForImage(image);
  const order = new Map(recommended.map((id, index) => [id, index]));
  return [...state.rules.filters].sort((a, b) => {
    const aOrder = order.has(a.id) ? order.get(a.id) : 1000;
    const bOrder = order.has(b.id) ? order.get(b.id) : 1000;
    return (
      aOrder - bOrder ||
      Number(a.sortOrder ?? 0) - Number(b.sortOrder ?? 0) ||
      String(a.sourceName || '').localeCompare(String(b.sourceName || ''), 'zh-Hans-CN') ||
      a.displayName.localeCompare(b.displayName, 'zh-Hans-CN', { numeric: true })
    );
  });
}

function filterVisibleFilters(filters, recommended, effectiveMode) {
  const query = state.filterQuery.trim().toLowerCase();
  return filters.filter((filter) => {
    if (effectiveMode === 'recommended' && !recommended.has(filter.id)) return false;
    if (effectiveMode !== 'recommended' && state.sourceFilter !== 'all' && filter.sourceId !== state.sourceFilter) {
      return false;
    }
    if (!query) return true;
    const text = [filter.displayName, filter.id, filter.effectName, filter.sourceName, filter.relativePath]
      .join(' ')
      .toLowerCase();
    return text.includes(query);
  });
}

function pickDefaultFilter(image) {
  const recommended = recommendedFilterIdsForImage(image);
  return recommended.map((id) => filterById(id)).find(Boolean) || state.rules.filters[0] || null;
}

function renderFilterCard(filter, rating, recommended, options = {}) {
  const immersive = Boolean(options.immersive);
  const value = Number(rating.filters?.[filter.id] ?? 0);
  const previewWidth = immersive ? 720 : 480;
  const previewHeight = immersive ? 405 : 270;
  const aggregate = state.ratings.aggregate[state.selectedImageId]?.filters?.[filter.id];
  const aggregateText = aggregate?.count
    ? `均分 ${aggregate.average.toFixed(2)} / ${aggregate.count} 人`
    : '暂无他人评分';
  return `
    <article class="filter-card ${immersive ? 'immersive-filter-card' : ''} ${
      filter.id === state.activeFilterId ? 'active' : ''
    }" data-filter-id="${escapeHtml(
      filter.id
    )}">
      <div class="filter-preview-wrapper">
        <canvas class="filter-preview" data-preview-filter-id="${escapeHtml(
          filter.id
        )}" width="${previewWidth}" height="${previewHeight}"></canvas>
        <div class="preview-loading" data-preview-spinner="${escapeHtml(filter.id)}"><div class="spinner spinner-sm"></div></div>
        <button class="preview-zoom-btn" type="button" data-zoom-filter="${escapeHtml(filter.id)}" title="放大查看">🔍</button>
        <button class="preview-original-btn card-original-btn" type="button" data-original-filter="${escapeHtml(filter.id)}" title="原图对比">原图</button>
      </div>
      <div class="filter-body">
        <div class="filter-name-row">
          <div>
            <div class="filter-name">${escapeHtml(filter.attrLabel || filter.displayName || filter.id)}</div>
            <div class="filter-name-original">${escapeHtml(filter.displayName || '')}</div>
            <div class="filter-detail">${escapeHtml(filter.sourceName || 'LUT')} · ${escapeHtml(
              String(filter.lutKind || 'image').toUpperCase()
            )}</div>
          </div>
          ${recommended ? '<span class="badge">推荐</span>' : ''}
        </div>
        <div class="rating-row" role="group" aria-label="${escapeHtml(filter.displayName || filter.id)} 评分">
          <button class="zero-btn" type="button" data-rate-filter="${escapeHtml(filter.id)}" data-rating="0">0</button>
          ${[1, 2, 3, 4, 5]
            .map(
              (star) =>
                `<button class="star-btn ${value >= star ? 'on' : ''}" type="button" data-rate-filter="${escapeHtml(
                  filter.id
                )}" data-rating="${star}">★</button>`
            )
            .join('')}
        </div>
        <div class="rating-desc" data-rating-desc="${escapeHtml(filter.id)}">${filter.id in (rating.filters || {}) && value >= 0 ? escapeHtml(RATING_DESCRIPTIONS[value] || '') : ''}</div>
        <div class="aggregate">${escapeHtml(aggregateText)}</div>
      </div>
    </article>
  `;
}

function emptyAnnotation() {
  return {
    filterStyleTags: [],
    riskTags: [],
    style: [],
    saturation: '',
    contrast: '',
    hue: '',
    colorTemp: '',
    description: ''
  };
}

function annotationList(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  return value ? [value] : [];
}

function mergeAnnotation(base, override = {}) {
  const merged = { ...emptyAnnotation(), ...base, ...override };
  for (const key of ['style', 'filterStyleTags', 'riskTags']) {
    merged[key] = unique([...annotationList(base?.[key]), ...annotationList(override?.[key])]);
  }
  return merged;
}

function suggestedFilterAnnotation(filter) {
  if (!filter) return emptyAnnotation();
  return {
    ...emptyAnnotation(),
    style: filter.attrStyle ? [filter.attrStyle] : [],
    saturation: filter.attrSaturation || '',
    contrast: filter.attrContrast || '',
    hue: filter.attrHue || '',
    colorTemp: filter.attrColorTemp || ''
  };
}

function renderFilterAnnotationWorkbench(image) {
  const activeFilter = filterById(state.activeFilterId) || state.rules.filters[0] || null;
  if (activeFilter && state.activeFilterId !== activeFilter.id) state.activeFilterId = activeFilter.id;
  const hasSavedFilterAnnotation = Boolean(activeFilter && state.annotations.own.filters[activeFilter.id]);
  const savedFilterAnnotation = activeFilter ? state.annotations.own.filters[activeFilter.id] || {} : {};
  const filterAnnotation = hasSavedFilterAnnotation ? mergeAnnotation(emptyAnnotation(), savedFilterAnnotation) : suggestedFilterAnnotation(activeFilter);
  const activeFilterLabel = activeFilter?.attrLabel || [activeFilter?.attrStyle, activeFilter?.attrSaturation, activeFilter?.attrContrast, activeFilter?.attrHue].filter(Boolean).join(' · ');
  const filters = state.rules.filters || [];
  const activeFilterIndex = activeFilter ? filters.findIndex((filter) => filter.id === activeFilter.id) : -1;
  const filterProgress = activeFilterIndex >= 0 ? `${activeFilterIndex + 1}/${filters.length}` : `0/${filters.length}`;
  return `
    <section class="annotation-shell">
      <div class="annotation-header">
        <div>
          <h2 class="annotation-title">滤镜标注</h2>
          <div class="annotation-subtitle">给滤镜补充风格、饱和、对比、色相和风险描述；当前场景集默认使用“滤镜标注场景”。</div>
        </div>
        <div class="annotation-status" id="annotationStatus"></div>
      </div>
      <div class="annotation-grid filter-annotation-grid">
        <section class="annotation-preview-panel">
          ${
            image
              ? `<div class="annotation-preview-head">
                  <div>
                    <div class="annotation-card-title">${escapeHtml(image.filename)}</div>
                    <div class="annotation-path">${escapeHtml(image.relativePath)}</div>
                  </div>
                  <div class="annotation-preview-filter">
                    <span>当前滤镜</span>
                    <strong>${escapeHtml(activeFilterLabel || activeFilter?.displayName || activeFilter?.id || '原图')}</strong>
                  </div>
                </div>
                <div class="preview-wrap annotation-preview-wrap">
                  <canvas class="main-canvas annotation-main-canvas" id="mainCanvas" width="1280" height="860"></canvas>
                  <button class="preview-original-btn" id="originalBtn" type="button">原图</button>
                  <button class="preview-zoom-btn annotation-zoom-btn" type="button" data-main-zoom-filter="${escapeHtml(
                    activeFilter?.id || ''
                  )}" title="放大查看" ${activeFilter ? '' : 'disabled'}>🔍</button>
                </div>`
              : `<div class="annotation-empty-reference">
                  <strong>当前“滤镜标注场景”还没有图片。</strong>
                  <span>把参考图放到 <code>scene_library/滤镜标注场景</code> 后刷新场景库，这里会显示大图预览。</span>
                </div>`
          }
        </section>
        <form class="annotation-panel filter-annotation-panel" id="filterAnnotationForm">
          <div class="annotation-panel-head">
            <div>
              <div class="annotation-card-title">滤镜属性标签</div>
              <div class="annotation-path">${escapeHtml(activeFilter?.id || '')}</div>
            </div>
            <div class="annotation-filter-nav" aria-label="当前滤镜进度">
              <button class="secondary-btn annotation-nav-btn" type="button" data-annotation-filter-step="-1" ${
                activeFilterIndex <= 0 ? 'disabled' : ''
              }>上一个</button>
              <span class="annotation-filter-progress">当前滤镜 ${escapeHtml(filterProgress)}</span>
              <button class="secondary-btn annotation-nav-btn" type="button" data-annotation-filter-step="1" ${
                activeFilterIndex < 0 || activeFilterIndex >= filters.length - 1 ? 'disabled' : ''
              }>下一个</button>
            </div>
            <select class="source-select annotation-filter-select" id="annotationFilterSelect">
              ${filters
                .map(
                  (filter) =>
                    `<option value="${escapeHtml(filter.id)}" ${filter.id === activeFilter?.id ? 'selected' : ''}>${escapeHtml(
                      filter.displayName || filter.id
                    )}</option>`
                )
                .join('')}
            </select>
          </div>
          ${
            activeFilter
              ? `<div class="annotation-current-filter">
                  <div class="signal-title">当前滤镜描述</div>
                  <strong>${escapeHtml(activeFilterLabel || activeFilter.displayName || activeFilter.id)}</strong>
                  ${
                    activeFilterLabel && activeFilter.displayName
                      ? `<span>${escapeHtml(activeFilter.displayName)}</span>`
                      : ''
                  }
                </div>`
              : ''
          }
          <div class="annotation-suggestion-note">${
            hasSavedFilterAnnotation ? '已加载你保存过的滤镜标注。' : '已按当前滤镜描述预选四个产品属性，可修改后保存。'
          }</div>
          ${renderTagGroup('style', '风格', filterAttributeOptions('style'), filterAnnotation)}
          ${renderSingleChoiceGroup('saturation', '饱和', filterAttributeOptions('saturation'), filterAnnotation, filterDefaultAttribute(activeFilter, 'saturation'))}
          ${renderSingleChoiceGroup('contrast', '对比', filterAttributeOptions('contrast'), filterAnnotation, filterDefaultAttribute(activeFilter, 'contrast'))}
          ${renderSingleChoiceGroup('hue', '色相', filterAttributeOptions('hue'), filterAnnotation, filterDefaultAttribute(activeFilter, 'hue'))}
          ${renderSingleChoiceGroup('colorTemp', '色温', filterAttributeOptions('colorTemp'), filterAnnotation, filterDefaultAttribute(activeFilter, 'colorTemp'))}
          ${renderTagGroup('filterStyleTags', '补充风格标签', FILTER_TAG_GROUPS.filterStyleTags, filterAnnotation)}
          ${renderTagGroup('riskTags', '风险标签', FILTER_TAG_GROUPS.riskTags, filterAnnotation)}
          <label class="annotation-field">
            <span>滤镜描述</span>
            <textarea class="note-input" name="description" placeholder="例如：低饱和、柔和偏暖，肤色友好，但夜景容易压暗">${escapeHtml(
              filterAnnotation.description || ''
            )}</textarea>
          </label>
          <button class="primary-btn" type="submit" ${state.annotationSaving || !activeFilter ? 'disabled' : ''}>保存滤镜标注</button>
        </form>
      </div>
    </section>
  `;
}

const ATTRIBUTE_SORT_ORDER = {
  saturation: ['低饱和', '略降饱和', '自然饱和', '略增饱和', '高饱和'],
  contrast: ['低对比', '略低对比', '自然对比', '略高对比', '高对比'],
  colorTemp: ['偏冷', '中性', '偏暖'],
};

function filterAttributeOptions(field) {
  const attrKey = {
    style: 'attrStyle',
    saturation: 'attrSaturation',
    contrast: 'attrContrast',
    hue: 'attrHue',
    colorTemp: 'attrColorTemp'
  }[field];
  const fromRules = attrKey ? state.rules.filters.map((filter) => filter[attrKey]).filter(Boolean) : [];
  const combined = unique([...fromRules, ...(FALLBACK_FILTER_ATTRIBUTE_OPTIONS[field] || [])]);
  const order = ATTRIBUTE_SORT_ORDER[field];
  if (order) {
    combined.sort((a, b) => {
      const ai = order.indexOf(a);
      const bi = order.indexOf(b);
      if (ai >= 0 && bi >= 0) return ai - bi;
      if (ai >= 0) return -1;
      if (bi >= 0) return 1;
      return String(a).localeCompare(String(b), 'zh-Hans-CN');
    });
  }
  return combined;
}

function filterDefaultAttribute(filter, field) {
  if (!filter) return '';
  const attrKey = {
    style: 'attrStyle',
    saturation: 'attrSaturation',
    contrast: 'attrContrast',
    hue: 'attrHue',
    colorTemp: 'attrColorTemp'
  }[field];
  return attrKey ? filter[attrKey] || '' : '';
}

function renderTagGroup(group, title, values, annotation) {
  const selected = new Set(annotationList(annotation[group]));
  return `
    <fieldset class="annotation-group">
      <legend>${escapeHtml(title)}</legend>
      <div class="annotation-chip-row" data-tag-group="${escapeHtml(group)}">
        ${values
          .map(
            (value) => {
              const label = FILTER_TAG_LABELS[value] || value;
              return (
              `<button class="annotation-chip ${selected.has(value) ? 'active' : ''}" type="button" data-annotation-tag="${escapeHtml(
                value
              )}" title="${escapeHtml(value)}">${escapeHtml(label)}</button>`
              );
            }
          )
          .join('')}
      </div>
    </fieldset>
  `;
}

function renderSingleChoiceGroup(field, title, values, annotation, fallbackValue = '') {
  const selected = annotation[field] || fallbackValue || '';
  return `
    <fieldset class="annotation-group">
      <legend>${escapeHtml(title)}</legend>
      <div class="annotation-chip-row single-choice" data-single-field="${escapeHtml(field)}">
        ${values
          .map(
            (value) =>
              `<button class="annotation-chip ${selected === value ? 'active' : ''}" type="button" data-single-value="${escapeHtml(
                value
              )}">${escapeHtml(value)}</button>`
          )
          .join('')}
      </div>
    </fieldset>
  `;
}

function formatDateTime(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('zh-CN', { hour12: false });
}

function renderCurrentSelection({ preserveFilterScroll = false } = {}) {
  const panel = document.querySelector('.main-panel');
  if (!panel) {
    renderApp();
    return;
  }

  const image = selectedImage();
  if (!image && !isFilterAnnotationContext()) {
    panel.innerHTML = renderEmptySceneSetPanel();
    return;
  }

  const previousScrollTop = preserveFilterScroll ? document.querySelector('.filter-grid')?.scrollTop || 0 : 0;
  const rating = image ? ownRating(image.id) : { filters: {}, allBad: false, note: '' };
  panel.classList.toggle('immersive-panel', state.layoutMode === 'immersive');
  panel.classList.toggle('single-panel', isFilterAnnotationContext());
  panel.innerHTML = renderMainPanelContent(image, rating);
  bindReviewEvents();
  bindAnnotationEvents();
  if (preserveFilterScroll) {
    const filterGrid = document.querySelector('.filter-grid');
    if (filterGrid) filterGrid.scrollTop = previousScrollTop;
  }
  if (image && (isFilterAnnotationContext() || state.layoutMode === 'preview' || state.layoutMode === 'immersive')) {
    loadSelectedImageAndRenderPreviews();
  }
}

function updateSidebarSelection() {
  document.querySelectorAll('[data-image-id]').forEach((button) => {
    button.classList.toggle('active', button.dataset.imageId === state.selectedImageId);
  });
}

function filterCardById(filterId) {
  return [...document.querySelectorAll('.filter-card')].find((card) => card.dataset.filterId === filterId) || null;
}

function updateRatingButtons() {
  const rating = ownRating();
  document.querySelectorAll('[data-rate-filter]').forEach((button) => {
    const filterId = button.dataset.rateFilter;
    const value = Number(rating.filters?.[filterId] ?? 0);
    if (button.classList.contains('star-btn')) {
      button.classList.toggle('on', value >= Number(button.dataset.rating));
    }
  });
  // Update rating descriptions
  document.querySelectorAll('[data-rating-desc]').forEach((el) => {
    const fid = el.dataset.ratingDesc;
    const rated = fid in (rating.filters || {});
    const v = Number(rating.filters?.[fid] ?? 0);
    el.textContent = rated ? RATING_DESCRIPTIONS[v] || '' : '';
  });
  // Update quick rating inline desc
  const quickRating = document.querySelector('.quick-rating');
  if (quickRating) {
    const fid = state.activeFilterId;
    const rated = fid in (rating.filters || {});
    const v = Number(rating.filters?.[fid] ?? 0);
    let descEl = quickRating.querySelector('.rating-desc-inline');
    if (!descEl) {
      descEl = document.createElement('span');
      descEl.className = 'rating-desc-inline';
      quickRating.appendChild(descEl);
    }
    descEl.textContent = rated ? RATING_DESCRIPTIONS[v] || '' : '';
  }
}

function updateCompletionControls() {
  // no-op: completion is now just "rated at least one filter positively"
}

function updateActiveFilterUi() {
  document.querySelectorAll('.filter-card').forEach((card) => {
    card.classList.toggle('active', card.dataset.filterId === state.activeFilterId);
  });

  const activeFilter = filterById(state.activeFilterId);
  const activeName = document.querySelector('.active-filter-name');
  const activeOriginal = document.querySelector('.active-filter-original');
  const activeDetail = document.querySelector('.active-filter-detail');
  if (activeName) activeName.textContent = activeFilter?.attrLabel || activeFilter?.displayName || '原图';
  if (activeOriginal) {
    activeOriginal.textContent = (activeFilter?.attrLabel && activeFilter?.displayName) ? activeFilter.displayName : '';
    activeOriginal.style.display = activeOriginal.textContent ? '' : 'none';
  }
  if (activeDetail) activeDetail.textContent = activeFilter ? activeFilter.id : '';

  const quickRating = document.querySelector('.quick-rating');
  if (quickRating && activeFilter) {
    quickRating.outerHTML = renderQuickRating(activeFilter, ownRating());
    bindRatingButtons(document.querySelector('.quick-rating'));
  }
}

function updateCurrentRatingUi() {
  updateSidebarProgressAndStatuses();
  updateRatingButtons();
  updateCompletionControls();
}

function updateSidebarProgressAndStatuses() {
  const images = currentSceneSetImages();
  const doneCount = images.filter((image) => completionStatus(image.id) !== 'open').length;
  const progress = images.length ? Math.round((doneCount / images.length) * 100) : 0;
  const progressCount = document.querySelector('.progress-count');
  const progressFill = document.querySelector('.progress-fill');
  if (progressCount) progressCount.textContent = `${doneCount}/${images.length}`;
  if (progressFill) progressFill.style.width = `${progress}%`;

  document.querySelectorAll('[data-image-id]').forEach((button) => {
    const status = completionStatus(button.dataset.imageId);
    const dot = button.querySelector('.status-dot');
    if (!dot) return;
    dot.classList.toggle('done', status === 'done');
    dot.classList.toggle('bad', status === 'bad');
    dot.title = statusLabel(status);
  });
}

function selectFilter(filterId) {
  if (!filterById(filterId)) return;
  state.activeFilterId = filterId;
  updateActiveFilterUi();
  if (!state.originalImage) return;
  const runId = ++state.previewRunId;
  renderMainCanvas(runId).catch((error) => {
    console.error('Failed to render main preview', error);
  });
}

function bindAppEvents() {
  document.querySelector('#helpBtn')?.addEventListener('click', () => showWelcomePopup());
  document.querySelector('#logoutBtn')?.addEventListener('click', logout);
  document.querySelector('#reloadBtn')?.addEventListener('click', async () => {
    await refreshSceneLibrary();
  });
  document.querySelector('[data-layout-switch]')?.querySelectorAll('[data-layout-value]').forEach((button) => {
    button.addEventListener('click', () => {
      addDebugEvent('layout-link-click', {
        targetMode: button.dataset.layoutValue,
        href: button.getAttribute('href')
      });
    });
  });
  document.querySelector('[data-scene-set-switch]')?.querySelectorAll('[data-scene-set-id]').forEach((button) => {
    button.addEventListener('click', () => {
      addDebugEvent('scene-set-link-click', {
        sceneSetId: button.dataset.sceneSetId,
        href: button.getAttribute('href')
      });
    });
  });
  document.querySelector('[data-segment="listMode"]')?.querySelectorAll('button').forEach((button) => {
    button.addEventListener('click', () => {
      state.listMode = button.dataset.value;
      renderApp();
    });
  });
  // Global keyboard shortcuts (skip when typing in inputs or lightbox is open)
  document.addEventListener('keydown', async (e) => {
    if (document.querySelector('.lightbox-overlay')) return;
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      const filters = state.rules.filters;
      if (!filters.length) return;
      const currentIdx = filters.findIndex((f) => f.id === state.activeFilterId);
      const delta = e.key === 'ArrowRight' ? 1 : -1;
      const nextIdx = currentIdx + delta;

      if (nextIdx < 0 || nextIdx >= filters.length) {
        // At boundary: show toast to go to next/prev scene
        const images = currentSceneSetImages();
        const imgIdx = images.findIndex((img) => img.id === state.selectedImageId);
        const nextImgIdx = imgIdx + (delta > 0 ? 1 : -1);
        if (nextImgIdx >= 0 && nextImgIdx < images.length) {
          showFilterEndToast(nextImgIdx, delta > 0);
        }
        return;
      }
      if (isFilterAnnotationContext()) {
        await flushCurrentFilterAnnotationBeforeSwitch();
        state.activeFilterId = filters[nextIdx].id;
        renderCurrentSelection();
        return;
      }
      selectFilter(filters[nextIdx].id);
      // Scroll the active card into view
      const activeCard = document.querySelector('.filter-card.active');
      activeCard?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    }

    if (e.key >= '0' && e.key <= '5' && state.activeFilterId) {
      e.preventDefault();
      setRating(state.activeFilterId, Number(e.key));
    }
  });

  document.querySelectorAll('[data-image-id]').forEach((button) => {
    button.addEventListener('click', async () => {
      await selectImage(button.dataset.imageId);
    });
  });
  bindReviewEvents();
  bindAnnotationEvents();
}

function bindReviewEvents() {
  document.querySelector('#sourceFilter')?.addEventListener('change', (event) => {
    state.sourceFilter = event.currentTarget.value;
    renderCurrentSelection();
  });
  document.querySelector('[data-segment="filterMode"]')?.querySelectorAll('button').forEach((button) => {
    button.addEventListener('click', () => {
      state.filterMode = button.dataset.value;
      renderCurrentSelection();
    });
  });
  document.querySelectorAll('.filter-card').forEach((card) => {
    card.addEventListener('click', (event) => {
      if (event.target.closest('[data-rate-filter]')) return;
      if (event.target.closest('[data-zoom-filter]')) {
        openLightbox(card.dataset.filterId);
        return;
      }
      selectFilter(card.dataset.filterId);
    });
  });
  document.querySelector('[data-main-zoom-filter]')?.addEventListener('click', (event) => {
    const filterId = event.currentTarget.dataset.mainZoomFilter || state.activeFilterId;
    if (filterId) openLightbox(filterId);
  });
  bindRatingButtons(document);
  document.querySelector('#noteInput')?.addEventListener('change', async (event) => {
    await saveCurrentRating({ note: event.currentTarget.value });
  });
  const originalBtn = document.querySelector('#originalBtn');
  let viewingOriginal = false;
  let activeOriginalCard = null;
  originalBtn?.addEventListener('mousedown', () => {
    viewingOriginal = true;
    const canvas = document.querySelector('#mainCanvas');
    if (!canvas || !state.originalImage) return;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    drawContain(ctx, canvas, state.originalImage);
  });

  // Card-level original buttons
  document.querySelector('.filter-grid, .immersive-filter-grid')?.addEventListener('mousedown', (event) => {
    const btn = event.target.closest('[data-original-filter]');
    if (!btn || !state.originalImage) return;
    const card = btn.closest('.filter-card');
    const canvas = card?.querySelector('[data-preview-filter-id]');
    if (!canvas) return;
    activeOriginalCard = canvas;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    drawContain(ctx, canvas, state.originalImage);
  });

  document.addEventListener('mouseup', async () => {
    if (viewingOriginal) {
      viewingOriginal = false;
      await renderMainCanvas(state.previewRunId);
    }
    if (activeOriginalCard) {
      const canvas = activeOriginalCard;
      activeOriginalCard = null;
      const filter = filterById(canvas.dataset.previewFilterId);
      if (filter && state.originalImage) {
        await renderCanvas(canvas, state.originalImage, filter, state.previewRunId);
      }
    }
  });
}

function bindAnnotationEvents() {
  document.querySelectorAll('[data-annotation-tag]').forEach((button) => {
    button.addEventListener('click', () => {
      button.classList.toggle('active');
      scheduleFilterAnnotationAutosave(button.closest('form'), 120);
    });
  });

  document.querySelectorAll('[data-single-value]').forEach((button) => {
    button.addEventListener('click', () => {
      const group = button.closest('[data-single-field]');
      if (!group) return;
      const wasActive = button.classList.contains('active');
      group.querySelectorAll('[data-single-value]').forEach((item) => item.classList.remove('active'));
      if (!wasActive) button.classList.add('active');
      scheduleFilterAnnotationAutosave(button.closest('form'), 120);
    });
  });

  document.querySelector('#filterAnnotationForm textarea[name="description"]')?.addEventListener('input', (event) => {
    scheduleFilterAnnotationAutosave(event.currentTarget.closest('form'), 700);
  });

  document.querySelector('#filterAnnotationForm textarea[name="description"]')?.addEventListener('change', async (event) => {
    scheduleFilterAnnotationAutosave(event.currentTarget.closest('form'), 0);
  });

  document.querySelector('#annotationFilterSelect')?.addEventListener('change', async (event) => {
    await flushCurrentFilterAnnotationBeforeSwitch();
    state.activeFilterId = event.currentTarget.value;
    renderCurrentSelection();
  });

  document.querySelectorAll('[data-annotation-filter-step]').forEach((button) => {
    button.addEventListener('click', async () => {
      const filters = state.rules.filters || [];
      if (!filters.length) return;
      const currentIndex = Math.max(0, filters.findIndex((filter) => filter.id === state.activeFilterId));
      const delta = Number(button.dataset.annotationFilterStep || 0);
      const nextIndex = Math.max(0, Math.min(filters.length - 1, currentIndex + delta));
      if (nextIndex === currentIndex) return;
      await flushCurrentFilterAnnotationBeforeSwitch();
      state.activeFilterId = filters[nextIndex].id;
      renderCurrentSelection();
    });
  });

  document.querySelector('#filterAnnotationForm')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    await saveFilterAnnotation(event.currentTarget);
  });
}

function collectActiveTags(root, group) {
  return [...root.querySelectorAll(`[data-tag-group="${selectorEscape(group)}"] [data-annotation-tag].active`)].map(
    (button) => button.dataset.annotationTag
  );
}

function collectSingleChoice(root, field) {
  return root.querySelector(`[data-single-field="${selectorEscape(field)}"] [data-single-value].active`)?.dataset.singleValue || '';
}

function selectorEscape(value) {
  if (window.CSS?.escape) return CSS.escape(value);
  return String(value).replace(/["\\]/g, '\\$&');
}

function setAnnotationStatus(message, isError = false) {
  const el = document.querySelector('#annotationStatus');
  if (!el) return;
  el.textContent = message;
  el.classList.toggle('error', isError);
}

function buildFilterAnnotationPayload(form = document.querySelector('#filterAnnotationForm')) {
  const filter = filterById(state.activeFilterId);
  if (!filter || !form) return null;
  return {
    filterId: filter.id,
    style: collectActiveTags(form, 'style'),
    saturation: collectSingleChoice(form, 'saturation'),
    contrast: collectSingleChoice(form, 'contrast'),
    hue: collectSingleChoice(form, 'hue'),
    colorTemp: collectSingleChoice(form, 'colorTemp'),
    filterStyleTags: collectActiveTags(form, 'filterStyleTags'),
    riskTags: collectActiveTags(form, 'riskTags'),
    description: form.querySelector('[name="description"]')?.value || ''
  };
}

function scheduleFilterAnnotationAutosave(form = document.querySelector('#filterAnnotationForm'), delay = 250) {
  const payload = buildFilterAnnotationPayload(form);
  if (!payload) return;
  state.annotationPendingPayload = payload;
  if (state.annotationSaveTimer) window.clearTimeout(state.annotationSaveTimer);
  state.annotationSaveTimer = window.setTimeout(() => {
    flushFilterAnnotationAutosave({ silent: true });
  }, delay);
  setAnnotationStatus('正在自动保存...');
}

async function flushFilterAnnotationAutosave({ silent = false } = {}) {
  if (state.annotationSaveTimer) {
    window.clearTimeout(state.annotationSaveTimer);
    state.annotationSaveTimer = null;
  }
  const latestPayload = buildFilterAnnotationPayload();
  if (latestPayload) state.annotationPendingPayload = latestPayload;
  if (!state.annotationPendingPayload) return;
  if (state.annotationSaving) {
    state.annotationSaveQueued = true;
    if (state.annotationSavePromise) await state.annotationSavePromise;
    return;
  }

  const payload = state.annotationPendingPayload;
  state.annotationPendingPayload = null;
  state.annotationSaving = true;
  if (!silent) setAnnotationStatus('正在保存滤镜标注...');
  state.annotationSavePromise = (async () => {
    try {
      state.annotations = await api.post('/api/annotations/filter', payload);
      setAnnotationStatus(silent ? '已自动保存' : '滤镜标注已保存');
    } catch (error) {
      setAnnotationStatus(`保存失败：${error.message}`, true);
    } finally {
      state.annotationSaving = false;
      state.annotationSavePromise = null;
      if (state.annotationSaveQueued || state.annotationPendingPayload) {
        state.annotationSaveQueued = false;
        await flushFilterAnnotationAutosave({ silent: true });
      }
    }
  })();
  await state.annotationSavePromise;
}

async function saveFilterAnnotation(form) {
  const payload = buildFilterAnnotationPayload(form);
  if (!payload) return;
  state.annotationPendingPayload = payload;
  await flushFilterAnnotationAutosave({ silent: false });
}

async function flushCurrentFilterAnnotationBeforeSwitch() {
  if (!isFilterAnnotationContext()) return;
  const form = document.querySelector('#filterAnnotationForm');
  if (!form) return;
  state.annotationPendingPayload = buildFilterAnnotationPayload(form);
  await flushFilterAnnotationAutosave({ silent: true });
}

function bindRatingButtons(root) {
  root.querySelectorAll('[data-rate-filter]').forEach((button) => {
    button.addEventListener('click', async () => {
      await setRating(button.dataset.rateFilter, Number(button.dataset.rating));
    });
  });
}

async function refreshSceneLibrary() {
  if (state.refreshing) return;
  state.refreshing = true;
  state.refreshStatus = '正在刷新场景库...';
  renderApp();
  try {
    const result = await api.post('/api/refresh-labels', { force: false });
    state.refreshStatus = result.message || '场景库已刷新。';
    await loadWorkspace();
  } catch (error) {
    state.refreshStatus = `刷新失败：${error.message}`;
  } finally {
    state.refreshing = false;
    renderApp();
  }
}

async function logout() {
  await api.post('/api/logout');
  state.session = null;
  renderLogin(await api.get('/api/session'));
}

async function selectImage(imageId) {
  if (state.selectedImageId === imageId) return;
  await flushCurrentFilterAnnotationBeforeSwitch();
  const previousFilterId = state.activeFilterId;
  state.selectedImageId = imageId;
  if (!filterById(previousFilterId)) {
    state.activeFilterId = pickDefaultFilter(selectedImage())?.id || null;
  }
  state.originalImage = null;
  updateSidebarSelection();
  renderCurrentSelection();
}

async function goNext() {
  if (!isImageComplete()) return;
  const images = currentSceneSetImages();
  const index = images.findIndex((image) => image.id === state.selectedImageId);
  const next = images[(index + 1) % images.length];
  if (next) await selectImage(next.id);
}

async function setRating(filterId, value) {
  const current = ownRating();
  const filters = { ...(current.filters || {}) };
  filters[filterId] = value;
  await saveCurrentRating({ filters });
}

async function saveCurrentRating(patch = {}) {
  if (state.saving) return;
  state.saving = true;
  const current = ownRating();
  const payload = {
    imageId: state.selectedImageId,
    filters: current.filters || {},
    note: current.note || '',
    ...patch
  };
  try {
    state.ratings = await api.post('/api/ratings', payload);
    if (state.listMode === 'all') {
      updateCurrentRatingUi();
    } else {
      renderApp();
    }
  } finally {
    state.saving = false;
  }
}

async function loadSelectedImageAndRenderPreviews() {
  const image = selectedImage();
  if (!image) return;
  const runId = ++state.previewRunId;
  const previewWrap = document.querySelector('.preview-wrap');
  let loadingEl = null;
  if (previewWrap) {
    loadingEl = document.createElement('div');
    loadingEl.className = 'preview-loading';
    loadingEl.innerHTML = '<div class="spinner"></div>';
    loadingEl.id = 'mainPreviewSpinner';
    previewWrap.style.position = 'relative';
    previewWrap.appendChild(loadingEl);
  }
  const img = await loadImage(image.url);
  if (runId !== state.previewRunId) {
    if (loadingEl) loadingEl.remove();
    return;
  }
  state.originalImage = img;
  await renderMainCanvas(runId);
  if (loadingEl) loadingEl.remove();
  await renderFilterCanvases(runId);
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.crossOrigin = 'same-origin';
    image.onload = () => resolve(image);
    image.onerror = reject;
    image.src = src;
  });
}

async function renderMainCanvas(runId) {
  const canvas = document.querySelector('#mainCanvas');
  const filter = filterById(state.activeFilterId);
  if (!canvas || !state.originalImage) return;
  await renderCanvas(canvas, state.originalImage, filter, runId);
}

async function renderFilterCanvases(runId) {
  if (!state.originalImage) return;
  const canvases = [...document.querySelectorAll('[data-preview-filter-id]')];
  const BATCH_SIZE = 6;
  for (let i = 0; i < canvases.length; i += BATCH_SIZE) {
    if (runId !== state.previewRunId) return;
    const batch = canvases.slice(i, i + BATCH_SIZE);
    for (const canvas of batch) {
      if (runId !== state.previewRunId) return;
      const filter = filterById(canvas.dataset.previewFilterId);
      const spinner = canvas.parentElement?.querySelector('[data-preview-spinner]');
      try {
        await renderCanvas(canvas, state.originalImage, filter, runId);
      } catch (err) {
        console.error('Filter preview render failed', filter?.id, err);
      }
      if (spinner) spinner.remove();
    }
    if (i + BATCH_SIZE < canvases.length) {
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
  }
}

async function renderCanvas(canvas, image, filter, runId) {
  if (runId !== state.previewRunId) return;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  drawContain(context, canvas, image);
  if (!filter?.lutUrl && !filter?.lutFile) return;
  if (runId !== state.previewRunId) return;
  const lut = await getLut(filter);
  if (!lut || runId !== state.previewRunId) return;
  const imageData = context.getImageData(0, 0, canvas.width, canvas.height);
  applyLut(imageData.data, lut, Number(filter.defaultStrength ?? 100) / 100);
  context.putImageData(imageData, 0, 0);
}

function drawContain(context, canvas, image) {
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#151713';
  context.fillRect(0, 0, canvas.width, canvas.height);
  const scale = Math.min(canvas.width / image.naturalWidth, canvas.height / image.naturalHeight);
  const width = image.naturalWidth * scale;
  const height = image.naturalHeight * scale;
  const x = (canvas.width - width) / 2;
  const y = (canvas.height - height) / 2;
  context.drawImage(image, x, y, width, height);
}

async function getLut(filter) {
  if (state.lutCache.has(filter.id)) return state.lutCache.get(filter.id);
  const lutUrl = filter.lutUrl || `/lut/${filter.lutFile.split('/').map(encodeURIComponent).join('/')}`;
  if (filter.lutKind === 'cube') {
    const response = await fetch(lutUrl, { credentials: 'same-origin' });
    const text = await response.text();
    const lut = parseCubeLut(text);
    state.lutCache.set(filter.id, lut);
    return lut;
  }

  const image = await loadImage(lutUrl);
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  context.drawImage(image, 0, 0);
  const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const lut = { kind: 'image', data, width: canvas.width, height: canvas.height, cubeSize: 64, tiles: 8 };
  state.lutCache.set(filter.id, lut);
  return lut;
}

function parseCubeLut(text) {
  let size = 0;
  let domainMin = [0, 0, 0];
  let domainMax = [1, 1, 1];
  const values = [];

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*/, '').trim();
    if (!line) continue;
    const parts = line.split(/\s+/);
    const keyword = parts[0].toUpperCase();
    if (keyword === 'LUT_3D_SIZE') {
      size = Number(parts[1]);
      continue;
    }
    if (keyword === 'DOMAIN_MIN') {
      domainMin = parts.slice(1, 4).map(Number);
      continue;
    }
    if (keyword === 'DOMAIN_MAX') {
      domainMax = parts.slice(1, 4).map(Number);
      continue;
    }
    const rgb = parts.slice(0, 3).map(Number);
    if (rgb.length === 3 && rgb.every(Number.isFinite)) {
      values.push(
        Math.max(0, Math.min(255, rgb[0] * 255)),
        Math.max(0, Math.min(255, rgb[1] * 255)),
        Math.max(0, Math.min(255, rgb[2] * 255))
      );
    }
  }

  if (!size || values.length < size * size * size * 3) {
    throw new Error('Invalid CUBE LUT');
  }

  return {
    kind: 'cube',
    size,
    domainMin,
    domainMax,
    data: new Float32Array(values.slice(0, size * size * size * 3))
  };
}

function applyLut(pixels, lut, strength) {
  const amount = Math.max(0, Math.min(1, strength));
  for (let i = 0; i < pixels.length; i += 4) {
    const alpha = pixels[i + 3];
    if (!alpha) continue;
    const originalR = pixels[i];
    const originalG = pixels[i + 1];
    const originalB = pixels[i + 2];
    const mapped = lut.kind === 'cube' ? sampleCubeLut(lut, originalR, originalG, originalB) : sampleImageLut(lut, originalR, originalG, originalB);
    pixels[i] = originalR + (mapped[0] - originalR) * amount;
    pixels[i + 1] = originalG + (mapped[1] - originalG) * amount;
    pixels[i + 2] = originalB + (mapped[2] - originalB) * amount;
  }
}

function sampleImageLut(lut, r, g, b) {
  const cube = lut.cubeSize;
  const tiles = lut.tiles;
  const max = cube - 1;
  const rf = (r / 255) * max;
  const gf = (g / 255) * max;
  const bf = (b / 255) * max;
  const b0 = Math.floor(bf);
  const b1 = Math.min(max, b0 + 1);
  const t = bf - b0;
  const c0 = samplePlane(lut, tiles, cube, b0, rf, gf);
  const c1 = samplePlane(lut, tiles, cube, b1, rf, gf);
  return [
    c0[0] + (c1[0] - c0[0]) * t,
    c0[1] + (c1[1] - c0[1]) * t,
    c0[2] + (c1[2] - c0[2]) * t
  ];
}

function sampleCubeLut(lut, r, g, b) {
  const size = lut.size;
  const rf = normalizeCubeAxis(r, lut.domainMin[0], lut.domainMax[0], size);
  const gf = normalizeCubeAxis(g, lut.domainMin[1], lut.domainMax[1], size);
  const bf = normalizeCubeAxis(b, lut.domainMin[2], lut.domainMax[2], size);
  const r0 = Math.floor(rf);
  const g0 = Math.floor(gf);
  const b0 = Math.floor(bf);
  const r1 = Math.min(size - 1, r0 + 1);
  const g1 = Math.min(size - 1, g0 + 1);
  const b1 = Math.min(size - 1, b0 + 1);
  const rt = rf - r0;
  const gt = gf - g0;
  const bt = bf - b0;

  const c000 = cubeColor(lut, r0, g0, b0);
  const c100 = cubeColor(lut, r1, g0, b0);
  const c010 = cubeColor(lut, r0, g1, b0);
  const c110 = cubeColor(lut, r1, g1, b0);
  const c001 = cubeColor(lut, r0, g0, b1);
  const c101 = cubeColor(lut, r1, g0, b1);
  const c011 = cubeColor(lut, r0, g1, b1);
  const c111 = cubeColor(lut, r1, g1, b1);

  return [0, 1, 2].map((channel) => {
    const c00 = lerp(c000[channel], c100[channel], rt);
    const c10 = lerp(c010[channel], c110[channel], rt);
    const c01 = lerp(c001[channel], c101[channel], rt);
    const c11 = lerp(c011[channel], c111[channel], rt);
    const c0 = lerp(c00, c10, gt);
    const c1 = lerp(c01, c11, gt);
    return lerp(c0, c1, bt);
  });
}

function normalizeCubeAxis(value, min, max, size) {
  const normalized = (value / 255 - min) / (max - min || 1);
  return Math.max(0, Math.min(size - 1, normalized * (size - 1)));
}

function cubeColor(lut, r, g, b) {
  const index = ((b * lut.size + g) * lut.size + r) * 3;
  return [lut.data[index], lut.data[index + 1], lut.data[index + 2]];
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function samplePlane(lut, tiles, cube, bIndex, rf, gf) {
  const x = Math.min(lut.width - 1, (bIndex % tiles) * cube + Math.round(rf));
  const y = Math.min(lut.height - 1, Math.floor(bIndex / tiles) * cube + Math.round(gf));
  const offset = (y * lut.width + x) * 4;
  return [lut.data[offset], lut.data[offset + 1], lut.data[offset + 2]];
}

function openLightbox(filterId) {
  const filter = filterById(filterId);
  const image = state.originalImage;
  if (!filter || !image) return;

  const existing = document.querySelector('.lightbox-overlay');
  if (existing) existing.remove();

  const currentImg = selectedImage();
  const lightboxFilters = visibleFiltersForImage(currentImg);
  if (!lightboxFilters.find((item) => item.id === filter.id)) {
    lightboxFilters.unshift(filter);
  }

  const overlay = document.createElement('div');
  overlay.className = 'lightbox-overlay';

  const canvas = document.createElement('canvas');
  canvas.className = 'lightbox-canvas';

  function sizeCanvas(img) {
    const maxW = Math.min(window.innerWidth * 0.82, img.naturalWidth);
    const maxH = Math.min(window.innerHeight * 0.88, img.naturalHeight);
    const s = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight);
    canvas.width = img.naturalWidth * s;
    canvas.height = img.naturalHeight * s;
  }

  sizeCanvas(image);
  let showingOriginal = false;
  let lightboxFilter = filter;
  let lightboxImage = image;
  let lightboxFilterIdx = lightboxFilters.findIndex((item) => item.id === filter.id);
  if (lightboxFilterIdx < 0) lightboxFilterIdx = 0;

  const toggleBtn = document.createElement('button');
  toggleBtn.className = 'lightbox-original-btn';
  toggleBtn.textContent = '原图';
  toggleBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    showingOriginal = !showingOriginal;
    toggleBtn.classList.toggle('active', showingOriginal);
    toggleBtn.textContent = showingOriginal ? '滤镜' : '原图';
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (showingOriginal) {
      drawContain(ctx, canvas, lightboxImage);
    } else {
      renderCanvas(canvas, lightboxImage, lightboxFilter, state.previewRunId);
    }
  });

  function updateLightboxInfo() {
    const label = lightboxFilter?.attrLabel || lightboxFilter?.displayName || '原图';
    info.textContent = `${label} · ${lightboxFilterIdx + 1}/${lightboxFilters.length}`;
  }

  async function navigateToFilter(delta) {
    if (!lightboxFilters.length) return;
    const nextIdx = (lightboxFilterIdx + delta + lightboxFilters.length) % lightboxFilters.length;
    if (nextIdx === lightboxFilterIdx) return;
    await flushCurrentFilterAnnotationBeforeSwitch();
    lightboxFilterIdx = nextIdx;
    lightboxFilter = lightboxFilters[lightboxFilterIdx];
    state.activeFilterId = lightboxFilter.id;
    if (isFilterAnnotationContext()) {
      renderCurrentSelection();
    } else {
      updateActiveFilterUi();
    }
    showingOriginal = false;
    toggleBtn.classList.remove('active');
    toggleBtn.textContent = '原图';
    updateLightboxInfo();
    const runId = ++state.previewRunId;
    await renderMainCanvas(runId);
    await renderCanvas(canvas, lightboxImage, lightboxFilter, runId);
  }

  const prevBtn = document.createElement('button');
  prevBtn.className = 'lightbox-arrow lightbox-arrow-left';
  prevBtn.title = '上一个滤镜';
  prevBtn.innerHTML = '‹';
  prevBtn.addEventListener('click', (e) => { e.stopPropagation(); navigateToFilter(-1); });

  const nextBtn = document.createElement('button');
  nextBtn.className = 'lightbox-arrow lightbox-arrow-right';
  nextBtn.title = '下一个滤镜';
  nextBtn.innerHTML = '›';
  nextBtn.addEventListener('click', (e) => { e.stopPropagation(); navigateToFilter(1); });

  const closeBtn = document.createElement('button');
  closeBtn.className = 'lightbox-close';
  closeBtn.innerHTML = '✕';
  closeBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    closeLightbox(overlay);
  });

  const info = document.createElement('div');
  info.className = 'lightbox-info';
  updateLightboxInfo();

  overlay.appendChild(canvas);
  overlay.appendChild(toggleBtn);
  overlay.appendChild(prevBtn);
  overlay.appendChild(nextBtn);
  overlay.appendChild(closeBtn);
  overlay.appendChild(info);
  document.body.appendChild(overlay);

  overlay.addEventListener('click', () => closeLightbox(overlay));

  function onLightboxKey(e) {
    if (e.key === 'Escape') {
      closeLightbox(overlay);
      return;
    }
    if (e.key === 'ArrowLeft') { e.preventDefault(); navigateToFilter(-1); return; }
    if (e.key === 'ArrowRight') { e.preventDefault(); navigateToFilter(1); return; }
  }
  document.addEventListener('keydown', onLightboxKey);
  overlay._keyHandler = onLightboxKey;

  renderCanvas(canvas, image, filter, state.previewRunId);
}

function closeLightbox(overlay) {
  if (overlay._keyHandler) document.removeEventListener('keydown', overlay._keyHandler);
  overlay.classList.add('closing');
  setTimeout(() => overlay.remove(), 150);
}

const RATING_DESCRIPTIONS = {
  5: '封神了 🏆',
  4: '非常对味 👌',
  3: '还行还行 🤔',
  2: '勉强能忍 😬',
  1: '差点意思 💀',
  0: '建议报警 🚔',
};

function showFilterEndToast(nextImgIdx, isForward) {
  const existing = document.querySelector('.filter-end-toast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.className = 'filter-end-toast';
  const nextImg = currentSceneSetImages()[nextImgIdx];
  toast.innerHTML = `
    <span>${isForward ? '已经是最后一个滤镜了' : '已经是第一个滤镜了'}</span>
    <button class="toast-btn" type="button">→ ${escapeHtml(nextImg?.filename || '')}</button>
  `;
  toast.querySelector('.toast-btn').addEventListener('click', async () => {
    await selectImage(nextImg.id);
    toast.remove();
  });
  document.body.appendChild(toast);
  setTimeout(() => {
    if (document.body.contains(toast)) toast.remove();
  }, 4000);
}

function showWelcomePopup() {
  if (document.querySelector('.welcome-overlay')) return;
  const overlay = document.createElement('div');
  overlay.className = 'welcome-overlay';
  overlay.innerHTML = `
    <div class="welcome-dialog">
      <button class="welcome-close" type="button">✕</button>
      <h2 class="welcome-title">欢迎来到 Scene LUT 评分台 👋</h2>
      <div class="welcome-steps">
        <div class="welcome-step">
          <div class="welcome-step-num">1</div>
          <div class="welcome-step-body">
            <div class="welcome-step-title">浏览场景图片</div>
            <div class="welcome-step-desc">左侧列表选择场景图，或键盘 ← → 切换图片。右上角按住"原图"可对比原始效果。</div>
          </div>
        </div>
        <div class="welcome-step">
          <div class="welcome-step-num">2</div>
          <div class="welcome-step-body">
            <div class="welcome-step-title">切换滤镜并打分</div>
            <div class="welcome-step-desc">键盘 ← → 切换滤镜，数字键 <kbd>0</kbd>-<kbd>5</kbd> 打分。右下角 🔍 可放大查看。<strong>只给觉得合适的打分，不合适的跳过就好。</strong></div>
          </div>
        </div>
        <div class="welcome-step">
          <div class="welcome-step-num">3</div>
          <div class="welcome-step-body">
            <div class="welcome-step-title">完成所有场景</div>
            <div class="welcome-step-desc">每张图至少评一个合适的滤镜即可。数据将用于训练场景自适应滤镜推荐模型。</div>
          </div>
        </div>
      </div>
      <div class="welcome-tips">
        <strong>💡 快捷键：</strong>← → 切滤镜 &nbsp;|&nbsp; 0-5 打分 &nbsp;|&nbsp; 按住原图按钮对比 &nbsp;|&nbsp; 🔍 放大
      </div>
      <button class="welcome-start-btn" type="button">开始打分 🚀</button>
    </div>
  `;
  document.body.appendChild(overlay);

  const close = () => {
    overlay.classList.add('closing');
    setTimeout(() => overlay.remove(), 200);
  };
  overlay.querySelector('.welcome-close').addEventListener('click', close);
  overlay.querySelector('.welcome-start-btn').addEventListener('click', close);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });
}

init().catch((error) => {
  console.error(error);
  app.innerHTML = `<div class="empty-state">启动失败：${escapeHtml(error.message)}</div>`;
});
