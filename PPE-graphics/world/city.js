import * as THREE from 'three';
import {BufferGeometryUtils} from 'three/examples/jsm/utils/BufferGeometryUtils.js';
const mergeBufferGeometries = BufferGeometryUtils.mergeBufferGeometries.bind(BufferGeometryUtils);
import {hgt} from './waves.js';
/** City: deterministic seeded layout, merged static geometry, foam and beacons. */
export function createCity(S,{wt,ft}){
const wallM=new THREE.MeshStandardMaterial({map:wt,roughness:.95,metalness:0}),roofM=new THREE.MeshStandardMaterial({color:0x2e3133,roughness:1}),
 foamM=new THREE.MeshBasicMaterial({map:ft,transparent:true,depthWrite:false,color:new THREE.Color(.5,.55,.58),side:THREE.DoubleSide}),
 antM=new THREE.MeshStandardMaterial({color:0x1b1d1f,roughness:.8}),
 beac=[0,1,2].map(()=>new THREE.MeshBasicMaterial({color:0xff2a1a}));
let seed=7;const rnd=()=>{seed|=0;seed=seed+0x6D2B79F5|0;let t=Math.imul(seed^seed>>>15,1|seed);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296};
const bl=[],spec=[[0,-70,32,24,62],[-72,-25,24,24,46],[64,35,24,32,40]];
const wallG=[],roofG=[],antG=[],beaG=[[],[],[]],BCOL=new THREE.Color(1,.15,.08);
const gRoof=new THREE.BoxGeometry(1,5,1),gAnt=new THREE.CylinderGeometry(.12,.2,1,5),gBea=new THREE.SphereGeometry(.7,8,6);
function add(x,z,w,d,fl){const bi=bl.length%3,H=fl*3.2,top=H-20,g=new THREE.BoxGeometry(w,H,d),uv=g.attributes.uv;
 for(let i=0;i<24;i++){const side=i<8?d:(i>=16?w:0);if(side){uv.setX(i,uv.getX(i)*side/16);uv.setY(i,uv.getY(i)*fl/8)}}
 g.translate(x,top-H/2,z);
 const ix=g.index.array,wi=new Uint16Array(24);wi.set(ix.subarray(0,12));wi.set(ix.subarray(24,36),12);
 const part=idx=>{const p=new THREE.BufferGeometry();['position','normal','uv'].forEach(n=>p.setAttribute(n,g.attributes[n]));p.setIndex(new THREE.BufferAttribute(idx,1));return p};
 wallG.push(part(wi));roofG.push(part(ix.slice(12,24)));
 roofG.push(gRoof.clone().scale(w*.35,1,d*.35).translate(x+w*.1,top+2.5,z));
 for(let k=0;k<3;k++){const hh=10+rnd()*14,ax=x+(rnd()-.5)*w*.6,az=z+(rnd()-.5)*d*.6;antG.push(gAnt.clone().scale(1,hh,1).translate(ax,top+8,az))}
 beaG[bi].push(gBea.clone().translate(x,top+22,z));
 const fg=new THREE.BoxGeometry(w+1,14,d+1),fu=fg.attributes.uv;for(let i=0;i<24;i++){fu.setX(i,fu.getX(i)*((i<8?d:w)/18))}
 fg.clearGroups();fg.setIndex(new THREE.BufferAttribute(wi.slice(),1));
 const fm=new THREE.Mesh(fg,foamM);fm.renderOrder=2;S.add(fm);
 bl.push({x,z,hw:w/2,hd:d/2,top,fm,ph:rnd()*6})}
function finalizeCity(){
 const mk=(list,mat)=>{const m=new THREE.Mesh(mergeBufferGeometries(list),mat);S.add(m);list.forEach(g=>g.dispose());list.length=0};
 mk(wallG,wallM);mk(roofG,roofM);mk(antG,antM);beaG.forEach((l,i)=>mk(l,beac[i]));
 [gRoof,gAnt,gBea].forEach(g=>g.dispose())}
spec.forEach(s=>add(...s));
for(let n=0;bl.length<95&&n<4000;n++){const r=60+Math.pow(rnd(),1.35)*640,a=rnd()*6.283,x=Math.sin(a)*r,z=Math.cos(a)*r,w=8*(2+(rnd()*3|0)),d=8*(2+(rnd()*3|0)),fl=14+(rnd()*48|0);
 if(Math.hypot(x,z-140)<50)continue;
 if(bl.some(b=>Math.abs(x-b.x)<b.hw+w/2+30&&Math.abs(z-b.z)<b.hd+d/2+30))continue;add(x,z,w,d,fl)}

finalizeCity();
function collide(pos,vel){let s=0;
 // AABB push-out, no margin, no roof pops: the drone bounces off walls by its
 // own inertia; landing on a roof is physics (low vertical speed), not collision.
 for(const b of bl){const dx=pos.x-b.x,dz=pos.z-b.z;if(pos.y<b.top&&Math.abs(dx)<b.hw&&Math.abs(dz)<b.hd){
  const px=b.hw-Math.abs(dx),pz=b.hd-Math.abs(dz),py=b.top-pos.y;
  if(py<px&&py<pz){s+=Math.min(1,Math.abs(vel.y)*.03);pos.y+=py;vel.y=Math.max(vel.y,0)*.3}
  else if(px<pz){s+=Math.min(1,Math.abs(vel.x)*.03);pos.x+=Math.sign(dx)*px;vel.x*=-.25}
  else{s+=Math.min(1,Math.abs(vel.z)*.03);pos.z+=Math.sign(dz)*pz;vel.z*=-.25}}}
 return s}
function update(t,dt){
 const k=1-Math.exp(-5*dt);   // wall foam: splash height follows the water rise speed at the building (wave impact)
 for(const b of bl){const h=hgt(b.x,b.z,t),v=b.h0===undefined?0:(h-b.h0)/Math.max(dt,1e-3);b.h0=h;
  const tg=.8+Math.max(-.35,Math.min(.9,v*.2));b.sy=b.sy===undefined?.8:b.sy+(tg-b.sy)*k;b.fm.position.set(b.x,h+3,b.z);b.fm.scale.y=b.sy}
 beac.forEach((m,i)=>m.color.setScalar(Math.sin(t*3+i*2.1)>.55?1:.05).multiply(BCOL));
}
return {bl,beac,collide,update};
}
