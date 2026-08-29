/**
 * The Office — F.O.R.G.E. drawn as the place it is.
 *
 * Twelve rooms around a courtyard, the six-seat board table in the middle with no head
 * chair, every specialist at a desk, the Principal's reception at the bottom. The ledger
 * animates it: an active run makes the addressed room type, queued mail bobs as an
 * envelope on the recipient's roof, a courier walks a note from reception when you send,
 * a streak earns a little flame over the desk that earned it.
 *
 * Drawn with Canvas 2D and nothing else. The obvious library for this is a sprite engine;
 * the whole Console runs on a fresh clone with no install step, and a renderer for
 * eighteen rooms and sixty little people does not need one. Warm palette, hand-drawn
 * shapes — an illustration of an office, not a clone of anyone's pixel art.
 *
 * The canvas is enhancement, never the only path: the legend chips under it are real
 * buttons, so keyboard and screen-reader users get the same navigation the mouse gets.
 */

/**
 * THE CANVAS HAS TO BE TOLD ABOUT THE THEME — CSS cannot reach inside it.
 *
 * This was a hardcoded light palette, and when dark mode arrived the HUD and the drawer went
 * dark while the office floor stayed bright paper. It was found by screenshotting the real
 * page, and it is invisible to any assertion about classes or computed styles: a canvas has
 * no elements to compute styles for. It is one bitmap that knows only what it is handed.
 *
 * So the palette is READ from the same custom properties everything else uses — one source
 * of truth for colour, and a third theme later would be a token edit and nothing here.
 *
 * `floor` and the wood tones have no token of their own (they are canvas-only surfaces), so
 * they are derived from --paper and --line by a small luminance shift. That keeps the office
 * reading as a room in either ground without a second palette to maintain.
 */
const readVar = (name, fallback) => {
  try {
    const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
    return v || fallback;
  } catch {
    return fallback; // rendered before styles resolve, or a context with no document
  }
};

