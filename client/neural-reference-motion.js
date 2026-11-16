/** Adapted animation implementation from luoluo-121/neural-creator-dashboard.
 * Required Notice: Copyright (c) 2026 luoluo-121 and neural-creator-dashboard contributors
 * Reference commit: 769d690fa1c06d985926d8f16772d15514b718e1
 * PolyForm Noncommercial 1.0.0; prior-license and third-party exceptions:
 * assets/neural-reference/LICENSE and NOTICE.md.
 * ARES changes: real workflow modules, bounded groups, embedded-host media paths,
 * narrow-height adaptation, lifecycle controlled by the existing ARES workspaces.
 * Original spring, entrance, orb/jelly movement, dust, video Canvas rendering,
 * curves, fan staggering, pulses and background animation are retained below.
 */
const asset=path=>({'media/orb.mp4':'__ARES_NEURAL_ORB_MP4__','media/orb.jpg':'__ARES_NEURAL_ORB_JPG__','media/jellyfish.mp4':'__ARES_NEURAL_JELLY_MP4__','media/jellyfish.jpg':'__ARES_NEURAL_JELLY_JPG__'})[path];
const T = {
  kinds: {core: '#ecd9a6', folder: '#d9b6c1', post: '#c0b8ef', note: '#a9dccb', idea: '#e8c48c', draft: '#a9d3e4', concept: '#e4e6e8', tag: '#98a6a1', ghost: '#70746f'},
  modules: {
    works: {color: '#c3bcf2', filter: 'hue-rotate(215deg) saturate(1.1)'},
    concepts: {color: '#e2e5e8', filter: 'hue-rotate(185deg) saturate(.3) brightness(1.15)'},
    methods: {color: '#ace0cf', filter: 'hue-rotate(118deg) saturate(1)'},
    ideas: {color: '#ecc98f', filter: 'saturate(1)'},
    drafts: {color: '#acd6e8', filter: 'hue-rotate(158deg) saturate(1.05)'}
  },
  media: {orb: asset('media/orb.mp4'), orbPoster: asset('media/orb.jpg'), jelly: asset('media/jellyfish.mp4'), jellyPoster: asset('media/jellyfish.jpg')},
  pulse: {out: ['#fffaf0', '#ecd39e'], in: ['#ffffff', '#e3b3c4']},
  ring: ['#ecd9a6', '#c9cac5'],
  logo: ['#7d7f7c', '#d8d9d6', '#ecd9a6', '#a9aba7'],
  mini: {glow0: '#ffffff', core: '#c9d6e0', dot: '#f2f4f5', mutual: '#ecd39e', pulseOut: '#ffffff', pulseIn: '#e3b3c4'},
  dust: ['236,236,232', '230,207,152', '200,205,210', '255,255,255'],
  canvas: {additive: true, mutual: '236,206,146', mutualIn: '232,176,196', wiki: '172,224,206', link: '205,208,204', pulseOne: '190,230,215', label: '#e6e7e3', spark: ['200,205,210', '225,228,232', '255,236,200'], glow: '66', light: '#ffffff'}
  };

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
function targets(L, t) {
  const MODULES=L.modules;
  const {w: W, h: H} = L.size, st = L.stage, narrow = W < 1000;
  const swim = L.reduced ? 0 : 1;
  const res = {orb: {}, jelly: {}, fan: null};
  if (st === 'hub') {
    const s = narrow ? Math.min(clamp(W * .56, 180, 280),Math.max(96,H*.50)) : clamp(Math.min(W, H) * .5, 250, 440);
    const cy = narrow ? H * (H<410?.32:.47) : H * .53;
    res.orb = {x: W / 2, y: cy, s};
    const rx = narrow ? W * .36 : Math.min(W * .36, 540), ry = narrow ? H * .21 : Math.min(H * .32, 262);
    MODULES.forEach((m, i) => {
      const a = (m.angle + swim * 7 * Math.sin(t * .17 + i * 1.7)) * Math.PI / 180;
      const r = 1 + swim * .04 * Math.sin(t * .23 + i);
      res.jelly[m.id] = {x: W / 2 + Math.cos(a) * rx * r, y: cy + Math.sin(a) * ry * r + swim * 9 * Math.sin(t * .9 + i * 2.1), s: narrow ? (H<410?64:92) : clamp(W * .12, 120, 184), o: 1, tilt: swim * 6 * Math.sin(t * .6 + i)};
    });
  } else if (narrow) {
    res.orb = {x: 40, y: Math.min(156,H*.25), s: 86};
    MODULES.forEach((m, i) => {
      const sel = m.id === L.mod, k = slotOf(L.mod, m.id, MODULES);
      res.jelly[m.id] = {x: 104 + k * (W - 136) / Math.max(1,MODULES.length-1), y: Math.min(152,H*.25) + swim * 4 * Math.sin(t * .9 + i * 2), s: sel ? 76 : 54, o: sel ? 1 : .55, tilt: swim * 3 * Math.sin(t * .6 + i)};
    });
    const n = L.items.length, gap = clamp((H - 330) / Math.max(n - 1, 1), 22, 54);
    res.fan = {x: 34, y0: Math.min(286,H*.63), gap};
  } else {
    const ox = Math.max(124, W * .09), cy = H * .53;
    res.orb = {x: ox, y: cy, s: 178};
    const colX = ox + 158, gap = Math.min(122, (H - 150) / Math.max(1,MODULES.length));
    MODULES.forEach((m, i) => {
      const sel = m.id === L.mod, k = slotOf(L.mod, m.id, MODULES);
      res.jelly[m.id] = {x: colX + (sel ? 16 : 0), y: cy + (k - Math.floor(MODULES.length/2)) * gap + swim * 5 * Math.sin(t * .9 + i * 2), s: sel ? 128 : 92, o: sel ? 1 : .6, tilt: swim * 3 * Math.sin(t * .6 + i)};
    });
    // 伞状条目以右侧分析栏为基准排在它左边约 90px 处（条目最宽约 270px），触须拉长、画面左右均衡；
    // 模块层和打开笔记后位置相同，右侧栏滑入时伞不跳动
    const panelLeft = W - clamp(W * .33, 380, 470) - 44;
    const n = L.items.length;
    const span = Math.min(H - 130, Math.max(0, n - 1) * 54);
    const originX = colX + 16 + 128 * .5 + 10 + 168;
    res.fan = {x: Math.min(Math.max(panelLeft - 270 - 90, originX + 60), panelLeft - 280), y0: cy - span / 2, gap: n > 1 ? span / (n - 1) : 0};
  }
  return res;
}

