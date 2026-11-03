/** Start/pause overlay and pointer lock. */
export function createOverlay({signal,canvas,onStart,onPause}){
 const ov=document.getElementById('s');let locked=false;
 function go(){onStart();ov.style.display='none';try{canvas.requestPointerLock()}catch(_e){/* pointer lock can fail in iframes — non-fatal */}}
 ov.onclick=go;
 if(new URLSearchParams(location.search).has('autostart'))setTimeout(go,300);
 document.addEventListener('pointerlockchange',()=>{if(document.pointerLockElement)locked=true;else if(locked){onPause();ov.style.display='flex';locked=false}},{signal});
 signal.addEventListener('abort',()=>{ov.onclick=null});
}
