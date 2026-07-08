import { createServer } from 'node:http';
import { promises as fs } from 'node:fs';
import fsSync from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.resolve(__dirname, '..');
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const RATINGS_PATH = path.join(DATA_DIR, 'ratings.json');
const LEGACY_ANNOTATIONS_PATH = path.join(DATA_DIR, 'semantic_annotations.json');
const ANNOTATIONS_PATH = path.join(DATA_DIR, 'filter_annotations.json');
const LUT_SOURCES_PATH = path.join(__dirname, 'lut_sources.json');
const DEFAULT_SCENE_LIBRARY_DIR = path.join(ROOT_DIR, 'scene_library');
const RULES_PATH = process.env.RULES_PATH
  ? path.resolve(process.env.RULES_PATH)
  : path.join(ROOT_DIR, 'scene_lut_recommend', 'rules.json');
const SUB_SCENES_PATH = process.env.SUB_SCENES_PATH
  ? path.resolve(process.env.SUB_SCENES_PATH)
  : path.join(ROOT_DIR, 'scene_lut_recommend', 'sub_scenes.json');
const DEV_APK_RULES_PATH = process.env.DEV_APK_RULES_PATH
  ? path.resolve(process.env.DEV_APK_RULES_PATH)
  : path.join(ROOT_DIR, 'exports', 'dev_apk_rule_inspect_20260703', 'rules_from_NTCamera_7.json');
const MLKIT_LABEL_NAMES_PATH = process.env.MLKIT_LABEL_NAMES_PATH
  ? path.resolve(process.env.MLKIT_LABEL_NAMES_PATH)
  : path.join(ROOT_DIR, 'exports', 'dev_apk_rule_inspect_20260703', '0-labels.txt');
const LUT_ROOT = process.env.LUT_ROOT
  ? path.resolve(process.env.LUT_ROOT)
  : path.join(ROOT_DIR, 'scene_lut_recommend');
const SCENE_LIBRARY_DIR = process.env.SCENE_LIBRARY_DIR
  ? path.resolve(process.env.SCENE_LIBRARY_DIR)
  : DEFAULT_SCENE_LIBRARY_DIR;
const HOST = process.env.HOST || '0.0.0.0';
const PORT = Number(process.env.PORT || 4173);
const ACCESS_CODE = process.env.ACCESS_CODE || '';
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 7;
const LARK_HOST = (process.env.LARK_HOST || 'https://open.larksuite.com').replace(/\/$/, '');
const LARK_APP_ID = process.env.LARK_APP_ID || '';
const LARK_APP_SECRET = process.env.LARK_APP_SECRET || '';
const LARK_CALLBACK_URL = process.env.LARK_CALLBACK_URL || '';
const LARK_ALLOWED_TENANT = process.env.LARK_ALLOWED_TENANT || '';
const LARK_ENABLED = Boolean(LARK_APP_ID && LARK_APP_SECRET && LARK_CALLBACK_URL);
const MLKIT_LABEL_COMMAND = process.env.MLKIT_LABEL_COMMAND || '';
const MLKIT_LABEL_TIMEOUT_MS = Number(process.env.MLKIT_LABEL_TIMEOUT_MS || 30000);

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.heic', '.heif']);
const BROWSER_RECOMMENDED_IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.webp'];
const LUT_EXTENSIONS = new Set(['.cube', '.CUBE', '.png', '.PNG']);
const LOCAL_RULE_SOURCE_ID = 'scene_lut_recommend';
const SCENE_SETS = [
  {
    id: 'filter_rating',
    name: '滤镜打分场景',
    description: '当前用于同事对推荐滤镜进行星级评分的场景库。',
    aliases: ['filter_rating', 'rating', '滤镜打分场景']
  },
  {
    id: 'acceptance',
    name: '验收场景',
    description: '后续用于验证推荐规则和 APK 端效果的验收图片。',
    aliases: ['acceptance', 'acceptance_scenes', '验收场景']
  },
  {
    id: 'filter_annotation',
    name: '滤镜标注场景',
    description: '用于给滤镜补充风格、饱和、对比、色相和风险描述的参考图片。',
    aliases: ['filter_annotation', 'filter_annotation_scenes', 'filter_tags', '滤镜标注场景']
  }
];
const DEFAULT_SCENE_SET_ID = 'filter_rating';
const sessions = new Map();
const oauthStates = new Map();
let ratingsWrite = Promise.resolve();
const SESSION_COOKIE = 'scene_lut_session';

const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.heic': 'image/heic',
  '.heif': 'image/heif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.csv': 'text/csv; charset=utf-8',
  '.cube': 'text/plain; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8'
};

async function ensureStorage() {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.mkdir(DEFAULT_SCENE_LIBRARY_DIR, { recursive: true });
  if (!fsSync.existsSync(RATINGS_PATH)) {
    await writeJsonAtomic(RATINGS_PATH, { version: 1, ratings: {} });
  }
  if (!fsSync.existsSync(ANNOTATIONS_PATH)) {
    if (fsSync.existsSync(LEGACY_ANNOTATIONS_PATH)) {
      await fs.copyFile(LEGACY_ANNOTATIONS_PATH, ANNOTATIONS_PATH);
    } else {
      await writeJsonAtomic(ANNOTATIONS_PATH, { version: 1, images: {}, filters: {} });
    }
  }
}

