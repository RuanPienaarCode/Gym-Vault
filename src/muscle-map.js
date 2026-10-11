'use strict';
/* THE MUSCLE MAP — an animated anatomy mannequin doing the exercise, with
   the muscles that work coloured in. It replaces the stock photos for any
   exercise that has a motion (motion-library.js); everything else keeps its
   photos.

   TWO VIEWS, one switch on the visual itself (remembered in settings):
     Basic     the moving body, working muscles heating amber→red with load,
               holding muscles in the accent, one quiet line naming them.
               Readable mid-set on a phone.
     Detailed  adds a label on every muscle (plain + Latin name, live load %
               or HOLD), a load bar, and a caption that steps through the
               note's numbered steps once per rep.

   THREE PLACES IT APPEARS (the callers decide; this file only draws):
     the exercise page      the full map, with the Basic/Detailed switch
     the live set           opts.mini — the bare figure, no switch, no legend,
                            no labels, in the thumbnail slot; a tap on it is
                            the CALLER's (it opens the viewer)
     the full-screen viewer opts.exclusive — the same full map, large

   IT NEVER RUNS UNSEEN. An animation loop costs battery every frame, so it
   only ticks while the map is on screen (IntersectionObserver) and the app
   is in the foreground (visibilitychange); it draws at about 30 frames a
   second, not the display's rate; it ends itself the first frame after its
   DOM is thrown away; and stop() tears down all of it. Where it cannot tell
   whether it is visible (no IntersectionObserver), it draws one still frame
   rather than looping blind. While a viewer's map (opts.exclusive) is open,
   every other map pauses: the thumbnail under a full-screen dialog is not
   being looked at, and IntersectionObserver cannot see a dialog covering it.

   PLAY OR STILL is opts.autoPlay (media-cycle.js autoPlayMedia: the one rule
   the photos use too: reduced motion, or Settings -> Animate exercise images
   off, means still). Still is a pose a tap steps through; the viewer's Play
   button can still start it for that viewing (stop.setPlaying), and stepping
   by hand pauses it, as it does the photos.

   Built with createElementNS — no innerHTML. Colours come from theme
   tokens via classes; only the per-frame geometry and the heat colour are
   written as SVG attributes. */

const { el, ico } = require('./dom');
const G = require('./motion-geom');
const lib = require('./motion-library');

const NS = 'http://www.w3.org/2000/svg';
let uid = 0;
/* Tendon: the pale cord a muscle ends in — a real colour, the same in every theme. */
const TENDON = 'rgb(244, 238, 226)';
/* One live map per slot (the exercise page): mounting again stops the old. */
const SLOTS = {};
/* Every running map's "should I be ticking?" check, so a viewer opening or
   closing can pause and wake the others at once. */
const LIVE = new Set();
let exclusiveOpen = 0;
/* Every full map's way of being told the Basic/Detailed choice changed
   somewhere else (the viewer's switch, under the page's own map). */
const DETAIL_SUBS = new Set();
/* ~30 fps: a frame that arrives sooner than this after the last drawn one is
   skipped. The figure is a handful of paths; halving the redraws halves the
   battery for a difference nobody can see in a push-up. */
const MIN_FRAME_MS = 28;

function svgEl(tag, attrs, parent) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs || {})) n.setAttribute(k, String(v));
  if (parent) parent.appendChild(n);
  return n;
}
const clearNode = n => { while (n.firstChild) n.removeChild(n.firstChild); };

