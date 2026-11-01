/** Ares 竞赛工作台 —— 一站式面板：项目状态 · 七阶段进度 · 赛事主库 · 环境体检。数据全部来自宿主真实路由。 */
window.__ModuleLoader__.load({
  id: 'ares',
  factory(require) {
    const React = require('react');
    const h = React.createElement;
    const PKG_ID = 'ares';
    const PANEL_KEY = 'ares-workbench';
    const NS = PKG_ID;

    const DICT = {
      zh: {
        nav: 'ARES', title: '竞赛工作台', subtitle: '一句话参赛备赛，从赛事匹配到全套材料交付。',
        refresh: '刷新数据', refreshing: '正在同步',
        projects: '竞赛项目', projectUnit: '个项目', selectProject: '选择项目',
        addRoot: '关联项目目录', removeRoot: '取消关联', rootsEmpty: '尚未关联任何目录',
        emptyTitle: '开始一项竞赛备赛', emptyText: '关联一个项目目录，在 Ares 会话中说一句参赛需求即可建档开工。已有项目可关联后继续跟进。',
        noProject: '未发现 Ares 项目（目录下需有 project.json 或 ares-run.json）',
        openSession: '打开会话', errSession: '打开会话失败', errPick: '选择目录失败',
        stage: '当前阶段', stages: '七阶段进度', deliverables: '交付物清单', deliverableUnit: '项',
        present: '已交付', missing: '待产出', pipeline: '生产线', level: '级别', track: '赛道',
        noRunState: '尚未创建运行状态（会话中执行 match 阶段后出现）',
        competitions: '赛事主库', competitionUnit: '项赛事', search: '搜索赛事名或别名',
        allLevels: '全部级别', allPipelines: '全部生产线', noMatch: '没有匹配的赛事',
        environment: '环境体检', envOk: '必需能力全部可用', envBad: '必需能力缺失', envUnknown: '未检测',
        aliases: '别名', tracksCount: '个赛道',
        loading: '正在读取数据', readError: '暂时无法读取数据', errorDetails: '查看错误详情',
        stageMatch: '赛事匹配', stageProfile: '项目档案', stagePlan: '生产计划', stageResearch: '调研先行',
        stageProduce: '材料生产', stageReview: '质检评审', stageDeliver: '交付收尾',
        statusPending: '待推进', statusInProgress: '进行中', statusDone: '已完成', statusFailed: '失败', statusSkipped: '已跳过'
      },
      en: {
        nav: 'ARES', title: 'Competition workbench', subtitle: 'From competition matching to a full deliverable set in one sentence.',
        refresh: 'Refresh', refreshing: 'Syncing',
        projects: 'Competition projects', projectUnit: 'projects', selectProject: 'Choose project',
        addRoot: 'Link project folder', removeRoot: 'Unlink', rootsEmpty: 'No folders linked',
        emptyTitle: 'Start a competition entry', emptyText: 'Link a folder, then state your goal in an Ares session. Link existing projects to keep following up.',
        noProject: 'No Ares project found (needs project.json or ares-run.json)',
        openSession: 'Open session', errSession: 'Unable to open session', errPick: 'Unable to pick folder',
        stage: 'Current stage', stages: 'Seven stages', deliverables: 'Deliverables', deliverableUnit: 'items',
        present: 'Delivered', missing: 'Pending', pipeline: 'Pipeline', level: 'Level', track: 'Track',
        noRunState: 'No run state yet (appears after the match stage runs in a session)',
        competitions: 'Competition catalog', competitionUnit: 'competitions', search: 'Search name or alias',
        allLevels: 'All levels', allPipelines: 'All pipelines', noMatch: 'No matching competition',
        environment: 'Environment check', envOk: 'All required capabilities available', envBad: 'Required capabilities missing', envUnknown: 'Not checked',
        aliases: 'Aliases', tracksCount: 'tracks',
        loading: 'Loading data', readError: 'Unable to refresh. Previous data is retained.', errorDetails: 'Error details',
        stageMatch: 'Match', stageProfile: 'Profile', stagePlan: 'Plan', stageResearch: 'Research',
        stageProduce: 'Produce', stageReview: 'Review', stageDeliver: 'Deliver',
        statusPending: 'Pending', statusInProgress: 'In progress', statusDone: 'Done', statusFailed: 'Failed', statusSkipped: 'Skipped'
      }
    };

    const PIPELINES = [
      ['L1', '创业竞赛线'], ['L2', '理科建模线'], ['L3', '工科作品线'], ['L4', '商科分析线'],
      ['L5', '艺术设计线'], ['L6', '程序算法线'], ['E1', '人文语言'], ['E2', '实验技能'], ['E3', '模拟经营'],
    ];
    const STAGE_KEYS = ['match', 'profile', 'plan', 'research', 'produce', 'review', 'deliver'];

    const css = `
.ar-panel,.ar-hud{--ar-accent:#1F4E79;--ar-accent2:#2E75B6;--ar-ink:var(--dsw-alias-label-primary,#202936);--ar-muted:var(--dsw-alias-label-secondary,#74808C);--ar-bg:var(--dsw-alias-bg-base,#F5F7FA);--ar-surface:var(--dsw-alias-bg-layer-1,#fff);--ar-soft:var(--dsw-alias-bg-layer-2,#EEF0F4);--ar-line:var(--dsw-alias-border-l1,#DEE3E9);--ar-cta-ink:#fff;font:14px/1.6 "Segoe UI","Microsoft YaHei UI","Microsoft YaHei","PingFang SC",sans-serif;color:var(--ar-ink);box-sizing:border-box}
body[data-ds-dark-theme] .ar-panel{--ar-accent:#8CCFBC;--ar-accent2:#7FB8E8}
.ar-panel *,.ar-hud *{box-sizing:border-box}.ar-panel{height:100%;overflow:auto;background:var(--ar-bg);scrollbar-gutter:stable}
.ar-shell{max-width:1320px;margin:0 auto;padding:34px 42px 30px}.ar-panel button,.ar-panel input,.ar-panel select{font:inherit}
.ar-panel button{cursor:pointer;-webkit-app-region:no-drag}.ar-panel button:disabled{cursor:wait;opacity:.6}
.ar-top{display:flex;justify-content:space-between;align-items:center;gap:20px;margin-bottom:22px}
.ar-brand{display:flex;align-items:center;gap:12px}.ar-logo{width:40px;height:40px;border-radius:11px;background:linear-gradient(135deg,#2E75B6,#1F4E79);color:#fff;display:flex;align-items:center;justify-content:center;font:700 19px Georgia,serif;flex:none}
.ar-title h1{font-size:22px;font-weight:650;margin:0;letter-spacing:-.3px}.ar-title p{margin:2px 0 0;font-size:12px;color:var(--ar-muted)}
.ar-button{display:inline-flex;align-items:center;gap:7px;min-height:36px;padding:7px 13px;color:var(--ar-ink);background:var(--ar-surface);border:1px solid var(--ar-line);border-radius:9px;line-height:1.4;white-space:nowrap}
.ar-button:hover{background:var(--ar-soft)}.ar-button:active{transform:translateY(1px)}
.ar-button.ar-primary{background:var(--ar-accent);border-color:var(--ar-accent);color:var(--ar-cta-ink);font-weight:600}
.ar-section{margin-bottom:22px}.ar-head{display:flex;justify-content:space-between;align-items:baseline;gap:12px;margin-bottom:12px}
.ar-head h2{font-size:15px;font-weight:650;margin:0}.ar-head span{font-size:11px;color:var(--ar-muted)}
.ar-card{background:var(--ar-surface);border:1px solid var(--ar-line);border-radius:14px}
.ar-projectBar{display:flex;align-items:center;justify-content:space-between;gap:14px;margin-bottom:12px}
.ar-picker{display:flex;align-items:center;gap:10px;min-width:0;flex-wrap:wrap}
.ar-picker select{max-width:430px;border:1px solid var(--ar-line);background:var(--ar-surface);color:var(--ar-ink);border-radius:8px;padding:7px 10px;font-weight:600}
.ar-count{font-size:11px;color:var(--ar-muted);background:var(--ar-soft);padding:2px 8px;border-radius:5px;white-space:nowrap}
.ar-hero{display:grid;grid-template-columns:minmax(0,1.55fr) minmax(230px,1fr);overflow:hidden}
.ar-heroMain{padding:24px 27px}.ar-heroSide{padding:22px 25px;background:color-mix(in srgb,var(--ar-soft) 55%,var(--ar-surface));border-left:1px solid var(--ar-line);display:flex;flex-direction:column;justify-content:center}
.ar-badges{display:flex;gap:7px;flex-wrap:wrap;margin-bottom:12px}
.ar-badge{font-size:11px;font-weight:600;padding:3px 9px;border-radius:5px;background:color-mix(in srgb,var(--ar-accent2) 10%,transparent);color:var(--ar-accent2)}
.ar-hero h3{font-size:23px;font-weight:650;margin:0 0 7px;letter-spacing:-.4px;overflow-wrap:anywhere}
.ar-hero p{margin:0;font-size:13px;color:var(--ar-muted);max-width:560px}
.ar-progressNum{font-size:30px;font-weight:550;line-height:1.25;font-variant-numeric:tabular-nums}
.ar-progressNum small{font-size:14px;color:var(--ar-muted);margin-left:4px}
.ar-progress{height:5px;background:var(--ar-line);border-radius:8px;overflow:hidden;margin:12px 0 8px}
.ar-progress>div{height:100%;background:var(--ar-accent2);transition:width .2s}
.ar-stagerail{display:grid;grid-template-columns:repeat(7,minmax(0,1fr));gap:5px}
.ar-stage{display:flex;flex-direction:column;align-items:center;gap:6px;padding:9px 3px 7px;border:0;border-radius:9px;background:none;color:var(--ar-muted);font-size:11px;line-height:1.4}
.ar-stageDot{height:26px;width:26px;display:flex;align-items:center;justify-content:center;border:1px solid var(--ar-line);border-radius:50%;font-size:11px;font-weight:600;background:var(--ar-surface);font-variant-numeric:tabular-nums}
.ar-stage.is-current .ar-stageDot{color:var(--ar-accent2);border-color:var(--ar-accent2);box-shadow:0 0 0 3px color-mix(in srgb,var(--ar-accent2) 12%,transparent)}
.ar-stage.is-done .ar-stageDot{background:var(--ar-accent2);border-color:var(--ar-accent2);color:var(--ar-cta-ink)}
.ar-stage.is-failed .ar-stageDot{color:#B44846;border-color:#B44846}
.ar-check{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:6px;padding:16px 20px}
.ar-checkItem{display:flex;align-items:center;gap:8px;font-size:12px;padding:6px 8px;border-radius:7px;background:var(--ar-soft)}
.ar-checkItem.is-present{background:color-mix(in srgb,#287E59 9%,transparent);color:#287E59}
.ar-checkMark{font-weight:700;flex:none}
.ar-compTools{display:flex;gap:9px;flex-wrap:wrap;margin-bottom:12px}
.ar-search{flex:1;min-width:200px;max-width:320px;display:flex;align-items:center;border:1px solid var(--ar-line);background:var(--ar-surface);border-radius:8px;padding:7px 11px;color:var(--ar-muted)}
.ar-search input{width:100%;border:0;outline:none;background:none;color:var(--ar-ink);font-size:13px}
.ar-select{border:1px solid var(--ar-line);background:var(--ar-surface);color:var(--ar-ink);border-radius:8px;padding:7px 10px;font-size:13px}
.ar-table{width:100%;border-collapse:collapse;background:var(--ar-surface);border-radius:14px;overflow:hidden;display:block}
.ar-table tbody{display:table;width:100%}
.ar-table th{text-align:left;font-size:11px;color:var(--ar-muted);font-weight:600;padding:11px 14px;border-bottom:1px solid var(--ar-line)}
.ar-table td{padding:10px 14px;font-size:13px;border-bottom:1px solid var(--ar-line)}
.ar-table tr:hover td{background:var(--ar-soft)}
.ar-lv{font-size:11px;font-weight:700;padding:2px 8px;border-radius:5px}
.ar-lv.A1{background:#B4484622;color:#B44846}.ar-lv.A2{background:#C2531A22;color:#C2531A}
.ar-lv.A3{background:#287D6C22;color:#287D6C}.ar-lv.B1{background:#2E75B622;color:#2E75B6}.ar-lv.B2{background:#74808C22;color:#74808C}
.ar-envRow{display:flex;flex-wrap:wrap;gap:7px;padding:15px 20px 17px}
.ar-envChip{font-size:12px;padding:5px 12px;border-radius:7px;background:var(--ar-soft);color:var(--ar-muted)}
.ar-envChip.ok{background:color-mix(in srgb,#287E59 10%,transparent);color:#287E59}
.ar-envChip.bad{background:color-mix(in srgb,#B44846 10%,transparent);color:#B44846}
.ar-empty{padding:64px 28px;text-align:center}
.ar-emptyIcon{width:56px;height:56px;border-radius:17px;background:var(--ar-soft);color:var(--ar-accent2);display:flex;align-items:center;justify-content:center;margin:0 auto 18px;font-size:26px}
.ar-empty h2{font-size:20px;font-weight:600;margin:0 0 10px}
.ar-empty p{max-width:460px;margin:0 auto 20px;color:var(--ar-muted);font-size:13px}
.ar-error{padding:11px 14px;margin-bottom:14px;border:1px solid color-mix(in srgb,#B44846 30%,var(--ar-line));border-radius:9px;color:#B44846;font-size:12px;overflow-wrap:anywhere}
.ar-loading{padding:55px;display:flex;align-items:center;justify-content:center;gap:10px;color:var(--ar-muted)}
.ar-spin{width:16px;height:16px;border:2px solid var(--ar-line);border-top-color:var(--ar-accent2);border-radius:50%;animation:ar-spin 1s linear infinite}
@keyframes ar-spin{to{transform:rotate(360deg)}}
.ar-mutedText{color:var(--ar-muted);font-size:12px}
@media(max-width:980px){.ar-hero{grid-template-columns:1fr}.ar-heroSide{border-left:0;border-top:1px solid var(--ar-line)}.ar-stagerail{grid-template-columns:repeat(4,1fr);row-gap:10px}.ar-shell{padding:24px 20px}}
`;

    function createStore(initial) {
      let state = initial;
      const listeners = new Set();
      return {
        get: () => state,
        set(patch) {
          state = { ...state, ...patch };
          for (const l of listeners) {
            try { l(state); } catch {}
          }
        },
        subscribe(fn) {
          listeners.add(fn);
          return () => listeners.delete(fn);
        },
      };
    }

    async function getJson(path) {
      const res = await fetch(path, { headers: { accept: 'application/json' } });
      const body = await res.json();
      if (!res.ok || body.ok === false) throw new Error(body.error || ('HTTP ' + res.status));
      return body;
    }
    async function postJson(path, payload) {
      const res = await fetch(path, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload || {}),
      });
      const body = await res.json();
      if (!res.ok || body.ok === false) throw new Error(body.error || ('HTTP ' + res.status));
      return body;
    }

    function Wordmark({ size = 17 }) {
      return h('span', {
        style: {
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
          width: size, height: size, borderRadius: Math.max(4, size * 0.28),
          background: 'linear-gradient(135deg,#2E75B6,#1F4E79)',
          color: '#fff', font: `700 ${Math.round(size * 0.58)}px Georgia,serif`, flex: 'none',
        }, 'aria-label': 'ARES',
      }, 'A');
    }

    function buildPanel(store, t, actions) {
      function useStore() {
        const [, force] = React.useReducer((n) => n + 1, 0);
        React.useEffect(() => store.subscribe(force), []);
        return store.get();
      }

      function StageRail({ stages, current }) {
        return h('div', { className: 'ar-stagerail', role: 'list', 'aria-label': t('stages') },
          stages.map((s, i) => h('div', {
            key: s.key, role: 'listitem',
            className: 'ar-stage' + (s.status === 'done' ? ' is-done' : '') + (s.key === current ? ' is-current' : '') + (s.status === 'failed' ? ' is-failed' : ''),
          },
            h('span', { className: 'ar-stageDot' }, s.status === 'done' ? '✓' : i + 1),
            h('span', null, s.label),
          )));
      }

      function DeliverableCheck({ items }) {
        if (!items || !items.length) return null;
        const done = items.filter((d) => d.present).length;
        return h('div', null,
          h('div', { className: 'ar-head', style: { padding: '16px 20px 0' } },
            h('h2', null, t('deliverables')),
            h('span', null, `${done} / ${items.length} ${t('deliverableUnit')}`)),
          h('div', { className: 'ar-check' },
            items.map((d) => h('span', { key: d.name, className: 'ar-checkItem' + (d.present ? ' is-present' : '') },
              h('span', { className: 'ar-checkMark' }, d.present ? '✓' : '○'),
              d.name))));
      }

      function ProjectView({ project }) {
        const comp = project.competition || {};
        const done = (project.stages || []).filter((s) => s.status === 'done').length;
        return h('div', null,
          h('div', { className: 'ar-card ar-hero' },
            h('div', { className: 'ar-heroMain' },
              h('div', { className: 'ar-badges' },
                comp.level ? h('span', { className: 'ar-badge' }, `${t('level')} ${comp.level}`) : null,
                comp.track ? h('span', { className: 'ar-badge' }, comp.track) : null,
                comp.name ? h('span', { className: 'ar-badge' }, `#${comp.id} ${comp.name}`) : null),
              h('h3', null, project.name),
              project.oneLiner ? h('p', null, project.oneLiner) : null,
              project.slogan ? h('p', { style: { marginTop: '6px', fontWeight: 600, color: 'var(--ar-accent2)' } }, project.slogan) : null),
            h('div', { className: 'ar-heroSide' },
              h('div', { className: 'ar-progressNum' }, done, h('small', null, '/ 7 ' + t('stages'))),
              project.stageLabel ? h('div', { className: 'ar-mutedText', style: { marginBottom: '10px' } }, `${t('stage')}：${project.stageLabel}`) : null,
              h('button', { className: 'ar-button ar-primary', onClick: () => actions.openSession(project.root) }, t('openSession')))),
          h('div', { className: 'ar-card', style: { marginTop: '14px', padding: '16px 20px 18px' } },
            h('div', { className: 'ar-head', style: { marginBottom: '10px' } },
              h('h2', null, t('stages')),
              h('span', null, project.hasRunState ? '' : t('noRunState'))),
            h(StageRail, { stages: project.stages || [], current: project.stage })),
          h('div', { className: 'ar-card', style: { marginTop: '14px' } },
            h(DeliverableCheck, { items: project.deliverables })));
      }

      function CompetitionsView() {
        const state = useStore();
        const [query, setQuery] = React.useState('');
        const [level, setLevel] = React.useState('');
        const [pipeline, setPipeline] = React.useState('');
        const records = state.competitions || [];
        const q = query.trim().toLowerCase();
        const filtered = records.filter((c) => {
          if (level && c.level !== level) return false;
          if (pipeline && !(c.pipeline || '').includes(pipeline)) return false;
          if (!q) return true;
          return c.name.toLowerCase().includes(q) || (c.aliases || []).some((a) => a.toLowerCase().includes(q));
        }).slice(0, 60);
        return h('div', null,
          h('div', { className: 'ar-compTools' },
            h('label', { className: 'ar-search' },
              h('input', { placeholder: t('search'), value: query, onChange: (e) => setQuery(e.target.value) })),
            h('select', { className: 'ar-select', value: level, onChange: (e) => setLevel(e.target.value) },
              h('option', { value: '' }, t('allLevels')),
              ['A1', 'A2', 'A3', 'B1', 'B2'].map((lv) => h('option', { key: lv, value: lv }, lv))),
            h('select', { className: 'ar-select', value: pipeline, onChange: (e) => setPipeline(e.target.value) },
              h('option', { value: '' }, t('allPipelines')),
              PIPELINES.map(([k, label]) => h('option', { key: k, value: k }, `${k} ${label}`)))),
          h('table', { className: 'ar-table' },
            h('thead', null, h('tr', null,
              h('th', { style: { width: '52px' } }, 'ID'),
              h('th', null, t('competitions')),
              h('th', { style: { width: '70px' } }, t('level')),
              h('th', { style: { width: '130px' } }, t('pipeline')),
              h('th', null, t('track')))),
            h('tbody', null,
              filtered.length ? filtered.map((c) => h('tr', { key: c.id },
                h('td', null, String(c.id)),
                h('td', null, c.name),
                h('td', null, h('span', { className: 'ar-lv ' + c.level }, c.level)),
                h('td', { className: 'ar-mutedText' }, c.pipeline || ''),
                h('td', { className: 'ar-mutedText' }, (c.tracks || []).length ? `${c.tracks.length} ${t('tracksCount')}：${c.tracks.join('、')}` : ''))) :
                h('tr', null, h('td', { colSpan: 5, style: { textAlign: 'center', color: 'var(--ar-muted)', padding: '26px' } }, t('noMatch'))))));
      }

      function EnvironmentCard() {
        const state = useStore();
        const env = state.doctor;
        if (!env) return h('div', { className: 'ar-card ar-envRow' }, h('span', { className: 'ar-envChip' }, t('envUnknown')));
        const chips = [];
        for (const m of env.requiredModules || []) chips.push(h('span', { key: m.name, className: 'ar-envChip ' + (m.available ? 'ok' : 'bad') }, `${m.name} ${m.available ? '✓' : '✗'}`));
        if (env.ok && (!env.requiredModules || !env.requiredModules.length)) chips.push(h('span', { className: 'ar-envChip ok' }, t('envOk')));
        if (!env.ok) chips.push(h('span', { className: 'ar-envChip bad' }, t('envBad') + (env.error ? '：' + env.error : '')));
        return h('div', { className: 'ar-card ar-envRow' }, chips);
      }

      function Panel() {
        const state = useStore();
        const project = (state.projects || []).find((p) => p.root === state.selectedRoot) || (state.projects || []).find((p) => p.ares) || null;
        let body;
        if (state.loading) body = h('div', { className: 'ar-loading' }, h('span', { className: 'ar-spin' }), t('loading'));
        else if (!state.roots.length) body = h('div', { className: 'ar-card ar-empty' },
          h('div', { className: 'ar-emptyIcon' }, '🏆'),
          h('h2', null, t('emptyTitle')),
          h('p', null, t('emptyText')),
          h('button', { className: 'ar-button ar-primary', onClick: actions.addRoot }, t('addRoot')));
        else if (state.projectsError) body = h('div', { className: 'ar-error' }, state.projectsError);
        else if (!project) body = h('div', { className: 'ar-card ar-empty' },
          h('div', { className: 'ar-emptyIcon' }, '📁'),
          h('h2', null, t('noProject')),
          h('p', null, t('emptyText')),
          h('div', { style: { display: 'flex', gap: '10px', justifyContent: 'center' } },
            h('button', { className: 'ar-button ar-primary', onClick: actions.addRoot }, t('addRoot')),
            h('button', { className: 'ar-button', onClick: actions.refreshProjects }, t('refresh'))));
        else body = h(ProjectView, { project });

        return h('div', { className: 'ar-panel' },
          h('div', { className: 'ar-shell' },
            h('div', { className: 'ar-top' },
              h('div', { className: 'ar-brand' },
                h('div', { className: 'ar-logo' }, 'A'),
                h('div', { className: 'ar-title' }, h('h1', null, t('title')), h('p', null, t('subtitle')))),
              h('button', { className: 'ar-button', onClick: actions.refreshProjects, disabled: state.loading }, state.loading ? t('refreshing') : t('refresh'))),
            state.error ? h('div', { className: 'ar-error' }, state.error) : null,
            state.roots.length ? h('div', { className: 'ar-section' },
              h('div', { className: 'ar-projectBar' },
                h('div', { className: 'ar-picker' },
                  h('span', { className: 'ar-count' }, `${(state.projects || []).filter((p) => p.ares).length} ${t('projectUnit')}`),
                  (state.projects || []).some((p) => p.ares) ? h('select', {
                    value: state.selectedRoot || '', onChange: (e) => store.set({ selectedRoot: e.target.value }),
                  }, (state.projects || []).filter((p) => p.ares).map((p) => h('option', { key: p.root, value: p.root }, p.name))) : null,
                  h('button', { className: 'ar-button', onClick: actions.addRoot }, t('addRoot'))),
                state.selectedRoot ? h('button', { className: 'ar-button', onClick: () => actions.removeRoot(state.selectedRoot) }, t('removeRoot')) : null),
              body) : body,
            h('div', { className: 'ar-section' },
              h('div', { className: 'ar-head' }, h('h2', null, t('environment'))),
              h(EnvironmentCard)),
            h('div', { className: 'ar-section' },
              h('div', { className: 'ar-head' },
                h('h2', null, t('competitions')),
                h('span', null, `${state.competitionsCount || ''} ${t('competitionUnit')}`)),
              h(CompetitionsView))));
      }
      return Panel;
    }

    function bindActions(store, t, services) {
      async function refreshProjects() {
        try {
          store.set({ loading: true, error: null });
          const state = await getJson('/ares/api/v1/state');
          const projectsBody = await getJson('/ares/api/v1/projects');
          const competitionsBody = await getJson('/ares/api/v1/competitions');
          const projects = projectsBody.projects || [];
          const selected = store.get().selectedRoot;
          store.set({
            roots: state.roots || [],
            projects,
            competitionsCount: competitionsBody.count || 0,
            competitions: competitionsBody.records || [],
            loading: false,
            selectedRoot: selected && projects.some((p) => p.root === selected) ? selected : ((projects.find((p) => p.ares) || {}).root || null),
          });
        } catch (error) {
          store.set({ loading: false, error: t('readError') + '：' + String(error) });
        }
      }
      async function bootstrap() {
        try {
          const state = await getJson('/ares/api/v1/state');
          store.set({ roots: state.roots || [] });
          const doctorBody = await getJson('/ares/api/v1/doctor');
          store.set({ doctor: { ok: !!doctorBody.ok && doctorBody.exitCode === 0, requiredModules: doctorBody.requiredModules, error: doctorBody.error } });
        } catch (error) {
          store.set({ error: String(error) });
        }
      }
      async function addRoot() {
        try {
          const path = await services.uiWorkspace.pickDirectory();
          if (!path) return;
          await postJson('/ares/api/v1/roots', { path });
          await refreshProjects();
        } catch (error) {
          store.set({ error: t('errPick') + '：' + String(error) });
        }
      }
      async function removeRoot(path) {
        try {
          await postJson('/ares/api/v1/roots/remove', { path });
          if (store.get().selectedRoot === path) store.set({ selectedRoot: null });
          await refreshProjects();
        } catch (error) {
          store.set({ error: String(error) });
        }
      }
      async function openSession(root) {
        try {
          const workspace = services.uiWorkspace;
          if (!workspace || typeof services.workspaces?.create !== 'function') throw new Error('Workspace service unavailable');
          const view = await services.workspaces.create({ path: root });
          const id = view?.workspaceId ?? view?.id ?? view;
          if (typeof id !== 'string') throw new Error('Workspace id unavailable');
          if (typeof workspace.openWorkspace === 'function') await workspace.openWorkspace(id);
          else if (typeof workspace.connectWorkspace === 'function' && typeof workspace.openSession === 'function') {
            const sessionId = await workspace.connectWorkspace(id, {});
            if (typeof sessionId !== 'string') throw new Error('Session id unavailable');
            await workspace.openSession(sessionId);
          } else throw new Error('Session navigation unavailable');
        } catch (error) {
          store.set({ error: t('errSession') + '：' + String(error) });
        }
      }
      return { refreshProjects, bootstrap, addRoot, removeRoot, openSession };
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        const store = createStore({
          roots: [], projects: null, competitions: [], competitionsCount: 0, doctor: null,
          loading: false, error: null, projectsError: null, selectedRoot: null,
        });
        const services = { uiWorkspace: null, workspaces: null };
        ctx.effect(() => ctx.locale.register(NS, DICT), 'ares: dictionaries');
        const t = ctx.locale.bind(NS);
        const actions = bindActions(store, t, services);
        ctx.effect(() => {
          const tag = document.createElement('style');
          tag.dataset.pluginCss = PKG_ID + '/client.css';
          tag.textContent = css;
          document.head.appendChild(tag);
          return () => tag.remove();
        }, 'ares: workbench styles');
        ctx.inject(['uiWorkspace'], (scope) => {
          services.uiWorkspace = scope.uiWorkspace;
          scope.effect(() => () => { services.uiWorkspace = null; }, 'ares: navigation lifetime');
        });
        ctx.inject(['workspaces'], (scope) => {
          services.workspaces = scope.workspaces;
          scope.effect(() => () => { services.workspaces = null; }, 'ares: workspace lifetime');
        });
        const Panel = buildPanel(store, t, actions);
        ctx.slots.inject('main', () => {
          const dispose = ctx.slots.register({ name: 'main', key: PANEL_KEY, locale: NS }, () => h(Panel));
          return () => {
            const layout = ctx.get('layout');
            if (layout?.panelInfo?.getSnapshot?.().activePanelId === PANEL_KEY) layout.selectPanel(null);
            if (typeof dispose === 'function') dispose();
          };
        });
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({
          name: 'sidebar.panellist', id: PANEL_KEY, order: 6, label: () => t('nav'), locale: NS,
        }, (owner = {}) => h(Wordmark, { size: owner.size || 17 })));
        ctx.effect(() => {
          actions.bootstrap();
          actions.refreshProjects();
          const timer = setInterval(() => actions.refreshProjects(), 60000);
          return () => clearInterval(timer);
        }, 'ares: workbench refresh');
      },
    };
  }
});