/** Nudge a #rrggbb toward white or black. Signed: positive is lighter. */
const shift = (hex, amount) => {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex).trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const ch = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => Math.max(0, Math.min(255, Math.round(c + amount))));
  return `#${ch.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
};

let PAL = {};

const readPalette = () => {
  const paper = readVar('--paper', '#f5efe3');
  // Is the ground dark? Ask the ground, not the toggle — with no explicit choice the root
  // carries no data-theme and the OS decides, so the attribute would be empty exactly when
  // the answer matters.
  const isDark = parseInt(String(paper).replace('#', '').slice(0, 2), 16) < 128;
  PAL = {
    court: paper,
    floor: shift(paper, isDark ? 8 : -6),
    wall: readVar('--line-2', '#d9cbb0'),
    room: readVar('--card-2', '#fbf6ec'),
    roomHot: shift(readVar('--card-2', '#fbf6ec'), isDark ? 12 : 4),
    wood: shift(readVar('--line', '#e6dbc6'), isDark ? 4 : -8),
    dim: shift(readVar('--faint', '#a08f78'), isDark ? -30 : 30),
    ink: readVar('--ink', '#2b2117'),
    ink2: readVar('--ink-2', '#6d5f4e'),
    faint: readVar('--faint', '#a08f78'),
    copper: readVar('--copper', '#b05f2a'),
    copperD: readVar('--copper-ink', '#8a4a20'),
    mark: readVar('--mark', '#0d8ea3'),
    good: readVar('--good', '#3d7a5c'),
    warn: readVar('--warn', '#a8741c'),
    bad: readVar('--bad', '#b23b3b'),
    paper: readVar('--card', '#fffdf8'),
    // The people keep their hues in both themes. They are identity, not chrome — an agent
    // that changed colour with the theme would read as a different agent.
    skin: ['#b05f2a', '#0d8ea3', '#3d7a5c', '#a8741c', '#7d5a7a', '#6b7c8f'],
  };
};
readPalette();

/* The theme changes at runtime (the toggle) and under us (the OS). Both must repaint. */
if (typeof document !== 'undefined') {
  try {
    new MutationObserver(readPalette).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', readPalette);
  } catch { /* no observers here — the palette it booted with still applies */ }
}
const hueFor = (name) => PAL.skin[[...name].reduce((n, c) => n + c.charCodeAt(0), 0) % PAL.skin.length];

const W = 1240;
const H = 950;

let ctx;
let canvas;
let raf = 0;
let t0 = performance.now();
let scene = null;           // rooms, chars, board — rebuilt when the org changes
let live = null;            // status, mail, runs, rewards — swapped on every refresh
let couriers = [];          // one-shot walkers, spawned by run events
let hover = null;
let handlers = { onRoom: () => {}, onAgent: () => {}, onBoard: () => {}, onReception: () => {}, onElevator: () => {} };
let reduced = false;

// ── layout ─────────────────────────────────────────────────────────────────────────────

const buildScene = (org) => {
  const divs = org.divisions;
  const rooms = [];
  // Perimeter: 4 up, 2 right, 4 down, 2 left — walk order matches the constitution order.
  // A clean ring: four rooms across the top, three down each side, two flanking the
  // courtyard at the bottom with reception between them. The first layout let the bottom
  // row span the full width and it collided with both side columns — visible the moment
  // the floor rendered, which is why floors get looked at and not proven.
  const spots = [
    ...[0, 1, 2, 3].map((i) => ({ x: 20 + i * 302, y: 16, w: 292, h: 196, door: 'S' })),
    { x: 940, y: 228, w: 280, h: 176, door: 'W' },
    { x: 940, y: 420, w: 280, h: 176, door: 'W' },
    { x: 940, y: 612, w: 280, h: 176, door: 'W' },
    { x: 638, y: H - 16 - 196, w: 286, h: 196, door: 'N' },
    { x: 316, y: H - 16 - 196, w: 286, h: 196, door: 'N' },
    { x: 20, y: 612, w: 280, h: 176, door: 'E' },
    { x: 20, y: 420, w: 280, h: 176, door: 'E' },
    { x: 20, y: 228, w: 280, h: 176, door: 'E' },
  ];
  divs.forEach((d, i) => {
    const s = spots[i % spots.length];
    const specialists = d.agents.filter((a) => a.role === 'specialist');
    const manager = d.agents.find((a) => a.role === 'manager');
    const chars = [];
    // Manager's desk faces the door; specialists in rows of three behind it.
    const mx = s.x + s.w / 2;
    const my = s.door === 'N' ? s.y + s.h - 52 : s.y + 64;
    chars.push({ agent: manager.name, division: d.id, x: mx, y: my, seed: i * 7, manager: true });
    specialists.forEach((a, j) => {
      const col = j % 3;
      const row = Math.floor(j / 3);
      const px = s.x + 54 + col * ((s.w - 108) / 2);
      const rowGap = s.h > 190 ? 52 : 46;
      const py = s.door === 'N' ? s.y + s.h - 104 - row * rowGap : s.y + 112 + row * rowGap;
      chars.push({ agent: a.name, division: d.id, x: px, y: py, seed: i * 7 + j + 1 });
    });
    rooms.push({ ...s, id: d.id, name: d.name, code: d.code, mayHalt: d.mayHalt, chars });
  });

  // The board table — a hexagon in the courtyard, six seats, deliberately no head chair.
  const bx = W / 2;
  const by = 400;
  const board = org.seats.map((seat, i) => {
    const a = -Math.PI / 2 + (i * Math.PI) / 3;
    return { agent: seat.name, seat: seat.seat, isChair: seat.isChair, x: bx + Math.cos(a) * 92, y: by + Math.sin(a) * 60, seed: 60 + i };
  });

  return { rooms, board, bx, by, reception: { x: W / 2, y: 620 } };
};

// ── drawing primitives ────────────────────────────────────────────────────────────────

const rr = (x, y, w, h, r) => {
  ctx.beginPath();
  ctx.roundRect(x, y, w, h, r);
};

/**
 * A person, drawn as a NODE rather than a character.
 *
 * The old figure was a body, a hexagonal head, a chair and a desk with papers on it — a
 * little cartoon of a worker. That is what made the whole surface read as a game: at 68
 * agents it is sixty-eight cartoons, and the eye starts looking for the story instead of the
 * state. The Principal's own words were "professional, RPG-inspiring but not kiddish".
 *
 * So: keep the spatial metaphor, which is genuinely good, and lose the illustration. Each
 * agent is now a hexagonal node — the same hex as the F.O.R.G.E. mark, so the shape is brand
 * rather than decoration — sitting on a short baseline that stands in for the desk.
 *
 * WHAT THE MARKS MEAN, since every one of them now has to earn its place:
 *   fill       the agent's identity hue, constant across themes
 *   ring       a manager. One extra stroke, not a tie-pin
 *   baseline   the desk. A line, because a desk is a surface and not an object
 *   pulse      currently working — the only motion, and it is a state, not a flourish
 *   bar        an active streak, drawn as a small meter rather than a flame
 *
 * Nothing bobs. Idle motion was the single largest contributor to the toy feeling: an office
 * where everyone is gently bouncing is an aquarium. Motion is now reserved for "this agent is
 * doing something right now", which makes it information.
 */
const person = (c, time, opts = {}) => {
  const hue = hueFor(c.agent);
  const r = 9;
  const working = opts.typing && !reduced;
  // A slow breath, ONLY while working. Amplitude is deliberately under a pixel of apparent
  // size — enough to catch peripheral vision, not enough to read as an animation.
  const pulse = working ? 1 + Math.sin(time / 340 + c.seed) * 0.06 : 1;

  // The desk: one hairline. It anchors the node to the floor and says nothing else.
  ctx.strokeStyle = PAL.line;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(c.x - 14, c.y + 13.5);
  ctx.lineTo(c.x + 14, c.y + 13.5);
  ctx.stroke();

  // The node.
  const hex = (cx, cy, rad) => {
    ctx.beginPath();
    for (let i = 0; i < 6; i += 1) {
      const a = -Math.PI / 2 + (i * Math.PI) / 3;
      ctx[i ? 'lineTo' : 'moveTo'](cx + Math.cos(a) * rad, cy + Math.sin(a) * rad * 1.08);
    }
    ctx.closePath();
  };

  if (working) {
    // A soft halo instead of a typing animation. Same information, no jitter.
    ctx.globalAlpha = 0.18;
    ctx.fillStyle = hue;
    hex(c.x, c.y, r * pulse * 1.9);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  hex(c.x, c.y, r * pulse);
  ctx.fillStyle = opts.dim ? PAL.dim : hue;
  ctx.fill();

  if (c.manager) {
    // Authority is one ring. It reads at a glance and does not need a legend.
    ctx.strokeStyle = PAL.ink;
    ctx.lineWidth = 1.4;
    hex(c.x, c.y, r * pulse + 3.5);
    ctx.stroke();
  }

  if (opts.flame) {
    // A streak, as a meter. A flame is a mood; a bar is a quantity.
    ctx.fillStyle = PAL.warn;
    rr(c.x - 6, c.y - r - 7, 12, 2.5, 1.25);
    ctx.fill();
  }
};

const envelope = (x, y, time) => {
  const bob = reduced ? 0 : Math.sin(time / 300) * 3;
  ctx.fillStyle = PAL.paper;
  ctx.strokeStyle = PAL.copperD;
  ctx.lineWidth = 1.4;
  rr(x - 10, y - 7 + bob, 20, 14, 2); ctx.fill(); ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x - 10, y - 7 + bob); ctx.lineTo(x, y + 1 + bob); ctx.lineTo(x + 10, y - 7 + bob);
  ctx.stroke();
};

// ── the frame ─────────────────────────────────────────────────────────────────────────

const frame = (now) => {
  const time = now - t0;
  ctx.clearRect(0, 0, W, H);

  // courtyard + floor
  ctx.fillStyle = PAL.court; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = 'rgba(160,143,120,.18)';
  ctx.lineWidth = 1;
  for (let x = 0; x < W; x += 44) { ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, H); ctx.stroke(); }
  for (let y = 0; y < H; y += 44) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(W, y); ctx.stroke(); }

  const runsByAgent = new Map();
  for (const r of live?.runs || []) runsByAgent.set(r.to, r);
  const mailByAgent = new Map();
  for (const th of live?.waitingThreads || []) mailByAgent.set(th.to, (mailByAgent.get(th.to) || 0) + 1);
  const flames = new Set((live?.rewards?.streaks || []).map((s) => s.agent));

  // rooms
  for (const room of scene.rooms) {
    const st = live?.status?.[room.id]?.state || 'idle';
    const isHover = hover?.type === 'room' && hover.id === room.id;
    const roomRunning = room.chars.some((c) => runsByAgent.has(c.agent));
    ctx.fillStyle = isHover || roomRunning ? PAL.roomHot : PAL.room;
    ctx.strokeStyle = isHover ? PAL.copper : PAL.wall;
    ctx.lineWidth = isHover ? 2.4 : 2;
    rr(room.x, room.y, room.w, room.h, 10); ctx.fill(); ctx.stroke();

    // door gap toward the courtyard
    ctx.strokeStyle = PAL.court; ctx.lineWidth = 4;
    ctx.beginPath();
    if (room.door === 'S') { ctx.moveTo(room.x + room.w / 2 - 17, room.y + room.h); ctx.lineTo(room.x + room.w / 2 + 17, room.y + room.h); }
    if (room.door === 'N') { ctx.moveTo(room.x + room.w / 2 - 17, room.y); ctx.lineTo(room.x + room.w / 2 + 17, room.y); }
    if (room.door === 'W') { ctx.moveTo(room.x, room.y + room.h / 2 - 17); ctx.lineTo(room.x, room.y + room.h / 2 + 17); }
    if (room.door === 'E') { ctx.moveTo(room.x + room.w, room.y + room.h / 2 - 17); ctx.lineTo(room.x + room.w, room.y + room.h / 2 + 17); }
    ctx.stroke();

    // name plate + status lamp
    ctx.fillStyle = PAL.ink;
    ctx.font = '600 12.5px "Avenir Next", system-ui';
    ctx.textAlign = 'left';
    const plateY = room.door === 'N' ? room.y + room.h - 14 : room.y + 22;
    ctx.fillText(room.name.toUpperCase(), room.x + 14, plateY);
    const lamp = { active: PAL.good, failing: PAL.bad, blocked: PAL.warn, idle: PAL.wall }[st];
    ctx.fillStyle = lamp;
    ctx.beginPath(); ctx.arc(room.x + room.w - 18, plateY - 4, 4.5, 0, 7); ctx.fill();
    if ((st === 'active' || roomRunning) && !reduced) {
      ctx.strokeStyle = lamp; ctx.globalAlpha = 0.4 + Math.sin(time / 300) * 0.3;
      ctx.beginPath(); ctx.arc(room.x + room.w - 18, plateY - 4, 7.5, 0, 7); ctx.stroke();
      ctx.globalAlpha = 1;
    }
    if (room.mayHalt) {
      ctx.fillStyle = PAL.bad; ctx.font = '700 9px system-ui';
      ctx.fillText('■ may halt', room.x + room.w - 76, plateY + 10);
    }

    for (const c of room.chars) {
      person(c, time, { typing: runsByAgent.has(c.agent), flame: flames.has(c.agent), dim: st === 'idle' && !runsByAgent.has(c.agent) });
    }
    let mails = 0;
    for (const c of room.chars) mails += mailByAgent.get(c.agent) || 0;
    if (mails > 0) {
      const at = {
        S: [room.x + room.w / 2 + 34, room.y + room.h + 12],
        N: [room.x + room.w / 2 + 34, room.y - 12],
        W: [room.x - 14, room.y + room.h / 2],
        E: [room.x + room.w + 14, room.y + room.h / 2],
      }[room.door];
      envelope(at[0], at[1], time);
    }
  }

  // the board table — hexagonal, no head chair
  ctx.fillStyle = PAL.wood; ctx.strokeStyle = PAL.wall; ctx.lineWidth = 2;
  ctx.beginPath();
  for (let i = 0; i < 6; i += 1) {
    const a = -Math.PI / 2 + (i * Math.PI) / 3;
    ctx[i ? 'lineTo' : 'moveTo'](scene.bx + Math.cos(a) * 62, scene.by + Math.sin(a) * 40);
  }
  ctx.closePath(); ctx.fill(); ctx.stroke();
  ctx.fillStyle = PAL.faint; ctx.font = '600 10px system-ui'; ctx.textAlign = 'center';
  ctx.fillText('THE BOARD', scene.bx, scene.by + 3);
  ctx.fillText('no head chair', scene.bx, scene.by + 15);
  for (const c of scene.board) person(c, time, { typing: runsByAgent.has(c.agent), dim: false });

  // the elevator — sessions and other workplaces live behind these doors
  const ev = { x: 340, y: 560 };
  ctx.fillStyle = PAL.wood; ctx.strokeStyle = PAL.wall; ctx.lineWidth = 2;
  rr(ev.x - 26, ev.y - 34, 52, 68, 6); ctx.fill(); ctx.stroke();
  ctx.strokeStyle = PAL.faint;
  ctx.beginPath(); ctx.moveTo(ev.x, ev.y - 30); ctx.lineTo(ev.x, ev.y + 30); ctx.stroke();
  ctx.fillStyle = PAL.faint; ctx.font = '600 9px system-ui'; ctx.textAlign = 'center';
  ctx.fillText('ELEVATOR', ev.x, ev.y + 46);
  ctx.fillText('sessions', ev.x, ev.y + 57);
  scene.elevator = ev;

  // reception — the Principal's desk
  const rc = scene.reception;
  ctx.fillStyle = PAL.wood; ctx.strokeStyle = PAL.wall;
  rr(rc.x - 56, rc.y - 8, 112, 26, 8); ctx.fill(); ctx.stroke();
  ctx.fillStyle = PAL.faint; ctx.font = '600 10px system-ui'; ctx.textAlign = 'center';
  ctx.fillText('YOU — RECEPTION', rc.x, rc.y + 32);
  person({ agent: 'principal', x: rc.x, y: rc.y - 14, seed: 99 }, time, {});

  // couriers, spawned by sends: a note walks from reception to the room
  couriers = couriers.filter((k) => k.t < 1);
  for (const k of couriers) {
    k.t += reduced ? 1 : 0.006;
    const x = rc.x + (k.tx - rc.x) * k.t;
    const y = rc.y + (k.ty - rc.y) * k.t - Math.sin(k.t * Math.PI) * 46;
    envelope(x, y, time);
  }

  // tooltip
  if (hover?.type === 'agent') {
    ctx.font = '600 12px "Avenir Next", system-ui';
    const label = hover.agent;
    const tw = ctx.measureText(label).width + 18;
    ctx.fillStyle = PAL.ink;
    rr(hover.x - tw / 2, hover.y - 44, tw, 24, 6); ctx.fill();
    ctx.fillStyle = PAL.paper; ctx.textAlign = 'center';
    ctx.fillText(label, hover.x, hover.y - 28);
  }

};

const draw = (now) => {
  frame(now);
  raf = requestAnimationFrame(draw);
};

// ── hit testing ───────────────────────────────────────────────────────────────────────

const pick = (mx, my) => {
  if (!scene) return null;
  for (const room of scene.rooms) {
    for (const c of room.chars) {
      if (Math.abs(mx - c.x) < 14 && my > c.y - 28 && my < c.y + 16) return { type: 'agent', agent: c.agent, x: c.x, y: c.y };
    }
  }
  for (const c of scene.board) {
    if (Math.abs(mx - c.x) < 14 && my > c.y - 28 && my < c.y + 16) return { type: 'agent', agent: c.agent, x: c.x, y: c.y };
  }
  if (scene.elevator && Math.abs(mx - scene.elevator.x) < 30 && Math.abs(my - scene.elevator.y) < 40) return { type: 'elevator' };
  if (Math.abs(mx - scene.reception.x) < 62 && Math.abs(my - scene.reception.y) < 34) return { type: 'reception' };
  if (Math.abs(mx - scene.bx) < 100 && Math.abs(my - scene.by) < 70) return { type: 'board' };
  for (const room of scene.rooms) {
    if (mx > room.x && mx < room.x + room.w && my > room.y && my < room.y + room.h) return { type: 'room', id: room.id };
  }
  return null;
};

// ── public api ────────────────────────────────────────────────────────────────────────

export const mount = (el, org, on) => {
  canvas = el;
  handlers = { ...handlers, ...on };
  reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = W * dpr;
  canvas.height = H * dpr;
  ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  scene = buildScene(org);

  canvas.onmousemove = (e) => {
    const r = canvas.getBoundingClientRect();
    hover = pick(((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H);
    canvas.style.cursor = hover ? 'pointer' : 'default';
  };
  canvas.onmouseleave = () => { hover = null; };
  canvas.onclick = () => {
    if (hover?.type === 'room') handlers.onRoom(hover.id);
    if (hover?.type === 'agent') handlers.onAgent(hover.agent);
    if (hover?.type === 'board') handlers.onBoard();
    if (hover?.type === 'reception') handlers.onReception();
    if (hover?.type === 'elevator') handlers.onElevator();
  };

  cancelAnimationFrame(raf);
  t0 = performance.now();
  raf = requestAnimationFrame(draw);
};

export const update = (data) => { live = data; };

export const courier = (agentName) => {
  if (!scene) return;
  for (const room of scene.rooms) {
    const c = room.chars.find((x) => x.agent === agentName);
    if (c) { couriers.push({ tx: c.x, ty: c.y, t: 0 }); return; }
  }
  const b = scene.board.find((x) => x.agent === agentName);
  if (b) couriers.push({ tx: b.x, ty: b.y, t: 0 });
};

export const unmount = () => { cancelAnimationFrame(raf); raf = 0; canvas = null; };

/**
 * Stop animating but keep the scene: one last frame, then stillness. Used by ?live=0 —
 * a headless capture under virtual time never reaches idle while a rAF loop runs, so the
 * static mode that exists for screenshots must actually hold still.
 */
export const freeze = () => {
  cancelAnimationFrame(raf);
  raf = 0;
  // One deliberate frame after the loop stops. Under a headless virtual-time capture the
  // timer that calls freeze can win the race against the first animation frame, and a
  // freeze that only cancels then holds a canvas nobody ever painted.
  if (ctx && scene) frame(performance.now());
};
