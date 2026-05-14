/* ═══════════════════════════════════════════════════════════════
   OpenSim — display/robot_arm.js
   SO-101 robot arm — Three.js renderer, URDF-accurate assembly.

   Joint hierarchy (from so101_new_calib.urdf):
     shoulder_pan   link 0→1   base_link    → shoulder_link
     shoulder_lift  link 1→2   shoulder     → upper_arm
     elbow_flex     link 2→3   upper_arm    → lower_arm
     wrist_flex     link 3→4   lower_arm    → wrist
     wrist_roll     link 4→5   wrist        → gripper
     gripper        link 5→6   gripper      → moving_jaw

   Every joint rotates about its own local Z axis (URDF axis 0 0 1).
   Joint origins and visual mesh positions come directly from the URDF.

   Root group carries rotation.x = −π/2 to convert URDF Z-up → Three.js Y-up.

   Input (unified — parts and joints in one list):
     [ / ]      — cycle prev / next item
     1–6        — jump to joint J1–J6
     X / Y / Z  — choose axis for part editing
     ← →        — rotate joint  OR  rotate part on axis  (Shift ×5)
     ↑ ↓        — (part only) translate on axis  (Shift ×5)
     Space      — gripper toggle
     H          — home all joints
     L          — log all part transforms to console
   ═══════════════════════════════════════════════════════════════ */

import { S, setState }  from '../core/state.js';
import { bbEvent }      from '../core/blackbox.js';
import { sendCartJog }  from '../core/hil.js';

/* ── Colours ── */
const JCOLORS = ['#58a6ff','#3fb950','#d29922','#f85149','#bc8cff','#39d0d0'];
const JNAMES  = ['Base','Shoulder','Elbow','Wrist Pitch','Wrist Roll','Gripper'];
const PART_COLOR = 0x8b9bb4;

/* ── Three.js state ── */
let _renderer = null;
let _scene    = null;
let _camera   = null;
let _controls = null;
let _loaded   = false;
let _bound    = false;
let _hud      = null;
let _root     = null;   // URDF root: rotation.x = −π/2 (Z-up → Y-up)

/* ── Kinematic hierarchy ──
   _linkGroups[0]  = base_link (world origin, no parent joint)
   _linkGroups[1]  = shoulder_link    rotation.z = θ₁
   _linkGroups[2]  = upper_arm_link   rotation.z = θ₂
   _linkGroups[3]  = lower_arm_link   rotation.z = θ₃
   _linkGroups[4]  = wrist_link       rotation.z = θ₄
   _linkGroups[5]  = gripper_link     rotation.z = θ₅
   _linkGroups[6]  = moving_jaw_link  rotation.z = θ₆          ── */
let _linkGroups = [];
let _meshes     = {};   // partName → THREE.Mesh (editor)

/* ── Selection: one index into ITEM_LIST covers both parts and joints ── */
let _selItemIdx = 0; // resolved to J1 on first reset; ITEM_LIST not yet defined at module init
let _editAxis   = 'x';   // axis for part translate / rotate
let _raycaster  = null;
let _editCanvas = null;

/* ── Cart-jog mode ── */
let _cartMode = false;
let _cartStep = 0.010;  // metres

/* ── Constants ── */
const SCALE = 0.001;          // STL vertices are in mm → metres after scale
const PI    = Math.PI;
const HPI   = Math.PI / 2;
const DEG   = Math.PI / 180;

/* ──────────────────────────────────────────────────────────────
   URDF joint origins  [tx, ty, tz, roll, pitch, yaw]
   Source: so101_new_calib.urdf  <joint><origin xyz="…" rpy="…"/>
   Applied as FIXED transforms between each parent link frame and
   the joint frame.  The joint variable θ then rotates about the
   joint frame's local Z axis (URDF axis="0 0 1").
   ────────────────────────────────────────────────────────────── */
const JOINT_XFORMS = [
  //  tx           ty           tz        roll   pitch   yaw
  [ 0.0388353,  0,           0.0624,    PI,    0,      -PI  ],  // shoulder_pan
  [-0.0303992, -0.0182778,  -0.0542,   -HPI,  -HPI,    0   ],  // shoulder_lift
  [-0.11257,   -0.028,       0,         0,     0,      HPI  ],  // elbow_flex
  [-0.1349,     0.0052,      0,         0,     0,     -HPI  ],  // wrist_flex
  [ 0,         -0.0611,      0.0181,   HPI,   0.0487,  PI   ],  // wrist_roll
  [ 0.0202,     0.0188,     -0.0234,   HPI,   0,       0    ],  // gripper
];

