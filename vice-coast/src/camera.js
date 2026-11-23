// Third-person camera rig: orbit on foot, over-the-shoulder aim, vehicle chase
// cams (far/near/hood/interior), cinematic auto-cam, collision, FOV kick & shake.
import * as THREE from 'three';
import { clamp, damp, dampAngle, lerp, wrapAngle, R } from './util.js';
import { groundHeight } from './world/layout.js';

const _t = new THREE.Vector3(), _d = new THREE.Vector3(), _p = new THREE.Vector3();

export class CameraRig {
  constructor(G, camera) {
    this.G = G; this.cam = camera;
    this.yaw = Math.PI; this.pitch = 0.18;
    this.dist = 4.6; this.targetDist = 4.6;
    this.vehMode = 0; // 0 far, 1 near, 2 hood, 3 interior
    this.cinematic = false; this.cineT = 0; this.cineShot = 0;
    this.manualT = 0;
    this.shakeAmt = 0;
    this.fov = 65; this.baseFov = 65;
    this.pos = new THREE.Vector3(0, 10, 10);
    this.look = new THREE.Vector3();
    this.override = null; // {pos, look} for cutscenes / title
  }
  shake(a) { this.shakeAmt = Math.min(1, this.shakeAmt + a); }
  distTo(p) { return this.cam.position.distanceTo(p); }
  setVehicleMode(m) { this.vehMode = m; }
  cycleVehicleMode() { this.vehMode = (this.vehMode + 1) % 4; this.cinematic = false; return this.vehMode; }
  forwardXZ() { return { x: -Math.sin(this.yaw), z: -Math.cos(this.yaw) }; }

  collide(target, pos) {
    const col = this.G.col;
    const t = col.raycast(target.x, target.y, target.z, pos.x, pos.y, pos.z, 'tree');
    if (t < 1) pos.lerpVectors(target, pos, Math.max(0.05, t - 0.06));
    const gy = groundHeight(pos.x, pos.z) + 0.3;
    if (pos.y < gy) pos.y = gy;
  }

