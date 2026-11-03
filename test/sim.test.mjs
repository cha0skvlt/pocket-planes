
// Run: npm test (plain Node, no browser). This is also the reference for the Rust core.
import {sea,updateSea,hgt,sampleMod,MOD,TH0} from '../PPE-graphics/sim/sea.js';
import {createWind,vn} from '../PPE-graphics/sim/wind.js';
let bad=0;const ok=(c,m)=>{console.log((c?'  ok  ':'  FAIL')+' '+m);if(!c)bad++};
const cs=(a,b)=>a.map((v,i)=>v*b[i]).reduce((x,y)=>x+y,0);

// 1. waves run downwind (cross-correlation along the wind)
{const dx=Math.cos(TH0),dz=Math.sin(TH0),line=t=>Array.from({length:400},(_,i)=>hgt(dx*i*2,dz*i*2,t));
 const a=line(10),b=line(10.5);let best=-9,arg=0;for(let s=-12;s<=12;s++){const sh=b.map((_,i)=>b[Math.min(399,Math.max(0,i+s))]);const c=cs(a,sh);if(c>best){best=c;arg=s}}
 ok(arg>0,`crests shift downwind (${arg*2} m per 0.5 s)`)}

// 2. sea statistics close to the original (rms over 20000 points)
{let s=0;const n=20000;for(let i=0;i<n;i++){const h=hgt((Math.random()-.5)*800,(Math.random()-.5)*800,Math.random()*100);s+=h*h}
 const rms=Math.sqrt(s/n);ok(rms>.9&&rms<4.5,`rms height ${rms.toFixed(2)} m within sane bounds`)}

// 3. modulation field: normalized and tiling
{let m=0;for(let i=0;i<MOD.length;i+=4)m+=MOD[i];m/=MOD.length/4*255;
 ok(Math.abs(m-.5)<.03,`group envelope: mean ${m.toFixed(3)} ~ 0.5`);
 const a=sampleMod(.3,.7).slice(),b=sampleMod(1.3,-.3).slice();ok(Math.abs(a[0]-b[0])<1e-9&&Math.abs(a[1]-b[1])<1e-9,'modulation tiles seamlessly')}

// 4. sea response to wind: stronger wind grows long waves; swell never vanishes instantly; direction follows
{const base=sea.ratio[0];for(let i=0;i<900;i++)updateSea(1,{u10:16,dir:TH0+.5});
 ok(sea.ratio[0]>base*1.3,`at 16 m/s wind the long wave grows (x${sea.ratio[0].toFixed(2)})`);
 ok(Math.abs(sea.th-(TH0+.5))<.05,`sea direction caught up with the wind (${(sea.th-TH0).toFixed(2)} rad)`);
 for(let i=0;i<30;i++)updateSea(1,{u10:6,dir:TH0});ok(sea.ratio[0]>=.45,'after a sudden calm the swell does not vanish (clamped >= 0.45)')}

// 5. wind: mean at 10 m, profile, gustiness
{const W=createWind(),o={x:0,y:0,z:0};let s=0,n=0;
 for(let t=0;t<20000;t+=5){W.update(5,t);s+=W.u10;n++}ok(Math.abs(s/n-12)<1,`mean wind ${(s/n).toFixed(1)} m/s`);
 W.update(0,0);const sp=y=>{W.at(300,y,300,o);return Math.hypot(o.x,o.z)};
 ok(sp(2)<sp(10)&&sp(10)<sp(100),`profile grows with height: ${sp(2).toFixed(1)} < ${sp(10).toFixed(1)} < ${sp(100).toFixed(1)}`)}

// 6. building: wake behind the tower, stagnation/upwash in front, side flow (60 s average to remove turbulence)
{const W=createWind(),o={x:0,y:0,z:0},cx=Math.cos(TH0),cz=Math.sin(TH0),b={x:0,z:0,hw:15,hd:12,top:100};
 const Wp=b.hw*Math.abs(cz)+b.hd*Math.abs(cx),Lp=b.hw*Math.abs(cx)+b.hd*Math.abs(cz);
 const P=(s,c,y)=>[s*cx-c*cz,s*cz+c*cx,y];   // (along wind, across, height) -> (x,z,y)
 const avg=(p,list,f)=>{W.setObstacles(list);let a=0;for(let t=0;t<60;t++){W.update(0,t);W.at(p[0],p[2],p[1],o);a+=f(o)}return a/60};
 const sp=o=>Math.hypot(o.x,o.z),up=o=>o.y;
 let p=P(Lp+.5*Wp,0,40);const wk=avg(p,[b],sp),fr=avg(p,[],sp);ok(wk<fr*.6,`behind the tower the wind is weaker: ${wk.toFixed(1)} vs ${fr.toFixed(1)} m/s`);
 p=P(-(Lp+.3*Wp),0,40);const u=avg(p,[b],up);ok(u>2,`in front of the wall the flow goes up (${u.toFixed(1)} m/s)`);
 p=P(0,1.2*Wp,40);const fl=avg(p,[b],sp),ff=avg(p,[],sp);ok(fl>ff*1.03,`beside the tower the flow speeds up (${fl.toFixed(1)} vs ${ff.toFixed(1)})`);
 p=P(Lp+.5*Wp,0,160);const ab=avg(p,[b],sp),af=avg(p,[],sp);ok(ab>af*.9,'above the roof the wake disappears')}

// 7. gust noise: range and mean
{let m=0,mn=1,mx=0;for(let i=0;i<5000;i++){const v=vn(i*.37,i*.91);m+=v;mn=Math.min(mn,v);mx=Math.max(mx,v)}ok(mn>=0&&mx<=1&&Math.abs(m/5000-.5)<.05,'vn: values in [0,1], mean ~0.5')}
console.log(bad?`\n${bad} FAILED`:'\nall tests passed');process.exit(bad?1:0);