/* ──────────────────────────────────────────────────────────────
   URDF visual origins  [link_idx, filename, tx, ty, tz, roll, pitch, yaw]
   Source: so101_new_calib.urdf  <visual><origin xyz="…" rpy="…"/>
   STL filenames map to /assets/so101/<file>.

   Entries marked with  ⚡ have no URDF visual entry — positions
   are best-guess from the physical assembly; use the part editor
   (E key) to fine-tune them.
   ────────────────────────────────────────────────────────────── */
const VISUALS = [
  // link 0 — base_link
  [0, 'Base_SO101.stl',
      -0.00636471,  0,           -0.0024,  -HPI, HPI,  PI  ],
  [0, 'Base_motor_holder_SO101.stl',
      -0.00636471, -9.94414e-5,  -0.0024,   HPI, HPI,  0   ],

  // link 1 — shoulder_link
  [1, 'Rotation_Pitch_SO101.stl',
       0.0122008,   2.22413e-5,   0.0464,   -HPI, 0,    0  ],

  // link 2 — upper_arm_link
  [2, 'Upper_arm_SO101.stl',
       0.040,        0.012,        0.0182,    275 * DEG, 135 * DEG, 0  ],

  // link 3 — lower_arm_link
  [3, 'Under_arm_SO101.stl',
       0.288,       -0.002,         0.030,    90 * DEG,  195 * DEG,  0  ],

  // link 4 — wrist_link

  // link 5 — gripper_link
  [5, 'Wrist_Roll_Follower_SO101.stl',
      -0.276,      -2.18214e-4,  -0.505,   -180 * DEG,  -20 * DEG,  20 * DEG  ],
  [5, 'Wrist_Roll_SO101.stl',                         // ⚡ approx.
      -0.280,      -2.18214e-4,  -0.505,   -185 * DEG,  160 * DEG,  0  ],

  // link 6 — moving_jaw_link
  [6, 'Moving_Jaw_SO101.stl',
      -0.298,      -0.502,         0.023,   -10 * DEG,  -25 * DEG,  15 * DEG  ],
];

/* ──────────────────────────────────────────────────────────────
   Unified item list — parts and joints interleaved by link order.
   P items: {type:'part',  name, pIdx}   (pIdx = 1-based display index)
   J items: {type:'joint', jIdx}         (jIdx = 0-based joint index)
   ────────────────────────────────────────────────────────────── */
/* ──────────────────────────────────────────────────────────────
   Part groups — translating any member also moves all others
   in the same group by the same delta.
   ────────────────────────────────────────────────────────────── */
const PART_GROUPS = [];

function _groupPeers(name) {
  const g = PART_GROUPS.find(g => g.includes(name));
  return g ? g.filter(n => n !== name) : [];
}

const ITEM_LIST = (() => {
  const items = [];
  let pi = 0;
  for (let link = 0; link <= 6; link++) {
    VISUALS.filter(v => v[0] === link).forEach(v => {
      items.push({ type: 'part', name: v[1].replace(/\.stl$/i, ''), pIdx: ++pi });
    });
    if (link < 6) items.push({ type: 'joint', jIdx: link });
  }
  return items;
})();

/* ══════════════════════════════════════════════════════════════
   Init / reset
   ══════════════════════════════════════════════════════════════ */

export function resetRobotArm() {
  if (_controls) { _controls.dispose(); _controls = null; }
  if (_renderer) { _renderer.dispose(); _renderer = null; }
  if (_editCanvas) { _editCanvas.removeEventListener('click', _onEditClick); _editCanvas = null; }
  if (_hud && _hud.parentElement) _hud.parentElement.removeChild(_hud);
  _raycaster = null;
  _hud = null; _root = null;
  _scene = null; _camera = null;
  _linkGroups = []; _meshes = {};
  _loaded = false; _bound = false;
  _selItemIdx = ITEM_LIST.findIndex(it => it.type === 'joint');
  window.removeEventListener('keydown', _onKey);
}

