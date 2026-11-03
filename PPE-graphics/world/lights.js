import * as THREE from 'three';
export function createLights(S,rift){
const hl=new THREE.HemisphereLight(0x9aa4ad,0x0c1114,1.15);S.add(hl);
const dl=new THREE.DirectionalLight(0xdfe8ee,.9);dl.position.copy(rift).multiplyScalar(100);S.add(dl);
 return {hl,dl};
}
