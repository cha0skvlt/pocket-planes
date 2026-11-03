/**
 * Wind (plain JS). One field for the drone, rain, clouds and sea:
 *  - mean 10 m wind: speed and direction breathe slowly (squalls, lulls, meander);
 *  - logarithmic profile over height (weaker near water, stronger at tower height);
 *  - gusts are patches advected by the wind itself;
 *  - buildings: stagnation and upwash in front of a wall, accelerated flow around the sides, a sheltered turbulent wake behind a tower.
 */
const TAU=Math.PI*2,TH0=Math.atan2(.6,.8),U0=12,Z0=.02,LN10=Math.log(10/Z0);
function hash(ix,iz){let h=Math.imul(ix,374761393)^Math.imul(iz,668265263);h=Math.imul(h^h>>>13,1274126177);return((h^h>>>16)>>>0)/4294967296}
export function vn(x,z){const ix=Math.floor(x),iz=Math.floor(z),fx=x-ix,fz=z-iz,sx=fx*fx*(3-2*fx),sz=fz*fz*(3-2*fz);
 const a=hash(ix,iz),b=hash(ix+1,iz),c=hash(ix,iz+1),d=hash(ix+1,iz+1);return(a+(b-a)*sx)*(1-sz)+(c+(d-c)*sx)*sz}
const sm=(a,b,x)=>{const t=Math.min(1,Math.max(0,(x-a)/(b-a)));return t*t*(3-2*t)};
const acc={k:0,n:0,dy:0,t:0};
function wake(b,x,y,z,cx,cz){
 const dx=x-b.x,dz=z-b.z,s=dx*cx+dz*cz,c=dz*cx-dx*cz,ac=Math.abs(cx),as=Math.abs(cz),ay=Math.abs(c);
 const Wp=b.hw*as+b.hd*ac,Lp=b.hw*ac+b.hd*as;                       // half-width across the wind / half-length along the wind
 if(s>Lp+14*Wp||s<-Lp-5*Wp||ay>Wp*3.5)return;
 const fh=1-sm(b.top,b.top+.6*Wp,y);if(fh<=0)return;               // above the roof the wake disappears
 if(s>Lp){const d=.75*Math.exp(-(s-Lp)/(3.5*Wp))*Math.exp(-((c/(.85*Wp))**2))*fh;acc.k-=d;acc.t+=.25*d;acc.dy-=.12*d}
 else if(s<-Lp){const st=Math.exp(-(-s-Lp)/(1.3*Wp))*Math.exp(-((c/(1.1*Wp))**2))*fh;acc.k-=.4*st;acc.dy+=.5*st}
 if(ay>Wp*.9&&s>-Lp*1.2&&s<Lp*3+3*Wp){const f=Math.exp(-(ay-Wp)/(.8*Wp))*fh;acc.k+=.18*f;acc.n+=Math.sign(c)*.4*f}}

export function createWind(){
 const last={x:0,y:0,z:0}; // last at() result — rain.js reads wind.x/y/z per drop
 const W={u10:U0,dir:TH0,g:.5,t:0,adv:{x:0,z:0},obst:[],U0,
  get x(){return last.x},get y(){return last.y},get z(){return last.z},
  setObstacles(list){W.obst=list},
  update(dt,t){W.t=t;W.u10=U0*(1+.22*Math.sin(TAU*t/410)+.1*Math.sin(TAU*t/97));
   W.dir=TH0+.3*Math.sin(TAU*t/530)+.12*Math.sin(TAU*t/151);
   W.adv.x+=Math.cos(W.dir)*W.u10*.85*dt;W.adv.z+=Math.sin(W.dir)*W.u10*.85*dt},
  /** Wind vector (m/s) at a point; out is any object with x,y,z (e.g. THREE.Vector3). W.g in [0,1] - gustiness. */
  at(x,y,z,out){const t=W.t,ax=x-W.adv.x,az=z-W.adv.z;
   const g1=vn(ax/240,az/240),g2=vn(ax/90+17.3,az/90-4.1),g=.65*g1+.35*g2;
   const U=W.u10*(1+.7*(g-.5))*Math.log(Math.max(y,.5)/Z0)/LN10,th=W.dir+.5*(g1-.5),cx=Math.cos(th),cz=Math.sin(th);
   acc.k=acc.n=acc.dy=acc.t=0;
   for(const b of W.obst){if(Math.abs(b.x-x)>260||Math.abs(b.z-z)>260)continue;wake(b,x,y,z,cx,cz)}
   const f=Math.max(.15,1+acc.k),sg=U*(.05+.06*Math.max(0,g-.4)+acc.t);
   out.x=U*cx*f-cz*acc.n*U+sg*(Math.sin(2.3*t+.11*x+.05*z)+.7*Math.sin(5.1*t+.23*z+1));
   out.z=U*cz*f+cx*acc.n*U+sg*(Math.sin(2.9*t+.09*z+.04*x+2)+.7*Math.sin(4.3*t+.19*x));
   out.y=acc.dy*U+sg*.6*(Math.sin(3.7*t+.17*(x+z))+.5*Math.sin(7.3*t+.3*x));
   last.x=out.x;last.y=out.y;last.z=out.z;
   W.g=Math.min(1,g+acc.t*1.2)}};
 return W}
