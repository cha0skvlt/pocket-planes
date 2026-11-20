import './style.css';
import * as THREE from 'three';
import {createStage,disposeStage} from './core/stage.js';
import {log} from './core/log.js';
import {createSky} from './world/sky.js';
import {createOcean} from './world/ocean.js';
import {createLights} from './world/lights.js';
import {createTextures} from './world/textures.js';
import {createCity} from './world/city.js';
import {createRain} from './world/rain.js';
import {createAtmosphere} from './world/atmosphere.js';
import {createAudio} from './audio/audio.js';
import {createInput} from './flight/input.js';
import {createDrone} from './flight/drone.js';
import {createHuman} from './flight/human.js';
import {createSeaUniforms} from './world/waves.js';
import {createOverlay} from './ui/overlay.js';
import {initPP,PP,sea as seaPP,updateSea as updateSeaPP} from './sim/pp.js';
import {initBlob,BLOB,blobInput,blobObstacles,blobCollide,blobDrag} from './sim/blob.js';
import {createBlob} from './world/blob.js';
import {createKey} from './sim/key.js';
import {createPortal} from './world/portal.js';
import {createWind as createWindJS} from './sim/wind.js';
import {sea as seaJS,updateSea as updateSeaJS,hgt as hgtJS} from './sim/sea.js';

const ac=new AbortController(),signal=ac.signal;

// WebGL is required: without it three.js throws and the overlay hangs dead.
function noWebGL(msg){
 window.__galNoWebGL=true;
 const s=document.getElementById('s');
 if(s)s.innerHTML='<h1>NO WEBGL</h1><div>This browser does not provide a WebGL context — the engine cannot start.</div>'
  +'<small>Open this address in Safari/Chrome/Firefox. '+String(msg||'').replace(/[<>&]/g,'')+'</small>';
}