// 选中的模块排在列的正中间（第 2 格），其余模块按原顺序分列上下，触须从中间向上下对称展开。
function slotOf(selId, id, MODULES) {
  const others = MODULES.filter(m => m.id !== selId).map(m => m.id);
  const middle=Math.floor(MODULES.length/2); const order=[...others.slice(0,middle),selId,...others.slice(middle)];
  const k = order.indexOf(id);
  return k < 0 ? MODULES.findIndex(m => m.id === id) : k;
}

function spring(st, target, dt, k = 62) {
  const c = 2 * Math.sqrt(k);
  st.v += (-k * (st.x - target) - c * st.v) * dt;
  st.x += st.v * dt;
  return st.x;
}
const sp = x => ({x, v: 0});
// 光球边缘向外飘散的光点（光球本地坐标，画布 1012×1012，中心 506）
const DUST = Array.from({length: 110}, (_, i) => ({a: i * 2.39996, v: .035 + (i * 37 % 100) / 100 * .06, o: (i * .618034) % 1, w: (i % 2 ? 1 : -1) * (.15 + (i % 7) * .05), s: .7 + (i % 5) * .32, b: .45 + (i % 3) * .25, c: T.dust[i % T.dust.length]}));
// 光球与水母的视频逐帧画到 <canvas> 上显示：部分内置 / 嵌入式浏览器不合成 <video> 画面（解码正常但页面上是空的），
// 画布在所有浏览器里都能显示。视频本身透明地留在原位负责播放；未加载好时先画封面图。
const posterCache = new Map();
const posterOf = url => { if (!posterCache.has(url)) { const img = new Image(); img.src = url; posterCache.set(url, img); } return posterCache.get(url); };
function paintVideo(pair) {
  const {video, canvas} = pair;
  if (!video || !canvas) return;
  const cw = canvas.clientWidth, ch = canvas.clientHeight;
  if (!cw || !ch) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2), W = Math.round(cw * dpr), H = Math.round(ch * dpr);
  const resized = canvas.width !== W || canvas.height !== H;
  if (resized) { canvas.width = W; canvas.height = H; }
  const ready = video.readyState >= 2 && video.videoWidth;
  const src = ready ? video : posterOf(video.poster);
  const sw0 = ready ? video.videoWidth : src.naturalWidth, sh0 = ready ? video.videoHeight : src.naturalHeight;
  if (!sw0 || !sh0) return;
  const stamp = ready ? video.currentTime : -1;
  if (!resized && stamp === pair.stamp && ready === pair.ready) return;
  pair.stamp = stamp; pair.ready = ready;
  // 等同 object-fit: cover
  const k = Math.max(W / sw0, H / sh0), sw = W / k, sh = H / k;
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, W, H);
  ctx.drawImage(src, (sw0 - sw) / 2, (sh0 - sh) / 2, sw, sh, 0, 0, W, H);
}