export function initRobotArm(canvas) {
  if (_loaded || _bound) return;
  _bound = true;

  if (!S.armJoints) {
    const home = (S.aircraft?.joints ?? []).map(j => j.home ?? 0);
    setState({ armJoints: home.length ? home : [0, 45, -60, 30, 0, 0], armGripper: 0, armTargetIdx: 0 });
  }

  /* 2D HUD overlay */
  const par = canvas.parentElement;
  if (getComputedStyle(par).position === 'static') par.style.position = 'relative';
  _hud = document.createElement('canvas');
  _hud.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:10;';
  par.appendChild(_hud);

  /* Three.js renderer */
  _renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  _renderer.setPixelRatio(window.devicePixelRatio);
  _renderer.setClearColor(0x0d1117, 1);
  _renderer.shadowMap.enabled = true;

  _scene = new THREE.Scene();

  /* Camera */
  _camera = new THREE.PerspectiveCamera(45, 1, 0.001, 10);
  _camera.position.set(0.55, 0.30, 0.60);
  _camera.lookAt(0, 0.15, 0);

  /* Lighting */
  _scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const dir = new THREE.DirectionalLight(0xffffff, 1.2);
  dir.position.set(1, 2, 1.5);
  dir.castShadow = true;
  _scene.add(dir);
  const fill = new THREE.DirectionalLight(0x8899ff, 0.4);
  fill.position.set(-1, 0.5, -1);
  _scene.add(fill);

  /* Floor grid */
  const grid = new THREE.GridHelper(0.8, 16, 0x222233, 0x1a1a2a);
  grid.position.y = -0.005;
  _scene.add(grid);

  /* Raycaster for part editor */
  _raycaster  = new THREE.Raycaster();
  _editCanvas = canvas;
  canvas.addEventListener('click', _onEditClick);

  /* Orbit controls */
  _controls = new THREE.OrbitControls(_camera, canvas);
  _controls.target.set(0, 0.18, 0);
  _controls.enableDamping = true;
  _controls.dampingFactor = 0.08;
  _controls.minDistance   = 0.15;
  _controls.maxDistance   = 2.0;
  _controls.update();

  _buildLinks();
  _loadSTLs();

  window.addEventListener('keydown', _onKey);
  _loaded = true;
}

/* ══════════════════════════════════════════════════════════════
   Build URDF kinematic hierarchy
   ══════════════════════════════════════════════════════════════ */

function _buildLinks() {
  /* Root: convert URDF Z-up to Three.js Y-up */
  _root = new THREE.Group();
  _root.rotation.x = -HPI;
  _scene.add(_root);

  /* base_link sits at the world origin */
  const base = new THREE.Group();
  _root.add(base);
  _linkGroups = [base];

  let parentLink = base;

  for (let i = 0; i < 6; i++) {
    const [tx, ty, tz, roll, pitch, yaw] = JOINT_XFORMS[i];

    /* Fixed joint-origin transform (translate + RPY) */
    const jointGroup = new THREE.Group();
    jointGroup.position.set(tx, ty, tz);
    jointGroup.rotation.set(roll, pitch, yaw, 'XYZ');
    parentLink.add(jointGroup);

    /* Child link group — rotation.z carries the joint variable θ */
    const childLink = new THREE.Group();
    jointGroup.add(childLink);
    _linkGroups.push(childLink);

    parentLink = childLink;
  }
}

/* ══════════════════════════════════════════════════════════════
   Load STL parts with URDF visual origins
   ══════════════════════════════════════════════════════════════ */

function _loadSTLs() {
  const loader = new THREE.STLLoader();
  const mat = new THREE.MeshPhongMaterial({
    color:     PART_COLOR,
    specular:  0x334455,
    shininess: 40,
    side:      THREE.DoubleSide,
  });

  VISUALS.forEach(([linkIdx, file, tx, ty, tz, roll, pitch, yaw]) => {
    const partName = file.replace('.stl', '').replace('.STL', '');
    loader.load(`assets/so101/${file}`, (geo) => {
      geo.computeVertexNormals();

      const mesh = new THREE.Mesh(geo, mat.clone());
      mesh.scale.setScalar(SCALE);
      mesh.position.set(tx, ty, tz);
      mesh.rotation.set(roll, pitch, yaw, 'XYZ');
      mesh.castShadow    = true;
      mesh.receiveShadow = true;
      mesh.userData.partName = partName;

      _linkGroups[linkIdx].add(mesh);
      _meshes[partName] = mesh;
    }, undefined, (err) => {
      console.warn(`[arm] failed to load ${file}:`, err);
    });
  });
}

