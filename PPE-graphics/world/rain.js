import * as THREE from 'three';
import {vn} from '../sim/wind.js';
/**
 * Rain follows the wind: a drop reaches air speed with inertia (~0.35 s), so tilt = wind / fall speed,
 * changes in gusts and behind towers; downpour bands (dense/sparse patches) ride the same wind; brightness grows with gust.
 */
export function createRain(S){
const rn=Math.random,NR=3200,FALL=22;
const hp=new Float32Array(NR*3),rp=new Float32Array(NR*6),rc=new Float32Array(NR*6);
for(let i=0;i<NR;i++){hp[i*3]=(rn()-.5)*80;hp[i*3+1]=(rn()-.5)*50;hp[i*3+2]=(rn()-.5)*80}
const rg=new THREE.BufferGeometry();
rg.setAttribute('position',new THREE.BufferAttribute(rp,3).setUsage(THREE.DynamicDrawUsage));
rg.setAttribute('color',new THREE.BufferAttribute(rc,3).setUsage(THREE.DynamicDrawUsage));
const mat=new THREE.LineBasicMaterial({color:0xaab4bb,vertexColors:true,transparent:true,opacity:.3,fog:false});
const rain=new THREE.LineSegments(rg,mat);rain.frustumCulled=false;S.add(rain);
const dv=new THREE.Vector3(),rv=new THREE.Vector3(),adv={x:0,z:0};let first=true;
function update(dt,pos,vel,wind,gust){
 // wind.x/y/z may be missing on a shim without a live at() (e.g. before the first frame):
 // never let NaN into the drop velocities — hold the last valid field instead.
 const wx=Number.isFinite(wind.x)?wind.x:dv.x, wy=Number.isFinite(wind.y)?wind.y:dv.y, wz=Number.isFinite(wind.z)?wind.z:dv.z;
 if(first){dv.set(wx,-FALL,wz);first=false}
 const k=1-Math.exp(-dt/.35);dv.x+=(wx-dv.x)*k;dv.z+=(wz-dv.z)*k;dv.y+=(-FALL+wy*.6-dv.y)*k;
 adv.x+=dv.x*.9*dt;adv.z+=dv.z*.9*dt;rv.copy(dv).sub(vel);mat.opacity=.22+.2*gust;
 for(let i=0;i<NR;i++){let x=hp[i*3]+rv.x*dt,y=hp[i*3+1]+rv.y*dt,z=hp[i*3+2]+rv.z*dt;
  if(x>40)x-=80;else if(x<-40)x+=80;if(y>25)y-=50;else if(y<-25)y+=50;if(z>40)z-=80;else if(z<-40)z+=80;
  hp[i*3]=x;hp[i*3+1]=y;hp[i*3+2]=z;const o=i*6,wx=pos.x+x-adv.x,wz=pos.z+z-adv.z;
  rp[o]=pos.x+x;rp[o+1]=pos.y+y;rp[o+2]=pos.z+z;rp[o+3]=rp[o]-rv.x*.04;rp[o+4]=rp[o+1]-rv.y*.04;rp[o+5]=rp[o+2]-rv.z*.04;
  const c=Math.min(1,.35+1.1*(vn(wx/55,wz/55)*.7+vn(wx/17+9,wz/17)*.3));      // wind-carried downpour bands
  rc[o]=rc[o+1]=rc[o+2]=c;rc[o+3]=rc[o+4]=rc[o+5]=c*.35}
 rg.attributes.position.needsUpdate=true;rg.attributes.color.needsUpdate=true;
}
return {update};
}
