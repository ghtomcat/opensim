/* ═══════════════════════════════════════════════════════════════
   OpenSim — display/robot_arm.js
   SO-101 robot arm — Three.js renderer with actual STL geometry.

   Joint hierarchy (SO-101):
     J1  Base rotation    (Y axis)  — Base_motor_holder
     J2  Shoulder pitch   (Z axis)  — Upper_arm
     J3  Elbow pitch      (Z axis)  — Under_arm + Rotation_Pitch
     J4  Wrist pitch      (Z axis)  — Wrist_Roll_Pitch
     J5  Wrist roll       (X axis)  — Wrist_Roll
     J6  Gripper          (Z axis)  — Moving_Jaw

   Input:
     Tab / 1–6  — select joint
     ← →        — rotate (Shift = ×5)
     Space      — gripper toggle
     H          — home position
   ═══════════════════════════════════════════════════════════════ */

import { S, setState } from '../core/state.js';
import { bbEvent }     from '../core/blackbox.js';

/* ── Colours ── */
const JCOLORS = ['#58a6ff','#3fb950','#d29922','#f85149','#bc8cff','#39d0d0'];
const JNAMES  = ['Base','Shoulder','Elbow','Wrist Pitch','Wrist Roll','Gripper'];
const PART_COLOR   = 0x8b9bb4;   // main arm colour
const SELECTED_COLOR = 0xffffff;
const GRIPPER_OPEN_COLOR  = 0x3fb950;
const GRIPPER_CLOSE_COLOR = 0xf85149;

/* ── Three.js scene ── */
let _renderer = null;
let _scene    = null;
let _camera   = null;
let _controls = null;   // OrbitControls
let _loaded   = false;
let _bound    = false;
let _hud      = null;   // separate 2D overlay canvas (WebGL locks the main canvas)

/* ── Joint pivot groups (one per joint, nested) ── */
let _pivots = [];        // [j1_pivot, j2_pivot, …, j6_pivot]
let _meshes = {};        // part name → THREE.Mesh

/* ── Active joint ── */
let _selJoint = 0;

/* ── Part editor ── */
let _editMode  = false;   // E key toggles
let _editMesh  = null;    // currently selected mesh
let _editAxis  = 'x';     // x / y / z
let _raycaster = null;
let _editCanvas = null;

/* ── STL part definitions ── */
// Each entry: { file, parent: pivot index (-1 = world), offset: [x,y,z] mm, rotation: [rx,ry,rz] rad }
const SCALE = 0.001;   // mm → metres

const H = -Math.PI / 2;   // Z→Y: column/motor parts (Z is the kinematic height)
const Q =  Math.PI / 2;   // X→Y: arm link parts (X is the kinematic length)

/*
 * Measured bounding boxes — 'ha' is the height axis ('z' or 'x'):
 *   base           Z=87.0  → H, halfH=43.5
 *   base_motor     Z=80.2  → H, halfH=40.1
 *   motor_base     Z=55.1  → H, halfH=27.5
 *   upper_arm      X=142.1 → Q, halfH=71.05   ← length is CAD X
 *   rotation_pitch Z=46.0  → H, halfH=23.0
 *   under_arm      X=130.7 → Q, halfH=65.35   ← length is CAD X
 *   motor_wrist    Z=56.4  → H, halfH=28.2
 *   wrist_pitch    Z=77.8  → H, halfH=38.9
 *   wrist_roll     Z=42.8  → H, halfH=21.4
 *   wrist_follower Z=105.4 → H, halfH=52.7
 *   jaw            Z=48.0  → H, halfH=24.0
 *
 * JOINT_Y_REL[i] = full height of tallest part in group i
 * (next joint goes at the top of the current group's tallest part).
 *   J0 base:       87mm
 *   J1 motors:     80.2mm  (base_motor)
 *   J2 upper_arm:  142.1mm
 *   J3 under_arm:  130.7mm
 *   J4 wrist:      77.8mm  (wrist_pitch)
 *   J5 wrist_roll: 105.4mm (wrist_follower)
 */