function prefersReduced() {
  try { return !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch (e) { return false; }
}

/* The working muscles heat from the load ramp's two tokens (--gv-load-lo ->
   --gv-load-hi, styles.css), so the colours follow the theme and are one
   definition. Read from the computed style of the map itself, once drawn into
   the page, and again if the theme flips while it is on screen. NOT accent
   tied: a muscle turning magenta under the Punch accent would read as a
   different thing. These defaults are only what a page without the
   stylesheet (a test) gets. */
const LOAD_FALLBACK = { lo: [251, 191, 36], hi: [220, 38, 38] };
const rgb = c => `rgb(${c.map(Math.round).join(',')})`;
const mix = (c, to, k) => c.map((v, i) => v + (to[i] - v) * k);
function parseColour(text) {
  const t = String(text || '').trim();
  let m = /^#([0-9a-f]{6})$/i.exec(t);
  if (m) return [0, 2, 4].map(i => parseInt(m[1].slice(i, i + 2), 16));
  m = /^#([0-9a-f]{3})$/i.exec(t);
  if (m) return [0, 1, 2].map(i => parseInt(m[1][i] + m[1][i], 16));
  m = /^rgba?\(\s*(\d+(?:\.\d+)?)[ ,]+(\d+(?:\.\d+)?)[ ,]+(\d+(?:\.\d+)?)/i.exec(t);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : null;
}
function readLoadTokens(node) {
  try {
    const cs = window.getComputedStyle(node);
    return {
      lo: parseColour(cs.getPropertyValue('--gv-load-lo')) || LOAD_FALLBACK.lo,
      hi: parseColour(cs.getPropertyValue('--gv-load-hi')) || LOAD_FALLBACK.hi,
    };
  } catch (e) { return LOAD_FALLBACK; }
}
const isDark = () => !!(document.body && document.body.classList && document.body.classList.contains('theme-dark'));

const PAD = 10;
const PAD_MINI = 4;
const LABEL_TOP = 62;      // side view: room above the figure for two staggered rows of labels
const LABEL_BOTTOM = 56;   // side view: room below the floor for two staggered rows
/* The 96x72 thumbnail of a long, low figure (the push-up) shows its front part: the
   head, shoulders, chest, arms and hips, where the working muscles are, at the
   size a thumbnail can use, instead of the whole body at a third of it. */
const MINI_LONG_SHARE = 0.72;

/* A map, possibly with more than one view of the same rep (the squat: side
   and front). The views share one clock, one Basic/Detailed choice and one
   play/still state, so switching view carries on the rep instead of
   restarting it. Returns stop(); stop also carries the controls a viewer
   needs (setPlaying, isPlaying, step, setDetail). */
function mountMuscleMap(host, opts) {
  const o = opts || {};
  if (o.slot && SLOTS[o.slot]) SLOTS[o.slot]();
  const clock = o.clock && typeof o.clock === 'object' && Number.isFinite(o.clock.t) ? o.clock : { t: 0 };
  let detail = o.mini || o.detail !== 'detailed' ? 'basic' : 'detailed';
  /* `playing` is what is happening; `still` is which resting pose a paused
     figure shows (an index into STILL), or null for "frozen where it was". */
  const state = { playing: o.autoPlay === undefined ? !prefersReduced() : !!o.autoPlay, still: 0 };
  if (state.playing) state.still = null;
  let current = null, stopped = false;
  const show = motion => {
    if (current) { current.stop(); current.card.remove(); }
    current = mountOne(host, Object.assign({}, o, {
      motion, detail, clock, state,
      onDetail: d => { detail = d; if (typeof o.onDetail === 'function') o.onDetail(d); broadcastDetail(d, sub); },
      onView: vid => { if (!stopped && lib.MOTIONS[vid]) show(lib.MOTIONS[vid]); },
    }));
  };
  /* A change made on another map (the viewer's switch) reaches this one
     without calling onDetail again: the choice is already saved. */
  const sub = {
    alive: () => !stopped && !!current && current.card.isConnected !== false,
    set: d => { if (o.mini || d === detail) return; detail = d; if (current) current.setDetail(d, true); },
  };
  show(o.motion);
  if (o.exclusive) { exclusiveOpen++; wakeAll(); }
  if (!o.mini) DETAIL_SUBS.add(sub);
  function stop() {
    if (stopped) return;
    stopped = true;
    if (current) current.stop();
    DETAIL_SUBS.delete(sub);
    if (o.slot && SLOTS[o.slot] === stop) delete SLOTS[o.slot];
    if (o.exclusive) { exclusiveOpen--; wakeAll(); }
  }
  stop.setPlaying = on => { if (!stopped && current) current.setPlaying(on); };
  stop.isPlaying = () => state.playing;
  stop.step = dir => { if (!stopped && current) current.step(dir); };
  stop.setDetail = d => { if (!stopped) sub.set(d === 'detailed' ? 'detailed' : 'basic'); };
  if (o.slot) SLOTS[o.slot] = stop;
  return stop;
}

function broadcastDetail(d, from) {
  for (const sub of [...DETAIL_SUBS]) {
    if (sub === from) continue;
    if (!sub.alive()) { DETAIL_SUBS.delete(sub); continue; }
    sub.set(d);
  }
}
/* A viewer opened or closed: every other map re-asks whether it may tick. */
function wakeAll() { for (const f of [...LIVE]) f(); }

const VIEW_LABEL = { side: 'Side', front: 'Front' };

function mountOne(host, o) {
  const { ex, motion } = o;
  const steps = Array.isArray(o.steps) ? o.steps : [];
  const bodyKey = o.body === 'female' ? 'female' : 'male';
  /* mini: 'thumb' (the 96x72 poster slot: the front of a long figure, see
     MINI_LONG_SHARE) or 'frame' (Floor and Editorial's wide frame: all of it). */
  const mini = o.mini ? (o.mini === 'frame' ? 'frame' : 'thumb') : null;
  let detail = !mini && o.detail === 'detailed' ? 'detailed' : 'basic';
  const state = o.state || { playing: !prefersReduced(), still: 0 };
  const id = ++uid;

  const roles = lib.muscleRoles(motion, ex);
  const isPrime = rid => roles.prime.includes(rid);
  const regions = motion.regions.filter(r => isPrime(r.id) || roles.hold.includes(r.id));
  const defOf = rid => motion.regions.find(x => x.id === rid);
  const canWatch = typeof window.IntersectionObserver === 'function';
  const name = (ex && ex.name) || motion.name;

  /* Frame the figure once from its whole range of motion, so the stage
     never jumps as the body moves. */
  const samples = [0, 0.25, 0.5, 0.75, 1].map(d => lib.poseAtDepth(motion, d, bodyKey));
  const [bx0, by0, bx1, by1] = G.bounds(samples.flatMap(p => Object.values(p.parts).concat(p.props.map(pr => [pr.a, pr.b]))));
  const hasFloor = motion.floor !== false; // the pull-up hangs from a bar
  const pad = mini ? PAD_MINI : PAD;
  const box = { x: bx0 - pad, y: by0 - pad, w: bx1 - bx0 + pad * 2, floor: hasFloor ? G.FLOOR : by1 + pad };
  /* A tall figure (anyone standing or hanging) takes its labels in columns
     at the sides; the long horizontal push-up takes them in rows. */
  const columns = (box.floor - box.y) > box.w;
  /* Estimated widths of a label (name + load %) and its Latin line, in the same
     units as the viewBox, so the rows below can space them without overlap. */
  const textWidth = r => Math.max(r.label.length * 5.9 + (isPrime(r.id) ? 26 : 0), r.latin.length * 4.3);
  const sideRoom = columns ? Math.max(60, ...regions.map(textWidth)) + 12 : 0;
  const viewBox = () => {
    if (columns) {
      const side = detail === 'detailed' ? sideRoom : 0;
      const bottom = hasFloor ? box.floor + pad : box.floor;
      return `${(box.x - side).toFixed(1)} ${box.y.toFixed(1)} ${(box.w + side * 2).toFixed(1)} ${(bottom - box.y).toFixed(1)}`;
    }
    const top = detail === 'detailed' ? box.y - LABEL_TOP : box.y;
    const bottom = detail === 'detailed' ? box.floor + LABEL_BOTTOM : box.floor + pad;
    const w = mini === 'thumb' ? box.w * MINI_LONG_SHARE : box.w;
    return `${box.x.toFixed(1)} ${top.toFixed(1)} ${w.toFixed(1)} ${(bottom - top).toFixed(1)}`;
  };

  /* ---------------------------------------------------------------- DOM */
  const card = el('div', { class: `gv-mm gv-mm-${detail}${mini ? ' gv-mm-mini' : ''}` });
  /* The app's own segmented control classes, so the switch looks like every
     other one in whichever skin is active. */
  const seg = el('div', { class: 'gv-segmented gv-mm-seg', role: 'group', 'aria-label': 'How much the muscle map explains' });
  const segBtns = ['basic', 'detailed'].map(k => el('button', {
    type: 'button', class: `gv-segmented-btn gv-mm-seg-btn${k === detail ? ' on' : ''}`, 'data-detail': k, 'aria-pressed': String(k === detail),
    onclick: () => setDetail(k),
  }, k === 'basic' ? 'Basic' : 'Detailed'));
  segBtns.forEach(b => seg.append(b));
  /* Side | Front, for a movement drawn both ways. */
  const views = (motion.views || []).filter(v => lib.MOTIONS[v]);
  const viewSeg = views.length > 1 ? el('div', { class: 'gv-segmented gv-mm-seg gv-mm-views', role: 'group', 'aria-label': 'Which way to look' },
    ...views.map(v => {
      const on = v === motion.id;
      return el('button', {
        type: 'button', class: `gv-segmented-btn gv-mm-view-btn${on ? ' on' : ''}`, 'data-view': v, 'aria-pressed': String(on),
        onclick: () => { if (!on && typeof o.onView === 'function') o.onView(v); },
      }, VIEW_LABEL[lib.MOTIONS[v].view] || v);
    })) : '';
  if (!mini) {
    /* Where the caller can open an enlarged view, a real button says so (the
       stage is a tap target too, but a figure cannot say "tap me"). It sits in
       the heading row, not over the figure, which Detailed fills with labels. */
    const enlarge = typeof o.onEnlarge === 'function'
      ? el('button', { class: 'gv-icon-btn gv-icon-btn-small gv-mm-enlarge', type: 'button', 'aria-label': `Show ${(ex && ex.name) || motion.name} larger`, onclick: () => o.onEnlarge() }, ico('maximize-2'))
      : '';
    card.append(el('div', { class: 'gv-mm-head' },
      el('div', { class: 'gv-mm-headl' }, el('span', { class: 'gv-mm-title' }, 'How it moves'), enlarge),
      el('div', { class: 'gv-mm-switches' }, viewSeg, seg)));
  }

  const stage = el('div', { class: 'gv-mm-stage' });
  /* The miniature is decoration inside a control the caller labels ("Show
     Push-ups larger"), so it is hidden from assistive tech rather than read
     out as a second, wordier description of the same button. */
  const svg = svgEl('svg', Object.assign({
    class: 'gv-mm-svg', viewBox: viewBox(), preserveAspectRatio: 'xMidYMid meet',
  }, mini ? { 'aria-hidden': 'true', focusable: 'false' } : {
    role: 'img',
    'aria-label': `${name}: the body doing the movement, with the working muscles coloured. `
      + `Working: ${roles.prime.map(r => defOf(r).label.toLowerCase()).join(', ')}. `
      + `Holding: ${roles.hold.map(r => defOf(r).label.toLowerCase()).join(', ')}.`,
  }));
  stage.append(svg);
  card.append(stage);

  /* Volume: every muscle is lit from its middle, so it reads as a rounded
     belly rather than a flat patch. One gradient per role, shared by every
     muscle in it (objectBoundingBox fits it to each shape). The working
     one's colours follow the heat each frame; the holding one's come from
     the theme via CSS. */
  const defs = svgEl('defs', {}, svg);
  const primeGrad = svgEl('radialGradient', { id: `gv-mm-gp-${id}`, cx: 0.45, cy: 0.4, r: 0.72 }, defs);
  const primeStops = [0, 0.6, 1].map(off => svgEl('stop', { offset: off }, primeGrad));
  const holdGrad = svgEl('radialGradient', { id: `gv-mm-gh-${id}`, cx: 0.45, cy: 0.4, r: 0.72 }, defs);
  svgEl('stop', { offset: 0, class: 'gv-mm-gh-hi' }, holdGrad);
  svgEl('stop', { offset: 1, class: 'gv-mm-gh-lo' }, holdGrad);
  if (hasFloor) svgEl('line', { class: 'gv-mm-floor', x1: box.x - 120, x2: box.x + box.w + 120, y1: box.floor + 1, y2: box.floor + 1 }, svg);

  const fig = svgEl('g', { class: 'gv-mm-fig' }, svg);
  const paths = {}, context = {}, muscles = {};
  /* Each muscle is its drawn shape plus its fibres and landmarks (clipped to
     the outline, so they fill it without spilling onto the body) and, where
     it attaches, a tendon. Working muscles are heat; holding ones the
     accent; deep ones — behind a front muscle — a shade lighter. `k` is the
     instance: a front-view muscle has a mirrored twin, `<id>_l`. */
  const muscle = (r, k) => {
    const tier = isPrime(r.id) ? 'gv-mm-prime' : r.deep ? 'gv-mm-hold gv-mm-deep' : 'gv-mm-hold';
    const fill = svgEl('path', {
      class: `gv-mm-muscle ${tier}`, 'data-region': r.id,
      fill: `url(#${isPrime(r.id) ? `gv-mm-gp-${id}` : `gv-mm-gh-${id}`})`,
    }, fig);
    /* Fibres, landmarks and tendons are detail a 96px miniature cannot show:
       leaving them out is a third of its paths and every frame's clip work. */
    let clipShape = null, fibre = null, mark = null, tendon = null;
    if (!mini) {
      const clip = svgEl('clipPath', { id: `gv-mm-c-${id}-${k}` }, defs);
      clipShape = svgEl('path', {}, clip);
      fibre = svgEl('path', { class: 'gv-mm-fibre', 'clip-path': `url(#gv-mm-c-${id}-${k})` }, fig);
      mark = r.lines.length ? svgEl('path', { class: 'gv-mm-mark', 'clip-path': `url(#gv-mm-c-${id}-${k})` }, fig) : null;
      tendon = r.tendon ? svgEl('path', { class: 'gv-mm-tendon', fill: TENDON }, fig) : null;
    }
    muscles[k] = { fill, clipShape, fibre, mark, tendon, r, k };
  };
  /* Behind first, in front last: deep, then holding, then working. */
  const rank = r => (isPrime(r.id) ? 2 : r.deep ? 0 : 1);
  const depthOrder = list => list.slice().sort((a, b) => rank(a) - rank(b));
  const instances = d => [d.id, d.id + '_l'].filter(k => samples[0].parts[k]);
  /* The motion says what is drawn in front of what (motion-library /
     motion-front `order`): body parts, its props (the bar), and — at each
     'muscles' step — that limb's neutral context muscles (the ones this
     movement doesn't use, which make the figure read as a muscular body)
     and then its coloured ones. */
  for (const item of samples[0].order) {
    if (item[0] === 'part') {
      if (samples[0].parts[item[1]]) paths[item[1]] = svgEl('path', { class: `gv-mm-part gv-mm-${item[1]} ${item[2]}` }, fig);
    } else if (item[0] === 'prop') {
      const pr = samples[0].props[item[1]];
      if (pr && pr.kind === 'bar') svgEl('line', { class: 'gv-mm-prop', x1: pr.a[0], y1: pr.a[1], x2: pr.b[0], y2: pr.b[1], 'stroke-width': pr.r * 2 }, fig);
    } else if (item[0] === 'muscles') {
      motion.context.filter(c => c.seg === item[1]).forEach(c => instances(c).forEach(k => {
        context[k] = svgEl('path', { class: 'gv-mm-ctx', 'data-context': c.id }, fig);
      }));
      depthOrder(regions.filter(r => r.seg === item[1])).forEach(r => instances(r).forEach(k => muscle(r, k)));
    }
  }

  const labelLayer = svgEl('g', { class: 'gv-mm-labels' }, svg);
  let labels = [];
  const foot = el('div', { class: 'gv-mm-under' });
  if (!mini) card.append(foot);
  let loadFill = null, loadPct = null, stepEl = null, stepShown = -1;

  /* Labels sit OUTSIDE the figure, never over the movement, and only their
     leader lines move. Side view: back-of-body muscles in a row above, the
     rest in two staggered rows below the floor, each row ordered by x so
     leaders don't cross. Front view: two columns, ordered top to bottom,
     each pointing at the muscle on its own side of the body. */
  function addLabel(r, key, x, y, anchor, leadFrom) {
    const prime = isPrime(r.id);
    const g = svgEl('g', { class: `gv-mm-label ${prime ? 'gv-mm-label-prime' : 'gv-mm-label-hold'}` }, labelLayer);
    const lead = svgEl('line', { class: 'gv-mm-lead', x1: leadFrom[0], y1: leadFrom[1] }, g);
    const dot = svgEl('circle', { class: `gv-mm-dot ${prime ? '' : 'gv-mm-dot-hold'}`, r: 2 }, g);
    const t1 = svgEl('text', { class: 'gv-mm-lbl', x, y, 'text-anchor': anchor }, g);
    const nm = svgEl('tspan', {}, t1); nm.textContent = r.label.toUpperCase();
    const pct = prime ? svgEl('tspan', { class: 'gv-mm-pct', dx: 3 }, t1) : null;
    const t2 = svgEl('text', { class: 'gv-mm-latin', x, y: y + 8.5, 'text-anchor': anchor }, g);
    t2.textContent = r.latin;
    labels.push({ key, lead, dot, pct });
  }
  function buildLabels() {
    clearNode(labelLayer);
    labels = [];
    if (detail !== 'detailed') return;
    const mid = lib.poseAtDepth(motion, 0.5, bodyKey);
    if (columns) {
      for (const side of ['left', 'right']) {
        const list = regions.filter(r => (r.col === 'left') === (side === 'left')).map(r => {
          const key = side === 'left' && mid.parts[r.id + '_l'] ? r.id + '_l' : r.id;
          return { r, key, c: G.centroid(mid.parts[key]) };
        }).sort((a, b) => a.c[1] - b.c[1]);
        const top = box.y + 14, span = box.floor - box.y - 34;
        list.forEach((it, k) => {
          const y = top + (list.length === 1 ? span / 2 : span * k / (list.length - 1));
          const x = side === 'left' ? box.x - sideRoom + 4 : box.x + box.w + sideRoom - 4;
          const edge = side === 'left' ? box.x - 6 : box.x + box.w + 6;
          addLabel(it.r, it.key, x, y, side === 'left' ? 'start' : 'end', [edge, y - 3]);
        });
      }
      return;
    }
    const items = regions.map(r => ({ r, key: r.id, c: G.centroid(mid.parts[r.id]) }));
    const rows = [items.filter(i => i.r.row === 'top'), items.filter(i => i.r.row !== 'top')];
    rows.forEach((row, ri) => {
      row.sort((a, b) => a.c[0] - b.c[0]);
      /* More than three labels in a row would collide at phone width, so a long
         row alternates between two levels: neighbours are then a level apart. */
      const stagger = row.length > 3;
      row.forEach((it, k) => {
        const half = textWidth(it.r) / 2 + 2;
        const x = G.clamp(box.x + box.w * (k + 0.5) / row.length, box.x + half, box.x + box.w - half);
        const y = (ri === 0 ? box.y - LABEL_TOP + 12 : box.floor + 16) + (stagger && k % 2 ? 22 : 0);
        addLabel(it.r, it.key, x, y, 'middle', [x, ri === 0 ? y + 12 : y - 9]);
      });
    });
  }

  function buildFoot() {
    if (mini) return;
    clearNode(foot);
    loadFill = loadPct = stepEl = null; stepShown = -1;
    if (detail === 'basic') {
      const names = list => list.map(r => defOf(r).label).join(' · ');
      foot.append(el('div', { class: 'gv-mm-legend' },
        el('span', { class: 'gv-mm-key gv-mm-key-prime' }), el('span', { class: 'gv-mm-key-text' }, `Working: ${names(roles.prime)}`),
        el('span', { class: 'gv-mm-key gv-mm-key-hold' }), el('span', { class: 'gv-mm-key-text' }, `Holding: ${names(roles.hold)}`)));
      return;
    }
    const meter = svgEl('svg', { class: 'gv-mm-load-svg', viewBox: '0 0 100 6', preserveAspectRatio: 'none', 'aria-hidden': 'true' });
    svgEl('rect', { class: 'gv-mm-load-track', x: 0, y: 0, width: 100, height: 6, rx: 3 }, meter);
    loadFill = svgEl('rect', { class: 'gv-mm-load-fill', x: 0, y: 0, width: 0, height: 6, rx: 3 }, meter);
    loadPct = el('span', { class: 'gv-mm-load-pct' }, '0%');
    foot.append(el('div', { class: 'gv-mm-load' }, el('span', { class: 'gv-mm-load-label' }, 'Load'), meter, loadPct));
    if (steps.length) { stepEl = el('div', { class: 'gv-mm-step', 'aria-live': 'polite' }); foot.append(stepEl); }
  }

  /* ---------------------------------------------------------------- draw */
  const STILL = [1, 0.5, 0]; // the resting poses: bottom, halfway, top
  const clock = o.clock && Number.isFinite(o.clock.t) ? o.clock : { t: 0 };
  /* The per-frame lists, built once: the loop walks arrays, not Object.entries. */
  const pathList = Object.entries(paths), contextList = Object.entries(context), muscleList = Object.values(muscles);
  /* A map is usually built BEFORE its host is in the page (the page appends
     the block afterwards), where there is no style to read; it reads again the
     first time it is seen. */
  let tokens = LOAD_FALLBACK, tokensDark = null, tokensFromPage = false;
  const refreshTokens = () => { tokens = readLoadTokens(svg); tokensDark = isDark(); tokensFromPage = svg.isConnected === true; };

  /* The figure now: a playing one follows the clock; a paused one is where it
     was frozen (still === null) or at the resting pose it was stepped to. */
  function poseNow() {
    if (state.playing || state.still === null) return lib.poseAt(motion, clock.t / 1000, bodyKey);
    const d = STILL[state.still];
    return Object.assign(lib.poseAtDepth(motion, d, bodyKey), { load: lib.loadOf(d), rep: state.still });
  }
  function draw() {
    const p = poseNow();
    for (const [k, node] of pathList) node.setAttribute('d', G.smooth(p.parts[k]));
    const hotRGB = mix(tokens.lo, tokens.hi, p.depth), hot = rgb(hotRGB);
    primeStops[0].setAttribute('stop-color', rgb(mix(hotRGB, [255, 255, 255], 0.38)));
    primeStops[1].setAttribute('stop-color', hot);
    primeStops[2].setAttribute('stop-color', rgb(mix(hotRGB, [40, 10, 5], 0.3)));
    const edge = rgb(mix(hotRGB, [60, 12, 6], 0.45));
    for (const [k, node] of contextList) node.setAttribute('d', G.smooth(p.parts[k]));
    for (const { fill, clipShape, fibre, mark, tendon, r, k } of muscleList) {
      const d = G.smooth(p.parts[k]);
      fill.setAttribute('d', d);
      if (clipShape) clipShape.setAttribute('d', d);
      if (fibre) fibre.setAttribute('d', G.strokes(p.fibres[k]));
      if (mark) mark.setAttribute('d', G.strokes(p.lines[k]));
      if (tendon) { const [a, c, b] = p.tendons[k]; tendon.setAttribute('d', G.smooth(G.taperPts(a, c, b, 1.1, 0.35))); }
      if (isPrime(r.id)) { fill.setAttribute('fill-opacity', (0.88 + 0.12 * p.load).toFixed(2)); fill.setAttribute('stroke', edge); }
    }
    if (mini) return;
    const pctText = `${Math.round(p.load * 100)}%`;
    for (const l of labels) {
      const c = G.centroid(p.parts[l.key]);
      l.lead.setAttribute('x2', c[0].toFixed(1)); l.lead.setAttribute('y2', c[1].toFixed(1));
      l.dot.setAttribute('cx', c[0].toFixed(1)); l.dot.setAttribute('cy', c[1].toFixed(1));
      if (l.pct) { l.pct.textContent = pctText; l.dot.setAttribute('fill', hot); }
    }
    if (loadFill) { loadFill.setAttribute('width', (p.load * 100).toFixed(1)); loadFill.setAttribute('fill', hot); loadPct.textContent = pctText; }
    if (stepEl) {
      const i = ((p.rep % steps.length) + steps.length) % steps.length;
      if (i !== stepShown) { stepShown = i; stepEl.textContent = `Step ${i + 1} of ${steps.length} · ${steps[i]}`; }
    }
  }

  function setDetail(next, silent) {
    if (mini || next === detail) return;
    detail = next;
    card.classList.remove('gv-mm-basic', 'gv-mm-detailed');
    card.classList.add(`gv-mm-${detail}`);
    segBtns.forEach(b => {
      const on = b.getAttribute('data-detail') === detail;
      b.setAttribute('aria-pressed', String(on));
      b.classList.toggle('on', on);
    });
    svg.setAttribute('viewBox', viewBox());
    buildLabels(); buildFoot();
    draw();
    if (!silent && typeof o.onDetail === 'function') o.onDetail(detail);
  }

  /* ---------------------------------------------------------------- loop
     The clock can be SHARED (opts.clock, an object holding ms): the guided
     session rebuilds this card on every logged set, and handing the same
     clock to each new map is what keeps the rep playing on from where it
     was instead of restarting at the top. */
  let raf = null, last = null;
  let visible = false, wasConnected = false, stopped = false;
  let hidden = document.visibilityState === 'hidden';

  const cancel = () => { if (raf !== null) { window.cancelAnimationFrame(raf); raf = null; } last = null; };
  /* May this map tick right now? Not while still, off-screen, in a
     background app, or while a viewer's map (opts.exclusive) is open over it. */
  const mayTick = () => !stopped && state.playing && canWatch && visible && !hidden && (o.exclusive || exclusiveOpen === 0);
  function schedule() {
    if (raf !== null || !mayTick()) return;
    raf = window.requestAnimationFrame(frame);
  }
  const recheck = () => { if (mayTick()) schedule(); else cancel(); };
  function frame(ts) {
    raf = null;
    if (stopped) return;
    if (svg.isConnected) wasConnected = true;
    else if (wasConnected) { stop(); return; }
    if (last !== null && ts - last < MIN_FRAME_MS) { schedule(); return; } // ~30 fps
    /* A paused stretch never counts: the clock only runs while drawn, capped
       per frame so a slow frame doesn't jump the rep. */
    if (last !== null) clock.t += Math.min(Math.max(ts - last, 0), 100);
    last = ts;
    if (!tokensFromPage || tokensDark !== isDark()) refreshTokens(); // first look, or the theme flipped while on screen
    draw();
    schedule();
  }

  /* Build and draw BEFORE subscribing to anything: if either throws (the
     page then falls back to photos), no observer or listener is left
     behind. */
  buildLabels();
  buildFoot();
  draw();

  let io = null;
  if (canWatch) {
    io = new window.IntersectionObserver(entries => {
      for (const e of entries) visible = !!e.isIntersecting;
      if (visible && (!tokensFromPage || tokensDark !== isDark())) { refreshTokens(); draw(); }
      recheck();
    });
    io.observe(stage);
  }
  const onVis = () => {
    hidden = document.visibilityState === 'hidden';
    recheck();
  };
  document.addEventListener('visibilitychange', onVis);
  LIVE.add(recheck);

  /* PLAY, PAUSE, STEP. Pausing freezes the figure where it is; stepping (or a
     tap on a still figure) walks the resting poses, and the clock follows so
     that playing again continues from the pose shown rather than jumping. */
  const nearestStill = () => {
    const d = lib.depthAt(motion, clock.t / 1000);
    return STILL.reduce((best, v, i) => (Math.abs(v - d) < Math.abs(STILL[best] - d) ? i : best), 0);
  };
  function setPlaying(on) {
    on = !!on;
    if (stopped || on === state.playing) return;
    if (!on) state.still = null; // frozen exactly here
    else if (state.still !== null) clock.t = lib.timeAtDepth(motion, STILL[state.still]) * 1000;
    state.playing = on;
    if (on) state.still = null;
    cancel();
    syncStage();
    draw();
    recheck();
  }
  function step(dir) {
    if (stopped) return;
    const from = state.still === null ? nearestStill() : state.still;
    state.playing = false;
    state.still = ((from + (dir < 0 ? -1 : 1)) % STILL.length + STILL.length) % STILL.length;
    clock.t = lib.timeAtDepth(motion, STILL[state.still]) * 1000;
    cancel();
    syncStage();
    draw();
  }

  /* The stage is a control only when it does something: a still figure steps
     on a tap, and where the caller offers an enlarged view a playing one
     opens it. */
  const act = () => { if (!state.playing) step(1); else if (typeof o.onEnlarge === 'function') o.onEnlarge(); };
  function syncStage() {
    if (mini) return;
    const stepping = !state.playing, enlarge = typeof o.onEnlarge === 'function';
    const live = stepping || enlarge;
    stage.classList.toggle('gv-mm-stage-step', live);
    if (!live) { stage.removeAttribute('role'); stage.removeAttribute('tabindex'); stage.removeAttribute('aria-label'); return; }
    stage.setAttribute('role', 'button');
    stage.setAttribute('tabindex', '0');
    stage.setAttribute('aria-label', stepping
      ? `${name}: still pose. Tap to step through the movement.`
      : `Show ${name} larger`);
  }
  if (!mini) {
    stage.addEventListener('click', act);
    stage.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { if (e.preventDefault) e.preventDefault(); act(); } });
    syncStage();
  }

  function stop() {
    if (stopped) return;
    stopped = true;
    cancel();
    if (io) io.disconnect();
    document.removeEventListener('visibilitychange', onVis);
    LIVE.delete(recheck);
  }

  host.append(card);
  /* Now it is in the page, its colours can be read from the page's tokens. */
  refreshTokens();
  draw();
  return { stop, card, setPlaying, step, setDetail };
}

/* Whether this document can draw the map at all. Every real engine can;
   this exists so a page can fall back to photos instead of failing. */
const canDraw = () => typeof document !== 'undefined' && typeof document.createElementNS === 'function';

module.exports = { mountMuscleMap, canDraw };
