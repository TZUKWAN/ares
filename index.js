import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const name = 'ares';

/**
 * Ares 超级竞赛插件 —— DeepSeek Harness 宿主插件。
 *
 * 职责：把 skills/ 下全部技能目录（SKILL.md + references/ + scripts/）注册为
 * DSH runtime skill。总控技能 ares 面向用户与模型双向可触发；生产线/共享技能
 * 仅模型可触发，由总控按名称调度（用户自然语言只打总控，与 Claude Code 侧
 * Commands 薄封装语义一致）。技能正文不进 Node 进程，由模型按 SKILL.md 驱动
 * pwsh 执行插件根下 scripts/ 与 data/（插件根 = 本 bundle 目录）。
 *
 * 注册失败的单个技能只告警跳过，不阻断其余技能与其余 bundle 装配。
 */
export function apply(ctx, config = {}) {
  ctx.inject(['skills'], (scope) => {
    const pkgDir = dirname(fileURLToPath(import.meta.url));
    const skillsRoot = join(pkgDir, 'skills');
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
