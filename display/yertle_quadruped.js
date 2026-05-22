/* ═══════════════════════════════════════════════════════════════
   OpenSim — display/yertle_quadruped.js
   Yertle robot dog — Three.js renderer, URDF-accurate assembly.

   Joint hierarchy (from yertle.URDF):
     lf_shoulder [1]   lf_thigh [2]   lf_shin  [3]
     rf_shoulder [4]   rf_thigh [5]   rf_shin  [6]
     lb_shoulder [7]   lb_thigh [8]   lb_shin  [9]
     rb_shoulder [10]  rb_thigh [11]  rb_shin  [12]

   Shoulder joints rotate about local X  (URDF axis="1 0 0")
   Thigh / shin joints rotate about local Y  (URDF axis="0 1 0")

   Root carries rotation.x = −π/2 (URDF Z-up → Three.js Y-up).

   Input:
     [ / ]         — cycle prev / next joint
     1–9, 0, -, = — jump directly to joints 1–12
     ← →           — rotate selected joint  (Shift ×5)
     H             — home all joints (0°)
     L             — log mesh transforms to console
   ═══════════════════════════════════════════════════════════════ */

import { S, setState } from '../core/state.js';

const LEG_COLORS  = ['#58a6ff', '#3fb950', '#d29922', '#f85149'];  // LF RF LB RB
const JOINT_NAMES = [
  'LF Shoulder', 'LF Thigh', 'LF Shin',
  'RF Shoulder', 'RF Thigh', 'RF Shin',
  'LB Shoulder', 'LB Thigh', 'LB Shin',
  'RB Shoulder', 'RB Thigh', 'RB Shin',
];
const PART_COLOR = 0x8b9bb4;

let _renderer   = null;
let _scene      = null;
let _camera     = null;
let _controls   = null;
let _loaded     = false;
let _bound      = false;
let _hud        = null;
let _root       = null;
let _linkGroups = [];
let _meshes     = {};
let _selJoint   = 0;

const SCALE = 0.001;          // STL vertices in mm → metres
const PI    = Math.PI;
const HPI   = Math.PI / 2;
const DEG   = Math.PI / 180;

/* ──────────────────────────────────────────────────────────────
   URDF joint origins [tx, ty, tz]  (rpy all zero for every joint)
   Order per leg: [shoulder, thigh, shin]
   ────────────────────────────────────────────────────────────── */
const LEG_ORIGINS = [
  [[0.090,  0.037, 0], [0.025,  0.027, 0], [0, 0, -0.130]],  // LF
  [[0.090, -0.040, 0], [0.025, -0.027, 0], [0, 0, -0.130]],  // RF
  [[-0.081, 0.038, 0], [-0.043, 0.027, 0], [0, 0, -0.130]],  // LB
  [[-0.081,-0.040, 0], [-0.043,-0.027, 0], [0, 0, -0.130]],  // RB
];

/* ──────────────────────────────────────────────────────────────
   URDF visual origins
   [linkIdx, partName, file, tx, ty, tz, roll, pitch, yaw]
   ────────────────────────────────────────────────────────────── */
const VISUALS = [
  [1,  'lf_shoulder', 'Left Shoulder.stl',  0,  0,       0,  PI,      PI,  0    ],
  [4,  'rf_shoulder', 'Left Shoulder.stl',  0,  0,       0,  0,       0,   PI   ],
  [7,  'lb_shoulder', 'Left Shoulder.stl',  0,  0,       0,  PI,      PI,  0    ],
  [10, 'rb_shoulder', 'Left Shoulder.stl',  0,  0,       0,  PI,      PI,  0    ],
  [2,  'lf_thigh',    'Femur.stl',          0,  0,       0,  HPI,     0,   HPI  ],
  [5,  'rf_thigh',    'Femur.stl',          0,  0,       0,  4.71239, PI,  HPI  ],
  [8,  'lb_thigh',    'Femur.stl',          0,  0,       0,  HPI,     0,   HPI  ],
  [11, 'rb_thigh',    'Femur.stl',          0,  0,       0,  4.71239, PI,  HPI  ],
  [3,  'lf_shin',     'Inner Tibia.stl',    0,  0.008,   0,  0.610865, 0, -HPI  ],
  [6,  'rf_shin',     'Outer Tibia.stl',    0, -0.0045,  0,  0.610865, 0, -HPI  ],
  [9,  'lb_shin',     'Inner Tibia.stl',    0,  0.008,   0,  0.610865, 0, -HPI  ],
  [12, 'rb_shin',     'Outer Tibia.stl',    0, -0.0045,  0,  0.610865, 0, -HPI  ],
];