const bez = (p0, p1, p2, p3, u) => { const m = 1 - u; return m * m * m * p0 + 3 * m * m * u * p1 + 3 * m * u * u * p2 + u * u * u * p3; };


export function createReferenceMotion(live, refs) {
 const {dustRef,orbRef,jellyRefs,innerRefs,labelRefs,threadRefs,pulseRefs,itemRefs,fanRefs,fanPulseRefs,vids}=refs;
 const MOD_STYLE=Object.fromEntries(live.current.modules.map((m,i)=>[m.id,{...m.style,flip:[1,-1,-1,-1,1][i%5]}]));
 const S=live.current.springs;
 let last=performance.now();
    const step = now => {
      const L = live.current; const items=L.items,sel=L.sel,MODULES=L.modules;
      // rAF 给的是帧开始时间，可能早于上面记录的 last；负的 dt 会让后续计算出现 NaN，所以限制为 ≥ 0
      const dt = Math.max(0, Math.min(1 / 30, (now - last) / 1000)); last = Math.max(last, now);
      if (!L.paused && !L.hold) L.time += dt;
      const t = L.time, since = (now - L.t0) / 1000;
      const T = targets(L, t);
      const intro = L.stage === 'hub' && !L.reduced;
      // 光球
      const orbS = intro && since < .15 ? T.orb.s * .35 : T.orb.s;
      const ox = spring(S.orb.x, T.orb.x, dt), oy = spring(S.orb.y, T.orb.y, dt), os = spring(S.orb.s, orbS, dt, 40), oo = spring(S.orb.o, intro && since < .1 ? 0 : 1, dt, 30);
      L.orb = {x: ox, y: oy, s: os};
      if (orbRef.current) { orbRef.current.style.transform = `translate3d(${ox - os / 2}px,${oy - os / 2}px,0) scale(${os / 460})`; orbRef.current.style.opacity = clamp(oo, 0, 1); }
      const dust = dustRef.current;
      if (dust) {
        const di = clamp(spring(S.dust, L.stage === 'hub' ? .3 : 1, dt, 18), 0, 1);
        const ctx = dust.getContext('2d');
        ctx.clearRect(0, 0, 1012, 1012);
        if (!L.reduced && di > .02) {
          const sc = Math.max(os / 460, .2);
          ctx.globalCompositeOperation = 'lighter';
          for (const p of DUST) {
            const ph = ((t * p.v + p.o) % 1 + 1) % 1, r = 150 + ph * 340, a = p.a + ph * p.w;
            const x = 506 + Math.cos(a) * r, y = 506 + Math.sin(a) * r * .96;
            const al = di * Math.pow(Math.max(0, Math.sin(ph * Math.PI)), 1.3) * p.b, rad = p.s / sc * 2.2;
            const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
            g.addColorStop(0, `rgba(${p.c},${al})`); g.addColorStop(1, `rgba(${p.c},0)`);
            ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, rad, 0, 7); ctx.fill();
          }
        }
      }
      // 水母
      MODULES.forEach((m, i) => {
        const j = S.jelly[m.id], tg = T.jelly[m.id];
        const gated = intro && since < 1 + i * .17;
        const x = spring(j.x, gated ? ox : tg.x, dt), y = spring(j.y, gated ? oy : tg.y, dt), s = spring(j.s, gated ? 24 : tg.s, dt), o = spring(j.o, gated ? 0 : tg.o, dt, 40);
        const lo = spring(j.lo, intro && since < 2 + i * .1 ? 0 : tg.o, dt, 40);
        j.cur = {x, y, s};
        const el = jellyRefs.current[m.id], inner = innerRefs.current[m.id], lab = labelRefs.current[m.id];
        if (el) { el.style.transform = `translate3d(${x - s / 2}px,${y - s * .375}px,0) scale(${s / 200})`; el.style.opacity = clamp(o, 0, 1); }
        if (inner) inner.style.transform = `rotate(${tg.tilt}deg) scaleX(${MOD_STYLE[m.id].flip})`;
        if (lab) {
          const lw = lab.offsetWidth, lh = lab.offsetHeight;
          const hub = L.stage === 'hub', narrow = L.size.w < 1000;
          // 侧列时标签放在水母右边缘之外再空 10px，触须不压标签
          const lx = hub ? x - lw / 2 : narrow ? x - lw / 2 : x + s * .5 + 10;
          const ly = hub ? y + s * .36 : narrow ? y + s * .36 : y - lh / 2;
          lab.style.transform = `translate3d(${lx}px,${ly}px,0)`;
          lab.style.opacity = clamp(narrow && !hub && m.id !== L.mod ? 0 : lo, 0, 1);
          j.label = {x: lx, y: ly, w: lw, h: lh};
        }
        // 光球 → 水母：神经丝与往返脉冲
        const g = threadRefs.current[m.id];
        if (g) {
          let x1, y1, x2, y2, c1x, c1y, c2x, c2y;
          if (L.stage === 'hub') {
            const dx = x - ox, dy = y - oy, d = Math.hypot(dx, dy) || 1, ux = dx / d, uy = dy / d;
            x1 = ox + ux * os * .2; y1 = oy + uy * os * .2; x2 = x - ux * s * .22; y2 = y - uy * s * .1;
            const bend = 26 * Math.sin(t * .5 + i);
            c1x = x1 + dx * .35 - uy * bend; c1y = y1 + dy * .35 + ux * bend; c2x = x1 + dx * .7 + uy * bend; c2y = y1 + dy * .7 - ux * bend;
          } else {
            x1 = ox + os * .3; y1 = oy; x2 = x - s * .34; y2 = y;
            const dx = x2 - x1; c1x = x1 + dx * .55; c1y = y1; c2x = x2 - dx * .55; c2y = y2;
          }
          const d = `M${x1},${y1} C${c1x},${c1y} ${c2x},${c2y} ${x2},${y2}`;
          const active = m.id === L.mod || m.kind === L.hover;
          g.glow.setAttribute('d', d); g.core.setAttribute('d', d);
          const vis = clamp(o, 0, 1) * (L.stage === 'hub' ? 1 : active ? 1 : .45);
          g.glow.style.opacity = vis * (active ? .9 : .45); g.core.style.opacity = vis;
          const pulses = pulseRefs.current[m.id] || [];
          pulses.forEach((c, k) => {
            if (!c) return;
            const inbound = k === 2;
            let u = ((t * (inbound ? .23 : .31) + k * .5 + i * .17) % 1);
            if (inbound) u = 1 - u;
            c.setAttribute('cx', bez(x1, c1x, c2x, x2, u)); c.setAttribute('cy', bez(y1, c1y, c2y, y2, u));
            c.style.opacity = L.reduced || L.paused ? 0 : vis * Math.sin(u * Math.PI);
          });
        }
      });
      // 选中模块 → 多篇笔记（触须式扇形展开）
      const sj = L.mod && S.jelly[L.mod];
      if (T.fan && sj?.label) {
        const narrow = L.size.w < 1000;
        const ox2 = narrow ? sj.label.x + sj.label.w / 2 : sj.label.x + sj.label.w + 6, oy2 = narrow ? sj.label.y + sj.label.h + 4 : sj.cur.y;
        items.forEach((n, i) => {
          if (!L.itemState[i]) L.itemState[i] = {x: sp(ox2), y: sp(oy2), o: sp(0)};
          const st = L.itemState[i];
          // 触须一根一根依次长出（20 条约 1.8 秒），形成伞状开花的节奏
          const ready = L.reduced || now - L.fanStart > 160 + i * Math.min(90, 1800 / Math.max(items.length, 1));
          const tx = T.fan.x, ty = T.fan.y0 + i * T.fan.gap + (L.reduced ? 0 : Math.sin(t * .8 + i * .9) * 2);
          const x = spring(st.x, ready ? tx : ox2, dt, 70), y = spring(st.y, ready ? ty : oy2, dt, 70), o = spring(st.o, ready ? 1 : 0, dt, 50);
          const el = itemRefs.current[i];
          if (el) { el.style.transform = `translate3d(${x}px,${y - 15}px,0)`; el.style.opacity = clamp(o, 0, 1); }
          const p = fanRefs.current[i];
          if (p) {
            const dx = x - ox2, sway = L.reduced ? 0 : Math.sin(t * 1.1 + i * .7) * 7;
            const c1x = ox2 + dx * .5, c1y = oy2 + sway, c2x = x - dx * .45, c2y = y - sway * .5;
            p.setAttribute('d', `M${ox2},${oy2} C${c1x},${c1y} ${c2x},${c2y} ${x},${y}`);
            const on = sel === n.id;
            p.style.opacity = clamp(o, 0, 1) * (sel ? (on ? 1 : .35) : .8);
            p.style.strokeWidth = on ? 1.8 : 1;
            (fanPulseRefs.current[i] || []).forEach((c, k) => {
              if (!c) return;
              let u = (t * (k ? .27 : .36) + i * .13 + k * .5) % 1;
              if (k) u = 1 - u;
              c.setAttribute('cx', bez(ox2, c1x, c2x, x, u)); c.setAttribute('cy', bez(oy2, c1y, c2y, y, u));
              c.style.opacity = L.reduced || L.paused ? 0 : clamp(o, 0, 1) * Math.sin(u * Math.PI) * (sel && !on ? .3 : 1);
            });
          }
        });
      }
      // 光球与水母的视频画面
      for (const pair of Object.values(vids.current)) paintVideo(pair);
    };

 return {step,replay(){const L=live.current,now=performance.now();L.t0=now;L.time=0;S.orb.s.x=120;S.orb.o.x=0;for(const m of L.modules)Object.assign(S.jelly[m.id],{x:sp(L.orb.x),y:sp(L.orb.y),s:sp(20),o:sp(0),lo:sp(0)});last=now;},snap(){const L=live.current,tg=targets(L,L.time); const set=(state,value)=>{state.x=value;state.v=0;};
 for(const key of ['x','y','s'])set(S.orb[key],tg.orb[key]);set(S.orb.o,1);set(S.dust,L.stage==='hub'?.3:1);
 for(const m of L.modules){const dest=tg.jelly[m.id],state=S.jelly[m.id];for(const key of ['x','y','s','o'])set(state[key],dest[key]);set(state.lo,dest.o);}
 if(tg.fan)L.itemState=L.items.map((_,i)=>({x:sp(tg.fan.x),y:sp(tg.fan.y0+i*tg.fan.gap),o:sp(1)}));L.fanStart=performance.now()-4000;
 const paused=L.paused;L.paused=true;last=performance.now()-16;step(performance.now());L.paused=paused;last=performance.now();
 },paint(){for(const pair of Object.values(vids.current))paintVideo(pair);}};
}
export function referenceTargets(state,time=0){return targets(state,time);}
export function referenceSprings(modules,size){return {dust:sp(.3),orb:{x:sp(size.w/2),y:sp(size.h/2),s:sp(120),o:sp(0)},jelly:Object.fromEntries(modules.map(m=>[m.id,{x:sp(size.w/2),y:sp(size.h/2),s:sp(20),o:sp(0),lo:sp(0)}]))};}
export const REFERENCE_THEME=T;

