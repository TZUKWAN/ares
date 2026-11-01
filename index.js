import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

export const name = 'ares';

const PKG_DIR = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(PKG_DIR, 'data');
const STAGES = ['match', 'profile', 'plan', 'research', 'produce', 'review', 'deliver'];
const STAGE_ZH = { match: '赛事匹配', profile: '项目档案', plan: '生产计划', research: '调研先行', produce: '材料生产', review: '质检评审', deliver: '交付收尾' };

/* ------------------------------------------------------------------ 技能注册 */

/**
 * Ares 超级竞赛插件 —— DeepSeek Harness 宿主插件。
 *
 * 职责一：把 skills/ 下全部技能目录（SKILL.md + references/ + scripts/）注册为
 * DSH runtime skill。总控技能 ares 面向用户与模型双向可触发；生产线/共享技能
 * 仅模型可触发，由总控按名称调度。技能正文不进 Node 进程，由模型按 SKILL.md
 * 驱动 pwsh 执行插件根下 scripts/ 与 data/（插件根 = 本 bundle 目录）。
 *
 * 职责二：挂载 /ares/api/v1/* 宿主路由，为侧边栏「ARES 工作台」客户端面板
 * 提供真实数据（项目扫描、赛事主库、环境体检）。数据一律来自插件 data/ 与
 * 用户项目目录中的真实文件，面板不制造任何演示数字。
 *
 * 注册失败的单个技能只告警跳过，不阻断其余技能与其余 bundle 装配。
 */
export function apply(ctx, config = {}) {
  ctx.inject(['skills'], (scope) => {
    const skillsRoot = join(PKG_DIR, 'skills');
    if (!existsSync(skillsRoot)) {
      console.warn('[ares] no skills/ directory, nothing registered');
      return;
    }
    const disposables = [];
    const registered = [];
    for (const ent of readdirSync(skillsRoot, { withFileTypes: true })) {
      if (!ent.isDirectory()) continue;
      const skillDir = join(skillsRoot, ent.name);
      const skillPath = join(skillDir, 'SKILL.md');
      if (!existsSync(skillPath)) continue;
      try {
        const raw = readFileSync(skillPath, 'utf8');
        const parsed = parseSkillMarkdown(raw, skillPath);
        if (!parsed.name) throw new Error('frontmatter 缺少 name 字段');
        const isMaster = parsed.name === 'ares';
        const dispose = scope.skills.register({
          name: parsed.name,
          description: parsed.description || 'Ares 竞赛插件技能',
          whenToUse: parsed.whenToUse,
          invocation: { modelInvocable: true, userInvocable: isMaster },
          provider: 'ares',
          source: 'plugin:ares',
          content: parsed.content,
          path: skillPath,
          resourceBase: { kind: 'directory', path: skillDir },
        });
        disposables.push(dispose);
        registered.push(parsed.name);
      } catch (error) {
        console.warn(`[ares] skill skipped: ${ent.name}:`, String(error));
      }
    }
    console.info(`[ares] registered ${registered.length} runtime skills: ${registered.join(', ')}`);
    scope.effect(
      () => () => {
        for (const d of disposables) {
          try {
            d();
          } catch {}
        }
      },
      'ares: dispose runtime skills',
    );
  });

  ctx.inject(['webServer'], (hostCtx) => {
    const routes = buildRoutes();
    const disposers = [];
    for (const route of routes) {
      try {
        const off = hostCtx.webServer.register(route);
        if (typeof off === 'function') disposers.push(off);
      } catch (error) {
        console.warn('[ares] route failed to register:', route.path, String(error));
      }
    }
    ctx.effect(
      () => () => {
        for (const off of disposers) {
          try {
            off();
          } catch {}
        }
      },
      'ares: workbench routes',
    );
  });
}