/* ══════════════════════════════════════════════════════════════
   Apply joint angles each frame
   θ[i] drives _linkGroups[i+1].rotation.z  (local Z = URDF joint axis)
   ══════════════════════════════════════════════════════════════ */

function _applyJoints(joints) {
  if (_linkGroups.length < 7) return;
  for (let i = 0; i < 6; i++) {
    _linkGroups[i + 1].rotation.z = joints[i] * DEG;
  }
}

/* ══════════════════════════════════════════════════════════════
   Part editor
   ══════════════════════════════════════════════════════════════ */

function _onEditClick(e) {
  if (!_raycaster || !_camera) return;
  const rect  = _editCanvas.getBoundingClientRect();
  const mouse = new THREE.Vector2(
    ((e.clientX - rect.left) / rect.width)  * 2 - 1,
   -((e.clientY - rect.top)  / rect.height) * 2 + 1,
  );
  _raycaster.setFromCamera(mouse, _camera);
  const hits = _raycaster.intersectObjects(Object.values(_meshes), true);
  if (hits.length) {
    let obj = hits[0].object;
    while (obj && !obj.userData.partName) obj = obj.parent;
    if (obj?.userData.partName) {
      const idx = ITEM_LIST.findIndex(it => it.type === 'part' && it.name === obj.userData.partName);
      if (idx >= 0) { _selItemIdx = idx; console.log(`[arm] selected: ${obj.userData.partName}`); }
    }
  }
}

function _cycleItem(dir) {
  _selItemIdx = (_selItemIdx + dir + ITEM_LIST.length) % ITEM_LIST.length;
  const it = ITEM_LIST[_selItemIdx];
  console.log(`[arm] ${it.type === 'joint' ? 'J' + (it.jIdx + 1) : 'P' + it.pIdx + ' ' + it.name}`);
}

function _logAllTransforms() {
  console.log('\n[editor] VISUALS entries — paste over the ⚡ lines:');
  Object.entries(_meshes).forEach(([name, mesh]) => {
    const p = mesh.position, r = mesh.rotation;
    const li = VISUALS.find(v => v[1].startsWith(name));
    const idx = li ? li[0] : '?';
    console.log(
      `  [${idx}, '${name}.stl',` +
      `  ${p.x.toFixed(6)}, ${p.y.toFixed(6)}, ${p.z.toFixed(6)},` +
      `  ${r.x.toFixed(5)}, ${r.y.toFixed(5)}, ${r.z.toFixed(5)}],`,
    );
  });
}

/* ══════════════════════════════════════════════════════════════
   Keyboard handler
   ══════════════════════════════════════════════════════════════ */

