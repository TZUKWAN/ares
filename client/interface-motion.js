/* Interface feedback only. No task events, timers that advance a workflow,
 * cloned conversations, session changes, or synthetic progress. */
const pressable = '.ares-btn,.galaxy-nav>button,.ff-tools button,' +
  '.nebula-artifact-context>button,.document-toolbar button,.document-footer button';
const cards = '.competition-project-choice,.ares-library-card,.ares-skill-card,' +
  '.ares-catalog-card,.ares-board-card,.competition-product-files>article';
const easing = 'cubic-bezier(.2,.75,.2,1)';

export function createInterfaceMotion(root) {
  const media = matchMedia('(prefers-reduced-motion: reduce)');
  const animations = new Set(), waves = new Set();
  let disposed = false, last = null, moveFrame = 0, hover = null;
  const pending = document.createElement('div');
  pending.className = 'ares-ui-pending';
  pending.hidden = true;
  pending.setAttribute('aria-hidden', 'true');
  root.append(pending);

  const enabled = () => !disposed && !media.matches &&
    root.dataset.aresMotion !== 'off' && !document.hidden;
  function animate(node, frames, options = {}, cleanup) {
    if (!enabled() || !node?.isConnected || typeof node.animate !== 'function') {
      cleanup?.(); return;
    }
    const animation = node.animate(frames, {id: 'ares-ui-feedback', duration: 260, easing, ...options});
    animations.add(animation);
    const done = () => { animations.delete(animation); cleanup?.(); };
    animation.finished.then(done, done);
    return animation;
  }
  function cancel() {
    for (const animation of animations) animation.cancel();
    animations.clear();
    for (const wave of waves) wave.remove();
    waves.clear();
    cancelAnimationFrame(moveFrame); moveFrame = 0; hover = null;
  }
  function preference() { if (!enabled()) cancel(); }
  media.addEventListener('change', preference);
  document.addEventListener('visibilitychange', preference);

  function feedback(event) {
    if (event.type === 'pointerdown' && (event.button !== 0 || !event.isPrimary)) return;
    if (event.type === 'click' && event.detail !== 0) return;
    const button = event.target.closest?.(pressable);
    if (!button || button.disabled || button.closest('[inert]') || !enabled()) return;
    // Native DSH controls and document contents keep their own interactions.
    if (button.closest('.ares-native-conversation,.document-prose')) return;
    button.dataset.uiPressable = '';
    const rect = button.getBoundingClientRect(), size = Math.max(rect.width, rect.height) * 2;
    const wave = document.createElement('span');
    wave.className = 'ares-press-wave'; wave.setAttribute('aria-hidden', 'true');
    wave.style.setProperty('--wave-size', size + 'px');
    wave.style.setProperty('--wave-x', (event.type === 'click' ? rect.width / 2 : event.clientX - rect.x) - size / 2 + 'px');
    wave.style.setProperty('--wave-y', (event.type === 'click' ? rect.height / 2 : event.clientY - rect.y) - size / 2 + 'px');
    // At most a handful of live waves, even under rapid repeated presses.
    if (waves.size >= 6) { const oldest = waves.values().next().value; oldest.remove(); waves.delete(oldest); }
    waves.add(wave); button.append(wave);
    animate(wave, [{transform: 'scale(.08)', opacity: 1}, {transform: 'scale(1)', opacity: 0}],
      {duration: 480}, () => { wave.remove(); waves.delete(wave); });
  }
  function pointer(event) {
    if (event.pointerType !== 'mouse' || !enabled()) return;
    const button = event.target.closest?.(pressable);
    if (!button || button.disabled || button.closest('.ares-native-conversation')) return;
    hover = {button, x: event.clientX, y: event.clientY};
    if (moveFrame) return;
    moveFrame = requestAnimationFrame(() => {
      moveFrame = 0;
      if (!hover?.button.isConnected || !enabled()) return;
      const {button, x, y} = hover, rect = button.getBoundingClientRect();
      button.dataset.uiPressable = '';
      button.style.setProperty('--ui-pointer-x', (x - rect.x) + 'px');
      button.style.setProperty('--ui-pointer-y', (y - rect.y) + 'px');
    });
  }
  function disclosure(event) {
    const details = event.target;
    if (details.tagName !== 'DETAILS' || !details.open || !enabled()) return;
    // Animate existing content; keep native details/summary keyboard semantics.
    for (const child of [...details.children].filter(node => node.tagName !== 'SUMMARY').slice(0, 5)) {
      animate(child, [{opacity: .15, translate: '0 -4px'}, {opacity: 1, translate: '0 0'}], {duration: 220});
    }
  }
  root.addEventListener('pointerdown', feedback, true);
  root.addEventListener('click', feedback, true);
  root.addEventListener('pointermove', pointer, {passive: true});
  root.addEventListener('toggle', disclosure, true);

  function capture() {
    if (!enabled()) return null;
    const nodes = new Map();
    for (const node of root.querySelectorAll('.ares-flow-plane .ares-step')) {
      nodes.set(node.dataset.id, node.getBoundingClientRect());
      if (nodes.size >= 48) break;
    }
    return {view: last?.view, nodes};
  }
  function reconcile(before, state) {
    if (disposed) return;
    pending.hidden = !state.busy;
    const layer = root.querySelector('.galaxy-console');
    if (layer) layer.setAttribute('aria-busy', String(!!state.busy));
    if (!enabled()) { cancel(); last = state; return; }
    // A polling refresh or an in-flight API response must never restart entry.
    for (const animation of animations) if (!animation.effect?.target?.isConnected) animation.cancel();
    const entered = last && state.view !== last.view;
    if (entered && layer) {
      animate(layer, [{opacity: 0, transform: 'translateY(14px) scale(.992)'},
        {opacity: 1, transform: 'none'}], {duration: 300});
      [...layer.querySelectorAll(cards)].slice(0, 10).forEach((card, index) => {
        animate(card, [{opacity: 0, transform: 'translateY(9px)'},
          {opacity: 1, transform: 'none'}], {duration: 280, delay: 30 + index * 18, fill: 'backwards'});
      });
    } else if (entered && !layer) {
      animate(root.querySelector('.galaxy-stage'), [{opacity: .65}, {opacity: 1}], {duration: 220});
    }
    if (last && state.work !== last.work && !layer && !state.modal) {
      animate(root.querySelector('.nebula-artifact-heading'), [{opacity: .4}, {opacity: 1}], {duration: 240});
      animate(root.querySelector('.document-statebar'), [{opacity: .35}, {opacity: 1}], {duration: 280});
    }
    if (state.modal && state.modal !== last?.modal) {
      animate(root.querySelector('.ares-modal'), [{opacity: 0, transform: 'translateY(12px) scale(.975)'},
        {opacity: 1, transform: 'none'}], {duration: 280});
    }
    if (last && state.view === last.view && state.detail !== last.detail && !state.modal) {
      const content = root.querySelector('.ares-editor .ares-field')?.parentElement ||
        root.querySelector('.ares-library,.ares-extension-grid');
      animate(content, [{opacity: .25, translate: '0 5px'}, {opacity: 1, translate: '0 0'}], {duration: 220});
    }
    // Workflow FLIP uses editor cards only. Never transform orbit coordinates.
    if (before?.view === state.view && !state.modal) {
      for (const node of root.querySelectorAll('.ares-flow-plane .ares-step')) {
        const old = before.nodes.get(node.dataset.id);
        if (!old) continue;
        const now = node.getBoundingClientRect(), dx = old.x - now.x, dy = old.y - now.y;
        if (Math.abs(dx) + Math.abs(dy) > 2 && Math.abs(dx) < 900 && Math.abs(dy) < 900) {
          // Bounds are screen pixels; the plane scales local translations too.
          const scaleX = now.width / node.offsetWidth || 1, scaleY = now.height / node.offsetHeight || 1;
          animate(node, [{transform: `translate(${dx / scaleX}px,${dy / scaleY}px)`}, {transform: 'none'}], {duration: 280});
        }
      }
    }
    if (state.toast && state.toast !== last?.toast) {
      animate(root.querySelector('.ares-toast'), [{opacity: 0, translate: '0 8px'},
        {opacity: 1, translate: '0 0'}], {duration: 220});
    }
    last = state;
  }
  function notify(node) {
    animate(node, [{opacity: 0, translate: '0 8px'}, {opacity: 1, translate: '0 0'}], {duration: 220});
  }
  return {capture, reconcile, notify, destroy() {
    disposed = true; cancel(); pending.remove();
    root.removeEventListener('pointerdown', feedback, true);
    root.removeEventListener('click', feedback, true);
    root.removeEventListener('pointermove', pointer);
    root.removeEventListener('toggle', disclosure, true);
    media.removeEventListener('change', preference);
    document.removeEventListener('visibilitychange', preference);
  }};
}