/** 解析 SKILL.md 的 YAML frontmatter（仅取单行标量字段，避免引入 yaml 依赖）。 */
function parseSkillMarkdown(raw, source) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw);
  if (!m) throw new Error(`${source} 缺少 frontmatter`);
  const fm = m[1];
  const get = (key) => {
    const r = new RegExp(`^${key}:[ \\t]*(.+)$`, 'm').exec(fm);
    return r ? r[1].trim().replace(/^["']|["']$/g, '') : undefined;
  };
  return {
    name: get('name'),
    description: get('description'),
    whenToUse: get('whenToUse'),
    content: raw.slice(m[0].length),
  };
}

/* ------------------------------------------------------------------ 工作台路由 */

function modeConfigPath() {
  return join(process.env.DSH_HOME || join(homedir(), '.dsh'), 'ares-mode.json');
}

function readModeConfig() {
  try {
    const parsed = JSON.parse(readFileSync(modeConfigPath(), 'utf8'));
    return {
      enabled: parsed.enabled !== false,
      roots: Array.isArray(parsed.roots) ? parsed.roots.map(String) : [],
    };
  } catch {
    return { enabled: true, roots: [] };
  }
}

function writeModeConfig(config) {
  try {
    writeFileSync(modeConfigPath(), JSON.stringify(config, null, 2) + '\n', 'utf8');
    return true;
  } catch {
    return false;
  }
}

function sendJson(response, status, payload) {
  const body = JSON.stringify(payload);
  response.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
  });
  response.end(body);
}

async function readJsonBody(request, limit = 1024 * 1024) {
  return new Promise((resolvePromise, rejectPromise) => {
    let size = 0;
    const chunks = [];
    request.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        rejectPromise(new Error('body too large'));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        resolvePromise(text ? JSON.parse(text) : {});
      } catch {
        rejectPromise(new Error('invalid JSON body'));
      }
    });
    request.on('error', rejectPromise);
  });
}

function sameOrigin(request) {
  const origin = request.headers.origin;
  if (!origin) return true;
  try {
    return new URL(origin).host === request.headers.host;
  } catch {
    return false;
  }
}

let catalogCache = null;
function loadCatalog() {
  if (catalogCache) return catalogCache;
  const competitions = JSON.parse(readFileSync(join(DATA_DIR, 'competitions.json'), 'utf8'));
  let tracks = [];
  const tracksPath = join(DATA_DIR, 'tracks.json');
  if (existsSync(tracksPath)) {
    tracks = JSON.parse(readFileSync(tracksPath, 'utf8')).entries || [];
  }
  const byCompetition = new Map();
  for (const t of tracks) {
    if (!byCompetition.has(t.competition_id)) byCompetition.set(t.competition_id, []);
    byCompetition.get(t.competition_id).push({ track: t.track, pipeline: t.pipeline, deliverables: t.default_deliverables });
  }
  catalogCache = {
    count: competitions.length,
    records: competitions.map((c) => ({
      id: c.id, name: c.name, aliases: c.aliases || [], level: c.level,
      pipeline: c.pipeline, category: c.category,
      tracks: (byCompetition.get(c.id) || []).map((t) => t.track),
    })),
    tracks: Object.fromEntries(byCompetition),
  };
  return catalogCache;
}

/** 探测一个目录是否为 Ares 竞赛项目（有 project.json），并汇总真实状态。 */
function probeRoot(root) {
  const profilePath = join(root, 'project.json');
  const runPath = join(root, 'ares-run.json');
  const hasProfile = existsSync(profilePath);
  const hasRun = existsSync(runPath);
  if (!hasProfile && !hasRun) return { root, ares: false, name: basename(root) };

  let profile = null;
  let profileError = null;
  if (hasProfile) {
    try {
      profile = JSON.parse(readFileSync(profilePath, 'utf8'));
    } catch (error) {
      profileError = 'project.json 解析失败：' + String(error);
    }
  }
  let run = null;
  if (hasRun) {
    try {
      run = JSON.parse(readFileSync(runPath, 'utf8'));
    } catch {
      run = null;
    }
  }

  const projectName = profile?.project_name || basename(root);
  let deliverables = null;
  if (profile && profile.competition?.id != null) {
    try {
      const tracks = loadCatalog().tracks;
      const entries = tracks[profile.competition.id] || [];
      const match = entries.find((t) => t.track === profile.competition?.track) || entries[0];
      if (match) {
        const outputsBase = join(root, '输出', projectName);
        deliverables = match.deliverables.map((d) => {
          const isDir = d.endsWith('/');
          const rel = d.replace(/\/$/, '');
          const target = join(outputsBase, rel);
          return { name: d, present: existsSync(target) && (isDir ? statSync(target).isDirectory() : statSync(target).isFile()) };
        });
      }
    } catch {
      deliverables = null;
    }
  }

  return {
    root,
    ares: true,
    name: projectName,
    oneLiner: profile?.one_liner || '',
    slogan: profile?.slogan || '',
    competition: profile?.competition || null,
    stage: run?.current_stage || null,
    stageLabel: run?.current_stage ? STAGE_ZH[run.current_stage] || run.current_stage : null,
    stages: STAGES.map((s) => ({
      key: s,
      label: STAGE_ZH[s],
      status: run?.stages?.[s]?.status || (run ? 'pending' : null),
      evidence: run?.stages?.[s]?.evidence || [],
    })),
    hasRunState: hasRun,
    deliverables,
    profileError,
  };
}