export function createReferenceNetwork(canvas,graph,layout,live){
 const ctx=canvas.getContext('2d'),P=T.canvas,ADD=P.additive?'lighter':'source-over',KINDS=Object.fromEntries(Object.entries(T.kinds).map(([key,color])=>[key,{color}]));
 let W=0,H=0,dpr=1,reduced=live.current.reduced;
 const resize=()=>{dpr=Math.min(devicePixelRatio||1,1.75);W=canvas.clientWidth;H=canvas.clientHeight;canvas.width=Math.round(W*dpr);canvas.height=Math.round(H*dpr);};
 resize();
    // 按与创作空间的链接层数决定蔓延顺序。
    const depth = new Map([['core', 0]]), q = ['core'];
    while (q.length) {
      const id = q.shift();
      for (const l of graph.links) {
        const o = l.a === id ? l.b : l.b === id ? l.a : null;
        if (o && !depth.has(o)) { depth.set(o, depth.get(id) + 1); q.push(o); }
      }
    }
    const nodes = graph.nodes.filter(n => n.kind !== 'core').map((n, i) => ({
      n, p: layout[n.id], d: depth.get(n.id) ?? 4, seed: (i * 9301 + 49297) % 233280 / 233280,
      r: n.kind === 'folder' ? 3.2 : n.kind === 'tag' ? 1.6 : n.kind === 'concept' ? 2.4 : n.kind === 'ghost' ? 2 : 2.2 + Math.min(n.deg, 14) * .22
    }));
    const byId = new Map(nodes.map(x => [x.n.id, x]));
    const links = graph.links.filter(l => byId.has(l.a) && byId.has(l.b)).map((l, i) => ({l, A: byId.get(l.a), B: byId.get(l.b), seed: (i * 7919 % 997) / 997}));
    const sparks = Array.from({length: 90}, (_, i) => ({a: i / 90 * Math.PI * 2 + Math.sin(i * 12.9) * .3, v: .35 + (i * 37 % 100) / 100, s: 1 + (i * 13 % 7) / 3}));

    const draw = now => {
      const L = live.current;
      const t = Math.max(0, (now - L.t0) / 1000);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      const cx = L.orb.x, cy = L.orb.y;
      const sc = (L.orb.s / 440) * Math.min(W * .37 / 380, H * .36 / 300) * (L.stage === 'hub' ? 1 : .55);
      const hover = L.hover;
      const hl = hover ? new Set(graph.nodes.filter(n => n.kind === hover).map(n => n.id)) : null;
      if (hl) for (const l of graph.links) { if (hl.has(l.a) && l.kind !== 'contain') hl.add(l.b); }
      const grow = reduced ? 1 : Math.min(1, Math.max(0, (t - .35) / 2.2));
      const prog = x => reduced ? 1 : Math.min(1, Math.max(0, (t - .4 - x.d * .32 - x.seed * .35) / .9));
      const pos = x => {
        const p = prog(x), e = 1 - Math.pow(1 - p, 3);
        const sway = reduced || L.paused ? 0 : Math.sin(t * .5 + x.seed * 6.28) * 3;
        return [cx + x.p[0] * sc * e + sway, cy + x.p[1] * sc * e + Math.cos(t * .4 + x.seed * 9) * (reduced || L.paused ? 0 : 2.5), p];
      };
      for (const x of nodes) x.s = pos(x);

      // 光球点亮时的粒子迸发
      if (!reduced && t < 2.2) {
        const k = t / 2.2;
        ctx.globalCompositeOperation = ADD;
        for (const s of sparks) {
          const d = (40 + s.v * 420) * (1 - Math.pow(1 - k, 2.4)) * (L.orb.s / 440);
          const a = Math.max(0, 1 - k) * .9;
          const x = cx + Math.cos(s.a) * d, y = cy + Math.sin(s.a) * d;
          const g = ctx.createLinearGradient(cx + Math.cos(s.a) * d * .6, cy + Math.sin(s.a) * d * .6, x, y);
          g.addColorStop(0, `rgba(${P.spark[0]},0)`); g.addColorStop(1, `rgba(${P.spark[1]},${a})`);
          ctx.strokeStyle = g; ctx.lineWidth = s.s;
          ctx.beginPath(); ctx.moveTo(cx + Math.cos(s.a) * d * .6, cy + Math.sin(s.a) * d * .6); ctx.lineTo(x, y); ctx.stroke();
          ctx.fillStyle = `rgba(${P.spark[2]},${a})`; ctx.beginPath(); ctx.arc(x, y, s.s * .9, 0, 7); ctx.fill();
        }
        ctx.globalCompositeOperation = 'source-over';
      }

      // 连线
      for (const k of links) {
        const [x1, y1, p1] = k.A.s, [x2, y2, p2] = k.B.s;
        const p = Math.min(p1, p2) * grow;
        if (p <= .02) continue;
        const on = !hl || (hl.has(k.l.a) && hl.has(k.l.b));
        let a = (k.l.both ? .32 : k.l.kind === 'wiki' ? .3 : k.l.kind === 'contain' ? .16 : .11) * p * (on ? 1 : .25) * (hl && on ? 2.2 : 1);
        ctx.strokeStyle = k.l.both ? `rgba(${P.mutual},${a})` : k.l.kind === 'wiki' ? `rgba(${P.wiki},${a})` : `rgba(${P.link},${a})`;
        ctx.lineWidth = k.l.both ? .6 + Math.min(k.l.w, 6) * .22 : .7;
        ctx.beginPath(); ctx.moveTo(x1, y1);
        if (k.l.both) { const mx = (x1 + x2) / 2 + (y2 - y1) * .12, my = (y1 + y2) / 2 - (x2 - x1) * .12; ctx.quadraticCurveTo(mx, my, x2, y2); }
        else ctx.lineTo(x2, y2);
        ctx.stroke();
      }

      // 神经脉冲：单向连接只朝出链方向，双向连接往返传递。
      if (!reduced && !L.paused && grow > .6) {
        ctx.globalCompositeOperation = ADD;
        for (const k of links) {
          if (k.l.kind === 'contain' || k.l.kind === 'tag') continue;
          const on = !hl || (hl.has(k.l.a) && hl.has(k.l.b));
          const speed = k.l.both ? .16 : .12;
          const lanes = k.l.both ? [0, 1] : [0];
          for (const lane of lanes) {
            const u = ((t * speed + k.seed + lane * .5) % 1);
            const fwd = lane === 0 ? (k.l.s === k.l.a) : !(k.l.s === k.l.a);
            const [x1, y1] = fwd ? k.A.s : k.B.s, [x2, y2] = fwd ? k.B.s : k.A.s;
            let x = x1 + (x2 - x1) * u, y = y1 + (y2 - y1) * u;
            if (k.l.both) { const mx = (k.A.s[0] + k.B.s[0]) / 2 + (k.B.s[1] - k.A.s[1]) * .12, my = (k.A.s[1] + k.B.s[1]) / 2 - (k.B.s[0] - k.A.s[0]) * .12; const uu = fwd ? u : 1 - u; x = (1 - uu) ** 2 * k.A.s[0] + 2 * (1 - uu) * uu * mx + uu * uu * k.B.s[0]; y = (1 - uu) ** 2 * k.A.s[1] + 2 * (1 - uu) * uu * my + uu * uu * k.B.s[1]; }
            const a = Math.sin(u * Math.PI) * (on ? .95 : .2);
            const g = ctx.createRadialGradient(x, y, 0, x, y, 6);
            const c = k.l.both ? (lane ? P.mutualIn : P.mutual) : P.pulseOne;
            g.addColorStop(0, `rgba(${c},${a})`); g.addColorStop(1, `rgba(${c},0)`);
            ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, 6, 0, 7); ctx.fill();
          }
        }
        ctx.globalCompositeOperation = 'source-over';
      }

      // 节点
      for (const x of nodes) {
        const [px, py, p] = x.s;
        if (p <= 0) continue;
        const on = !hl || hl.has(x.n.id);
        const color = KINDS[x.n.kind].color;
        const a = p * (on ? 1 : .22);
        const r = x.r * (hl && on ? 1.35 : 1);
        ctx.globalAlpha = a;
        ctx.globalCompositeOperation = ADD;
        const g = ctx.createRadialGradient(px, py, 0, px, py, r * 5);
        g.addColorStop(0, color + P.glow); g.addColorStop(1, color + '00');
        ctx.fillStyle = g; ctx.beginPath(); ctx.arc(px, py, r * 5, 0, 7); ctx.fill();
        ctx.globalCompositeOperation = 'source-over';
        if (x.n.kind === 'ghost') { ctx.setLineDash([2, 2]); ctx.strokeStyle = color; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(px, py, r + 1, 0, 7); ctx.stroke(); ctx.setLineDash([]); }
        else { const b = ctx.createRadialGradient(px - r * .35, py - r * .35, 0, px, py, r); b.addColorStop(0, P.light); b.addColorStop(.45, color); b.addColorStop(1, color + 'aa'); ctx.fillStyle = b; ctx.beginPath(); ctx.arc(px, py, r, 0, 7); ctx.fill(); }
        if (L.stage === 'hub' && p > .9 && (hl ? on && x.n.kind !== 'tag' : x.n.kind === 'concept')) {
          ctx.globalAlpha = a * (hl ? .9 : .42);
          ctx.fillStyle = P.label; ctx.font = `${hl ? 11 : 10}px -apple-system, "PingFang SC", sans-serif`;
          ctx.fillText((x.n.short || x.n.title).slice(0, 14), px + r + 5, py + 3.5);
        }
        ctx.globalAlpha = 1;
      }
    };

 return {draw(now){reduced=live.current.reduced;draw(now);},resize};
}
function rng(seed) { let s = 0; for (const c of seed) s = (s * 31 + c.charCodeAt(0)) >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
const rad = d => d * Math.PI / 180;

export function referenceForceLayout(graph,folders) {
  const N = graph.nodes, idx = graph.index, FOLDERS=folders, CONTENT=new Set(['post','note','idea','draft']);
  const anchor = id => {
    const n = idx.get(id);
    if (n.kind === 'concept') return [0, -1];
    const f = FOLDERS.find(f => f.id === (n.folder?.startsWith('f:0') || n.level === 2 ? 'f:methods' : n.folder) || f.id === id);
    return f ? [Math.cos(rad(f.angle)), Math.sin(rad(f.angle))] : null;
  };
  for (const n of N) {
    const r = rng(n.id), a = anchor(n.id);
    const R = n.kind === 'core' ? 0 : n.kind === 'folder' ? (n.level ? 300 : 210) : CONTENT.has(n.kind) ? 330 : 420;
    const base = a ? Math.atan2(a[1], a[0]) : r() * Math.PI * 2;
    const ang = base + (r() - .5) * (a ? 1.1 : 6.28);
    n.x = Math.cos(ang) * R * (0.8 + r() * .4); n.y = Math.sin(ang) * R * (0.8 + r() * .4); n.vx = 0; n.vy = 0;
  }
  const rest = {contain: 120, wiki: 95, source: 90, tag: 52, mention: 135, resonance: 170};
  const strength = {contain: .05, wiki: .06, source: .08, tag: .09, mention: .018, resonance: .006};
  for (let it = 0; it < 520; it++) {
    const alpha = 1 - it / 520;
    for (let i = 0; i < N.length; i++) for (let j = i + 1; j < N.length; j++) {
      const A = N[i], B = N[j];
      let dx = B.x - A.x, dy = B.y - A.y, d2 = dx * dx + dy * dy || .01;
      const charge = (A.kind === 'tag' || B.kind === 'tag' ? 900 : 2600) * (A.kind === 'folder' && B.kind === 'folder' ? 3 : 1);
      const f = charge / d2 * alpha, d = Math.sqrt(d2);
      dx /= d; dy /= d;
      A.vx -= dx * f; A.vy -= dy * f; B.vx += dx * f; B.vy += dy * f;
    }
    for (const l of graph.links) {
      const A = idx.get(l.a), B = idx.get(l.b);
      const dx = B.x - A.x, dy = B.y - A.y, d = Math.hypot(dx, dy) || .01;
      const k = (d - rest[l.kind]) * strength[l.kind] * alpha;
      A.vx += dx / d * k; A.vy += dy / d * k; B.vx -= dx / d * k; B.vy -= dy / d * k;
    }
    for (const n of N) {
      const a = anchor(n.id);
      if (n.kind === 'folder' && a) { const R = n.level ? 300 : 230; n.vx += (a[0] * R - n.x) * .04; n.vy += (a[1] * R - n.y) * .04; }
      else if (a && CONTENT.has(n.kind)) { n.vx += (a[0] * 380 - n.x) * .006; n.vy += (a[1] * 380 - n.y) * .006; }
      else if (a) { n.vx += (a[0] * 300 - n.x) * .004; n.vy += (a[1] * 300 - n.y) * .004; }
      n.vx -= n.x * .002; n.vy -= n.y * .002;
      if (n.kind === 'core') { n.x = 0; n.y = 0; n.vx = 0; n.vy = 0; continue; }
      n.x += n.vx; n.y += n.vy; n.vx *= .55; n.vy *= .55;
    }
  }
  return Object.fromEntries(N.map(n => [n.id, [n.x, n.y * .82]]));
}

// 放射层级：以创作空间为圆心，按链接层数排成同心环。
