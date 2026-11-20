import * as THREE from 'three';
import {hgt as hgtJS} from '../sim/sea.js';
import {PP} from '../sim/pp.js';
import {createClaw} from './claw.js';

// Bathyscaphe orange — same suit color as the human (iPhone-Pro-Max deep orange,
// dark soviet-plastic 80s). Matte black accents: gimbal, guards, joints.
const SUIT = 0xc45a1e;
const SUIT_DARK = 0x8f3d12;
const BLACK = 0x141414;
const BLACK_SOFT = 0x1e1e1e;

/** Build the drone skin: an orange FPV quad half human-height,
 *  shrouded propellers (round ducts), matte-black camera gimbal. */
export function createDroneMesh() {
  const mat = {
    suit: new THREE.MeshStandardMaterial({ color: SUIT, roughness: 0.5, metalness: 0.15 }),
    suitDark: new THREE.MeshStandardMaterial({ color: SUIT_DARK, roughness: 0.55, metalness: 0.1 }),
    black: new THREE.MeshStandardMaterial({ color: BLACK, roughness: 0.85, metalness: 0.1 }),
    guard: new THREE.MeshStandardMaterial({ color: BLACK_SOFT, roughness: 0.7, metalness: 0.2, side: THREE.DoubleSide }),
    lens: new THREE.MeshStandardMaterial({ color: 0x060608, roughness: 0.2, metalness: 0.4 }),
  };

  const g = new THREE.Group();

  // central body: puffy orange capsule torso, half human-height (~0.8 m total)
  const body = new THREE.Group();
  const hull = new THREE.Mesh(new THREE.SphereGeometry(0.22, 16, 12), mat.suit);
  hull.scale.set(1.25, 0.8, 1.05);
  const belly = new THREE.Mesh(new THREE.SphereGeometry(0.2, 14, 10), mat.suit);
  belly.scale.set(1.3, 0.85, 1.1);
  belly.position.y = -0.04;
  const pack = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.16, 0.1), mat.black);
  pack.position.set(0, 0.05, 0.16); // flush with the hull: nothing sits on top of the airframe
  body.add(hull, belly, pack);
  g.add(body);

  // camera gimbal: matte-black ball under the NOSE with a dark lens. The nose is -Z.
  const gimbal = new THREE.Group();
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 10), mat.black);
  const lens = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), mat.lens);
  lens.position.set(0, -0.02, -0.07);
  const lensRim = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.015, 8, 14), mat.black);
  lensRim.position.set(0, -0.02, -0.07);
  gimbal.add(ball, lens, lensRim);
  gimbal.position.set(0, -0.04, -0.20);
  g.add(gimbal);

  // four shrouded props: orange arms + round duct guards + dark rotors
  const props = [];
  const armLen = 0.48; // tip-to-tip distance from the center
  const corners = [[1, 1], [1, -1], [-1, -1], [-1, 1]];
  for (const [sx, sz] of corners) {
    const dx = sx * armLen / 2, dz = sz * armLen / 2;
    // arm: a short capsule-ish cylinder laid along (dx, 0, dz)
    const len = Math.hypot(dx, dz);
    const arm = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, len, 8), mat.suitDark);
    arm.position.set(dx / 2, 0.04, dz / 2);
    arm.rotation.z = Math.PI / 2;
    arm.rotation.y = -Math.atan2(dz, dx);
    g.add(arm);

    const pod = new THREE.Group();
    pod.position.set(dx, 0.04, dz);
    // duct: open cylinder wall as the round closed guard
    const duct = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 0.11, 18, 1, true), mat.guard);
    // top/bottom rim rings
    const rimT = new THREE.Mesh(new THREE.TorusGeometry(0.155, 0.016, 8, 18), mat.suitDark);
    rimT.rotation.x = Math.PI / 2; rimT.position.y = 0.055;
    const rimB = rimT.clone(); rimB.position.y = -0.055;
    // rotor: two crossed blades, dark
    const rotor = new THREE.Group();
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.27, 0.012, 0.028), mat.black);
    const blade2 = blade.clone(); blade2.rotation.y = Math.PI / 2;
    rotor.add(blade, blade2);
    pod.add(duct, rimT, rimB, rotor);
    g.add(pod);
    props.push({ rotor, dir: sx * sz > 0 ? 1 : -1 });
  }

  // no landing gear: the claw is the only thing under the belly, and skids next to it read as
  // a second, contradictory set of legs

  return { group: g, mat, props };
}