function jsonResponse(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

function textResponse(res, status, body, contentType = 'text/plain; charset=utf-8') {
  res.writeHead(status, {
    'Content-Type': contentType,
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

function redirect(res, location) {
  res.writeHead(302, { Location: location });
  res.end();
}

function safeRedirectPath(value) {
  if (!value) return '/';
  try {
    const parsed = new URL(value, 'http://scene-lut.local');
    if (parsed.origin !== 'http://scene-lut.local') return '/';
    return `${parsed.pathname}${parsed.search}${parsed.hash}` || '/';
  } catch {
    return '/';
  }
}

function parseCookies(req) {
  const header = req.headers.cookie || '';
  return Object.fromEntries(
    header
      .split(';')
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const index = part.indexOf('=');
        if (index === -1) return [part, ''];
        return [part.slice(0, index), decodeURIComponent(part.slice(index + 1))];
      })
  );
}

function setSessionCookie(res, sessionId) {
  res.setHeader(
    'Set-Cookie',
    `${SESSION_COOKIE}=${encodeURIComponent(sessionId)}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${Math.floor(
      SESSION_TTL_MS / 1000
    )}`
  );
}

function clearSessionCookie(res) {
  res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`);
}

function createSession(res, user) {
  const sessionId = crypto.randomBytes(32).toString('hex');
  sessions.set(sessionId, {
    user,
    expiresAt: Date.now() + SESSION_TTL_MS
  });
  setSessionCookie(res, sessionId);
  return sessionId;
}

function getSession(req) {
  const cookies = parseCookies(req);
  const sessionId = cookies[SESSION_COOKIE];
  if (!sessionId) return null;
  const session = sessions.get(sessionId);
  if (!session) return null;
  if (session.expiresAt < Date.now()) {
    sessions.delete(sessionId);
    return null;
  }
  session.expiresAt = Date.now() + SESSION_TTL_MS;
  return { id: sessionId, ...session };
}

function requireSession(req, res) {
  const session = getSession(req);
  if (!session) {
    jsonResponse(res, 401, { error: 'unauthorized' });
    return null;
  }
  return session;
}

async function readBodyJson(req, limit = 1024 * 1024) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (Buffer.byteLength(raw) > limit) {
      const err = new Error('request body too large');
      err.status = 413;
      throw err;
    }
  }
  if (!raw.trim()) return {};
  return JSON.parse(raw);
}

async function readJson(filePath, fallback) {
  try {
    return JSON.parse(await fs.readFile(filePath, 'utf8'));
  } catch (error) {
    if (error.code === 'ENOENT') return fallback;
    throw error;
  }
}

async function writeJsonAtomic(filePath, data) {
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmpPath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
  await fs.rename(tmpPath, filePath);
}

function normalizeRelPath(filePath) {
  return filePath.split(path.sep).join('/');
}

function resolveUnder(root, relPath) {
  const safeRel = decodeURIComponent(relPath).replace(/^[/\\]+/, '');
  const resolved = path.resolve(root, safeRel);
  const relative = path.relative(root, resolved);
  if (relative.startsWith('..') || path.isAbsolute(relative)) {
    return null;
  }
  return resolved;
}

function encodePathSegments(relPath) {
  return relPath.split('/').map(encodeURIComponent).join('/');
}

function slugify(value) {
  const normalized = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/\.[^.]+$/, '')
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || 'lut';
}

function shortHash(value) {
  return crypto.createHash('sha1').update(value).digest('hex').slice(0, 10);
}

async function getRules() {
  const rules = await readJson(RULES_PATH, { filters: [], scenes: [] });
  const localFilters = Array.isArray(rules.filters) ? rules.filters : [];
  rules.scenes = Array.isArray(rules.scenes) ? rules.scenes : [];
  const subSceneRules = await getSubSceneRules();
  rules.subScenes = subSceneRules.subScenes;
  const externalSources = await getLutSources();
  const externalFilters = await scanExternalLuts(externalSources);
  const attrAnalysis = await readJson(path.join(DATA_DIR, 'lut_attribute_analysis_riley_20260629.json'), { filters: [] });
  const attrMap = new Map();
  for (const item of (attrAnalysis.filters || [])) {
    attrMap.set(item.id, item);
    const norm = (s) => String(s || '').replace(/[^a-z0-9]+/gi, '').toLowerCase();
    attrMap.set(`_norm_${norm(item.id)}`, item);
  }

  function attachAttr(filter) {
    const norm = (s) => String(s || '').replace(/[^a-z0-9]+/gi, '').toLowerCase();
    let attr = attrMap.get(filter.id) || attrMap.get(`_norm_${norm(filter.id)}`);
    if (!attr) return filter;
    return {
      ...filter,
      attrStyle: attr.style || '',
      attrSaturation: attr.saturation || '',
      attrContrast: attr.contrast || '',
      attrHue: attr.hue || '',
      attrLabel: [attr.style, attr.saturation, attr.contrast, attr.hue].filter(Boolean).join(' · ')
    };
  }

  rules.lutSources = [
    ...externalSources.map((source) => ({
      id: source.id,
      name: source.name,
      path: source.path,
      count: externalFilters.filter((filter) => filter.sourceId === source.id).length,
      type: 'external'
    })),
    {
      id: LOCAL_RULE_SOURCE_ID,
      name: '产品调试 LUT',
      path: LUT_ROOT,
      count: localFilters.length,
      type: 'local'
    }
  ];
  rules.filters = [
    ...externalFilters.map(attachAttr),
    ...localFilters.map((filter, index) => attachAttr({
      ...filter,
      lutKind: 'image',
      lutUrl: filter.lutFile ? `/lut/${encodePathSegments(filter.lutFile)}` : '',
      sourceId: LOCAL_RULE_SOURCE_ID,
      sourceName: '产品调试 LUT',
      sourceType: 'local',
      sortOrder: externalFilters.length + index
    }))
  ];
  return rules;
}

async function getSubSceneRules() {
  const data = await readJson(SUB_SCENES_PATH, { schemaVersion: 1, subScenes: [] });
  return {
    ...data,
    subScenes: Array.isArray(data.subScenes) ? data.subScenes : []
  };
}

async function getRuleDiagnostics() {
  const [activeRules, devApkRules, labelNames] = await Promise.all([
    getRules(),
    readJson(DEV_APK_RULES_PATH, null),
    readMlKitLabelNames()
  ]);
  const active = buildRuleDiagnosticSource('当前网页规则', RULES_PATH, activeRules, labelNames);
  const devApk = devApkRules
    ? buildRuleDiagnosticSource('开发 APK 内置规则', DEV_APK_RULES_PATH, devApkRules, labelNames)
    : null;

  return {
    active,
    devApk,
    comparison: devApk ? compareRuleSources(active, devApk) : [],
    labelNameSource: fsSync.existsSync(MLKIT_LABEL_NAMES_PATH) ? MLKIT_LABEL_NAMES_PATH : '',
    generatedAt: new Date().toISOString()
  };
}

async function readMlKitLabelNames() {
  try {
    return (await fs.readFile(MLKIT_LABEL_NAMES_PATH, 'utf8')).split(/\r?\n/);
  } catch {
    return [];
  }
}

function buildRuleDiagnosticSource(name, sourcePath, rules, labelNames) {
  const filters = Array.isArray(rules?.filters) ? rules.filters : [];
  const scenes = Array.isArray(rules?.scenes) ? rules.scenes : [];
  const filterMap = new Map(filters.map((filter) => [filter.id, filter]));
  const labelThreshold = Number(rules?.labelThreshold ?? 0.65);
  const maxRecommendations = Number(rules?.maxRecommendations ?? 3);
  const sceneRecommendationCounts = unique(scenes.map((scene) => (scene.recommendations || []).length)).sort((a, b) => a - b);
  const lowThresholdLabels = [];
  const missingRecommendationRefs = [];
  const scenesBelowMax = [];
  const suspectRecommendations = [];

  const enrichedScenes = scenes.map((scene) => {
    const recommendations = (scene.recommendations || []).map((id, index) => {
      const filter = filterMap.get(id);
      if (!filter) missingRecommendationRefs.push({ sceneId: scene.sceneId, filterId: id });
      return {
        id,
        order: index + 1,
        displayName: filter?.displayName || id,
        effectName: filter?.effectName || '',
        defaultStrength: filter?.defaultStrength ?? '',
        attrLabel: filter?.attrLabel || ''
      };
    });

    if (recommendations.length < maxRecommendations) {
      scenesBelowMax.push({
        sceneId: scene.sceneId,
        displayName: scene.displayName || scene.sceneId,
        count: recommendations.length,
        expected: maxRecommendations
      });
    }

    const labels = (scene.labels || []).map((label) => {
      const index = Number(label.index);
      const minConfidence = Number(label.minConfidence ?? 0.65);
      const suppressedByGlobalThreshold = minConfidence < labelThreshold;
      if (suppressedByGlobalThreshold) {
        lowThresholdLabels.push({
          sceneId: scene.sceneId,
          labelIndex: index,
          labelName: labelNames[index] || `Label #${index}`,
          minConfidence,
          globalThreshold: labelThreshold
        });
      }
      return {
        index,
        labelName: labelNames[index] || `Label #${index}`,
        minConfidence,
        effectiveMinConfidence: Math.max(minConfidence, labelThreshold),
        weight: Number(label.weight || 100),
        suppressedByGlobalThreshold
      };
    });

    suspectRecommendations.push(...inspectSceneRecommendationRisks(scene, recommendations));

    return {
      sceneId: scene.sceneId,
      displayName: scene.displayName || scene.sceneId,
      priority: Number(scene.priority || 0),
      labels,
      recommendations
    };
  });

  const filterFields = unique(filters.flatMap((filter) => Object.keys(filter))).sort();
  const hasFilterAttributeFields = filters.some((filter) =>
    ['style', 'saturation', 'contrast', 'hue', 'attrStyle', 'attrSaturation', 'attrContrast', 'attrHue', 'attrLabel', 'risks'].some(
      (key) => key in filter && filter[key]
    )
  );
  const issues = buildRuleIssues({
    rules,
    filters,
    labelThreshold,
    maxRecommendations,
    scenesBelowMax,
    lowThresholdLabels,
    missingRecommendationRefs,
    suspectRecommendations,
    hasFilterAttributeFields
  });

  return {
    name,
    sourcePath,
    schemaVersion: rules?.schemaVersion ?? 1,
    labelThreshold,
    detectIntervalMs: Number(rules?.detectIntervalMs || 0),
    maxRecommendations,
    filterCount: filters.length,
    sceneCount: scenes.length,
    sceneRecommendationCounts,
    filterFields,
    hasFilterAttributeFields,
    hasUnknownSceneFallback: Array.isArray(rules?.unknownSceneFallback) && rules.unknownSceneFallback.length > 0,
    lowThresholdLabelCount: lowThresholdLabels.length,
    scenesBelowMax,
    missingRecommendationRefs,
    suspectRecommendations,
    issues,
    scenes: enrichedScenes,
    filters: filters.map((filter) => ({
      id: filter.id,
      displayName: filter.displayName || filter.id,
      effectName: filter.effectName || '',
      defaultStrength: filter.defaultStrength ?? '',
      attrLabel: filter.attrLabel || ''
    }))
  };
}

function buildRuleIssues({
  rules,
  labelThreshold,
  maxRecommendations,
  scenesBelowMax,
  lowThresholdLabels,
  missingRecommendationRefs,
  suspectRecommendations,
  hasFilterAttributeFields
}) {
  const issues = [];
  if (scenesBelowMax.length) {
    issues.push({
      severity: 'high',
      title: '候选池没有真正达到上限',
      detail: `${scenesBelowMax.length} 个场景的 recommendations 少于 maxRecommendations=${maxRecommendations}，5 选 3 的轮换效果会打不满。`
    });
  }
  if (lowThresholdLabels.length) {
    issues.push({
      severity: 'high',
      title: '场景内低阈值被全局阈值覆盖',
      detail: `${lowThresholdLabels.length} 个 label 的 minConfidence 低于全局 labelThreshold=${labelThreshold}，代码会先全局过滤，低阈值实际不会生效。`
    });
  }
  if (!hasFilterAttributeFields) {
    issues.push({
      severity: 'medium',
      title: '缺少滤镜属性标签',
      detail: '规则里的滤镜没有风格、饱和、对比、色相、风险等字段，暂时只能做场景到 LUT 的硬绑定。'
    });
  }
  if (!Array.isArray(rules?.unknownSceneFallback) || !rules.unknownSceneFallback.length) {
    issues.push({
      severity: 'medium',
      title: '没有显式 unknown fallback',
      detail: 'rules.json 未配置 unknownSceneFallback，会依赖 APK 代码默认兜底，产品侧不容易审核。'
    });
  }
  if (missingRecommendationRefs.length) {
    issues.push({
      severity: 'high',
      title: '推荐引用了不存在的滤镜',
      detail: `${missingRecommendationRefs.length} 个 recommendation id 在 filters 里找不到。`
    });
  }
  if (suspectRecommendations.length) {
    issues.push({
      severity: 'medium',
      title: '有场景推荐看起来像补位',
      detail: `${suspectRecommendations.length} 条推荐需要产品复核，例如 document 推荐人像/自然类、自然场景推荐人像类等。`
    });
  }
  return issues;
}

