// Dump of reference sea.js values for the cargo test golden_state_matches_js_dump.
// Run: node test/dump_golden.mjs > PPE-physics/tests/golden.json
import {sea,updateSea,hgt} from '../PPE-graphics/sim/sea.js';
import {createWind} from '../PPE-graphics/sim/wind.js';
updateSea(0,{u10:12,dir:Math.atan2(.6,.8)});
const pts=[];
for(let i=0;i<20;i++){const x=(i*137.3)%800-400,z=((i*91.7)%800+400)%800-400,t=i*5.3;
 pts.push({x,z,t,h:hgt(x,z,t)})}
// ABI guard (B1): run the JS reference wind for 600 s of variable-dt steps and
// dump the clock state. The Rust test asserts wind.t == accumulated sim time and
// u10 stays inside the breathing range — catches pp_step(dt, u10) ABI drift.
const wind=createWind();
let t=0,dtAcc=0;
for(let i=0;i<6000;i++){const dt=0.05+0.05*Math.sin(i*0.7);t+=dt;wind.update(dt,t);dtAcc+=dt;}
const out={w1:[...sea.w1],w2:[...sea.w2],w3:[...sea.w3],ratio:[...sea.ratio],hgt:pts,
 wind:{t,dtAcc,u10:wind.u10,dir:wind.dir}};
console.log(JSON.stringify(out));