/* ══════════════════════════════════════════════════════════════
   Init / reset
   ══════════════════════════════════════════════════════════════ */

export function resetYertleQuadruped() {
  if (_controls) { _controls.dispose(); _controls = null; }
  if (_renderer) { _renderer.dispose(); _renderer = null; }
  if (_hud && _hud.parentElement) _hud.parentElement.removeChild(_hud);
  _hud = null; _root = null;
  _scene = null; _camera = null;
  _linkGroups = []; _meshes = {};
  _loaded = false; _bound = false;
  window.removeEventListener('keydown', _onKey);
}

export function initYertleQuadruped(canvas) {
  if (_loaded || _bound) return;
  _bound = true;

  if (!S.dogJoints) setState({ dogJoints: Array(12).fill(0) });

  /* HUD overlay */
  const par = canvas.parentElement;
  if (getComputedStyle(par).position === 'static') par.style.position = 'relative';
  _hud = document.createElement('canvas');
  _hud.style.cssText = 'position:absolute;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:10;';
  par.appendChild(_hud);

  /* Renderer */
  _renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, preserveDrawingBuffer: true });
  _renderer.setPixelRatio(window.devicePixelRatio);
  _renderer.setClearColor(0x0d1117, 1);
  _renderer.shadowMap.enabled = true;

  _scene = new THREE.Scene();

  /* Camera — isometric-ish view of the dog body */
  _camera = new THREE.PerspectiveCamera(45, 1, 0.001, 10);
  _camera.position.set(0.45, 0.25, 0.55);
  _camera.lookAt(0, -0.05, 0);

  /* Lighting */
  _scene.add(new THREE.AmbientLight(0xffffff, 0.6));
  const dir = new THREE.DirectionalLight(0xffffff, 1.2);
  dir.position.set(1, 2, 1.5);
  dir.castShadow = true;
  _scene.add(dir);
  const fill = new THREE.DirectionalLight(0x8899ff, 0.4);
  fill.position.set(-1, 0.5, -1);
  _scene.add(fill);

  /* Floor grid below the feet (~300 mm below body origin) */
  const grid = new THREE.GridHelper(0.8, 16, 0x222233, 0x1a1a2a);
  grid.position.y = -0.30;
  _scene.add(grid);

  /* Orbit controls */
  _controls = new THREE.OrbitControls(_camera, canvas);
  _controls.target.set(0, -0.05, 0);
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
   Build URDF kinematic tree
   _linkGroups[0]       = base_link
   _linkGroups[leg*3+1] = shoulder_link  (rotation.x)
   _linkGroups[leg*3+2] = thigh_link     (rotation.y)
   _linkGroups[leg*3+3] = shin_link      (rotation.y)
   ══════════════════════════════════════════════════════════════ */

function _buildLinks() {
  _root = new THREE.Group();
  _root.rotation.x = -HPI;
  _scene.add(_root);

  const base = new THREE.Group();
  _root.add(base);
  _linkGroups = [base];

  LEG_ORIGINS.forEach(([sOrig, tOrig, kOrig]) => {
    const sJoint = new THREE.Group();
    sJoint.position.set(...sOrig);
    base.add(sJoint);
    const shoulderLink = new THREE.Group();
    sJoint.add(shoulderLink);
    _linkGroups.push(shoulderLink);

    const tJoint = new THREE.Group();
    tJoint.position.set(...tOrig);
    shoulderLink.add(tJoint);
    const thighLink = new THREE.Group();
    tJoint.add(thighLink);
    _linkGroups.push(thighLink);

    const kJoint = new THREE.Group();
    kJoint.position.set(...kOrig);
    thighLink.add(kJoint);
    const shinLink = new THREE.Group();
    kJoint.add(shinLink);
    _linkGroups.push(shinLink);
  });
}

/* ══════════════════════════════════════════════════════════════
   Load STLs with URDF visual origins
   ══════════════════════════════════════════════════════════════ */

function _loadSTLs() {
  const loader = new THREE.STLLoader();
  const mat = new THREE.MeshPhongMaterial({
    color: PART_COLOR, specular: 0x334455, shininess: 40, side: THREE.DoubleSide,
  });

  VISUALS.forEach(([linkIdx, partName, file, tx, ty, tz, roll, pitch, yaw]) => {
    loader.load(`assets/yertle/${encodeURIComponent(file)}`, (geo) => {
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
    }, undefined, (err) => console.warn(`[dog] failed to load ${file}:`, err));
  });
}