function inspectSceneRecommendationRisks(scene, recommendations) {
  const sceneId = String(scene.sceneId || '').toLowerCase();
  const sceneName = String(scene.displayName || '').toLowerCase();
  const sceneText = `${sceneId} ${sceneName}`;
  const risks = [];
  const recText = recommendations
    .map((item) => `${item.id} ${item.displayName} ${item.effectName}`.toLowerCase())
    .join(' | ');

  function add(reason) {
    risks.push({
      sceneId: scene.sceneId,
      displayName: scene.displayName || scene.sceneId,
      reason,
      recommendations: recommendations.map((item) => item.displayName || item.id)
    });
  }

  if (sceneText.includes('document') && !/(clean|neutral|document|文档|中性)/i.test(recText)) {
    add('文档场景没有 clean/neutral/document 类候选。');
  }
  if (/(waterfall|snow|sky|lake|river|mountain)/.test(sceneText) && /portrait|人像/.test(recText)) {
    add('自然场景里出现人像类滤镜，可能是兜底补位。');
  }
  if (sceneText.includes('mountain') && /night|neon|夜/.test(recText)) {
    add('山景场景里出现夜景霓虹类滤镜。');
  }
  if (sceneText.includes('architecture') && /forest|fresh|森林/.test(recText)) {
    add('建筑场景里出现森林清新类滤镜。');
  }
  if (/(auto|vehicle|car)/.test(sceneText) && /wedding|婚礼|肤/.test(recText)) {
    add('汽车场景里出现婚礼/肤色类滤镜。');
  }
  if (/(night|party|neon)/.test(sceneText) && /forest|森林/.test(recText)) {
    add('夜景场景里出现森林清新类滤镜。');
  }
  return risks;
}

function compareRuleSources(active, devApk) {
  const items = [];
  if (active.filterCount !== devApk.filterCount) {
    items.push(`滤镜数量不同：网页 ${active.filterCount}，APK ${devApk.filterCount}`);
  }
  if (String(active.sceneRecommendationCounts) !== String(devApk.sceneRecommendationCounts)) {
    items.push(`每场景候选数量不同：网页 ${active.sceneRecommendationCounts.join('/')}，APK ${devApk.sceneRecommendationCounts.join('/')}`);
  }
  if (active.lowThresholdLabelCount !== devApk.lowThresholdLabelCount) {
    items.push(`被全局阈值覆盖的 label 数不同：网页 ${active.lowThresholdLabelCount}，APK ${devApk.lowThresholdLabelCount}`);
  }
  if (active.hasFilterAttributeFields !== devApk.hasFilterAttributeFields) {
    items.push(`滤镜属性字段状态不同：网页 ${active.hasFilterAttributeFields ? '有' : '无'}，APK ${devApk.hasFilterAttributeFields ? '有' : '无'}`);
  }
  return items;
}

async function getLutSources() {
  const envSources = parseEnvLutSources();
  const config = envSources.length ? { sources: envSources } : await readJson(LUT_SOURCES_PATH, { sources: [] });
  const sources = Array.isArray(config.sources) ? config.sources : [];
  return sources
    .map((source) => {
      const sourcePath = typeof source === 'string' ? source : source.path;
      if (!sourcePath) return null;
      const name = typeof source === 'string' ? path.basename(sourcePath) : source.name || path.basename(sourcePath);
      const resolved = path.isAbsolute(sourcePath) ? sourcePath : path.resolve(ROOT_DIR, sourcePath);
      return {
        id: `${slugify(name)}-${shortHash(resolved)}`,
        name,
        path: resolved,
        defaultStrength: Number(source.defaultStrength || 100)
      };
    })
    .filter(Boolean);
}

function parseEnvLutSources() {
  if (!process.env.LUT_SOURCE_DIRS) return [];
  return process.env.LUT_SOURCE_DIRS.split(';')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => ({ path: item }));
}

async function scanExternalLuts(sources) {
  const filters = [];

  for (const source of sources) {
    let sourceFilters = [];
    try {
      sourceFilters = await scanLutSource(source);
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
    filters.push(...sourceFilters);
  }

  return filters.map((filter, index) => ({ ...filter, sortOrder: index }));
}

async function scanLutSource(source) {
  const files = [];

  async function walk(currentDir) {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    entries.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN', { numeric: true }));

    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const absPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(absPath);
        continue;
      }
      if (!entry.isFile()) continue;
      const ext = path.extname(entry.name).toLowerCase();
      if (!LUT_EXTENSIONS.has(ext)) continue;
      files.push(absPath);
    }
  }

  await walk(source.path);

  return files.map((absPath) => {
    const ext = path.extname(absPath).toLowerCase();
    const relPath = normalizeRelPath(path.relative(source.path, absPath));
    const baseName = path.basename(absPath, ext);
    const id = `lut_${slugify(source.name)}_${slugify(baseName)}_${shortHash(absPath)}`;
    return {
      id,
      effectName: id,
      displayName: baseName,
      lutKind: ext === '.cube' ? 'cube' : 'image',
      lutUrl: `/lut-file/${encodeURIComponent(id)}`,
      sourceId: source.id,
      sourceName: source.name,
      sourceType: 'external',
      relativePath: relPath,
      defaultStrength: source.defaultStrength,
      iqaStatus: 'candidate'
    };
  });
}

async function findExternalLutById(id) {
  const sources = await getLutSources();
  const filters = await scanExternalLuts(sources);
  return filters.find((filter) => filter.id === id) || null;
}

async function listImages() {
  const rules = await getRules();
  const subSceneRules = await getSubSceneRules();
  const images = [];
  const dirMetadataCache = new Map();
  const imageFiles = await collectSceneImageFiles();

  for (const { absPath, relPath } of imageFiles) {
    const metadata = await readImageMetadata(absPath, relPath, dirMetadataCache);
    const sceneSet = inferSceneSet(relPath, metadata);
    const isFilterAnnotationReference = sceneSet.id === 'filter_annotation';
    const labels = isFilterAnnotationReference ? [] : normalizeLabels(metadata);
    const tags = isFilterAnnotationReference ? [] : normalizeTags(metadata, labels);
    const sceneMatches = isFilterAnnotationReference ? [] : matchScenes(rules.scenes, metadata, labels, tags, relPath);
    const subSceneMatches = isFilterAnnotationReference
      ? []
      : matchSubScenes(subSceneRules.subScenes, sceneMatches, metadata, labels, tags, relPath);
    const recommendedFilterIds = isFilterAnnotationReference ? [] : getRecommendedFilterIds(sceneMatches, rules, Array.isArray(metadata.productTags) ? metadata.productTags : []);

    images.push({
      id: relPath,
      filename: path.basename(relPath),
      relativePath: relPath,
      directory: normalizeRelPath(path.dirname(relPath)).replace(/^\.$/, ''),
      sceneSetId: sceneSet.id,
      sceneSetName: sceneSet.name,
      url: `/media/${encodePathSegments(relPath)}`,
      labels,
      tags,
      productTags: Array.isArray(metadata.productTags) ? metadata.productTags : [],
      metadata,
      labelStatus: isFilterAnnotationReference ? 'reference' : labels.length ? 'labeled' : 'missing',
      sceneMatches,
      subSceneMatches,
      recommendedFilterIds
    });
  }

  return {
    images,
    sceneSets: buildSceneSetSummaries(images)
  };
}

function buildSceneSetSummaries(images) {
  const countById = new Map();
  for (const image of images) {
    countById.set(image.sceneSetId, (countById.get(image.sceneSetId) || 0) + 1);
  }
  return SCENE_SETS.map((sceneSet) => ({
    id: sceneSet.id,
    name: sceneSet.name,
    description: sceneSet.description,
    count: countById.get(sceneSet.id) || 0
  }));
}

