import * as THREE from 'three';
/** Renderer, scene, camera and shared uniforms (time, moon direction, fog). */
export function createStage(signal){
 const R=new THREE.WebGLRenderer({antialias:true,powerPreference:'high-performance'});
 R.setPixelRatio(Math.min(devicePixelRatio,2));R.setSize(innerWidth,innerHeight);document.body.prepend(R.domElement);
 const S=new THREE.Scene(),FC=new THREE.Color(.2,.22,.24);S.fog=new THREE.FogExp2(FC,.0028);
 const cam=new THREE.PerspectiveCamera(92,innerWidth/innerHeight,.3,3000);cam.rotation.order='YXZ';
 const rift=new THREE.Vector3(-.2,.42,-.85).normalize(),T={value:0};
 const fogU={t:T,fogC:{value:FC},rift:{value:rift},vis:{value:1},flash:{value:0},uCloud:{value:new THREE.Vector2()}};
 addEventListener('resize',()=>{R.setSize(innerWidth,innerHeight);cam.aspect=innerWidth/innerHeight;cam.updateProjectionMatrix()},{signal});
 return {R,S,cam,FC,rift,T,fogU};
}
export function disposeStage({R,S}){
 S.traverse(o=>{if(o.geometry)o.geometry.dispose();const m=o.material;if(m)(Array.isArray(m)?m:[m]).forEach(x=>{if(x.map)x.map.dispose();x.dispose()})});
 R.dispose();R.forceContextLoss();R.domElement.remove();
}
