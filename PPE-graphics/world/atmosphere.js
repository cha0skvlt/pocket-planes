/** Moon, cloud cover (vis), scene lighting and lightning. */
export const CFG={lightning:false};
/* lightning: kept as a function, off by default; the L key toggles it */
export function lightning(t){return CFG.lightning?Math.pow(Math.max(Math.sin(t*.31+Math.sin(t*.17)*2)*Math.sin(t*.083+1.3),0),14)*(.6+.4*Math.sin(t*23)):0}
export function createAtmosphere({rift,fogU,lights},signal){
 const {hl,dl}=lights;
 addEventListener('keydown',e=>{if(e.code==='KeyL')CFG.lightning=!CFG.lightning},{signal});
 function update(t){
 /* moon: slow arc across the sky; vis — how much light the clouds currently let through */
 const az=-.35+Math.sin(t*.0045)*1.2,el=.34+.14*Math.sin(t*.0031+1),vis=Math.min(1,Math.max(0,.75+.9*Math.sin(t*.0123)*Math.cos(t*.0057+.7))),fl=lightning(t);
 rift.set(Math.sin(az)*Math.cos(el),Math.sin(el),-Math.cos(az)*Math.cos(el));
 fogU.vis.value=vis;fogU.flash.value=fl;dl.position.copy(rift).multiplyScalar(100);dl.color.setRGB(.8,.88,1);dl.intensity=.2+.7*vis;hl.intensity=.85+.3*vis+fl*.5;
 }
 return {update};
}