function _onKey(e) {
  /* ── Navigation and axis selection — always active ── */
  if (e.key === ']') { _cycleItem(1);  return; }
  if (e.key === '[') { _cycleItem(-1); return; }
  if (e.key === 'l' || e.key === 'L') { _logAllTransforms(); return; }
  if (e.key === 'x' || e.key === 'X') { _editAxis = 'x'; return; }
  if (e.key === 'y' || e.key === 'Y') { _editAxis = 'y'; return; }
  if (e.key === 'z' || e.key === 'Z') { _editAxis = 'z'; return; }

  /* Number keys: 1-6 jump to joints J1-J6 */
  const num = parseInt(e.key);
  if (!isNaN(num) && num >= 1 && num <= 6) {
    const idx = ITEM_LIST.findIndex(it => it.type === 'joint' && it.jIdx === num - 1);
    if (idx >= 0) _selItemIdx = idx;
    return;
  }

  /* ── Vehicle guard for motion commands ── */
  if (S.aircraft?.vehicleType !== 'robot-arm') return;

  /* C — toggle Cartesian jog mode */
  if (e.key === 'c' || e.key === 'C') {
    _cartMode = !_cartMode;
    setState({ armCartMode: _cartMode });
    return;
  }

  /* ── Cart-jog mode: WASD+RF move TCP, arrows adjust step ── */
  if (_cartMode) {
    const MAP = { w:[+1,0,0], s:[-1,0,0], a:[0,+1,0], d:[0,-1,0], r:[0,0,+1], f:[0,0,-1] };
    const dir = MAP[e.key.toLowerCase()];
    if (dir) {
      e.preventDefault();
      sendCartJog(dir[0] * _cartStep, dir[1] * _cartStep, dir[2] * _cartStep);
      return;
    }
    if (e.key === 'ArrowUp')   { e.preventDefault(); _cartStep = Math.min(0.050, +(_cartStep * 2).toFixed(3)); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); _cartStep = Math.max(0.001, +(_cartStep / 2).toFixed(3)); return; }
    return;  // swallow other keys in cart mode so they don't trigger joint jog
  }

  if (e.key === 'h' || e.key === 'H') {
    setState({ armJoints: (S.aircraft?.joints ?? []).map(j => j.home ?? 0) });
    bbEvent({ type: 'arm_home' });
    return;
  }
  if (e.key === ' ') {
    e.preventDefault();
    const n = S.armGripper > 0 ? 0 : 1;
    setState({ armGripper: n });
    bbEvent({ type: 'gripper', gripper: n ? 'close' : 'open' });
    return;
  }

  /* ── Arrow keys: behaviour depends on selected item type ── */
  const item = ITEM_LIST[_selItemIdx];
  if (!item) return;

  if (item.type === 'joint') {
    const joints = [...(S.armJoints ?? [0, 0, 0, 0, 0, 0])];
    const cfg    = S.aircraft?.joints ?? [];
    const step   = e.shiftKey ? 10 : 2;
    if (e.key === 'ArrowRight' || e.key === 'ArrowUp') {
      e.preventDefault();
      joints[item.jIdx] = Math.min(cfg[item.jIdx]?.max ?? 180, joints[item.jIdx] + step);
      setState({ armJoints: joints });
      bbEvent({ type: 'joint_cmd', joint: item.jIdx, angle: joints[item.jIdx] });
    }
    if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') {
      e.preventDefault();
      joints[item.jIdx] = Math.max(cfg[item.jIdx]?.min ?? -180, joints[item.jIdx] - step);
      setState({ armJoints: joints });
      bbEvent({ type: 'joint_cmd', joint: item.jIdx, angle: joints[item.jIdx] });
    }
  } else {
    const mesh = _meshes[item.name];
    if (!mesh) return;
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault();
      mesh.rotation[_editAxis] += (e.key === 'ArrowRight' ? 1 : -1) * (e.shiftKey ? 15 : 5) * DEG;
    }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault();
      const delta = (e.key === 'ArrowUp' ? 1 : -1) * (e.shiftKey ? 0.010 : 0.002);
      mesh.position[_editAxis] += delta;
      _groupPeers(item.name).forEach(n => { if (_meshes[n]) _meshes[n].position[_editAxis] += delta; });
    }
  }
}

/* ══════════════════════════════════════════════════════════════
   Render
   ══════════════════════════════════════════════════════════════ */

export function renderRobotArm(canvas) {
  if (!canvas) return;
  if (!_loaded) { initRobotArm(canvas); return; }

  const W = canvas.offsetWidth, H = canvas.offsetHeight;
  if (_renderer.domElement.width  !== W * devicePixelRatio ||
      _renderer.domElement.height !== H * devicePixelRatio) {
    _renderer.setSize(W, H, false);
    _camera.aspect = W / H;
    _camera.updateProjectionMatrix();
  }

  _applyJoints(S.armJoints ?? [0, 45, -60, 30, 0, 0]);

  /* Reset emissive; highlight selected part */
  Object.values(_meshes).forEach(m => {
    m.material.emissive.setHex(0x000000);
    m.material.emissiveIntensity = 0;
  });
  const _si = ITEM_LIST[_selItemIdx];
  if (_si?.type === 'part') {
    const m = _meshes[_si.name];
    if (m) { m.material.emissive.setHex(0xf8c000); m.material.emissiveIntensity = 0.35; }
  }

  if (_controls) _controls.update();
  _renderer.render(_scene, _camera);
  _drawHUD(canvas, S.armJoints ?? [0, 0, 0, 0, 0, 0]);
}

/* ══════════════════════════════════════════════════════════════
   HUD overlay
   ══════════════════════════════════════════════════════════════ */