async function boot(){
 log.info('boot: start');
 // WASM core: when it boots, physics runs in Rust; JS modules are only a fallback.
 let useWASM=true;
 try{await initPP();log.info('boot: WASM core up, statePtr='+PP.statePtr)}catch(e){useWASM=false;log.warn('WASM core failed, physics on JS:',e)}
 const sea=useWASM?seaPP:seaJS;
 // updateSeaPP(dt, wind) unwraps wind.u10/wind.dir itself — same signature as updateSeaJS.
 // ⚠ Do not unwrap in a lambda: double unwrapping feeds undefined -> NaN into pp_step -> NaN into w1.
 const updateSea=useWASM?updateSeaPP:updateSeaJS;
 let wind=createWindJS();
 if(useWASM){ // same interface, data from Rust
  wind=await import('./sim/pp.js').then(m=>m.createWind());
 }
 let stage;
 try{stage=createStage(signal);log.info('boot: stage ok')}catch(e){noWebGL(e&&e.message);log.error('boot: no WebGL',e);throw e}
 // register renderer objects for modules that need them without prop-drilling
 PP.scene=stage.S; PP.camera=stage.cam;
 const {R,S,cam,rift,T,fogU}=stage;
 // Enemy: a colony of cells with its own Rust core (PPE-physics/src/blob).
 // Separate static and separate exports — PPState is untouched.
 let blob=null;
 // Local body is ~2.2 m across. Scale 28 -> ~62 m: an anomaly over the city, not a cloud of bubbles.
 const BLOB_SCALE=28;
 if(useWASM){try{
  initBlob(12345,1500);
  blob=createBlob(S,new THREE.Vector3(0,72,-20),BLOB_SCALE);
  log.info('boot: blob up, cells='+BLOB.N+' grains='+blob.grains+' scale='+BLOB_SCALE+' abi='+BLOB.ex.pp_blob_abi_version());
 }catch(e){log.warn('boot: blob failed',e)}}
 const _bw={x:0,y:0,z:0,g:0},_b0={x:0,y:0,z:0,r:0,vx:0,vy:0,vz:0},_b1={x:0,y:0,z:0,r:0,vx:0,vy:0,vz:0};
 let bfr=0, held=0;
 const seaU=useWASM?createSeaUniforms(seaPP):createSeaUniforms();
 const sky=createSky(S,fogU),ocean=createOcean(S,fogU,seaU.uniforms),lights=createLights(S,rift);
 const tex=createTextures(R),city=createCity(S,tex),rain=createRain(S);
 const atmo=createAtmosphere({rift,fogU,lights},signal),audio=createAudio();
 wind.setObstacles(city.bl);
 const input=createInput(signal),drone=createDrone({S,cam,city,input,windSys:wind});
 // Human body: physics in JS (flight/human-phys.js) — same pattern as the drone.
 // It reads the sea through the same interface and collides against city AABBs itself.
 const human=useWASM?createHuman(city):null;
 if(human){
  // Spawn on the tallest ROOF, not in open water: at (0,0.5,0) the body
  // is over open water (groundY=-Infinity), flips into Swim at once and
  // the keyboard feels dead. On a roof the state machine stays Ground.
  const roof=city.bl.reduce((a,b)=>b.top>a.top?b:a);
  // near the edge, clear of the rooftop hut: the hut sits at x + hw*0.2 and spans to x + hw*0.55
  human.spawn(roof.x-roof.hw*0.6,roof.top,roof.z,0.64);
  human.setActive(false); // start as the drone
  log.info(`boot: human spawned on roof (${roof.x.toFixed(0)},${roof.top.toFixed(0)},${roof.z.toFixed(0)})`);
 }
 // The loop: key (held in the colony) -> claw -> portal -> haul the operator through.
 // All three exist only with the WASM blob: no colony, no key, no door.
 let key=null,portal=null,won=false;const _pc={tip:null,keyGrabbed:false,carried:false,hx:0,hy:0,hz:0};
 if(blob&&BLOB.ready){
  key=createKey({S,BLOB,origin:blob.origin,scale:BLOB_SCALE,sea:seaPP,wind,hgt:(x,z,tt)=>PP.hgt(x,z,tt)});
  portal=createPortal({S,city});
  drone.claw.targets.key=key;_pc.tip=drone.clawTip;
  if(portal)log.info(`boot: portal at (${portal.center.x.toFixed(0)},${portal.center.y.toFixed(0)},${portal.center.z.toFixed(0)})`);
 }
 // the claw can carry the operator even when the colony failed to boot: no key, no door, but a body
 drone.claw.targets.human=human;
 // Tab: switch bodies. Camera flies along an arc; the idle body keeps living.
 let body='drone'; // 'drone' | 'human'
 let zoom=0;       // wheel: 0 = FPV, 1 = behind and above the active body
 let switchT=-1;   // arc animation clock, -1 = idle
 const switchArc={p:new THREE.Vector3(),q:new THREE.Quaternion()};
 const state={run:false};
 addEventListener('keydown',e=>{
  if(e.code==='Tab'){e.preventDefault();
   // switching to the human requires the human to exist (WASM core up);
   // without it human===null and the camera arc would dereference null.root
   if(switchT<0&&state.run&&!(body==='drone'&&!human)){switchT=0;body=body==='drone'?'human':'drone';
    drone.setActive&&drone.setActive(body==='drone');
    if(human)human.setActive(body==='human');
   }}
 },{signal});

 createOverlay({signal,canvas:R.domElement,onStart(){audio.start();state.run=true;log.info('run: started')},onPause(){state.run=false;log.info('run: paused')}});
 document.addEventListener('visibilitychange',()=>{if(state.run)audio.setSuspended(document.hidden)},{signal});

 const clock=new THREE.Clock();let t=0,raf=0;
 // uniform time wrap: t grows unbounded in f64 (JS), but the shader and pp_step see f32.
 // Wrap at 3600 s so ω·t never loses f32 precision (phase jump once per hour, unnoticeable).
 const T_WRAP=3600;
 function frame(){const dt=Math.min(clock.getDelta(),.05),sdt=state.run?dt:dt*.2;
  t+=sdt;const tw=t%T_WRAP;
  /* one world: wind -> sea, clouds, rain, both bodies */
  wind.update(sdt,tw);updateSea(sdt,wind);
  // drift is a VELOCITY (~3% of wind): integrate into an offset for the shader,
  // which samples foam noise at (p - uDrift). Raw velocity made foam jump ~0.4 m/frame.
  seaU.uniforms.uDrift.value.x+=sea.drift.x*sdt;seaU.uniforms.uDrift.value.y+=sea.drift.z*sdt;
  const cr=wind.u10/wind.U0*sdt;fogU.uCloud.value.x+=Math.cos(wind.dir)*cr;fogU.uCloud.value.y+=Math.sin(wind.dir)*cr;
  if(state.run&&!won){
   zoom=Math.max(0,Math.min(1,zoom+input.zoom));drone.zoom=zoom;if(human)human.zoom=zoom;
   drone.claw.targets.t=tw;drone.claw.targets.vel=drone.vel; // a dropped key keeps the drone's velocity
   // both bodies always step; input goes to the active one
   drone.load=human&&human.carried?1+80/60:1; // set BEFORE the step: a load applied a frame late is a free frame of thrust
   drone.step(dt,tw);const {pos,vel,wind:dw,out}=drone;
   // the operator steps AFTER the drone: the claw tip he hangs from is this frame's, not the last one's
   if(human){
    const active=body==='human';
    const carried=human.carried,live=active&&!carried; // a carried operator cannot act
    const inp=live?input.human():{fwd:0,side:0,run:false,jump:false,crouch:false};
    if(carried&&drone.claw.holding==='op')human.carryTo(drone.clawTip,drone.vel);
    // Like the drone: consume the accumulated mouse delta and ADD it to the
    // body's own absolute yaw/pitch. input.yaw is a DELTA (mouse movement),
    // human.yaw is the ABSOLUTE course — never overwrite one with the other.
    if(active&&carried){input.yaw;input.pitch;input.look.yaw=0;input.look.pitch=0} // drain the mouse: a carried body must not bank a delta for the moment it is dropped
    else if(active){human.yaw+=input.yaw;human.pitch=Math.max(-1.45,Math.min(1.45,human.pitch+input.pitch));input.look.yaw=0;input.look.pitch=0}
    if(!carried)human.crouch=inp.crouch;
    human.step(dt,tw,{fwd:inp.fwd,side:inp.side,run:inp.run,jump:inp.jump});
   }
   let aLoad=Math.hypot(drone.accel.x,drone.accel.y,drone.accel.z); // the drone's own flying, blob or not
   if(blob){ // world -> local (divide by scale), step, reaction back to world (multiply)
    const o=blob.origin,k=1/BLOB_SCALE;
    if((bfr++%10)===0){const lst=[];for(const b of city.bl){const dx=b.x-o.x,dz=b.z-o.z,d=dx*dx+dz*dz;if(d<160000)lst.push([d,b]);}lst.sort((a,b)=>a[0]-b[0]);blobObstacles(lst.length>64?lst.slice(0,64).map(e=>e[1]):lst.map(e=>e[1]),o,BLOB_SCALE);}
    _bw.x=dw.x*k;_bw.y=dw.y*k;_bw.z=dw.z*k;_bw.g=dw.g;
    _b0.x=(pos.x-o.x)*k;_b0.y=(pos.y-o.y)*k;_b0.z=(pos.z-o.z)*k;_b0.r=1.4*k;
    _b0.vx=vel.x*k;_b0.vy=vel.y*k;_b0.vz=vel.z*k;
    if(human){_b1.x=(human.pos.x-o.x)*k;_b1.y=(human.pos.y-o.y)*k;_b1.z=(human.pos.z-o.z)*k;_b1.r=0.4*k;
     _b1.vx=human.vel.x*k;_b1.vy=human.vel.y*k;_b1.vz=human.vel.z*k;}
    blobInput(_bw,(hgtJS(o.x,o.z,tw)-o.y)*k,_b0,human?_b1:null);
    BLOB.step(dt,tw);
    // the colony is solid for the drone: push-out, then the viscosity of the medium.
    // 1.4 m capsule radius, not 0.5: the body is sparse (~4 m between cells).
    blobCollide(pos,vel,1.4,o,BLOB_SCALE);
    const nc=blobDrag(pos,vel,1.4,o,BLOB_SCALE,dt,held>6?Math.max(0,1-(held-6)/2):1);
    held = nc>0 ? held+dt : 0;
    const m=BLOB.meta; // m[11..13] = reaction acceleration on body0, local units
    // clamp in world units: adhesion must stay below the drone thrust (38 m/s^2)
    const rx=Math.max(-30,Math.min(30,m[11]*BLOB_SCALE)),ry=Math.max(-30,Math.min(30,m[12]*BLOB_SCALE)),rz=Math.max(-30,Math.min(30,m[13]*BLOB_SCALE));
    vel.x+=rx*dt;vel.y+=ry*dt;vel.z+=rz*dt;
    // claw load: the drone's own flying (thrust, wind, walls) plus the entity's clamped adhesion.
    // blobDrag is the medium, not a load: the entity alone can slow the drone but never make it drop the key.
    aLoad=Math.hypot(drone.accel.x+rx,drone.accel.y+ry,drone.accel.z+rz);
    blob.update(tw);
    if(key){
     key.step(dt,tw,drone.clawTip);
     _pc.keyGrabbed=key.state===1;_pc.carried=!!(human&&human.carried);
     if(human){_pc.hx=human.pos.x;_pc.hy=human.pos.y+0.85;_pc.hz=human.pos.z}
     if(portal){const ev=portal.update(dt,_pc);
      if(ev.opened){key.consume();drone.claw.release('portal')} // the key is spent, the claw opens
      if(ev.won)won=true;}
    }
   }
   drone.claw.check(aLoad,drone.hitA); // the claw slips on overload with or without the colony
   // camera follows the active body; during Tab the arc flies between them
   if(switchT>=0&&human){ // arc only when both bodies exist
    switchT+=dt*1.6;
    const k=Math.min(switchT,1),e=k*k*(3-2*k);
    const from=body==='human'?drone.pos:human.root.position;
    const to=body==='human'?human.root.position:drone.pos;
    switchArc.p.lerpVectors(from,to,e);
    switchArc.p.y+=Math.sin(k*Math.PI)*6; // arc over the rooftops
    cam.position.copy(switchArc.p);
    if(switchT>=1)switchT=-1;
   }
   if(body==='drone'){
    sky.position.copy(pos);ocean.position.set(Math.round(pos.x/5)*5,0,Math.round(pos.z/5)*5);
    audio.update(dt,tw,out.sp,out.gust,pos.y-out.wh,drone.shk);
    rain.update(dt,pos,vel,dw,out.gust);
   } else if(human){
    const hp=human.pos,hv=human.vel;
    // alt ABOVE the water surface (audio fades with altitude over the sea, not absolute y)
    audio.update(dt,tw,Math.hypot(hv.x,hv.z),wind.g,hp.y-hgtJS(hp.x,hp.z,tw),human.waveHit);
    rain.update(dt,{x:hp.x,y:hp.y+1.6,z:hp.z},hv,wind,wind.g);
    sky.position.set(hp.x,hp.y,hp.z);ocean.position.set(Math.round(hp.x/5)*5,0,Math.round(hp.z/5)*5);
   }
  }else{ // paused: hold the last camera, keep the world breathing, no bodies step
   if(body==='drone'){drone.idle();sky.position.copy(drone.pos);
    // never leave the camera inside the drone skin (neuro-slop on ESC):
    // lift the view a little above the hull while paused
    cam.position.y+=0.6;
   } // human active: keep the last human camera exactly where it was
  }
  if(won&&portal)portal.update(dt,_pc); // the veil keeps fading after the run is frozen
  atmo.update(tw);T.value=tw;city.update(tw,sdt);
  // the FPV camera sits at the body centre: keep it out of the walls
  city.camPush(cam.position,0.6);
  R.render(S,cam);raf=requestAnimationFrame(frame)}
 frame();

 if(import.meta.hot){import.meta.hot.accept();import.meta.hot.dispose(()=>{
  cancelAnimationFrame(raf);ac.abort();tex.dispose();seaU.dispose();audio.close();
  if(document.pointerLockElement)document.exitPointerLock();disposeStage(stage)})}
}
boot();