const PARTS = [
  { name: 'base',           file: 'Base_SO101.stl',                joint: -1, rot: [0,0,0], ha: 'y' },
  { name: 'base_motor',     file: 'Base_motor_holder_SO101.stl',   joint:  0, rot: [H,0,0], ha: 'z' },
  { name: 'motor_base',     file: 'Motor_holder_SO101_Base.stl',   joint:  0, rot: [H,0,0], ha: 'z' },
  { name: 'upper_arm',      file: 'Upper_arm_SO101.stl',           joint:  1, rot: [0,0,Q],  ha: 'x' },
  { name: 'rotation_pitch', file: 'Rotation_Pitch_SO101.stl',      joint:  2, rot: [H,0,0], ha: 'z' },
  { name: 'under_arm',      file: 'Under_arm_SO101.stl',           joint:  2, rot: [0,0,Q],  ha: 'x' },
  { name: 'motor_wrist',    file: 'Motor_holder_SO101_Wrist.stl',  joint:  3, rot: [H,0,0], ha: 'z' },
  { name: 'wrist_pitch',    file: 'Wrist_Roll_Pitch_SO101.stl',    joint:  3, rot: [H,0,0], ha: 'z' },
  { name: 'wrist_roll',     file: 'Wrist_Roll_SO101.stl',          joint:  4, rot: [H,0,0], ha: 'z' },
  { name: 'wrist_follower', file: 'Wrist_Roll_Follower_SO101.stl', joint:  4, rot: [H,0,0], ha: 'z' },
  { name: 'jaw',            file: 'Moving_Jaw_SO101.stl',          joint:  5, rot: [-Math.PI,0,0], ha: 'z' },
];

const JOINT_Y_REL = [0.072, 0.082, 0.142, 0.131, 0.078, 0.030];

/* ── Reset — call before loading a new mission ── */
export function resetRobotArm() {
  if (_controls) { _controls.dispose(); _controls = null; }
  if (_renderer) { _renderer.dispose(); _renderer = null; }
  if (_editCanvas) { _editCanvas.removeEventListener('click', _onEditClick); _editCanvas = null; }
  _editMode = false; _editMesh = null; _raycaster = null;
  if (_hud && _hud.parentElement) _hud.parentElement.removeChild(_hud);
  _hud = null;
  _scene = null; _camera = null;
  _pivots = []; _meshes = {};
  _loaded = false; _bound = false;
  _selJoint = 0;
  window.removeEventListener('keydown', _onKey);
}

/* ── Init Three.js and load STLs ── */
export function initRobotArm(canvas) {
  if (_loaded) return;
  if (_bound) return;
  _bound = true;

  /* Seed joint state */
  if (!S.armJoints) {
    const home = (S.aircraft?.joints ?? []).map(j => j.home ?? 0);
    setState({ armJoints: home.length ? home : [0,45,-60,30,0,0], armGripper: 0, armTargetIdx: 0 });
  }

  /* 2D HUD overlay — separate canvas on top (WebGL locks the main canvas) */
  const par = canvas.parentElement;
  if (getComputedStyle(par).position === 'static') par.style.position = 'relative';
  _hud = document.createElement('canvas');
  _hud.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:10;';
  par.appendChild(_hud);

  /* Three.js renderer — render into the existing canvas */
  _renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  _renderer.setPixelRatio(window.devicePixelRatio);
  _renderer.setClearColor(0x0d1117, 1);
  _renderer.shadowMap.enabled = true;

  _scene = new THREE.Scene();

  /* Camera */
  _camera = new THREE.PerspectiveCamera(45, 1, 0.001, 10);
  _camera.position.set(0.50, 0.18, 0.65);
  _camera.lookAt(0, 0.15, 0);

  /* Lighting */
  _scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
  dirLight.position.set(1, 2, 1.5);
  dirLight.castShadow = true;
  _scene.add(dirLight);
  const fillLight = new THREE.DirectionalLight(0x8899ff, 0.4);
  fillLight.position.set(-1, 0.5, -1);
  _scene.add(fillLight);

  /* Floor grid */
  const grid = new THREE.GridHelper(0.6, 12, 0x222233, 0x1a1a2a);
  grid.position.y = -0.005;
  _scene.add(grid);

  /* Part editor raycaster */
  _raycaster  = new THREE.Raycaster();
  _editCanvas = canvas;
  canvas.addEventListener('click', _onEditClick);

  /* Orbit controls — drag to rotate, scroll to zoom */
  _controls = new THREE.OrbitControls(_camera, canvas);
  _controls.target.set(0, 0.20, 0);
  _controls.enableDamping = true;
  _controls.dampingFactor = 0.08;
  _controls.minDistance = 0.2;
  _controls.maxDistance = 2.0;
  _controls.update();

  /* Build pivot hierarchy */
  _buildPivots();

  /* Load STLs */
  _loadSTLs();

  /* Keyboard */
  window.addEventListener('keydown', _onKey);

  _loaded = true;
}