let doctorCache = null; // {at, payload}
function runDoctor() {
  if (doctorCache && Date.now() - doctorCache.at < 5 * 60 * 1000) return doctorCache.payload;
  const tmpOut = join(modeConfigPath(), '..', 'ares-doctor-cache.json');
  const run = spawnSync('python', [join(PKG_DIR, 'scripts', 'doctor.py'), '--out', tmpOut], {
    encoding: 'utf8',
    timeout: 60_000,
    windowsHide: true,
    env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
  });
  let payload = null;
  try {
    payload = JSON.parse(readFileSync(tmpOut, 'utf8'));
  } catch {
    payload = null;
  }
  const result = {
    ok: run.status === 0 && !!payload,
    exitCode: run.status,
    error: run.status !== 0 ? String(run.stderr || run.stdout || '').slice(-300) : null,
    requiredModules: payload?.required_modules || null,
    capabilities: payload?.capabilities || null,
  };
  doctorCache = { at: Date.now(), payload: result };
  return result;
}

function buildRoutes() {
  const guard = (handler) => (request, response) => {
    if (!sameOrigin(request)) {
      sendJson(response, 403, { ok: false, error: 'cross-origin refused' });
      return;
    }
    try {
      handler(request, response);
    } catch (error) {
      sendJson(response, 500, { ok: false, error: String(error) });
    }
  };
  return [
    {
      kind: 'exact',
      path: '/ares/api/v1/state',
      handler: guard((_request, response) => {
        const config = readModeConfig();
        const catalog = loadCatalog();
        sendJson(response, 200, { ok: true, enabled: config.enabled, roots: config.roots, competitions: catalog.count });
      }),
    },
    {
      kind: 'exact',
      path: '/ares/api/v1/projects',
      handler: guard((_request, response) => {
        const config = readModeConfig();
        const projects = config.roots.map(probeRoot);
        sendJson(response, 200, { ok: true, scannedAt: new Date().toISOString(), projects });
      }),
    },
    {
      kind: 'exact',
      path: '/ares/api/v1/competitions',
      handler: guard((_request, response) => {
        const catalog = loadCatalog();
        sendJson(response, 200, { ok: true, count: catalog.count, records: catalog.records });
      }),
    },
    {
      kind: 'exact',
      path: '/ares/api/v1/doctor',
      handler: guard((_request, response) => {
        sendJson(response, 200, { ok: true, ...runDoctor() });
      }),
    },
    {
      kind: 'exact',
      path: '/ares/api/v1/roots',
      handler: guard(async (request, response) => {
        const body = await readJsonBody(request);
        const raw = typeof body.path === 'string' ? body.path.trim() : '';
        if (!raw) {
          sendJson(response, 400, { ok: false, error: 'path required' });
          return;
        }
        const resolved = join(raw);
        if (!existsSync(resolved)) {
          sendJson(response, 400, { ok: false, error: 'directory does not exist: ' + resolved });
          return;
        }
        const config = readModeConfig();
        if (!config.roots.some((existing) => existing.toLowerCase() === resolved.toLowerCase())) {
          config.roots.push(resolved);
          writeModeConfig(config);
        }
        sendJson(response, 200, { ok: true, roots: config.roots });
      }),
    },
    {
      kind: 'exact',
      path: '/ares/api/v1/roots/remove',
      handler: guard(async (request, response) => {
        const body = await readJsonBody(request);
        const raw = typeof body.path === 'string' ? body.path : '';
        const config = readModeConfig();
        config.roots = config.roots.filter((existing) => existing.toLowerCase() !== raw.toLowerCase());
        writeModeConfig(config);
        sendJson(response, 200, { ok: true, roots: config.roots });
      }),
    },
  ];
}