  update(dt, mouse) {
    const G = this.G, P = G.player;
    const c = this.cam;
    if (this.override) {
      c.position.copy(this.override.pos); c.lookAt(this.override.look);
      this.applyFov(dt, this.override.fov || 55);
      return;
    }
    const sens = 0.0024;
    const veh = P.vehicle;
    if (mouse.wheel) this.targetDist = clamp(this.targetDist + mouse.wheel * 0.6, 1.8, veh ? 14 : 9);
    if (mouse.x || mouse.y) { this.manualT = 1.6; }
    this.yaw = wrapAngle(this.yaw - mouse.x * sens);
    this.pitch = clamp(this.pitch + mouse.y * sens, -0.6, 1.25);
    this.manualT = Math.max(0, this.manualT - dt);
    let fov = this.baseFov;
    if (!veh) {
      const crouch = P.crouching ? 0.45 : 0;
      const swim = P.swimming ? -0.6 : 0;
      _t.set(P.pos.x, P.pos.y + 1.55 - crouch + swim, P.pos.z);
      let dist = this.targetDist, side = 0;
      if (P.aiming) { dist = 1.9; side = 0.55; fov = this.baseFov - 18; _t.y += 0.1; }
      if (P.indoors) dist = Math.min(dist, 3.2);
      this.dist = damp(this.dist, dist, 8, dt);
      this.side = damp(this.side || 0, side, 10, dt);
      const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
      _p.set(_t.x + Math.sin(this.yaw) * cp * this.dist, _t.y + sp * this.dist, _t.z + Math.cos(this.yaw) * cp * this.dist);
      // shoulder offset (right of camera)
      const rx = Math.cos(this.yaw), rz = -Math.sin(this.yaw);
      _p.x += rx * this.side; _p.z += rz * this.side; _t.x += rx * this.side; _t.z += rz * this.side;
      this.collide(_t, _p);
      this.pos.lerp(_p, 1 - Math.exp(-dt * 18));
      this.look.lerp(_t, 1 - Math.exp(-dt * 22));
      if (P.sprinting) fov += 6;
    } else {
      const v = veh;
      const speed = v.speed;
      const T = v.T;
      fov += clamp(speed / 50, 0, 1) * 14;
      if (this.cinematic) { this.updateCinematic(dt, v); return this.finish(dt, fov); }
      if (this.vehMode >= 2) {
        // first person: hood or interior
        const fx = Math.sin(v.heading), fz = Math.cos(v.heading);
        let local;
        if (this.vehMode === 2) local = new THREE.Vector3(0, (T.nose || 0.9) + 0.45, (T.len / 2) - 0.6);
        else local = v.bike ? new THREE.Vector3(0, 1.55, -0.1) : new THREE.Vector3(0.38, T.belt + 0.42, v.geo.seatZ + 0.05);
        const wp = v.chassis.localToWorld(local.clone());
        const lookYaw = this.manualT > 0 ? this.fpYaw || 0 : 0;
        this.fpYaw = clamp((this.fpYaw || 0) - mouse.x * sens, -2.2, 2.2);
        if (this.manualT <= 0) this.fpYaw = damp(this.fpYaw, G.input.is('lookBack') ? Math.PI : 0, 4, dt);
        const yy = v.heading + this.fpYaw;
        this.fpPitch = clamp((this.fpPitch || 0) - mouse.y * sens, -0.6, 0.5);
        if (this.manualT <= 0) this.fpPitch = damp(this.fpPitch, 0, 4, dt);
        const tgt = wp.clone().add(new THREE.Vector3(Math.sin(yy) * 10, this.fpPitch * 10 + v.pitch * -6, Math.cos(yy) * 10));
        this.pos.copy(wp); this.look.copy(tgt);
        c.position.copy(this.pos); c.lookAt(this.look);
        c.rotateZ(-(v.roll + v.lean) * 0.6);
        return this.finish(dt, fov, true);
      }
      const near = this.vehMode === 1;
      const base = (v.bike ? 3.6 : T.len * 1.05 + 1.5) * (near ? 0.7 : 1) + (this.targetDist - 4.6) * 0.5;
      const height = (v.bike ? 1.5 : (T.box || T.roof || 1.4) * 0.6 + 1.2) * (near ? 0.85 : 1);
      // auto-align behind the car when not using the mouse
      const vf = v.fwdSpeed;
      let behind = wrapAngle(v.heading + Math.PI);
      if (vf < -2) behind = v.heading; // reversing: look forward of car (behind its motion)
      if (G.input.is('lookBack')) behind = v.heading;
      if (this.manualT <= 0 && speed > 1.5) {
        this.yaw = dampAngle(this.yaw, behind, 3.2, dt);
        this.pitch = damp(this.pitch, 0.16, 2, dt);
      } else if (this.manualT <= 0) this.yaw = dampAngle(this.yaw, behind, 1.2, dt);
      _t.set(v.pos.x, v.pos.y + height * 0.75, v.pos.z);
      // look ahead
      _t.x += v.vel.x * 0.08; _t.z += v.vel.y * 0.08;
      const dist = base + speed * 0.03;
      this.dist = damp(this.dist, dist, 4, dt);
      const cp = Math.cos(this.pitch), sp = Math.sin(this.pitch);
      _p.set(_t.x + Math.sin(this.yaw) * cp * this.dist, _t.y + sp * this.dist + height * 0.35, _t.z + Math.cos(this.yaw) * cp * this.dist);
      this.collide(_t, _p);
      this.pos.lerp(_p, 1 - Math.exp(-dt * 10));
      this.look.lerp(_t, 1 - Math.exp(-dt * 16));
    }
    c.position.copy(this.pos);
    c.lookAt(this.look);
    this.finish(dt, fov);
  }
  updateCinematic(dt, v) {
    this.cineT -= dt;
    if (this.cineT <= 0) {
      this.cineT = 4 + R() * 3;
      this.cineShot = (this.cineShot + 1 + Math.floor(R() * 2)) % 4;
      // fixed roadside shot: place ahead of car
      const f = v.forward;
      this.cineAnchor = new THREE.Vector3(v.pos.x + f.x * (25 + v.speed * 1.5) + (R() - 0.5) * 14, v.pos.y + 1 + R() * 3, v.pos.z + f.z * (25 + v.speed * 1.5) + (R() - 0.5) * 14);
    }
    const c = this.cam;
    const fx = Math.sin(v.heading), fz = Math.cos(v.heading);
    const rx = -fz, rz = fx;
    let pos, look = new THREE.Vector3(v.pos.x, v.pos.y + 0.8, v.pos.z);
    if (this.cineShot === 0) pos = this.cineAnchor;
    else if (this.cineShot === 1) pos = new THREE.Vector3(v.pos.x + rx * 3.5 + fx * 1.5, v.pos.y + 0.5, v.pos.z + rz * 3.5 + fz * 1.5);
    else if (this.cineShot === 2) pos = new THREE.Vector3(v.pos.x - fx * 6, v.pos.y + 14, v.pos.z - fz * 6);
    else pos = new THREE.Vector3(v.pos.x + fx * 6 - rx * 2, v.pos.y + 0.7, v.pos.z + fz * 6 - rz * 2);
    _t.copy(look);
    _p.copy(pos);
    this.collide(_t, _p);
    this.pos.lerp(_p, this.cineShot === 0 ? 1 : 1 - Math.exp(-dt * 6));
    c.position.copy(this.pos);
    c.lookAt(look);
  }
  applyFov(dt, fov) {
    this.fov = damp(this.fov, fov, 5, dt);
    if (Math.abs(this.cam.fov - this.fov) > 0.01) { this.cam.fov = this.fov; this.cam.updateProjectionMatrix(); }
  }
  finish(dt, fov) {
    const c = this.cam;
    if (this.shakeAmt > 0.001) {
      const s = this.shakeAmt * 0.25;
      c.position.x += (R() - 0.5) * s; c.position.y += (R() - 0.5) * s; c.position.z += (R() - 0.5) * s;
      c.rotateZ((R() - 0.5) * s * 0.1);
      this.shakeAmt *= Math.exp(-dt * 5);
    }
    this.applyFov(dt, fov);
  }
}