function _buildPivots() {
  /* Nested pivots — each is a child of the previous, so rotating J0 carries all above */
  _pivots = [];
  let parent = _scene;
  for (let i = 0; i < 6; i++) {
    const pivot = new THREE.Group();
    pivot.position.set(0, JOINT_Y_REL[i], 0);
    parent.add(pivot);
    _pivots.push(pivot);
    parent = pivot;
  }
}

function _loadSTLs() {
  const loader = new THREE.STLLoader();
  const mat = new THREE.MeshPhongMaterial({
    color: PART_COLOR,
    specular: 0x334455,
    shininess: 40,
    side: THREE.DoubleSide,
  });

  PARTS.forEach(part => {
    loader.load(`assets/so101/${part.file}`, (geometry) => {
      geometry.computeVertexNormals();
      geometry.computeBoundingBox();

      /* Centre geometry at its bounding box centre */
      const centre = new THREE.Vector3();
      geometry.boundingBox.getCenter(centre);
      geometry.translate(-centre.x, -centre.y, -centre.z);
      geometry.computeBoundingBox();   // recompute after translate

      /*
       * After centering + -90° X rotation: CAD Z-up → Three.js Y-up.
       * The geometry's Z range (in CAD) becomes the Y range in world space.
       * Offset the mesh by +max.z * SCALE so the bottom face sits at the pivot (Y=0).
       */
      const bbox = geometry.boundingBox;
      const halfH = (part.ha === 'x' ? bbox.max.x : part.ha === 'y' ? bbox.max.y : bbox.max.z) * SCALE;

      const mesh = new THREE.Mesh(geometry, mat.clone());
      mesh.scale.setScalar(SCALE);
      mesh.rotation.set(part.rot[0], part.rot[1], part.rot[2]);
      mesh.position.set(0, halfH, 0);
      mesh.castShadow = true;
      mesh.receiveShadow = true;

      const parent = part.joint >= 0 ? _pivots[part.joint] : _scene;
      parent.add(mesh);
      mesh.userData.partName = part.name;   // for editor identification
      _meshes[part.name] = mesh;
    }, undefined, (err) => {
      console.warn(`[arm] failed to load ${part.file}:`, err);
    });
  });
}

function _onEditClick(e) {
  if (!_editMode || !_raycaster || !_camera) return;
  const rect  = _editCanvas.getBoundingClientRect();
  const mouse = new THREE.Vector2(
    ((e.clientX - rect.left)  / rect.width)  * 2 - 1,
    -((e.clientY - rect.top) / rect.height) * 2 + 1
  );
  _raycaster.setFromCamera(mouse, _camera);
  const meshList = Object.values(_meshes);
  const hits = _raycaster.intersectObjects(meshList, false);
  if (hits.length) {
    _editMesh = hits[0].object;
    console.log(`[editor] selected: ${_editMesh.userData.partName}`);
  }
}

function _logAllRotations() {
  console.log('\n[editor] current part rotations (copy into PARTS array):');
  Object.entries(_meshes).forEach(([name, mesh]) => {
    const r = mesh.rotation;
    console.log(`  ${name}: [${r.x.toFixed(4)}, ${r.y.toFixed(4)}, ${r.z.toFixed(4)}]`);
  });
}

