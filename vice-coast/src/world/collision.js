// Static collision world: axis-aligned boxes stored in a spatial hash.
const CELL = 32;

export class CollisionWorld {
  constructor() {
    this.cells = new Map();
    this.boxes = [];
    this._stamp = 0;
  }
  key(cx, cz) { return cx * 73856093 ^ cz * 19349663; }
  add(x0, z0, x1, z1, y0 = 0, y1 = 100, tag = 'building') {
    const b = { x0: Math.min(x0, x1), x1: Math.max(x0, x1), z0: Math.min(z0, z1), z1: Math.max(z0, z1), y0, y1, tag, _s: 0 };
    this.boxes.push(b);
    const cx0 = Math.floor(b.x0 / CELL), cx1 = Math.floor(b.x1 / CELL);
    const cz0 = Math.floor(b.z0 / CELL), cz1 = Math.floor(b.z1 / CELL);
    for (let cx = cx0; cx <= cx1; cx++) for (let cz = cz0; cz <= cz1; cz++) {
      const k = this.key(cx, cz);
      let arr = this.cells.get(k);
      if (!arr) { arr = []; this.cells.set(k, arr); }
      arr.push(b);
    }
    return b;
  }
  // Collect boxes overlapping a rectangle
  query(x0, z0, x1, z1, out = []) {
    out.length = 0;
    const s = ++this._stamp;
    const cx0 = Math.floor(x0 / CELL), cx1 = Math.floor(x1 / CELL);
    const cz0 = Math.floor(z0 / CELL), cz1 = Math.floor(z1 / CELL);
    for (let cx = cx0; cx <= cx1; cx++) for (let cz = cz0; cz <= cz1; cz++) {
      const arr = this.cells.get(this.key(cx, cz));
      if (!arr) continue;
      for (const b of arr) { if (b._s !== s) { b._s = s; out.push(b); } }
    }
    return out;
  }
  // Push a vertical cylinder (x,z,r) at feet height y with height h out of boxes.
  // Returns {hit, nx, nz, depth} for the deepest contact; mutates p.
  resolveCircle(p, r, y, h, res = { hit: false, nx: 0, nz: 0, depth: 0 }) {
    res.hit = false; res.depth = 0; res.nx = 0; res.nz = 0;
    const list = this.query(p.x - r, p.z - r, p.x + r, p.z + r, this._tmp || (this._tmp = []));
    for (let iter = 0; iter < 2; iter++) {
      for (const b of list) {
        if (y + h < b.y0 || y > b.y1 - 0.01) continue;
        const cx = Math.max(b.x0, Math.min(p.x, b.x1));
        const cz = Math.max(b.z0, Math.min(p.z, b.z1));
        let dx = p.x - cx, dz = p.z - cz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= r * r) continue;
        let d = Math.sqrt(d2), nx, nz, pen;
        if (d < 1e-5) {
          // Center inside box: push along smallest axis
          const l = p.x - b.x0, rr = b.x1 - p.x, t = p.z - b.z0, bt = b.z1 - p.z;
          const m = Math.min(l, rr, t, bt);
          if (m === l) { nx = -1; nz = 0; pen = l + r; }
          else if (m === rr) { nx = 1; nz = 0; pen = rr + r; }
          else if (m === t) { nx = 0; nz = -1; pen = t + r; }
          else { nx = 0; nz = 1; pen = bt + r; }
        } else { nx = dx / d; nz = dz / d; pen = r - d; }
        p.x += nx * pen; p.z += nz * pen;
        if (pen > res.depth) { res.depth = pen; res.nx = nx; res.nz = nz; res.hit = true; res.box = b; }
      }
    }
    return res;
  }
  // Highest box top under a point within radius (for standing on things)
  topAt(x, z, y, r = 0.3) {
    const list = this.query(x - r, z - r, x + r, z + r, this._tmp2 || (this._tmp2 = []));
    let top = -Infinity;
    for (const b of list) {
      if (x + r < b.x0 || x - r > b.x1 || z + r < b.z0 || z - r > b.z1) continue;
      if (b.y1 <= y + 0.6 && b.y1 > top) top = b.y1;
    }
    return top;
  }
  // Segment vs boxes (3D). Returns fraction t in [0,1] of first hit or 1.
  raycast(ax, ay, az, bx, by, bz, ignoreTag) {
    const list = this.query(Math.min(ax, bx), Math.min(az, bz), Math.max(ax, bx), Math.max(az, bz), this._tmp3 || (this._tmp3 = []));
    let best = 1;
    const dx = bx - ax, dy = by - ay, dz = bz - az;
    for (const b of list) {
      if (ignoreTag && b.tag === ignoreTag) continue;
      let t0 = 0, t1 = best;
      const ax_ = [ax, ay, az], d_ = [dx, dy, dz], mn = [b.x0, b.y0, b.z0], mx = [b.x1, b.y1, b.z1];
      let ok = true;
      for (let k = 0; k < 3; k++) {
        if (Math.abs(d_[k]) < 1e-9) { if (ax_[k] < mn[k] || ax_[k] > mx[k]) { ok = false; break; } continue; }
        let ta = (mn[k] - ax_[k]) / d_[k], tb = (mx[k] - ax_[k]) / d_[k];
        if (ta > tb) { const tt = ta; ta = tb; tb = tt; }
        if (ta > t0) t0 = ta; if (tb < t1) t1 = tb;
        if (t0 > t1) { ok = false; break; }
      }
      if (ok && t0 < best) best = t0;
    }
    return best;
  }
}
