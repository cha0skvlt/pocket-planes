import * as THREE from 'three';
import {hgt as hgtJS} from '../sim/sea.js';
import {PP} from '../sim/pp.js';

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
  const spine = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.1, 0.12), mat.suitDark);
  spine.position.set(0, 0.14, -0.1);
  const pack = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.16, 0.1), mat.black);
  pack.position.set(0, 0.1, -0.16);
  body.add(hull, belly, spine, pack);
  g.add(body);

  // camera gimbal: matte-black ball under the nose with a dark lens
  const gimbal = new THREE.Group();
  const ball = new THREE.Mesh(new THREE.SphereGeometry(0.09, 12, 10), mat.black);
  const lens = new THREE.Mesh(new THREE.SphereGeometry(0.05, 10, 8), mat.lens);
  lens.position.set(0, -0.02, 0.07);
  const lensRim = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.015, 8, 14), mat.black);
  lensRim.position.set(0, -0.02, 0.07);
  gimbal.add(ball, lens, lensRim);
  gimbal.position.set(0, -0.14, 0.14);
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

  // landing skids: two black arcs
  for (const s of [-1, 1]) {
    const skid = new THREE.Mesh(new THREE.TorusGeometry(0.16, 0.014, 8, 16, Math.PI), mat.black);
    skid.position.set(0, -0.2, s * 0.2);
    skid.rotation.y = Math.PI / 2;
    g.add(skid);
    const strut = new THREE.Mesh(new THREE.CylinderGeometry(0.014, 0.014, 0.16, 6), mat.black);
    strut.position.set(s * 0.14, -0.14, s * 0.2);
    g.add(strut);
  }

  return { group: g, mat, props };
}

/** FPV drone: inertia, wind, collisions, roll and camera shake. */
export function createDrone({S, cam, city, input, windSys}){
const hgt=(x,z,t)=>PP.ready?PP.hgt(x,z,t):hgtJS(x,z,t);
const rn=Math.random,K=input.K;
const pos=new THREE.Vector3(0,42,150),vel=new THREE.Vector3(),wind=new THREE.Vector3(),tmp=new THREE.Vector3(),fw=new THREE.Vector3(),rt=new THREE.Vector3();
let yaw=0,pitch=-.05,roll=0,rate=0,yAcc=0,shk=0;
const out={gust:0,sp:0,wh:0};
let active=true; // when false (human is driving), step() integrates but does not touch the camera

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
  input.look.yaw=0;input.look.pitch=0; // discard look input while inactive
  windSys.at(pos.x,pos.y,pos.z,wind);
  const sp0=vel.length();
  tmp.copy(vel).sub(wind);vel.addScaledVector(tmp,-(.5+.014*sp0)*dt); // wind drag
  vel.y-=vel.y*(2.5*dt); // weak vertical damping: hold altitude, bob in gusts
  pos.addScaledVector(vel,dt);
  const wh=hgt(pos.x,pos.z,t);if(pos.y<wh+0.2){pos.y=wh+0.2;vel.y=Math.max(0,vel.y)}
  syncSkin(dt);
  return;
 } const my=input.look.yaw;yaw+=my;yAcc+=my;input.look.yaw=0;pitch+=input.look.pitch;input.look.pitch=0;
 const kk=k=>K[k]?1:0,hy=(kk('ArrowLeft')+kk('KeyQ')-kk('ArrowRight')-kk('KeyE'))*1.7*dt;yaw+=hy;yAcc+=hy;pitch+=(kk('ArrowUp')-kk('ArrowDown'))*1.2*dt;pitch=Math.max(-1.45,Math.min(1.45,pitch));
 rate+=(yAcc/Math.max(dt,1e-3)-rate)*(1-Math.exp(-10*dt));yAcc=0;
 const cp=Math.cos(pitch);fw.set(-Math.sin(yaw)*cp,Math.sin(pitch),-Math.cos(yaw)*cp);rt.set(Math.cos(yaw),0,-Math.sin(yaw));
 tmp.set(0,0,0).addScaledVector(fw,(kk('KeyW')-kk('KeyS'))*38).addScaledVector(rt,(kk('KeyD')-kk('KeyA'))*28);tmp.y+=(kk('Space')-kk('ShiftLeft')-kk('ShiftRight'))*28;
 vel.addScaledVector(tmp,dt);
 windSys.at(pos.x,pos.y,pos.z,wind);const gust=windSys.g;
 const sp=vel.length();tmp.copy(vel).sub(wind);vel.addScaledVector(tmp,-(.5+.014*sp)*dt);
 pos.addScaledVector(vel,dt); const wh=hgt(pos.x,pos.z,t);
 shk+=city.collide(pos,vel);
 if(pos.y<wh+1.6){shk+=Math.min(1,Math.abs(vel.y)*.02)+dt*2;pos.y=wh+1.6;vel.y=Math.max(vel.y,-vel.y*.2);vel.x*=1-.5*dt;vel.z*=1-.5*dt}
 shk*=Math.exp(-4*dt);shk=Math.min(shk,1.5); // clamp: sustained surface contact must plateau, not grow
 const rr=Math.max(-.9,Math.min(.9,-rate*.14-vel.dot(rt)*.018));roll+=(rr-roll)*(1-Math.exp(-6*dt));
 syncSkin(dt);
 const sv=sp*.00004+.0012,j=(Math.sin(t*61)+Math.sin(t*37)*.7)*sv*(1+shk*10);
 cam.position.copy(pos);cam.rotation.set(pitch+j+shk*(rn()-.5)*.08,yaw+j*.7+shk*(rn()-.5)*.08,roll+shk*(rn()-.5)*.1);
 cam.fov=90+Math.min(sp,50)*.4+shk*3;cam.updateProjectionMatrix();
 out.gust=gust;out.sp=sp;out.wh=wh;
}
/** Sync the skin to the physics state: position, attitude, rotor spin. */
function syncSkin(dt){
 if(!skin)return;
 skin.group.position.copy(pos);
 // skin faces where the drone points; FPV camera is the nose
 skin.group.rotation.set(0,yaw,roll);
 // rotor blur: constant idle spin + speed
 spin+=dt*(40+out.sp*4);
 for(const p of skin.props)p.rotor.rotation.y=spin*p.dir;
}
function idle(){cam.position.copy(pos);cam.rotation.set(pitch,yaw,0)}
function dispose(){ if(skin&&S){S.remove&&S.remove(skin.group);skin.group.traverse(o=>{if(o.geometry)o.geometry.dispose()});Object.values(skin.mat).forEach(m=>m.dispose())} }
return {pos,vel,wind,out,step,idle,dispose,get shk(){return shk},setActive(v){active=v;setSkin(!v)},get active(){return active}};
// setActive(true)=drone drives -> skin hidden; setActive(false)=human drives -> skin visible
}