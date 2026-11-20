/** Input: keys and accumulated mouse movement (pointer lock). */
export function createInput(signal){
 const K={},look={yaw:0,pitch:0},M={tog:0},CL={toggle:false},W={z:0};
 addEventListener('keydown',e=>{K[e.code]=1;if(e.code==='Space')e.preventDefault()},{signal});
 addEventListener('keyup',e=>{K[e.code]=0},{signal});
 // RMB click = toggle the claw. Buttons only count under pointer lock, so the menu clicks that
 // start the run never reach the manipulator.
 addEventListener('mousedown',e=>{if(!document.pointerLockElement)return;if(e.button===2)M.tog=1},{signal});
 addEventListener('contextmenu',e=>{if(document.pointerLockElement)e.preventDefault()},{signal});
 addEventListener('mousemove',e=>{if(document.pointerLockElement){look.yaw+=-e.movementX*.0021;look.pitch-=e.movementY*.0021}},{signal});
 // wheel: pull the camera from FPV to behind the body. Accumulated, consumed by the read.
 addEventListener('wheel',e=>{if(!document.pointerLockElement)return;e.preventDefault();W.z+=e.deltaY*.0012},{signal,passive:false});
 return {K,look,
  // human-style readout: WASD as fwd/side, Shift as run, Space as jump (edge), C as crouch toggle
  _crouch:false,_jumpEdge:false,
  human(){
   const f=(K['KeyW']?1:0)-(K['KeyS']?1:0);
   const s=(K['KeyD']?1:0)-(K['KeyA']?1:0);
   if(K['KeyC']&&!this._cHeld){this._crouch=!this._crouch}
   this._cHeld=!!K['KeyC'];
   const jump=!!K['Space']&&!this._jHeld; this._jHeld=!!K['Space'];
   return {fwd:f,side:s,run:!!K['ShiftLeft']||!!K['ShiftRight'],jump,crouch:this._crouch};
  },
  // drone readout: toggle is edge-triggered and consumed by the read
  get claw(){CL.toggle=!!M.tog;M.tog=0;return CL},
  get yaw(){return look.yaw},get pitch(){return look.pitch},
  get zoom(){const v=W.z;W.z=0;return v},
 };
}
