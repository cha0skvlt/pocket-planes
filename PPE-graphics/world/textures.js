import * as THREE from 'three';
/** Procedural textures: facades and foam. */
export function createTextures(R){
const mc=(w,h)=>{const c=document.createElement('canvas');c.width=w;c.height=h;return c};
const rn=Math.random;
const wc=mc(256,512),g=wc.getContext('2d');
g.fillStyle='#5b5e60';g.fillRect(0,0,256,512);
for(let i=0;i<7000;i++){g.fillStyle=rn()<.5?'rgba(0,0,0,.07)':'rgba(255,255,255,.05)';g.fillRect(rn()*256,rn()*512,2,2)}
for(let f=0;f<8;f++){const y=f*64;
 g.fillStyle='#46494b';g.fillRect(0,y+50,256,14);g.fillStyle='#7d8081';g.fillRect(0,y+48,256,3);g.fillStyle='rgba(0,0,0,.35)';g.fillRect(0,y+60,256,4);
 for(let c=0;c<4;c++){const x=c*64+10;g.fillStyle='#0f1316';g.fillRect(x,y+9,44,34);
  const gr=g.createLinearGradient(x,y+9,x+44,y+43);gr.addColorStop(0,'rgba(130,145,155,.28)');gr.addColorStop(1,'rgba(0,0,0,0)');g.fillStyle=gr;g.fillRect(x,y+9,44,34);
  const q=rn();if(q<.07){g.fillStyle='#2b2f2a';g.fillRect(x,y+9,16+rn()*20,34)}else if(q<.09){g.fillStyle='rgba(150,125,70,.45)';g.fillRect(x+3,y+12,38,28)}
  g.strokeStyle='#3a3d3f';g.lineWidth=2;g.strokeRect(x,y+9,44,34);g.beginPath();g.moveTo(x+22,y+9);g.lineTo(x+22,y+43);g.stroke();
  if(rn()<.18){g.fillStyle='#8c9091';g.fillRect(x+30,y+36,12,9)}}}
for(let i=0;i<40;i++){const x=rn()*256,y=rn()*400,gr=g.createLinearGradient(0,y,0,y+160);gr.addColorStop(0,'rgba(0,0,0,.28)');gr.addColorStop(1,'rgba(0,0,0,0)');g.fillStyle=gr;g.fillRect(x,y,2+rn()*5,160)}
const wt=new THREE.CanvasTexture(wc);wt.wrapS=wt.wrapT=THREE.RepeatWrapping;wt.anisotropy=R.capabilities.getMaxAnisotropy();
const fc=mc(256,128),q=fc.getContext('2d');
for(let i=0;i<90;i++){const x=rn()*256,w=2+rn()*9,h=30+rn()*98,gr=q.createLinearGradient(0,128,0,128-h);gr.addColorStop(0,`rgba(255,255,255,${.5+rn()*.5})`);gr.addColorStop(1,'rgba(255,255,255,0)');q.fillStyle=gr;q.fillRect(x,128-h,w,h)}
const ft=new THREE.CanvasTexture(fc);ft.wrapS=ft.wrapT=THREE.RepeatWrapping;
 return {wt,ft,dispose(){wt.dispose();ft.dispose()}};
}