function inferSceneSet(relPath, metadata = {}) {
  const configured = String(
    metadata.sceneSetId || metadata.sceneSet || metadata.sceneLibrary || metadata.libraryType || metadata.collection || ''
  )
    .trim()
    .toLowerCase();
  const topLevelDir = normalizeRelPath(relPath).split('/')[0]?.toLowerCase() || '';
  const matched = SCENE_SETS.find((sceneSet) => {
    const tokens = [sceneSet.id, sceneSet.name, ...(sceneSet.aliases || [])].map((token) => String(token).toLowerCase());
    return tokens.includes(configured) || tokens.includes(topLevelDir);
  });
  return matched || SCENE_SETS.find((sceneSet) => sceneSet.id === DEFAULT_SCENE_SET_ID) || SCENE_SETS[0];
}

async function collectSceneImageFiles() {
  const imageFiles = [];

  async function walk(currentDir) {
    let entries;
    try {
      entries = await fs.readdir(currentDir, { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }

    entries.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));

    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const absPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(absPath);
        continue;
      }
      if (!entry.isFile()) continue;
      if (!IMAGE_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) continue;

      const relPath = normalizeRelPath(path.relative(SCENE_LIBRARY_DIR, absPath));
      imageFiles.push({ absPath, relPath });
    }
  }

  await walk(SCENE_LIBRARY_DIR);
  return imageFiles;
}