function _drawHUD(canvas, joints) {
  if (!_hud) return;
  const dpr = window.devicePixelRatio || 1;
  const W   = canvas.offsetWidth * dpr, H = canvas.offsetHeight * dpr;
  if (_hud.width !== W || _hud.height !== H) { _hud.width = W; _hud.height = H; }

  const ctx = _hud.getContext('2d');
  ctx.clearRect(0, 0, W, H);
  ctx.textAlign = 'right';
  const rx = W - 12 * dpr;
  let   ry = 18 * dpr;
  const lh = 15 * dpr;

  /* Mode indicator + instructions */
  ctx.font = `${9 * dpr}px monospace`;
  if (_cartMode) {
    ctx.fillStyle = '#58a6ff';
    ctx.fillText('CART JOG  W/S=+X/-X  A/D=+Y/-Y  R/F=+Z/-Z  ↑↓=step  C=joint mode', rx, ry);
    ry += lh;
    const t = S.armTcp;
    ctx.fillStyle = '#58a6ff';
    ctx.fillText(
      t ? `TCP  X:${t.x.toFixed(3)}  Y:${t.y.toFixed(3)}  Z:${t.z.toFixed(3)}  step:${(_cartStep * 1000).toFixed(0)}mm`
        : `TCP  —  step:${(_cartStep * 1000).toFixed(0)}mm`,
      rx, ry,
    );
  } else {
    ctx.fillStyle = 'rgba(255,255,255,0.28)';
    ctx.fillText('[/]=prev  1-6=joint  X/Y/Z=axis  ←→=rot  ↑↓=move  Shift×5  H home  C=cart', rx, ry);
  }
  ry += lh * 1.1;

  /* Unified interleaved list */
  const fmt = (a, v, unit) =>
    `${a === _editAxis ? '[' : ''}${a.toUpperCase()}:${v}${unit}${a === _editAxis ? ']' : ''}`;

  ITEM_LIST.forEach((it, i) => {
    const sel = i === _selItemIdx;

    if (it.type === 'joint') {
      const angle = (joints[it.jIdx] ?? 0).toFixed(1);
      ctx.fillStyle = sel ? '#ffffff' : JCOLORS[it.jIdx];
      ctx.font      = sel ? `bold ${12 * dpr}px monospace` : `${11 * dpr}px monospace`;
      ctx.fillText(
        `J${it.jIdx + 1} ${JNAMES[it.jIdx].padEnd(13)}${String(angle + '°').padStart(8)}`,
        rx, ry,
      );
      ry += sel ? lh * 1.15 : lh;
    } else {
      const short = it.name.replace(/_SO101$/i, '').replace(/_/g, ' ');
      if (sel) {
        const mesh = _meshes[it.name];
        ctx.fillStyle = '#f8c000';
        ctx.font      = `bold ${11 * dpr}px monospace`;
        ctx.fillText(`P${it.pIdx} ${short}`, rx, ry);
        ry += lh;
        if (mesh) {
          const p = mesh.position, r = mesh.rotation;
          ctx.font = `${9 * dpr}px monospace`;
          ctx.fillText(
            `pos  ${fmt('x', (p.x * 1000).toFixed(1), 'mm')}  ` +
            `${fmt('y', (p.y * 1000).toFixed(1), 'mm')}  ` +
            `${fmt('z', (p.z * 1000).toFixed(1), 'mm')}`,
            rx, ry,
          );
          ry += lh;
          ctx.fillText(
            `rot  ${fmt('x', (r.x * 180 / PI).toFixed(1), '°')}  ` +
            `${fmt('y', (r.y * 180 / PI).toFixed(1), '°')}  ` +
            `${fmt('z', (r.z * 180 / PI).toFixed(1), '°')}`,
            rx, ry,
          );
          ry += lh * 1.2;
        }
      } else {
        ctx.fillStyle = 'rgba(200,180,130,0.45)';
        ctx.font      = `${9 * dpr}px monospace`;
        ctx.fillText(`P${it.pIdx} ${short}`, rx, ry);
        ry += lh * 0.85;
      }
    }
  });

  /* Gripper state at bottom */
  const grip = (S.armGripper ?? 0) > 0.5;
  ctx.fillStyle = grip ? '#f85149' : '#3fb950';
  ctx.font      = `${11 * dpr}px monospace`;
  ctx.fillText(`Gripper  ${grip ? 'CLOSED' : 'OPEN'}`, rx, H - 12 * dpr);
}
