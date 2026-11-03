// Dump of reference sea.js values for the cargo test golden_state_matches_js_dump.
// Run: node test/dump_golden.mjs > PPE-physics/tests/golden.json
import {sea,updateSea,hgt} from '../PPE-graphics/sim/sea.js';
updateSea(0,{u10:12,dir:Math.atan2(.6,.8)});
const pts=[];
for(let i=0;i<20;i++){const x=(i*137.3)%800-400,z=((i*91.7)%800+400)%800-400,t=i*5.3;
 pts.push({x,z,t,h:hgt(x,z,t)})}
const out={w1:[...sea.w1],w2:[...sea.w2],w3:[...sea.w3],ratio:[...sea.ratio],hgt:pts};
console.log(JSON.stringify(out));