/** FPV drone: inertia, wind, collisions, roll and camera shake. */
export function createDrone({S, cam, city, input, windSys}){
const hgt=(x,z,t)=>PP.ready?PP.hgt(x,z,t):hgtJS(x,z,t);
const rn=Math.random,K=input.K;
const pos=new THREE.Vector3(0,42,150),vel=new THREE.Vector3(),wind=new THREE.Vector3(),tmp=new THREE.Vector3(),fw=new THREE.Vector3(),rt=new THREE.Vector3();
let yaw=0,pitch=-.05,roll=0,rate=0,yAcc=0,shk=0;
const out={gust:0,sp:0,wh:0};
// the claw: a body under the belly. `load` is the mass factor while a person hangs from it.
const claw=createClaw({S,city}),NOCL={toggle:false};claw.targets.vel=vel;
let load=1,hitA=0;const v0=new THREE.Vector3(),accel=new THREE.Vector3();
let active=true; // when false (human is driving), step() integrates but does not touch the camera
let zoom=0; // wheel: 0 = FPV, 1 = behind and above the body

// visible skin: an orange quad half human-height, shrouded props, black gimbal.
// FPV: the drone never sees its own body — hide the skin while the drone camera
// is active, show it when the HUMAN is active (he must see the drone in the world).
let skin=null,spin=0;
if(S){ // S may be omitted in tests
  skin=createDroneMesh();
  skin.group.position.copy(pos);
  S.add(skin.group);
  skin.group.visible=false;
}
function setSkin(v){ if(skin)skin.group.visible=v }

function step(dt,t){
 if(!active){ // passive: AUTOPILOT HOLD — hover at the altitude where the player
  // left it (no gravity, no thrust keys), drift with the wind, never sink.
  // Do NOT touch input.look here: the operator is driving, and he consumes that delta himself.
  windSys.at(pos.x,pos.y,pos.z,wind);
  const sp0=vel.length();
  tmp.copy(vel).sub(wind);vel.addScaledVector(tmp,-(.5+.014*sp0)*dt); // wind drag
  vel.y-=vel.y*(2.5*dt); // weak vertical damping: hold altitude, bob in gusts
  pos.addScaledVector(vel,dt);
  const wh=hgt(pos.x,pos.z,t);if(pos.y<wh+0.2){pos.y=wh+0.2;vel.y=Math.max(0,vel.y)}
  claw.update(dt,pos,vel,yaw,pitch,roll,null);
  hitA=0;accel.set(0,0,0); // a parked drone has no impact and no acceleration: a stale value would drop the carried operator
  syncSkin(dt);
  return;
 }
 // RMB toggles the claw. It has no aim of its own: the drone's position and attitude are the aim.
 const cl=input.claw||NOCL;let my=input.look.yaw,mp=input.look.pitch;
 yaw+=my;yAcc+=my;input.look.yaw=0;pitch+=mp;input.look.pitch=0;v0.copy(vel);
 const kk=k=>K[k]?1:0,hy=(kk('ArrowLeft')+kk('KeyQ')-kk('ArrowRight')-kk('KeyE'))*1.7*dt;yaw+=hy;yAcc+=hy;pitch+=(kk('ArrowUp')-kk('ArrowDown'))*1.2*dt;pitch=Math.max(-1.45,Math.min(1.45,pitch));
 rate+=(yAcc/Math.max(dt,1e-3)-rate)*(1-Math.exp(-10*dt));yAcc=0;
 const cp=Math.cos(pitch);fw.set(-Math.sin(yaw)*cp,Math.sin(pitch),-Math.cos(yaw)*cp);rt.set(Math.cos(yaw),0,-Math.sin(yaw));
 const lf=1/load; // a hanging person loads the vertical and forward axes only
 tmp.set(0,0,0).addScaledVector(fw,(kk('KeyW')-kk('KeyS'))*38*lf).addScaledVector(rt,(kk('KeyD')-kk('KeyA'))*28);tmp.y+=(kk('Space')-kk('ShiftLeft')-kk('ShiftRight'))*28*lf;
 vel.addScaledVector(tmp,dt);
 windSys.at(pos.x,pos.y,pos.z,wind);const gust=windSys.g;
 const sp=vel.length();tmp.copy(vel).sub(wind);vel.addScaledVector(tmp,-(.5+.014*sp)*dt);
 pos.addScaledVector(vel,dt); const wh=hgt(pos.x,pos.z,t);
 const cx0=vel.x,cy0=vel.y,cz0=vel.z; shk+=city.collide(pos,vel);
 hitA=Math.hypot(vel.x-cx0,vel.y-cy0,vel.z-cz0); // walls only: m/s of velocity lost to the city, NOT m/s^2
 // the operator is a body too: without this the drone flies through him and the player has no
 // physical cue for the grab distance. Contact puts him at 0.77 m from the axis, gap 0.42 — in range.
 // This contact is NOT a hit: a carried operator must not be dropped by the push that grabbed him.
 const hh=claw.targets.human;
 if(hh&&!hh.carried){
  const p=hh.pos, cy=Math.max(p.y,Math.min(p.y+hh.eyeH,pos.y));
  const hx=pos.x-p.x, hy=pos.y-cy, hz=pos.z-p.z;
  const hd=Math.hypot(hx,hy,hz), HR=0.35+0.42;
  if(hd<HR&&hd>1e-4){const k=(HR-hd)/hd;pos.x+=hx*k;pos.y+=hy*k;pos.z+=hz*k;vel.x*=.5;vel.y*=.5;vel.z*=.5}
 }
 if(pos.y<wh+1.6){shk+=Math.min(1,Math.abs(vel.y)*.02)+dt*2;pos.y=wh+1.6;vel.y=Math.max(vel.y,-vel.y*.2);vel.x*=1-.5*dt;vel.z*=1-.5*dt}
 shk*=Math.exp(-4*dt);shk=Math.min(shk,1.5); // clamp: sustained surface contact must plateau, not grow
 const rl=load>1?.45:.9,rr=Math.max(-rl,Math.min(rl,-rate*.14-vel.dot(rt)*.018));roll+=(rr-roll)*(1-Math.exp(-6*dt));
 accel.set((vel.x-v0.x)/Math.max(dt,1e-3),(vel.y-v0.y)/Math.max(dt,1e-3),(vel.z-v0.z)/Math.max(dt,1e-3));
 claw.update(dt,pos,vel,yaw,pitch,roll,cl);
 syncSkin(dt);
 const sv=sp*.00004+.0012,j=(Math.sin(t*61)+Math.sin(t*37)*.7)*sv*(1+shk*10);
 const zb=0.45+zoom*4.5,zu=0.12+zoom*1.8; // wheel: FPV -> behind and above, WoW-style
 // the offset follows the PITCH too, otherwise a nose-down drone climbs out of the frame
 const pc=Math.cos(pitch),ps=Math.sin(pitch);
 cam.rotation.order='YXZ'; // yaw, then pitch, then roll: the default XYZ rolls in the wrong frame
 cam.position.set(pos.x+Math.sin(yaw)*pc*zb,pos.y-ps*zb+zu,pos.z+Math.cos(yaw)*pc*zb);cam.rotation.set(pitch+j-0.21-zoom*0.10+shk*(rn()-.5)*.08,yaw+j*.7+shk*(rn()-.5)*.08,roll*(1-zoom)+shk*(rn()-.5)*.1);
 cam.fov=90+Math.min(sp,50)*.4+shk*3;cam.updateProjectionMatrix();
 out.gust=gust;out.sp=sp;out.wh=wh;
}
/** Sync the skin to the physics state: position, attitude, rotor spin. */
function syncSkin(dt){
 if(!skin)return;
 // third person must SEE the body it is flying: the skin appears as soon as the wheel pulls back
 skin.group.visible=!active||zoom>0.15;
 // and the claw is part of the body: in FPV it is not there at all
 claw.group.visible=!active||zoom>0.15;
 skin.group.position.copy(pos);
 // skin faces where the drone points; FPV camera is the nose. YXZ, or the pitch would be
 // applied before the yaw and the body would lean in the wrong plane.
 skin.group.rotation.order='YXZ';
 skin.group.rotation.set(pitch,yaw,roll);
 // rotor blur: constant idle spin + speed
 spin+=dt*(40+out.sp*4);
 for(const p of skin.props)p.rotor.rotation.y=spin*p.dir;
}
function idle(){const zb=0.45+zoom*4.5,zu=0.12+zoom*1.8;const pc=Math.cos(pitch),ps=Math.sin(pitch);cam.rotation.order='YXZ';cam.position.set(pos.x+Math.sin(yaw)*pc*zb,pos.y-ps*zb+zu,pos.z+Math.cos(yaw)*pc*zb);cam.rotation.set(pitch-0.21-zoom*0.10,yaw,0)}
function dispose(){ claw.dispose(); if(skin&&S){S.remove&&S.remove(skin.group);skin.group.traverse(o=>{if(o.geometry)o.geometry.dispose()});Object.values(skin.mat).forEach(m=>m.dispose())} }
return {pos,vel,wind,out,step,idle,dispose,claw,accel,get clawTip(){return claw.tip},get hitA(){return hitA},get load(){return load},set load(v){load=v},get shk(){return shk},get yaw(){return yaw},get pitch(){return pitch},get roll(){return roll},setActive(v){active=v;setSkin(!v)},get active(){return active},set zoom(v){zoom=v},get zoom(){return zoom}};
// setActive(true)=drone drives -> skin hidden; setActive(false)=human drives -> skin visible
}