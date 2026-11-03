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
import {createWind as createWindJS} from './sim/wind.js';
import {sea as seaJS,updateSea as updateSeaJS} from './sim/sea.js';

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
  human.spawn(roof.x,roof.top,roof.z,0.64);
  human.setActive(false); // start as the drone
  log.info(`boot: human spawned on roof (${roof.x.toFixed(0)},${roof.top.toFixed(0)},${roof.z.toFixed(0)})`);
 }
 // Tab: switch bodies. Camera flies along an arc; the idle body keeps living.
 let body='drone'; // 'drone' | 'human'
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
 function frame(){const dt=Math.min(clock.getDelta(),.05),sdt=state.run?dt:dt*.2;
  t+=sdt;
  /* one world: wind -> sea, clouds, rain, both bodies */
  wind.update(sdt,t);updateSea(sdt,wind);seaU.uniforms.uDrift.value.set(sea.drift.x,sea.drift.z);
  const cr=wind.u10/wind.U0*sdt;fogU.uCloud.value.x+=Math.cos(wind.dir)*cr;fogU.uCloud.value.y+=Math.sin(wind.dir)*cr;
  if(state.run){
   // both bodies always step; input goes to the active one
   if(human){
    const active=body==='human';
    const inp=active?input.human():{fwd:0,side:0,run:false,jump:false,crouch:false};
    // Like the drone: consume the accumulated mouse delta and ADD it to the
    // body's own absolute yaw/pitch. input.yaw is a DELTA (mouse movement),
    // human.yaw is the ABSOLUTE course — never overwrite one with the other.
    if(active){human.yaw+=input.yaw;human.pitch=Math.max(-1.45,Math.min(1.45,human.pitch+input.pitch));input.look.yaw=0;input.look.pitch=0}
    human.crouch=inp.crouch;
    human.step(dt,t,{fwd:inp.fwd,side:inp.side,run:inp.run,jump:inp.jump});
   }
   drone.step(dt,t);const {pos,vel,wind:dw,out}=drone;
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
    sky.position.copy(pos);ocean.position.set(Math.round(pos.x/4)*4,0,Math.round(pos.z/4)*4);
    audio.update(dt,t,out.sp,out.gust,pos.y-out.wh,drone.shk);
    rain.update(dt,pos,vel,dw,out.gust);
   } else if(human){
    const hp=human.pos,hv=human.vel;
    audio.update(dt,t,Math.hypot(hv.x,hv.z),wind.g,hp.y+1.6,human.waveHit);
    rain.update(dt,{x:hp.x,y:hp.y+1.6,z:hp.z},hv,wind,human.waveHit);
    sky.position.set(hp.x,0,hp.z);ocean.position.set(Math.round(hp.x/4)*4,0,Math.round(hp.z/4)*4);
   }
  }else{ // paused: hold the last camera, keep the world breathing, no bodies step
   if(body==='drone'){drone.idle();sky.position.copy(drone.pos);
    // never leave the camera inside the drone skin (neuro-slop on ESC):
    // lift the view a little above the hull while paused
    cam.position.y+=0.6;
   } // human active: keep the last human camera exactly where it was
  }
  atmo.update(t);T.value=t;city.update(t,sdt);
  R.render(S,cam);raf=requestAnimationFrame(frame)}
 frame();

 if(import.meta.hot){import.meta.hot.accept();import.meta.hot.dispose(()=>{
  cancelAnimationFrame(raf);ac.abort();tex.dispose();seaU.dispose();audio.close();
  if(document.pointerLockElement)document.exitPointerLock();disposeStage(stage)})}
}
boot();