function _onKey(e) {
  if (S.aircraft?.vehicleType !== 'robot-arm') return;

  /* ── Part editor mode ── */
  if (e.key === 'e' || e.key === 'E') {
    _editMode = !_editMode;
    _editMesh = null;
    console.log(`[editor] ${_editMode ? 'ON — click a part, use X/Y/Z + ←→ to rotate, L to log' : 'OFF'}`);
    return;
  }

  if (_editMode) {
    if (e.key === 'x') { _editAxis = 'x'; console.log('[editor] axis: X'); return; }
    if (e.key === 'y') { _editAxis = 'y'; console.log('[editor] axis: Y'); return; }
    if (e.key === 'z') { _editAxis = 'z'; console.log('[editor] axis: Z'); return; }
    if (e.key === 'l' || e.key === 'L') { _logAllRotations(); return; }

    if (_editMesh && (e.key === 'ArrowLeft' || e.key === 'ArrowRight')) {
      e.preventDefault();
      const step = (e.shiftKey ? 15 : 5) * Math.PI / 180;
      const delta = e.key === 'ArrowRight' ? step : -step;
      _editMesh.rotation[_editAxis] += delta;
      const r = _editMesh.rotation;
      console.log(`[editor] ${_editMesh.userData.partName} rot: x=${r.x.toFixed(3)} y=${r.y.toFixed(3)} z=${r.z.toFixed(3)}`);
    }
    if (_editMesh && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault();
      const step = (e.shiftKey ? 0.02 : 0.005);
      _editMesh.position.y += e.key === 'ArrowUp' ? step : -step;
      console.log(`[editor] ${_editMesh.userData.partName} y=${(_editMesh.position.y * 1000).toFixed(1)}mm`);
    }
    return;
  }

  const joints = [...(S.armJoints ?? [0,0,0,0,0,0])];
  const cfg    = S.aircraft?.joints ?? [];

  if (e.key === 'Tab') { e.preventDefault(); _selJoint = (_selJoint + 1) % 6; return; }

  const num = parseInt(e.key);
  if (num >= 1 && num <= 6) { _selJoint = num - 1; return; }

  if (e.key === ' ') {
    e.preventDefault();
    const next = S.armGripper > 0 ? 0 : 1;
    setState({ armGripper: next });
    bbEvent({ type: 'gripper', gripper: next ? 'close' : 'open' });
    return;
  }

  if (e.key === 'h' || e.key === 'H') {
    const home = cfg.map(j => j.home ?? 0);
    setState({ armJoints: home });
    bbEvent({ type: 'arm_home' });
    return;
  }

  const step = e.shiftKey ? 10 : 2;

  if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
    e.preventDefault();
    const jcfg = cfg[_selJoint] ?? {};
    joints[_selJoint] = Math.min(jcfg.max ?? 180, joints[_selJoint] + step);
    setState({ armJoints: joints });
    bbEvent({ type: 'joint_cmd', joint: _selJoint, angle: joints[_selJoint] });
    return;
  }
  if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
    e.preventDefault();
    const jcfg = cfg[_selJoint] ?? {};
    joints[_selJoint] = Math.max(jcfg.min ?? -180, joints[_selJoint] - step);
    setState({ armJoints: joints });
    bbEvent({ type: 'joint_cmd', joint: _selJoint, angle: joints[_selJoint] });
    return;
  }
}

/* ── Apply joint angles to Three.js pivot rotations ── */
function _applyJoints(joints) {
  if (_pivots.length < 6) return;
  const DEG = Math.PI / 180;

  // J0: base pan → Y (vertical) axis
  _pivots[0].rotation.y = joints[0] * DEG;
  // J1: shoulder pitch → X axis (tips arm forward/backward)
  _pivots[1].rotation.x = joints[1] * DEG;
  // J2: elbow pitch → X axis
  _pivots[2].rotation.x = joints[2] * DEG;
  // J3: wrist pitch → X axis
  _pivots[3].rotation.x = joints[3] * DEG;
  // J4: wrist roll → Y axis (roll around arm length axis)
  _pivots[4].rotation.y = joints[4] * DEG;
  // J5: gripper → X axis
  _pivots[5].rotation.x = joints[5] * DEG;
}

