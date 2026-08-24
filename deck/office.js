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

const PAL = {
  floor: '#efe7d6', court: '#f5efe3', wall: '#d9cbb0', room: '#fbf6ec', roomHot: '#fdf9f1',
  ink: '#2b2117', ink2: '#6d5f4e', faint: '#a08f78',
  copper: '#b05f2a', copperD: '#8a4a20', mark: '#0d8ea3',
  good: '#3d7a5c', warn: '#a8741c', bad: '#b23b3b', paper: '#fffdf8',
  skin: ['#b05f2a', '#0d8ea3', '#3d7a5c', '#a8741c', '#7d5a7a', '#6b7c8f'],
};
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

const person = (c, time, opts = {}) => {
  const bob = reduced ? 0 : Math.sin(time / 420 + c.seed) * 1.6;
  const typing = opts.typing && !reduced ? Math.sin(time / 90 + c.seed) * 1.4 : 0;
  const hue = hueFor(c.agent);
  // chair
  ctx.fillStyle = 'rgba(43,33,23,.10)';
  rr(c.x - 11, c.y + 6, 22, 8, 3); ctx.fill();
  // body
  ctx.fillStyle = hue;
  rr(c.x - 9, c.y - 8 + bob, 18, 16, 6); ctx.fill();
  // hex head
  const hy = c.y - 16 + bob + typing * 0.4;
  ctx.beginPath();
  for (let i = 0; i < 6; i += 1) {
    const a = -Math.PI / 2 + (i * Math.PI) / 3;
    ctx[i ? 'lineTo' : 'moveTo'](c.x + Math.cos(a) * 8, hy + Math.sin(a) * 8.6);
  }
  ctx.closePath();
  ctx.fillStyle = opts.dim ? '#c9bda6' : PAL.paper;
  ctx.fill();
  ctx.strokeStyle = hue;
  ctx.lineWidth = 1.6;
  ctx.stroke();
  if (c.manager) { // a small tie-pin of authority: the manager's head carries its hue
    ctx.fillStyle = hue;
    ctx.beginPath(); ctx.arc(c.x, hy, 2.6, 0, 7); ctx.fill();
  }
  // desk with papers
  ctx.fillStyle = '#e4d6bc';
  rr(c.x - 15, c.y + 12, 30, 9, 2.5); ctx.fill();
  if (opts.typing) {
    ctx.fillStyle = PAL.paper;
    rr(c.x - 6 + typing, c.y + 9, 12, 4, 1); ctx.fill();
  }
  if (opts.flame) {
    const f = reduced ? 0 : Math.sin(time / 150 + c.seed) * 1.5;
    ctx.fillStyle = PAL.warn;
    ctx.beginPath();
    ctx.moveTo(c.x, hy - 18 - f);
    ctx.quadraticCurveTo(c.x + 5, hy - 12, c.x, hy - 8);
    ctx.quadraticCurveTo(c.x - 5, hy - 12, c.x, hy - 18 - f);
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
  ctx.fillStyle = '#e8dcc4'; ctx.strokeStyle = PAL.wall; ctx.lineWidth = 2;
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
  ctx.fillStyle = '#e8dcc4'; ctx.strokeStyle = PAL.wall; ctx.lineWidth = 2;
  rr(ev.x - 26, ev.y - 34, 52, 68, 6); ctx.fill(); ctx.stroke();
  ctx.strokeStyle = PAL.faint;
  ctx.beginPath(); ctx.moveTo(ev.x, ev.y - 30); ctx.lineTo(ev.x, ev.y + 30); ctx.stroke();
  ctx.fillStyle = PAL.faint; ctx.font = '600 9px system-ui'; ctx.textAlign = 'center';
  ctx.fillText('ELEVATOR', ev.x, ev.y + 46);
  ctx.fillText('sessions', ev.x, ev.y + 57);
  scene.elevator = ev;

  // reception — the Principal's desk
  const rc = scene.reception;
  ctx.fillStyle = '#e8dcc4'; ctx.strokeStyle = PAL.wall;
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