async function getSceneLibraryDiagnostics() {
  const byExtension = {};
  const sceneSetCounts = Object.fromEntries(SCENE_SETS.map((sceneSet) => [sceneSet.id, 0]));
  const filterAnnotation = {
    directory: path.join(SCENE_LIBRARY_DIR, '滤镜标注场景'),
    images: [],
    sidecars: [],
    ignored: []
  };
  let totalFiles = 0;
  let imageFiles = 0;
  let sidecarFiles = 0;
  let ignoredFiles = 0;

  async function walk(currentDir) {
    let entries;
    try {
      entries = await fs.readdir(currentDir, { withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }

    entries.sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN'));

    for (const entry of entries) {
      const absPath = path.join(currentDir, entry.name);
      const relPath = normalizeRelPath(path.relative(SCENE_LIBRARY_DIR, absPath));

      if (entry.isDirectory()) {
        if (!entry.name.startsWith('.')) await walk(absPath);
        continue;
      }
      if (!entry.isFile()) continue;

      totalFiles += 1;
      const ext = path.extname(entry.name).toLowerCase() || '(none)';
      byExtension[ext] = (byExtension[ext] || 0) + 1;
      const sidecarImageExt = entry.name.toLowerCase().endsWith('.json')
        ? path.extname(entry.name.slice(0, -'.json'.length)).toLowerCase()
        : '';
      const isHidden = entry.name.startsWith('.');
      const isImage = !isHidden && IMAGE_EXTENSIONS.has(ext);
      const isImageSidecar = !isHidden && Boolean(sidecarImageExt) && IMAGE_EXTENSIONS.has(sidecarImageExt);
      const sceneSet = inferSceneSet(relPath, {});
      const record = {
        relPath,
        filename: entry.name,
        extension: ext,
        sceneSetId: isImage || isImageSidecar ? sceneSet.id : '',
        status: isImage ? 'image' : isImageSidecar ? 'sidecar' : 'ignored',
        reason: isHidden ? 'hidden_file' : isImageSidecar ? 'image_sidecar_json' : isImage ? '' : 'unsupported_or_metadata_file',
        browserPreviewStable: isImage ? BROWSER_RECOMMENDED_IMAGE_EXTENSIONS.includes(ext) : false
      };

      if (isImage) {
        imageFiles += 1;
        sceneSetCounts[sceneSet.id] = (sceneSetCounts[sceneSet.id] || 0) + 1;
      } else if (isImageSidecar) {
        sidecarFiles += 1;
      } else {
        ignoredFiles += 1;
      }

      if (sceneSet.id === 'filter_annotation' || relPath.startsWith('滤镜标注场景/')) {
        if (record.status === 'image') filterAnnotation.images.push(record);
        else if (record.status === 'sidecar') filterAnnotation.sidecars.push(record);
        else filterAnnotation.ignored.push(record);
      }
    }
  }

  await walk(SCENE_LIBRARY_DIR);

  return {
    sceneLibraryDir: SCENE_LIBRARY_DIR,
    supportedImageExtensions: [...IMAGE_EXTENSIONS].sort(),
    browserRecommendedImageExtensions: BROWSER_RECOMMENDED_IMAGE_EXTENSIONS,
    totalFiles,
    imageFiles,
    sidecarFiles,
    ignoredFiles,
    byExtension,
    sceneSetCounts,
    filterAnnotation
  };
}

function getRecommendedFilterIds(sceneMatches, rules, productTags = []) {
  // v3: product tag recommendations (new system)
  const ptRules = rules.productTagRecommendations || {};
  if (productTags.length > 0) {
    const combo = productTags.join('/');
    const byCombo = ptRules.byCombo || {};
    const byTag = ptRules.byTag || {};

    // Try exact combo match first
    if (byCombo[combo] && byCombo[combo].length > 0) {
      return unique(byCombo[combo]).slice(0, 5);
    }

    // Merge per-tag recommendations
    const merged = [];
    for (const tag of productTags) {
      if (byTag[tag]) merged.push(...byTag[tag]);
    }
    if (merged.length > 0) return unique(merged).slice(0, 5);
  }

  // Fallback: old scene-based logic
  const ruleRecommended = sceneMatches.flatMap((scene) => scene.recommendations || []);
  if (ruleRecommended.length) return unique(ruleRecommended).slice(0, 5);

  const filters = Array.isArray(rules.filters) ? rules.filters : [];
  const sceneText = sceneMatches.map((scene) => `${scene.sceneId || ''} ${scene.displayName || ''}`).join(' ').toLowerCase();
  if (!sceneText) return [];

  const landscapeKeywords = ['sunset', 'forest', 'greenery', 'beach', 'sky', 'mountain', 'lake', 'river', 'waterfall', 'snow'];
  const shopKeywords = ['food', 'indoor', 'document'];
  const sourceNames = [];

  if (landscapeKeywords.some((keyword) => sceneText.includes(keyword))) sourceNames.push('店主推荐');
  if (shopKeywords.some((keyword) => sceneText.includes(keyword))) sourceNames.push('店主推荐');

  return unique(
    filters
      .filter((filter) => sourceNames.includes(filter.sourceName))
      .slice(0, 12)
      .map((filter) => filter.id)
  );
}

async function readImageMetadata(absPath, relPath, dirMetadataCache) {
  const dir = path.dirname(absPath);
  const basename = path.basename(absPath);
  const ext = path.extname(absPath);
  const basenameWithoutExt = path.basename(absPath, ext);
  const sidecarPaths = [
    `${absPath}.json`,
    path.join(dir, `${basenameWithoutExt}.json`)
  ];

  for (const sidecarPath of sidecarPaths) {
    try {
      const data = await readJson(sidecarPath, null);
      if (data && typeof data === 'object') return data;
    } catch {
      // Ignore malformed sidecar files so one bad tag file does not block the review queue.
    }
  }

  const metadataPath = path.join(dir, 'metadata.json');
  if (!dirMetadataCache.has(metadataPath)) {
    dirMetadataCache.set(metadataPath, await readJson(metadataPath, null).catch(() => null));
  }
  const dirMetadata = dirMetadataCache.get(metadataPath);
  if (dirMetadata && typeof dirMetadata === 'object') {
    if (Array.isArray(dirMetadata.images)) {
      const item = dirMetadata.images.find((entry) => {
        const key = entry.file || entry.filename || entry.path || entry.id;
        return key === basename || key === relPath;
      });
      if (item) return item;
    }
    const keyed = dirMetadata[basename] || dirMetadata[relPath];
    if (keyed && typeof keyed === 'object') return keyed;
  }

  return {};
}

function normalizeLabels(metadata) {
  const raw =
    metadata.labels ||
    metadata.mlkitLabels ||
    metadata.imageLabels ||
    metadata.detectedLabels ||
    metadata.tags ||
    [];
  if (!Array.isArray(raw)) return [];

  return raw
    .map((item) => {
      if (typeof item === 'string') {
        return { label: item, index: null, confidence: null };
      }
      if (!item || typeof item !== 'object') return null;
      const index = Number.isFinite(Number(item.index)) ? Number(item.index) : null;
      const confidenceValue = item.confidence ?? item.score ?? item.probability ?? item.value;
      const confidence = Number.isFinite(Number(confidenceValue)) ? Number(confidenceValue) : null;
      const label = item.label || item.name || item.description || item.displayName || '';
      return { index, label, confidence };
    })
    .filter(Boolean);
}

function imageSidecarPath(absPath) {
  return `${absPath}.json`;
}

async function refreshSceneLabels({ force = false, limit = 0 } = {}) {
  const imageFiles = await collectSceneImageFiles();
  const summary = {
    configured: Boolean(MLKIT_LABEL_COMMAND),
    totalImages: imageFiles.length,
    labeled: 0,
    skipped: 0,
    failed: 0,
    failures: [],
    message: ''
  };

  if (!MLKIT_LABEL_COMMAND) {
    summary.message = '未配置 MLKIT_LABEL_COMMAND，只刷新场景库列表。';
    return summary;
  }

  const dirMetadataCache = new Map();
  let processed = 0;

  for (const image of imageFiles) {
    if (limit && processed >= limit) break;
    const existing = await readImageMetadata(image.absPath, image.relPath, dirMetadataCache);
    const sceneSet = inferSceneSet(image.relPath, existing);
    if (sceneSet.id === 'filter_annotation') {
      summary.skipped += 1;
      continue;
    }
    const existingLabels = normalizeLabels(existing);
    if (!force && existingLabels.length) {
      summary.skipped += 1;
      continue;
    }

    processed += 1;
    try {
      const result = await runMlKitLabelCommand(image.absPath, image.relPath);
      const labels = normalizeLabels(result);
      if (!labels.length) throw new Error('ML Kit command returned no labels');

      await writeJsonAtomic(imageSidecarPath(image.absPath), {
        ...existing,
        labels,
        mlkitLabels: labels,
        mlkit: {
          provider: 'ML Kit',
          generatedAt: new Date().toISOString(),
          sourceImage: image.relPath,
          command: MLKIT_LABEL_COMMAND
        }
      });
      summary.labeled += 1;
    } catch (error) {
      summary.failed += 1;
      summary.failures.push({
        imageId: image.relPath,
        error: error.message
      });
      summary.failures = summary.failures.slice(-20);
    }
  }

  summary.message = `ML Kit 打标签完成：新增/更新 ${summary.labeled} 张，跳过 ${summary.skipped} 张，失败 ${summary.failed} 张。`;
  return summary;
}

function runMlKitLabelCommand(absPath, relPath) {
  return new Promise((resolve, reject) => {
    const commandParts = splitCommandLine(MLKIT_LABEL_COMMAND);
    if (!commandParts.length) {
      reject(new Error('MLKIT_LABEL_COMMAND is empty'));
      return;
    }
    const child = spawn(commandParts[0], [...commandParts.slice(1), absPath], {
      env: {
        ...process.env,
        MLKIT_IMAGE_PATH: absPath,
        MLKIT_IMAGE_REL_PATH: relPath
      },
      stdio: ['ignore', 'pipe', 'pipe']
    });
    let stdout = '';
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      child.kill('SIGTERM');
      reject(new Error(`ML Kit command timed out after ${MLKIT_LABEL_TIMEOUT_MS}ms`));
    }, MLKIT_LABEL_TIMEOUT_MS);

    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('error', (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.on('close', (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0) {
        reject(new Error(stderr.trim() || `ML Kit command exited with code ${code}`));
        return;
      }
      try {
        const parsed = JSON.parse(stdout);
        resolve(Array.isArray(parsed) ? { labels: parsed } : parsed);
      } catch (error) {
        reject(new Error(`ML Kit command did not return JSON: ${error.message}`));
      }
    });
  });
}

function splitCommandLine(commandLine) {
  const parts = [];
  let current = '';
  let quote = '';
  let escaping = false;

  for (const char of commandLine.trim()) {
    if (escaping) {
      current += char;
      escaping = false;
      continue;
    }
    if (char === '\\') {
      escaping = true;
      continue;
    }
    if (quote) {
      if (char === quote) {
        quote = '';
      } else {
        current += char;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (/\s/.test(char)) {
      if (current) {
        parts.push(current);
        current = '';
      }
      continue;
    }
    current += char;
  }

  if (current) parts.push(current);
  return parts;
}

function normalizeTags(metadata, labels) {
  const rawTags = [
    ...(Array.isArray(metadata.tags) ? metadata.tags : []),
    ...(Array.isArray(metadata.scenes) ? metadata.scenes : []),
    metadata.sceneId,
    metadata.scene,
    metadata.category
  ];
  return unique(
    rawTags
      .filter((tag) => typeof tag === 'string' && tag.trim())
      .map((tag) => tag.trim())
      .concat(labels.map((label) => label.label).filter(Boolean))
  );
}

function matchScenes(scenes, metadata, labels, tags, relPath) {
  const directSceneId = String(metadata.sceneId || metadata.scene || metadata.category || '').toLowerCase();
  const relLower = relPath.toLowerCase();
  const tagSet = new Set(tags.map((tag) => tag.toLowerCase()));

  return scenes
    .map((scene) => {
      let score = 0;
      let reason = '';
      const sceneId = String(scene.sceneId || '').toLowerCase();
      const displayName = String(scene.displayName || '').toLowerCase();

      if (directSceneId && (directSceneId === sceneId || directSceneId === displayName)) {
        score += 10000;
        reason = 'metadata';
      }

      if (sceneId && (tagSet.has(sceneId) || relLower.includes(sceneId))) {
        score += 5000;
        reason ||= 'tag';
      }
      if (displayName && (tagSet.has(displayName) || relLower.includes(displayName))) {
        score += 4500;
        reason ||= 'tag';
      }

      for (const requirement of scene.labels || []) {
        const matched = labels.find((label) => {
          if (label.index !== null && label.index === Number(requirement.index)) return true;
          const reqLabel = normalizeMatchToken(requirement.label || requirement.name || '');
          if (!reqLabel) return false;
          return normalizeMatchToken(label.label || '') === reqLabel;
        });
        if (!matched) continue;
        const confidence = matched.confidence ?? 1;
        const minConfidence = Number(requirement.minConfidence ?? 0);
        if (confidence < minConfidence) continue;
        score += Number(requirement.weight || 1) * confidence;
        reason ||= 'mlkit';
      }

      for (const group of scene.labelGroups || []) {
        const matches = [];
        let groupScore = 0;
        for (const requirement of group.labels || []) {
          const matched = findMatchingLabel(labels, requirement);
          if (!matched) continue;
          const confidence = matched.confidence ?? 1;
          matches.push(matched);
          groupScore += Number(requirement.weight || 1) * confidence;
        }
        const minMatches = Number(group.minMatches || 1);
        const minScore = Number(group.minScore || 0);
        if (matches.length < minMatches || groupScore < minScore) continue;
        score += Number(group.weight || 0) + groupScore;
        reason ||= group.reason || 'mlkit_group';
      }

      return {
        sceneId: scene.sceneId,
        displayName: scene.displayName || scene.sceneId,
        priority: Number(scene.priority || 0),
        score,
        reason,
        recommendations: Array.isArray(scene.recommendations) ? scene.recommendations : []
      };
    })
    .filter((scene) => scene.score > 0)
    .sort((a, b) => b.score - a.score || b.priority - a.priority)
    .slice(0, 3);
}

function matchSubScenes(subScenes, sceneMatches, metadata, labels, tags, relPath) {
  const relLower = relPath.toLowerCase();
  const tagTokens = tags.map((tag) => String(tag || '').toLowerCase());
  const sceneIds = new Set(sceneMatches.map((scene) => String(scene.sceneId || '').toLowerCase()));
  const primarySceneId = String(sceneMatches[0]?.sceneId || '').toLowerCase();
  const sceneTokens = sceneMatches
    .flatMap((scene) => [scene.sceneId, scene.displayName])
    .map((token) => String(token || '').toLowerCase())
    .filter(Boolean);
  const sceneScoreGap = sceneMatches.length >= 2 ? Number(sceneMatches[0].score || 0) - Number(sceneMatches[1].score || 0) : 1;
  const topConfidence = labels.length ? labels.reduce((max, label) => Math.max(max, Number(label.confidence || 0)), 0) : 1;
  const conditionRoot = {
    ...metadata,
    top_confidence: topConfidence,
    scene_score_gap: sceneScoreGap
  };
  const directSubScene = String(metadata.subSceneId || metadata.subScene || metadata.secondaryScene || '').toLowerCase();

  return (subScenes || [])
    .map((subScene) => {
      const subSceneId = String(subScene.subSceneId || '').toLowerCase();
      const parentSceneIds = (subScene.parentSceneIds || subScene.requiredSceneIds || []).map((id) => String(id || '').toLowerCase());
      const blockedPrimarySceneIds = (subScene.blockedPrimarySceneIds || []).map((id) => String(id || '').toLowerCase());
      if (blockedPrimarySceneIds.some((id) => primarySceneId === id || tokenMatches(id, sceneTokens, relLower))) {
        return null;
      }

      const reasons = [];
      let score = Number(subScene.baseWeight || 0);

      if (directSubScene && directSubScene === subSceneId) {
        score += 10000;
        reasons.push('metadata');
      }

      if (parentSceneIds.length) {
        const matchedParent = parentSceneIds.find((id) => sceneIds.has(id) || tokenMatches(id, tagTokens, relLower));
        if (!matchedParent) return null;
        if (subScene.baseWeight) reasons.push(`产品场景:${matchedParent}`);
      }

      if (Array.isArray(subScene.requiredTagKeywords) && subScene.requiredTagKeywords.length) {
        const hasRequiredKeyword = subScene.requiredTagKeywords.some((keyword) => {
          const item = typeof keyword === 'string' ? { value: keyword } : keyword;
          return tokenMatches(item.value, [...tagTokens, ...sceneTokens], relLower);
        });
        if (!hasRequiredKeyword) return null;
      }

      for (const sceneId of subScene.anySceneIds || []) {
        const normalized = String(sceneId || '').toLowerCase();
        if (sceneIds.has(normalized) || tokenMatches(normalized, tagTokens, relLower)) {
          score += Number(subScene.sceneWeight || 60);
          reasons.push(`产品场景:${normalized}`);
        }
      }

      for (const requirement of subScene.labels || []) {
        const matched = findMatchingLabel(labels, requirement);
        if (!matched) continue;
        const confidence = matched.confidence ?? 1;
        score += Number(requirement.weight || 1) * confidence;
        const labelName = requirement.label || matched.label || `#${matched.index}`;
        reasons.push(`ML Kit:${labelName} ${Math.round(confidence * 100)}%`);
      }

      for (const keyword of subScene.tagKeywords || []) {
        const item = typeof keyword === 'string' ? { value: keyword } : keyword;
        const value = String(item.value || '').toLowerCase();
        if (!value) continue;
        if (tokenMatches(value, tagTokens, relLower)) {
          score += Number(item.weight || 60);
          reasons.push(`标签:${item.value}`);
        }
      }

      for (const condition of subScene.metadataConditions || []) {
        if (!matchesMetadataCondition(conditionRoot, condition)) continue;
        score += Number(condition.weight || 60);
        reasons.push(`metadata:${condition.path}`);
      }

      const minScore = Number(subScene.minScore ?? (parentSceneIds.length ? 80 : 60));
      if (score < minScore) return null;

      return {
        subSceneId: subScene.subSceneId,
        displayName: subScene.displayName || subScene.subSceneId,
        sceneGroup: subScene.sceneGroup || '',
        priority: Number(subScene.priority || 0),
        score,
        reasons: unique(reasons).slice(0, 5),
        filterSignals: Array.isArray(subScene.filterSignals) ? subScene.filterSignals : [],
        avoidSignals: Array.isArray(subScene.avoidSignals) ? subScene.avoidSignals : []
      };
    })
    .filter(Boolean)
    .sort((a, b) => b.score - a.score || b.priority - a.priority)
    .slice(0, 5);
}

function tokenMatches(value, tagTokens, relLower) {
  const normalized = String(value || '').toLowerCase();
  if (!normalized) return false;
  const canUseContains = normalized.length >= 5;
  return (
    tagTokens.some((tag) => tag === normalized || (canUseContains && tag.includes(normalized))) ||
    (canUseContains && relLower.includes(normalized))
  );
}

function findMatchingLabel(labels, requirement) {
  const reqIndex = Number.isFinite(Number(requirement.index)) ? Number(requirement.index) : null;
  const reqLabel = normalizeMatchToken(requirement.label || requirement.name || '');
  const minConfidence = Number(requirement.minConfidence ?? 0);
  return labels.find((label) => {
    const confidence = label.confidence ?? 1;
    if (confidence < minConfidence) return false;
    if (reqIndex !== null && label.index === reqIndex) return true;
    if (!reqLabel) return false;
    const actual = normalizeMatchToken(label.label || '');
    if (actual === reqLabel) return true;
    const canUseContains = Math.min(actual.length, reqLabel.length) >= 6;
    return canUseContains && (actual.includes(reqLabel) || reqLabel.includes(actual));
  });
}

function normalizeMatchToken(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[\s_\-\/]+/g, '');
}

function matchesMetadataCondition(metadata, condition) {
  const actual = getMetadataPath(metadata, condition.path);
  if (actual === undefined || actual === null || actual === '') return false;
  const expected = condition.value;
  switch (condition.op || '=') {
    case '>=':
      return Number(actual) >= Number(expected);
    case '>':
      return Number(actual) > Number(expected);
    case '<=':
      return Number(actual) <= Number(expected);
    case '<':
      return Number(actual) < Number(expected);
    case 'contains':
      return String(actual).toLowerCase().includes(String(expected).toLowerCase());
    case '=':
    default:
      return actual === expected || String(actual).toLowerCase() === String(expected).toLowerCase();
  }
}

function getMetadataPath(metadata, pathValue) {
  if (!pathValue) return undefined;
  const parts = String(pathValue).split('.');
  let current = metadata;
  for (const part of parts) {
    if (current === undefined || current === null) return undefined;
    if (Object.prototype.hasOwnProperty.call(current, part)) {
      current = current[part];
      continue;
    }
    const camel = part.replace(/_([a-z])/g, (_, char) => char.toUpperCase());
    if (Object.prototype.hasOwnProperty.call(current, camel)) {
      current = current[camel];
      continue;
    }
    return undefined;
  }
  return current;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

function normalizeRatingPayload(body, rules) {
  const filterIds = new Set((rules.filters || []).map((filter) => filter.id));
  const filters = {};
  const incoming = body.filters && typeof body.filters === 'object' ? body.filters : {};
  for (const [filterId, value] of Object.entries(incoming)) {
    if (!filterIds.has(filterId)) continue;
    const rating = Number(value);
    if (!Number.isFinite(rating)) continue;
    filters[filterId] = Math.max(0, Math.min(5, Math.round(rating)));
  }

  const allBad = Boolean(body.allBad);
  return {
    imageId: String(body.imageId || ''),
    filters: allBad ? {} : filters,
    allBad,
    note: typeof body.note === 'string' ? body.note.slice(0, 1000) : ''
  };
}

async function loadRatings() {
  const store = await readJson(RATINGS_PATH, { version: 1, ratings: {} });
  if (!store.ratings || typeof store.ratings !== 'object') store.ratings = {};
  return store;
}

async function saveRating(session, payload) {
  const rules = await getRules();
  const normalized = normalizeRatingPayload(payload, rules);
  if (!normalized.imageId) {
    const err = new Error('imageId is required');
    err.status = 400;
    throw err;
  }

  ratingsWrite = ratingsWrite.catch(() => {}).then(async () => {
    const store = await loadRatings();
    store.ratings[normalized.imageId] ||= {};
    store.ratings[normalized.imageId][session.user.id] = {
      user: {
        id: session.user.id,
        name: session.user.name,
        email: session.user.email || '',
        authProvider: session.user.authProvider
      },
      filters: normalized.filters,
      allBad: normalized.allBad,
      note: normalized.note,
      updatedAt: new Date().toISOString()
    };
    store.updatedAt = new Date().toISOString();
    await writeJsonAtomic(RATINGS_PATH, store);
    return store;
  });

  return ratingsWrite;
}

function buildRatingView(store, userId) {
  const own = {};
  const aggregate = {};

  for (const [imageId, userRatings] of Object.entries(store.ratings || {})) {
    const ownRating = userRatings[userId];
    if (ownRating) own[imageId] = ownRating;

    aggregate[imageId] = { filters: {}, allBadCount: 0, userCount: 0 };
    for (const rating of Object.values(userRatings)) {
      aggregate[imageId].userCount += 1;
      if (rating.allBad) aggregate[imageId].allBadCount += 1;
      for (const [filterId, value] of Object.entries(rating.filters || {})) {
        const number = Number(value);
        if (!Number.isFinite(number)) continue;
        aggregate[imageId].filters[filterId] ||= {
          count: 0,
          average: 0,
          sum: 0,
          distribution: { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
        };
        const bucket = Math.max(0, Math.min(5, Math.round(number)));
        const item = aggregate[imageId].filters[filterId];
        item.count += 1;
        item.sum += number;
        item.average = Math.round((item.sum / item.count) * 100) / 100;
        item.distribution[bucket] += 1;
      }
    }
  }

  return { own, aggregate };
}

async function loadAnnotations() {
  const store = await readJson(ANNOTATIONS_PATH, { version: 1, images: {}, filters: {} });
  if (!store.images || typeof store.images !== 'object') store.images = {};
  if (!store.filters || typeof store.filters !== 'object') store.filters = {};
  return store;
}

function buildAnnotationView(store, userId) {
  const own = { images: {}, filters: {} };
  const aggregate = { images: {}, filters: {} };

  for (const [imageId, userItems] of Object.entries(store.images || {})) {
    if (userItems[userId]) own.images[imageId] = userItems[userId];
    aggregate.images[imageId] = summarizeAnnotationItems(Object.values(userItems || {}));
  }

  for (const [filterId, userItems] of Object.entries(store.filters || {})) {
    if (userItems[userId]) own.filters[filterId] = userItems[userId];
    aggregate.filters[filterId] = summarizeAnnotationItems(Object.values(userItems || {}));
  }

  return { own, aggregate };
}

function summarizeAnnotationItems(items) {
  const tagCounts = {};
  const descriptions = [];
  for (const item of items) {
    for (const tag of [
      ...(item.sceneBaseTags || []),
      ...(item.subjectTags || []),
      ...(item.lightingTags || []),
      ...(item.colorTags || []),
      ...(item.qualityTags || []),
      ...(item.filterStyleTags || []),
      ...(item.riskTags || [])
    ]) {
      tagCounts[tag] = (tagCounts[tag] || 0) + 1;
    }
    if (item.description) {
      descriptions.push({
        user: item.user?.name || '',
        text: item.description,
        updatedAt: item.updatedAt || ''
      });
    }
  }
  return {
    userCount: items.length,
    topTags: Object.entries(tagCounts)
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, 12)
      .map(([tag, count]) => ({ tag, count })),
    descriptions: descriptions.slice(-8)
  };
}

function normalizeStringList(value, limit = 24) {
  if (!Array.isArray(value)) {
    value = value ? [value] : [];
  }
  return unique(
    value
      .map((item) => String(item || '').trim())
      .filter(Boolean)
      .map((item) => item.slice(0, 80))
  ).slice(0, limit);
}

function normalizeAnnotationPayload(body) {
  return {
    sceneBaseTags: normalizeStringList(body.sceneBaseTags),
    subjectTags: normalizeStringList(body.subjectTags),
    lightingTags: normalizeStringList(body.lightingTags),
    colorTags: normalizeStringList(body.colorTags),
    qualityTags: normalizeStringList(body.qualityTags),
    filterStyleTags: normalizeStringList(body.filterStyleTags),
    riskTags: normalizeStringList(body.riskTags),
    style: normalizeStringList(body.style, 8),
    saturation: String(body.saturation || '').trim().slice(0, 80),
    contrast: String(body.contrast || '').trim().slice(0, 80),
    hue: String(body.hue || '').trim().slice(0, 80),
    colorTemp: String(body.colorTemp || '').trim().slice(0, 80),
    description: String(body.description || '').trim().slice(0, 2000)
  };
}

async function saveImageAnnotation(session, body) {
  const imageId = String(body.imageId || '').trim();
  if (!imageId) {
    const err = new Error('imageId is required');
    err.status = 400;
    throw err;
  }
  const normalized = normalizeAnnotationPayload(body);
  const store = await loadAnnotations();
  store.images[imageId] ||= {};
  store.images[imageId][session.user.id] = {
    user: annotationUser(session),
    ...normalized,
    updatedAt: new Date().toISOString()
  };
  store.updatedAt = new Date().toISOString();
  await writeJsonAtomic(ANNOTATIONS_PATH, store);
  return store;
}

async function saveFilterAnnotation(session, body) {
  const filterId = String(body.filterId || '').trim();
  if (!filterId) {
    const err = new Error('filterId is required');
    err.status = 400;
    throw err;
  }
  const normalized = normalizeAnnotationPayload(body);
  const store = await loadAnnotations();
  store.filters[filterId] ||= {};
  store.filters[filterId][session.user.id] = {
    user: annotationUser(session),
    ...normalized,
    updatedAt: new Date().toISOString()
  };
  store.updatedAt = new Date().toISOString();
  await writeJsonAtomic(ANNOTATIONS_PATH, store);
  return store;
}

function annotationUser(session) {
  return {
    id: session.user.id,
    name: session.user.name,
    email: session.user.email || '',
    authProvider: session.user.authProvider
  };
}

function exportRatingsCsv(store) {
  const rows = [
    ['image_id', 'user_id', 'user_name', 'auth_provider', 'email', 'all_bad', 'filter_id', 'rating', 'note', 'updated_at']
  ];
  for (const [imageId, userRatings] of Object.entries(store.ratings || {})) {
    for (const [userId, rating] of Object.entries(userRatings || {})) {
      const filters = Object.entries(rating.filters || {});
      if (!filters.length) {
        rows.push([
          imageId,
          userId,
          rating.user?.name || '',
          rating.user?.authProvider || '',
          rating.user?.email || '',
          rating.allBad ? '1' : '0',
          '',
          '',
          rating.note || '',
          rating.updatedAt || ''
        ]);
        continue;
      }
      for (const [filterId, value] of filters) {
        rows.push([
          imageId,
          userId,
          rating.user?.name || '',
          rating.user?.authProvider || '',
          rating.user?.email || '',
          rating.allBad ? '1' : '0',
          filterId,
          String(value),
          rating.note || '',
          rating.updatedAt || ''
        ]);
      }
    }
  }
  return rows.map((row) => row.map(csvEscape).join(',')).join('\n');
}

function csvEscape(value) {
  const text = String(value ?? '');
  if (!/[",\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

async function serveStatic(req, res, pathname) {
  const relPath = pathname === '/' ? 'index.html' : pathname.replace(/^\//, '');
  const absPath = resolveUnder(PUBLIC_DIR, relPath);
  if (!absPath) {
    textResponse(res, 403, 'Forbidden');
    return;
  }
  await serveFile(res, absPath);
}

async function serveMedia(res, relPath) {
  const absPath = resolveUnder(SCENE_LIBRARY_DIR, relPath);
  if (!absPath) {
    textResponse(res, 403, 'Forbidden');
    return;
  }
  await serveFile(res, absPath);
}

async function serveLut(res, relPath) {
  const absPath = resolveUnder(LUT_ROOT, relPath);
  if (!absPath) {
    textResponse(res, 403, 'Forbidden');
    return;
  }
  await serveFile(res, absPath);
}

async function serveExternalLut(res, id) {
  const filter = await findExternalLutById(decodeURIComponent(id));
  if (!filter) {
    textResponse(res, 404, 'Not found');
    return;
  }
  const source = (await getLutSources()).find((item) => item.id === filter.sourceId);
  if (!source) {
    textResponse(res, 404, 'Not found');
    return;
  }
  const absPath = resolveUnder(source.path, filter.relativePath);
  if (!absPath) {
    textResponse(res, 403, 'Forbidden');
    return;
  }
  await serveFile(res, absPath);
}

async function serveFile(res, absPath) {
  let stat;
  try {
    stat = await fs.stat(absPath);
  } catch (error) {
    if (error.code === 'ENOENT') {
      textResponse(res, 404, 'Not found');
      return;
    }
    throw error;
  }
  if (!stat.isFile()) {
    textResponse(res, 404, 'Not found');
    return;
  }
  const ext = path.extname(absPath).toLowerCase();
  const noStore = ['.html', '.js', '.css'].includes(ext);
  res.writeHead(200, {
    'Content-Type': mimeTypes[ext] || 'application/octet-stream',
    'Content-Length': stat.size,
    'Cache-Control': noStore ? 'no-store' : 'public, max-age=3600'
  });
  fsSync.createReadStream(absPath).pipe(res);
}

async function handleLocalLogin(req, res) {
  const body = await readBodyJson(req);
  const name = String(body.name || '').trim();
  const accessCode = String(body.accessCode || '');
  if (!name) {
    jsonResponse(res, 400, { error: 'name_required' });
    return;
  }
  if (ACCESS_CODE && accessCode !== ACCESS_CODE) {
    jsonResponse(res, 401, { error: 'bad_access_code' });
    return;
  }
  const slug = name.toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5._-]+/gi, '-').slice(0, 80);
  const user = {
    id: `local:${slug || crypto.createHash('sha1').update(name).digest('hex').slice(0, 12)}`,
    name,
    email: '',
    authProvider: 'local'
  };
  createSession(res, user);
  jsonResponse(res, 200, { user });
}

function handleLarkLogin(req, res, url) {
  if (!LARK_ENABLED) {
    jsonResponse(res, 400, { error: 'lark_not_configured' });
    return;
  }
  const host = req.headers.host || 'localhost';
  const callbackUrl = `http://${host}/auth/lark/callback`;
  const state = crypto.randomBytes(16).toString('hex');
  oauthStates.set(state, {
    expiresAt: Date.now() + 1000 * 60 * 10,
    next: safeRedirectPath(url.searchParams.get('next') || req.headers.referer || '/')
  });
  const params = new URLSearchParams({
    app_id: LARK_APP_ID,
    redirect_uri: callbackUrl,
    state
  });
  redirect(res, `${LARK_HOST}/open-apis/authen/v1/index?${params.toString()}`);
}

async function handleLarkCallback(req, res, url) {
  if (!LARK_ENABLED) {
    textResponse(res, 400, 'Lark login is not configured.');
    return;
  }
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const stateRecord = state ? oauthStates.get(state) : null;
  const stateExpiresAt = typeof stateRecord === 'number' ? stateRecord : stateRecord?.expiresAt || 0;
  const nextPath = typeof stateRecord === 'object' ? stateRecord.next || '/' : '/';
  oauthStates.delete(state);
  if (!code || !state || !stateExpiresAt || stateExpiresAt < Date.now()) {
    textResponse(res, 400, 'Invalid Lark login state.');
    return;
  }

  const appTokenResp = await larkFetch('/open-apis/auth/v3/app_access_token/internal', {
    method: 'POST',
    body: {
      app_id: LARK_APP_ID,
      app_secret: LARK_APP_SECRET
    }
  });
  const appAccessToken = appTokenResp.app_access_token || appTokenResp.data?.app_access_token;

  const userTokenResp = await larkFetch('/open-apis/authen/v1/access_token', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${appAccessToken}`
    },
    body: {
      grant_type: 'authorization_code',
      code
    }
  });
  const userAccessToken = userTokenResp.data?.access_token || userTokenResp.access_token;
  const tenantKey = userTokenResp.data?.tenant_key || userTokenResp.tenant_key || '';
  const userName = (userTokenResp.data?.name || userTokenResp.name || '');

  if (LARK_ALLOWED_TENANT && tenantKey !== LARK_ALLOWED_TENANT) {
    console.error(`Lark login rejected: user "${userName}" tenant "${tenantKey}" not in allowlist "${LARK_ALLOWED_TENANT}"`);
    textResponse(res, 403, '此应用仅限 Nothing Tech 组织成员登录。');
    return;
  }

  if (!LARK_ALLOWED_TENANT && tenantKey) {
    console.log(`Lark login: user "${userName}" tenant "${tenantKey}" (set LARK_ALLOWED_TENANT to restrict)`);
  }

  const userInfoResp = await larkFetch('/open-apis/authen/v1/user_info', {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${userAccessToken}`
    }
  });
  const info = userInfoResp.data || userInfoResp;
  const user = {
    id: `lark:${info.open_id || info.union_id || info.user_id || crypto.createHash('sha1').update(JSON.stringify(info)).digest('hex')}`,
    name: info.name || info.en_name || info.email || info.open_id || 'Lark User',
    email: info.email || '',
    avatarUrl: info.avatar_url || info.avatar_thumb || '',
    authProvider: 'lark',
    openId: info.open_id || ''
  };
  createSession(res, user);
  redirect(res, nextPath);
}

async function larkFetch(uri, options) {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    ...(options.headers || {})
  };
  const response = await fetch(`${LARK_HOST}${uri}`, {
    method: options.method,
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || (Number.isFinite(Number(data.code)) && Number(data.code) !== 0)) {
    const err = new Error(data.msg || `Lark request failed: ${response.status}`);
    err.status = 502;
    throw err;
  }
  return data;
}

async function handleApi(req, res, url) {
  const pathname = url.pathname;

  if (pathname === '/api/session' && req.method === 'GET') {
    const session = getSession(req);
    jsonResponse(res, 200, {
      user: session?.user || null,
      larkEnabled: LARK_ENABLED,
      accessCodeRequired: Boolean(ACCESS_CODE)
    });
    return;
  }

  if (pathname === '/api/login' && req.method === 'POST') {
    await handleLocalLogin(req, res);
    return;
  }

  if (pathname === '/api/logout' && req.method === 'POST') {
    const session = getSession(req);
    if (session) sessions.delete(session.id);
    clearSessionCookie(res);
    jsonResponse(res, 200, { ok: true });
    return;
  }

  const session = requireSession(req, res);
  if (!session) return;

  if (pathname === '/api/config' && req.method === 'GET') {
    jsonResponse(res, 200, {
      sceneLibraryDir: SCENE_LIBRARY_DIR,
      rulesPath: RULES_PATH,
      lutRoot: LUT_ROOT,
      lutSources: (await getRules()).lutSources,
      defaultSceneLibraryDir: DEFAULT_SCENE_LIBRARY_DIR,
      larkEnabled: LARK_ENABLED,
      supportedImageExtensions: [...IMAGE_EXTENSIONS].sort(),
      browserRecommendedImageExtensions: BROWSER_RECOMMENDED_IMAGE_EXTENSIONS,
      mlkit: {
        commandConfigured: Boolean(MLKIT_LABEL_COMMAND),
        timeoutMs: MLKIT_LABEL_TIMEOUT_MS
      }
    });
    return;
  }

  if (pathname === '/api/debug/scene-library' && req.method === 'GET') {
    jsonResponse(res, 200, await getSceneLibraryDiagnostics());
    return;
  }

  if (pathname === '/api/rules' && req.method === 'GET') {
    jsonResponse(res, 200, await getRules());
    return;
  }

  if (pathname === '/api/sub-scenes' && req.method === 'GET') {
    const subSceneRules = await getSubSceneRules();
    jsonResponse(res, 200, {
      ...subSceneRules,
      subScenes: (subSceneRules.subScenes || []).map((scene) => ({
        id: scene.subSceneId,
        ...scene
      }))
    });
    return;
  }

  if (pathname === '/api/rule-diagnostics' && req.method === 'GET') {
    jsonResponse(res, 200, await getRuleDiagnostics());
    return;
  }

  if (pathname === '/api/images' && req.method === 'GET') {
    jsonResponse(res, 200, await listImages());
    return;
  }

  if (pathname === '/api/refresh-labels' && req.method === 'POST') {
    const body = await readBodyJson(req);
    jsonResponse(res, 200, await refreshSceneLabels({
      force: Boolean(body.force),
      limit: Number(body.limit || 0)
    }));
    return;
  }

  if (pathname === '/api/ratings' && req.method === 'GET') {
    const store = await loadRatings();
    jsonResponse(res, 200, buildRatingView(store, session.user.id));
    return;
  }

  if (pathname === '/api/ratings' && req.method === 'POST') {
    const body = await readBodyJson(req);
    const store = await saveRating(session, body);
    jsonResponse(res, 200, buildRatingView(store, session.user.id));
    return;
  }

  if (pathname === '/api/annotations' && req.method === 'GET') {
    jsonResponse(res, 200, buildAnnotationView(await loadAnnotations(), session.user.id));
    return;
  }

  if (pathname === '/api/annotations/image' && req.method === 'POST') {
    const body = await readBodyJson(req);
    const store = await saveImageAnnotation(session, body);
    jsonResponse(res, 200, buildAnnotationView(store, session.user.id));
    return;
  }

  if (pathname === '/api/annotations/filter' && req.method === 'POST') {
    const body = await readBodyJson(req);
    const store = await saveFilterAnnotation(session, body);
    jsonResponse(res, 200, buildAnnotationView(store, session.user.id));
    return;
  }

  if (pathname === '/api/export/ratings.json' && req.method === 'GET') {
    jsonResponse(res, 200, await loadRatings());
    return;
  }

  if (pathname === '/api/export/annotations.json' && req.method === 'GET') {
    jsonResponse(res, 200, await loadAnnotations());
    return;
  }

  if (pathname === '/api/export/ratings.csv' && req.method === 'GET') {
    const csv = exportRatingsCsv(await loadRatings());
    textResponse(res, 200, csv, 'text/csv; charset=utf-8');
    return;
  }

  jsonResponse(res, 404, { error: 'not_found' });
}

async function requestHandler(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    if (url.pathname === '/auth/lark' && req.method === 'GET') {
      handleLarkLogin(req, res, url);
      return;
    }
    if (url.pathname === '/auth/lark/callback' && req.method === 'GET') {
      await handleLarkCallback(req, res, url);
      return;
    }
    if (url.pathname.startsWith('/api/')) {
      await handleApi(req, res, url);
      return;
    }
    if (url.pathname.startsWith('/media/')) {
      const session = requireSession(req, res);
      if (!session) return;
      await serveMedia(res, url.pathname.slice('/media/'.length));
      return;
    }
    if (url.pathname.startsWith('/lut/')) {
      const session = requireSession(req, res);
      if (!session) return;
      await serveLut(res, url.pathname.slice('/lut/'.length));
      return;
    }
    if (url.pathname.startsWith('/lut-file/')) {
      const session = requireSession(req, res);
      if (!session) return;
      await serveExternalLut(res, url.pathname.slice('/lut-file/'.length));
      return;
    }
    await serveStatic(req, res, url.pathname);
  } catch (error) {
    const status = error.status || 500;
    if (status >= 500) console.error(error);
    if (req.url?.startsWith('/api/')) {
      jsonResponse(res, status, { error: error.message || 'server_error' });
      return;
    }
    textResponse(res, status, error.message || 'Server error');
  }
}

await ensureStorage();

createServer(requestHandler).listen(PORT, HOST, () => {
  console.log(`Scene LUT rating tool: http://localhost:${PORT}`);
  console.log(`Scene library: ${SCENE_LIBRARY_DIR}`);
  console.log(`Rules: ${RULES_PATH}`);
  if (MLKIT_LABEL_COMMAND) {
    console.log(`ML Kit label command: ${MLKIT_LABEL_COMMAND}`);
  } else {
    console.log('ML Kit label command not configured. Set MLKIT_LABEL_COMMAND to enable scene-library tagging.');
  }
  getLutSources().then((sources) => {
    if (sources.length) {
      console.log(`LUT sources: ${sources.map((source) => source.path).join(' | ')}`);
    }
  }).catch((error) => console.error(error));
  if (LARK_ENABLED) {
    console.log(`Lark login enabled: ${LARK_HOST}`);
  } else {
    console.log('Lark login disabled. Use local username login.');
  }
});