/* ── Render ── */
export function renderRobotArm(canvas) {
  if (!canvas) return;

  /* Init on first render */
  if (!_loaded) {
    initRobotArm(canvas);
    return;
  }

  /* Resize renderer to match canvas CSS size */
  const W = canvas.offsetWidth;
  const H = canvas.offsetHeight;
  if (_renderer.domElement.width !== W * devicePixelRatio ||
      _renderer.domElement.height !== H * devicePixelRatio) {
    _renderer.setSize(W, H, false);
    _camera.aspect = W / H;
    _camera.updateProjectionMatrix();
  }

  /* Update joint rotations */
  const joints = S.armJoints ?? [0,45,-60,30,0,0];
  _applyJoints(joints);

  /* Highlight selected joint pivot mesh */
  Object.values(_meshes).forEach(m => {
    m.material.emissive.setHex(0x000000);
    m.material.emissiveIntensity = 0;
  });

  /* Render */
  if (_controls) _controls.update();
  _renderer.render(_scene, _camera);

  /* Overlay HUD on separate 2D canvas */
  _drawHUD(canvas, joints);
}

function _drawHUD(canvas, joints) {
  if (!_hud) return;
  /* Keep overlay canvas pixel dimensions in sync */
  const dpr = window.devicePixelRatio || 1;
  const W   = canvas.offsetWidth  * dpr;
  const H   = canvas.offsetHeight * dpr;
  if (_hud.width !== W || _hud.height !== H) {
    _hud.width  = W;
    _hud.height = H;
  }
  const ctx = _hud.getContext('2d');
  ctx.clearRect(0, 0, W, H);

  /* ── Top-right: joint angle readout ── */
  const px = 13 * dpr;
  const lineH = 17 * dpr;
  ctx.textAlign = 'right';
  const rx = W - 12 * dpr;
  let ry = 18 * dpr;

  if (_editMode) {
    ctx.font      = `bold ${12 * dpr}px monospace`;
    ctx.fillStyle = '#f8c000';
    ctx.fillText('EDIT MODE — click part · X/Y/Z axis · ←→ rotate · ↑↓ move · L log · E exit', rx, ry);
    ry += 16 * dpr;
    if (_editMesh) {
      const r = _editMesh.rotation;
      const p = _editMesh.userData.partName;
      ctx.fillStyle = '#ffffff';
      ctx.font = `${12 * dpr}px monospace`;
      ctx.fillText(`${p}  axis:${_editAxis.toUpperCase()}  rot: x=${r.x.toFixed(2)} y=${r.y.toFixed(2)} z=${r.z.toFixed(2)}`, rx, ry);
      ry += 16 * dpr;
    }
    return;
  }

  ctx.font      = `${10 * dpr}px monospace`;
  ctx.fillStyle = 'rgba(255,255,255,0.30)';
  ctx.fillText('Tab·1-6 select  ←→ move  Shift×5  H home  E edit', rx, ry);
  ry += lineH;

  for (let i = 0; i < 6; i++) {
    const sel = i === _selJoint;
    const val = (joints[i] ?? 0).toFixed(1);
    ctx.fillStyle = sel ? '#ffffff' : JCOLORS[i];
    ctx.font      = sel
      ? `bold ${13 * dpr}px monospace`
      : `${12 * dpr}px monospace`;
    const label = `J${i+1} ${JNAMES[i]}`;
    const angle = `${val}°`.padStart(8);
    ctx.fillText(`${label.padEnd(18)}${angle}`, rx, ry);
    ry += lineH;
  }

  /* gripper */
  const grip = (S.armGripper ?? 0) > 0.5 ? 'CLOSED' : 'OPEN';
  ctx.fillStyle = (S.armGripper ?? 0) > 0.5 ? '#f85149' : '#3fb950';
  ctx.font      = `${12 * dpr}px monospace`;
  ctx.fillText(`Gripper  ${grip}`, rx, ry);

  /* bottom-right: selected joint name */
  ctx.fillStyle = JCOLORS[_selJoint];
  ctx.font      = `bold ${14 * dpr}px monospace`;
  ctx.fillText(`J${_selJoint + 1} — ${JNAMES[_selJoint]}`, rx, H - 12 * dpr);
  ctx.textAlign = 'left';
}