/* ══════════════════════════════════════════════════════════════
   Apply joint angles each frame
   θ[leg*3+0] → shoulder  rotation.x
   θ[leg*3+1] → thigh     rotation.y
   θ[leg*3+2] → shin      rotation.y
   ══════════════════════════════════════════════════════════════ */

function _applyJoints(joints) {
  if (_linkGroups.length < 13) return;
  for (let leg = 0; leg < 4; leg++) {
    _linkGroups[leg * 3 + 1].rotation.x = joints[leg * 3 + 0] * DEG;
    _linkGroups[leg * 3 + 2].rotation.y = joints[leg * 3 + 1] * DEG;
    _linkGroups[leg * 3 + 3].rotation.y = joints[leg * 3 + 2] * DEG;
  }
}

/* ══════════════════════════════════════════════════════════════
   Keyboard handler
   ══════════════════════════════════════════════════════════════ */

const _NUM_MAP = { '1':0,'2':1,'3':2,'4':3,'5':4,'6':5,'7':6,'8':7,'9':8,'0':9,'-':10,'=':11 };

function _onKey(e) {
  if (e.key === ']') { _selJoint = (_selJoint + 1) % 12; return; }
  if (e.key === '[') { _selJoint = (_selJoint + 11) % 12; return; }

  if (e.key === 'h' || e.key === 'H') {
    setState({ dogJoints: Array(12).fill(0) });
    return;
  }

  if (e.key === 'l' || e.key === 'L') {
    console.log('\n[dog] mesh transforms:');
    Object.entries(_meshes).forEach(([name, mesh]) => {
      const p = mesh.position, r = mesh.rotation;
      console.log(
        `  '${name}'  pos(${p.x.toFixed(4)}, ${p.y.toFixed(4)}, ${p.z.toFixed(4)})` +
        `  rot(${(r.x * 180/PI).toFixed(1)}°, ${(r.y * 180/PI).toFixed(1)}°, ${(r.z * 180/PI).toFixed(1)}°)`,
      );
    });
    return;
  }

  if (e.key in _NUM_MAP) { _selJoint = _NUM_MAP[e.key]; return; }

  if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
    e.preventDefault();
    const joints = [...(S.dogJoints ?? Array(12).fill(0))];
    const step   = e.shiftKey ? 10 : 2;
    joints[_selJoint] += (e.key === 'ArrowRight' ? 1 : -1) * step;
    setState({ dogJoints: joints });
  }
}

/* ══════════════════════════════════════════════════════════════
   Render  (called every animation frame by the main loop)
   ══════════════════════════════════════════════════════════════ */

export function renderYertleQuadruped(canvas) {
  if (!canvas) return;
  if (!_loaded) { initYertleQuadruped(canvas); return; }

  const W = canvas.offsetWidth, H = canvas.offsetHeight;
  if (_renderer.domElement.width  !== W * devicePixelRatio ||
      _renderer.domElement.height !== H * devicePixelRatio) {
    _renderer.setSize(W, H, false);
    _camera.aspect = W / H;
    _camera.updateProjectionMatrix();
  }

  _applyJoints(S.dogJoints ?? Array(12).fill(0));

  if (_controls) _controls.update();
  _renderer.render(_scene, _camera);
  _drawHUD(canvas, S.dogJoints ?? Array(12).fill(0));
}

/* ══════════════════════════════════════════════════════════════
   HUD overlay — joint list
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

  ctx.font      = `${9 * dpr}px monospace`;
  ctx.fillStyle = 'rgba(255,255,255,0.28)';
  ctx.fillText('[/]=prev  1-0,-,==joints  ←→=rotate  Shift×5  H=home  L=log', rx, ry);
  ry += lh * 1.3;

  joints.forEach((angle, i) => {
    const sel   = i === _selJoint;
    const leg   = Math.floor(i / 3);
    const deg   = (angle ?? 0).toFixed(1);

    if (i > 0 && i % 3 === 0) ry += lh * 0.4;  // gap between legs

    ctx.fillStyle = sel ? '#ffffff' : LEG_COLORS[leg];
    ctx.font      = sel ? `bold ${12 * dpr}px monospace` : `${11 * dpr}px monospace`;
    ctx.fillText(
      `J${String(i + 1).padStart(2)} ${JOINT_NAMES[i].padEnd(13)}${String(deg + '°').padStart(8)}`,
      rx, ry,
    );
    ry += sel ? lh * 1.15 : lh;
  });
}
