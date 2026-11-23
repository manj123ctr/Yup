// Keyboard / mouse / gamepad input with action mapping.
export const BINDINGS = {
  forward: ['KeyW', 'ArrowUp'], back: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
  sprint: ['ShiftLeft', 'ShiftRight'], jump: ['Space'], crouch: ['KeyC', 'ControlLeft'], walk: ['KeyZ'],
  enter: ['KeyF'], interact: ['KeyE'], attack: ['Mouse0'], aim: ['Mouse2'], reload: ['KeyR'],
  headlights: ['KeyH'], horn: ['KeyQ'], camera: ['KeyV'], map: ['KeyM'], phone: ['KeyT'],
  inventory: ['Tab', 'KeyI'], pause: ['Escape', 'KeyP'], weapon1: ['Digit1'], weapon2: ['Digit2'], weaponNext: ['KeyX'],
  lookBack: ['KeyB'],
};
export const BINDING_LABELS = {
  forward: 'Move forward / Accelerate', back: 'Move back / Brake & reverse', left: 'Move / steer left', right: 'Move / steer right',
  sprint: 'Sprint (on foot)', jump: 'Jump / Handbrake', crouch: 'Crouch / Cinematic camera (vehicle)', walk: 'Toggle walk',
  enter: 'Enter / exit vehicle', interact: 'Interact (shops, missions)', attack: 'Attack / shoot', aim: 'Aim', reload: 'Reload / Radio station (vehicle)',
  headlights: 'Headlights', horn: 'Horn / Siren', camera: 'Cycle camera view', map: 'Map', phone: 'Phone',
  inventory: 'Inventory', pause: 'Pause menu', weapon1: 'Fists', weapon2: 'Pistol', weaponNext: 'Next weapon', lookBack: 'Look behind',
};

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.down = new Set();
    this.edge = new Set();
    this.mdx = 0; this.mdy = 0; this.wheel = 0;
    this.locked = false;
    this.enabled = true;
    this.sensitivity = 1; this.invertY = false;
    this.lastDevice = 'kb';
    this.pad = null;
    addEventListener('keydown', (e) => {
      if (e.code === 'Tab') e.preventDefault();
      if (e.target && (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT')) return;
      if (!this.down.has(e.code)) this.edge.add(e.code);
      this.down.add(e.code);
      this.lastDevice = 'kb';
      if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.down.delete(e.code));
    addEventListener('blur', () => this.down.clear());
    canvas.addEventListener('mousedown', (e) => {
      const c = 'Mouse' + e.button;
      if (!this.down.has(c)) this.edge.add(c);
      this.down.add(c);
      if (this.wantLock && !this.locked) this.requestLock();
    });
    addEventListener('mouseup', (e) => this.down.delete('Mouse' + e.button));
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    addEventListener('mousemove', (e) => {
      if (this.locked) { this.mdx += e.movementX; this.mdy += e.movementY; }
    });
    canvas.addEventListener('wheel', (e) => { this.wheel += Math.sign(e.deltaY); e.preventDefault(); }, { passive: false });
    document.addEventListener('pointerlockchange', () => { this.locked = document.pointerLockElement === canvas; });
    this.wantLock = false;
  }
  requestLock() {
    try { const p = this.canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* ignore */ }
  }
  releaseLock() { if (document.pointerLockElement) document.exitPointerLock(); }
  is(action) {
    if (!this.enabled) return false;
    const b = BINDINGS[action];
    for (const k of b) if (this.down.has(k)) return true;
    return this.padState && this.padState[action];
  }
  pressed(action) {
    if (!this.enabled) return false;
    const b = BINDINGS[action];
    for (const k of b) if (this.edge.has(k)) return true;
    return this.padEdge && this.padEdge[action];
  }
  // Analog axes in [-1,1]
  axis(neg, pos) {
    let v = (this.is(pos) ? 1 : 0) - (this.is(neg) ? 1 : 0);
    if (this.padAxes) {
      const a = { left: -this.padAxes.lx, right: this.padAxes.lx, forward: -this.padAxes.ly, back: this.padAxes.ly };
      if (Math.abs(this.padAxes.lx) > 0.15 || Math.abs(this.padAxes.ly) > 0.15) v = (a[pos] ?? 0);
    }
    return v;
  }
  pollGamepad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const p = pads && [...pads].find((x) => x);
    if (!p) { this.padAxes = null; this.padState = null; this.padEdge = null; return; }
    const dz = (v) => (Math.abs(v) < 0.15 ? 0 : v);
    const prev = this.padState || {};
    const btn = (i) => !!(p.buttons[i] && p.buttons[i].pressed);
    const st = {
      jump: btn(0), crouch: btn(1), enter: btn(3), interact: btn(2), sprint: btn(0) && false,
      attack: (p.buttons[7]?.value || 0) > 0.5, aim: (p.buttons[6]?.value || 0) > 0.5,
      pause: btn(9), map: btn(8), phone: btn(12), inventory: btn(13), camera: btn(5), horn: btn(10), reload: btn(4), headlights: btn(14),
    };
    this.padAxes = { lx: dz(p.axes[0]), ly: dz(p.axes[1]), rx: dz(p.axes[2]), ry: dz(p.axes[3]), rt: p.buttons[7]?.value || 0, lt: p.buttons[6]?.value || 0 };
    if (Object.values(st).some((v) => v) || Math.abs(this.padAxes.lx) + Math.abs(this.padAxes.ly) > 0.3) this.lastDevice = 'pad';
    this.padEdge = {};
    for (const k in st) if (st[k] && !prev[k]) this.padEdge[k] = true;
    this.padState = st;
    this.mdx += this.padAxes.rx * 14; this.mdy += this.padAxes.ry * 10;
  }
  consumeMouse() {
    const d = { x: this.mdx * this.sensitivity, y: this.mdy * this.sensitivity * (this.invertY ? -1 : 1), wheel: this.wheel };
    this.mdx = 0; this.mdy = 0; this.wheel = 0;
    return d;
  }
  endFrame() { this.edge.clear(); }
}
