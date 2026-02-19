const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

const levelInfoEl = document.getElementById('levelInfo');
const ballCountEl = document.getElementById('ballCount');
const regionCountEl = document.getElementById('regionCount');
const scoreEl = document.getElementById('score');
const statusEl = document.getElementById('status');

const difficultySelect = document.getElementById('difficultySelect');
const playerNameEl = document.getElementById('playerName');
const restartBtn = document.getElementById('restartBtn');
const nextLevelBtn = document.getElementById('nextLevelBtn');
const toggleAimBtn = document.getElementById('toggleAimBtn');
const highScoresListEl = document.getElementById('highScoresList');
const installHintEl = document.getElementById('installHint');
const scoreboardPanelEl = document.getElementById('scoreboardPanel');

const HIGH_SCORES_KEY = 'ball_splitter_high_scores_v1';
const MAX_HIGH_SCORES = 10;

const DIFFICULTY = {
  easy: {
    label: 'Easy',
    baseBalls: 1,
    speedMin: 90,
    speedMax: 125,
    speedUpPerCut: 1.05,
    baseWallSpeed: 430,
    targetCapture: 0.72,
    scoreMult: 0.9,
    ballGrowthInterval: 2,
    passiveSpeedRampPerSec: 0
  },
  normal: {
    label: 'Normal',
    baseBalls: 2,
    speedMin: 110,
    speedMax: 150,
    speedUpPerCut: 1.08,
    baseWallSpeed: 380,
    targetCapture: 0.75,
    scoreMult: 1,
    ballGrowthInterval: 2,
    passiveSpeedRampPerSec: 0
  },
  hard: {
    label: 'Hard',
    baseBalls: 3,
    speedMin: 130,
    speedMax: 180,
    speedUpPerCut: 1.11,
    baseWallSpeed: 330,
    targetCapture: 0.8,
    scoreMult: 1.2,
    ballGrowthInterval: 2,
    passiveSpeedRampPerSec: 0
  },
  elite: {
    label: 'Elite',
    baseBalls: 5,
    speedMin: 150,
    speedMax: 210,
    speedUpPerCut: 1.14,
    baseWallSpeed: 300,
    targetCapture: 0.84,
    scoreMult: 1.45,
    ballGrowthInterval: 1,
    passiveSpeedRampPerSec: 0.012
  }
};

const BASE = {
  minRadius: 7,
  maxRadius: 12,
  wallThickness: 6,
  minCutPadding: 18
};

const state = {
  balls: [],
  regions: [],
  nextRegionId: 1,
  activeCut: null,
  previewCut: null,
  orientation: 'vertical',
  status: 'running',
  level: 1,
  cutsCompleted: 0,
  runScore: 0,
  scoreSaved: false,
  difficultyKey: 'normal',
  levelCfg: null,
  levelClearReason: null,
  pointerId: null
};

const feedback = {
  audioCtx: null
};

function ensureAudioReady() {
  if (!window.AudioContext && !window.webkitAudioContext) {
    return null;
  }

  if (!feedback.audioCtx) {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    feedback.audioCtx = new Ctx();
  }

  if (feedback.audioCtx.state === 'suspended') {
    feedback.audioCtx.resume().catch(() => {});
  }

  return feedback.audioCtx;
}

function playTone(freq, duration, type, volume) {
  const audioCtx = ensureAudioReady();
  if (!audioCtx) {
    return;
  }

  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = type || 'sine';
  osc.frequency.value = freq;

  const now = audioCtx.currentTime;
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(volume || 0.06, now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start(now);
  osc.stop(now + duration);
}

function vibratePattern(pattern) {
  if (typeof navigator.vibrate === 'function') {
    navigator.vibrate(pattern);
  }
}

function triggerFeedback(kind) {
  if (kind === 'toggle') {
    playTone(740, 0.06, 'triangle', 0.045);
    vibratePattern(12);
    return;
  }

  if (kind === 'cutStart') {
    playTone(520, 0.05, 'square', 0.05);
    vibratePattern(10);
    return;
  }

  if (kind === 'split') {
    playTone(640, 0.05, 'triangle', 0.05);
    setTimeout(() => playTone(820, 0.06, 'triangle', 0.05), 45);
    vibratePattern([10, 20, 14]);
    return;
  }

  if (kind === 'levelwon') {
    playTone(660, 0.06, 'sine', 0.05);
    setTimeout(() => playTone(860, 0.07, 'sine', 0.05), 65);
    setTimeout(() => playTone(1060, 0.08, 'sine', 0.05), 130);
    vibratePattern([16, 18, 16]);
    return;
  }

  if (kind === 'gameover') {
    playTone(180, 0.12, 'sawtooth', 0.07);
    vibratePattern([24, 30, 24]);
  }
}

function rand(min, max) {
  return min + Math.random() * (max - min);
}

function makeRegion(x, y, w, h) {
  return { id: state.nextRegionId++, x, y, w, h };
}

function pointInRegion(x, y, region) {
  return x >= region.x && x <= region.x + region.w && y >= region.y && y <= region.y + region.h;
}

function pickRegionAt(x, y) {
  return state.regions.find((region) => pointInRegion(x, y, region));
}

function playableArea() {
  return state.regions.reduce((sum, region) => sum + region.w * region.h, 0);
}

function totalArea() {
  return canvas.clientWidth * canvas.clientHeight;
}

function captureRatio() {
  if (!state.regions.length) {
    return 1;
  }
  return 1 - playableArea() / totalArea();
}

function formatPct(value) {
  return `${Math.round(value * 100)}%`;
}

function currentDifficulty() {
  return DIFFICULTY[state.difficultyKey] || DIFFICULTY.normal;
}

function computeLevelConfig(level) {
  const d = currentDifficulty();
  const growthInterval = d.ballGrowthInterval || 2;
  return {
    ballCount: d.baseBalls + Math.floor((level - 1) / growthInterval),
    speedMin: d.speedMin + level * 7,
    speedMax: d.speedMax + level * 9,
    speedUpPerCut: d.speedUpPerCut,
    wallSpeed: Math.max(170, d.baseWallSpeed - level * 9),
    targetCapture: Math.min(0.9, d.targetCapture + level * 0.01),
    passiveSpeedRampPerSec: (d.passiveSpeedRampPerSec || 0) * (1 + (level - 1) * 0.08)
  };
}

function setCanvasSize() {
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.round(rect.width * dpr);
  canvas.height = Math.round(rect.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
}

function createBalls(region, count, speedMin, speedMax) {
  const balls = [];
  for (let i = 0; i < count; i += 1) {
    const r = rand(BASE.minRadius, BASE.maxRadius);
    const angle = rand(0, Math.PI * 2);
    const speed = rand(speedMin, speedMax);
    balls.push({
      x: rand(region.x + r, region.x + region.w - r),
      y: rand(region.y + r, region.y + region.h - r),
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      r,
      regionId: region.id
    });
  }
  return balls;
}

function assignBallRegions() {
  for (const ball of state.balls) {
    const region = pickRegionAt(ball.x, ball.y);
    if (region) {
      ball.regionId = region.id;
    }
  }
}

function statusText() {
  if (state.status === 'gameover') {
    return 'Run Over: ball hit building wall.';
  }

  if (state.status === 'levelwon') {
    if (state.levelClearReason === 'stalled') {
      return `No valid cuts left. Level ${state.level} cleared.`;
    }
    return `Level ${state.level} cleared. Continue to ${state.level + 1}.`;
  }

  return `Goal: capture ${formatPct(state.levelCfg.targetCapture)} this level.`;
}

function syncAimButton() {
  if (!toggleAimBtn) {
    return;
  }
  const mode = state.orientation === 'vertical' ? 'V' : 'H';
  toggleAimBtn.textContent = mode;
  toggleAimBtn.setAttribute('aria-label', `Aim ${mode}`);
}

function updateHud() {
  const d = currentDifficulty();
  levelInfoEl.textContent = `${d.label} | L${state.level}`;
  ballCountEl.textContent = `Balls: ${state.balls.length}`;
  regionCountEl.textContent = `Cuts: ${state.cutsCompleted} | Aim: ${state.orientation === 'vertical' ? 'V' : 'H'}`;
  scoreEl.textContent = `Score: ${Math.round(state.runScore)} | ${formatPct(captureRatio())}`;
  statusEl.textContent = statusText();
  nextLevelBtn.disabled = state.status !== 'levelwon';
  syncAimButton();
}

function loadHighScores() {
  try {
    const raw = localStorage.getItem(HIGH_SCORES_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveHighScores(scores) {
  localStorage.setItem(HIGH_SCORES_KEY, JSON.stringify(scores));
}

function renderHighScores() {
  const scores = loadHighScores();
  highScoresListEl.innerHTML = '';
  if (!scores.length) {
    const li = document.createElement('li');
    li.textContent = 'No scores yet';
    highScoresListEl.appendChild(li);
    return;
  }

  for (const entry of scores) {
    const li = document.createElement('li');
    li.textContent = `${entry.name} | ${entry.score} pts | L${entry.level} | ${entry.difficulty}`;
    highScoresListEl.appendChild(li);
  }
}

function saveRunScoreIfNeeded() {
  if (state.scoreSaved || state.runScore <= 0) {
    return;
  }
  const scores = loadHighScores();
  scores.push({
    name: (playerNameEl.value || 'Player').trim().slice(0, 12) || 'Player',
    score: Math.round(state.runScore),
    level: state.level,
    difficulty: currentDifficulty().label
  });

  scores.sort((a, b) => b.score - a.score);
  saveHighScores(scores.slice(0, MAX_HIGH_SCORES));
  state.scoreSaved = true;
  renderHighScores();
}

function startLevel(level) {
  state.level = level;
  state.levelCfg = computeLevelConfig(level);
  state.nextRegionId = 1;
  state.activeCut = null;
  state.previewCut = null;
  state.orientation = 'vertical';
  state.cutsCompleted = 0;
  state.status = 'running';
  state.levelClearReason = null;

  const full = makeRegion(0, 0, canvas.clientWidth, canvas.clientHeight);
  state.regions = [full];
  state.balls = createBalls(full, state.levelCfg.ballCount, state.levelCfg.speedMin, state.levelCfg.speedMax);
  updateHud();
}

function startNewRun() {
  state.difficultyKey = difficultySelect.value;
  state.runScore = 0;
  state.scoreSaved = false;
  startLevel(1);
}

function distancePointToSegment(px, py, x1, y1, x2, y2) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (dx === 0 && dy === 0) {
    return Math.hypot(px - x1, py - y1);
  }
  const t = Math.max(0, Math.min(1, ((px - x1) * dx + (py - y1) * dy) / (dx * dx + dy * dy)));
  const sx = x1 + t * dx;
  const sy = y1 + t * dy;
  return Math.hypot(px - sx, py - sy);
}

function maxBallRadiusInRegion(regionId) {
  let maxRadius = BASE.minRadius;
  for (const ball of state.balls) {
    if (ball.regionId === regionId) {
      maxRadius = Math.max(maxRadius, ball.r);
    }
  }
  return maxRadius;
}

function cutPaddingForRegion(regionId) {
  return Math.max(BASE.minCutPadding, maxBallRadiusInRegion(regionId) * 2 + 6);
}

function buildCutCandidate(region, orientation, x, y) {
  const padding = cutPaddingForRegion(region.id);

  if (orientation === 'vertical') {
    if (region.w < padding * 2) {
      return null;
    }
    const cut = Math.max(region.x + padding, Math.min(region.x + region.w - padding, x));
    return { region, orientation: 'vertical', cut, cursorAxis: y };
  }

  if (region.h < padding * 2) {
    return null;
  }
  const cut = Math.max(region.y + padding, Math.min(region.y + region.h - padding, y));
  return { region, orientation: 'horizontal', cut, cursorAxis: x };
}

function hasAnyValidCut() {
  for (const region of state.regions) {
    const centerX = region.x + region.w * 0.5;
    const centerY = region.y + region.h * 0.5;
    if (buildCutCandidate(region, 'vertical', centerX, centerY)) {
      return true;
    }
    if (buildCutCandidate(region, 'horizontal', centerX, centerY)) {
      return true;
    }
  }
  return false;
}

function getCutCandidate(x, y) {
  const region = pickRegionAt(x, y);
  if (!region) {
    return null;
  }

  const preferred = buildCutCandidate(region, state.orientation, x, y);
  if (preferred) {
    return preferred;
  }

  const fallbackOrientation = state.orientation === 'vertical' ? 'horizontal' : 'vertical';
  const fallback = buildCutCandidate(region, fallbackOrientation, x, y);
  if (fallback) {
    state.orientation = fallbackOrientation;
    syncAimButton();
    return fallback;
  }

  return null;
}

function updatePreview(x, y) {
  const candidate = getCutCandidate(x, y);
  state.previewCut = candidate
    ? {
        regionId: candidate.region.id,
        orientation: candidate.orientation,
        cut: candidate.cut,
        cursorAxis: candidate.cursorAxis
      }
    : null;
}

function startCutFromPreview(x, y) {
  if (!state.previewCut || state.status !== 'running' || state.activeCut) {
    return;
  }

  const region = state.regions.find((r) => r.id === state.previewCut.regionId);
  if (!region) {
    state.previewCut = null;
    return;
  }

  if (state.previewCut.orientation === 'vertical') {
    const pos = Math.max(region.y, Math.min(region.y + region.h, y));
    state.activeCut = {
      regionId: region.id,
      orientation: 'vertical',
      cut: state.previewCut.cut,
      negPos: pos,
      posPos: pos,
      negDone: false,
      posDone: false
    };
  } else {
    const pos = Math.max(region.x, Math.min(region.x + region.w, x));
    state.activeCut = {
      regionId: region.id,
      orientation: 'horizontal',
      cut: state.previewCut.cut,
      negPos: pos,
      posPos: pos,
      negDone: false,
      posDone: false
    };
  }

  triggerFeedback('cutStart');
  state.previewCut = null;
}

function failsActiveCut(region) {
  if (!state.activeCut) {
    return false;
  }

  let x1;
  let y1;
  let x2;
  let y2;

  if (state.activeCut.orientation === 'vertical') {
    x1 = state.activeCut.cut;
    x2 = state.activeCut.cut;
    y1 = state.activeCut.negPos;
    y2 = state.activeCut.posPos;
  } else {
    y1 = state.activeCut.cut;
    y2 = state.activeCut.cut;
    x1 = state.activeCut.negPos;
    x2 = state.activeCut.posPos;
  }

  for (const ball of state.balls) {
    if (ball.regionId !== region.id) {
      continue;
    }
    if (distancePointToSegment(ball.x, ball.y, x1, y1, x2, y2) <= ball.r + BASE.wallThickness * 0.5) {
      return true;
    }
  }
  return false;
}

function speedUpBalls() {
  for (const ball of state.balls) {
    ball.vx *= state.levelCfg.speedUpPerCut;
    ball.vy *= state.levelCfg.speedUpPerCut;
  }
}

function awardPoints(beforeCapture, afterCapture) {
  const delta = Math.max(0, afterCapture - beforeCapture);
  const diff = currentDifficulty();
  state.runScore += delta * 10000 * diff.scoreMult * (1 + state.level * 0.15);
}

function settleSplit(region, orientation, cut) {
  const beforeCapture = captureRatio();

  let a;
  let b;
  if (orientation === 'vertical') {
    a = makeRegion(region.x, region.y, cut - region.x, region.h);
    b = makeRegion(cut, region.y, region.x + region.w - cut, region.h);
  } else {
    a = makeRegion(region.x, region.y, region.w, cut - region.y);
    b = makeRegion(region.x, cut, region.w, region.y + region.h - cut);
  }

  const next = state.regions.filter((r) => r.id !== region.id);
  next.push(a, b);
  state.regions = next;
  assignBallRegions();

  const aHasBall = state.balls.some((ball) => ball.regionId === a.id);
  const bHasBall = state.balls.some((ball) => ball.regionId === b.id);

  if (!aHasBall) {
    state.regions = state.regions.filter((r) => r.id !== a.id);
  }
  if (!bHasBall) {
    state.regions = state.regions.filter((r) => r.id !== b.id);
  }

  const afterCapture = captureRatio();
  awardPoints(beforeCapture, afterCapture);

  state.cutsCompleted += 1;
  speedUpBalls();
  triggerFeedback('split');

  if (afterCapture >= state.levelCfg.targetCapture) {
    state.runScore += 500 * state.level * currentDifficulty().scoreMult;
    state.levelClearReason = 'target';
    state.status = 'levelwon';
    triggerFeedback('levelwon');
    return;
  }

  if (!hasAnyValidCut()) {
    state.levelClearReason = 'stalled';
    state.status = 'levelwon';
    triggerFeedback('levelwon');
  }
}

function updateBalls(dt) {
  const passiveRamp = state.levelCfg ? state.levelCfg.passiveSpeedRampPerSec : 0;
  const frameBoost = passiveRamp > 0 ? 1 + passiveRamp * dt : 1;

  for (const ball of state.balls) {
    const region = state.regions.find((r) => r.id === ball.regionId);
    if (!region) {
      continue;
    }

    if (frameBoost !== 1) {
      ball.vx *= frameBoost;
      ball.vy *= frameBoost;
    }

    ball.x += ball.vx * dt;
    ball.y += ball.vy * dt;

    const left = region.x + ball.r;
    const right = region.x + region.w - ball.r;
    const top = region.y + ball.r;
    const bottom = region.y + region.h - ball.r;

    if (ball.x < left) {
      ball.x = left;
      ball.vx *= -1;
    } else if (ball.x > right) {
      ball.x = right;
      ball.vx *= -1;
    }

    if (ball.y < top) {
      ball.y = top;
      ball.vy *= -1;
    } else if (ball.y > bottom) {
      ball.y = bottom;
      ball.vy *= -1;
    }
  }
}

function updateActiveCut(dt) {
  if (!state.activeCut || state.status !== 'running') {
    return;
  }

  const region = state.regions.find((r) => r.id === state.activeCut.regionId);
  if (!region) {
    state.activeCut = null;
    return;
  }

  const step = state.levelCfg.wallSpeed * dt;

  if (state.activeCut.orientation === 'vertical') {
    state.activeCut.negPos = Math.max(region.y, state.activeCut.negPos - step);
    state.activeCut.posPos = Math.min(region.y + region.h, state.activeCut.posPos + step);
    state.activeCut.negDone = state.activeCut.negPos <= region.y;
    state.activeCut.posDone = state.activeCut.posPos >= region.y + region.h;
  } else {
    state.activeCut.negPos = Math.max(region.x, state.activeCut.negPos - step);
    state.activeCut.posPos = Math.min(region.x + region.w, state.activeCut.posPos + step);
    state.activeCut.negDone = state.activeCut.negPos <= region.x;
    state.activeCut.posDone = state.activeCut.posPos >= region.x + region.w;
  }

  if (failsActiveCut(region)) {
    state.activeCut = null;
    state.status = 'gameover';
    triggerFeedback('gameover');
    saveRunScoreIfNeeded();
    updateHud();
    return;
  }

  if (state.activeCut.negDone && state.activeCut.posDone) {
    settleSplit(region, state.activeCut.orientation, state.activeCut.cut);
    state.activeCut = null;
    updateHud();
  }
}

function drawRegions() {
  ctx.fillStyle = '#0b1a2a';
  ctx.fillRect(0, 0, canvas.clientWidth, canvas.clientHeight);

  for (const region of state.regions) {
    ctx.fillStyle = '#fff8e8';
    ctx.fillRect(region.x, region.y, region.w, region.h);
    ctx.strokeStyle = '#0d243b';
    ctx.lineWidth = 2;
    ctx.strokeRect(region.x, region.y, region.w, region.h);
  }
}

function drawPreviewCut() {
  if (!state.previewCut || state.activeCut || state.status !== 'running') {
    return;
  }

  const region = state.regions.find((r) => r.id === state.previewCut.regionId);
  if (!region) {
    return;
  }

  ctx.save();
  ctx.strokeStyle = '#00b8ff';
  ctx.lineWidth = 3;
  ctx.setLineDash([7, 6]);
  ctx.beginPath();
  if (state.previewCut.orientation === 'vertical') {
    ctx.moveTo(state.previewCut.cut, region.y);
    ctx.lineTo(state.previewCut.cut, region.y + region.h);
  } else {
    ctx.moveTo(region.x, state.previewCut.cut);
    ctx.lineTo(region.x + region.w, state.previewCut.cut);
  }
  ctx.stroke();
  ctx.restore();
}

function drawActiveCut() {
  if (!state.activeCut) {
    return;
  }

  ctx.strokeStyle = '#ff2b63';
  ctx.lineWidth = BASE.wallThickness;
  ctx.beginPath();
  if (state.activeCut.orientation === 'vertical') {
    ctx.moveTo(state.activeCut.cut, state.activeCut.negPos);
    ctx.lineTo(state.activeCut.cut, state.activeCut.posPos);
  } else {
    ctx.moveTo(state.activeCut.negPos, state.activeCut.cut);
    ctx.lineTo(state.activeCut.posPos, state.activeCut.cut);
  }
  ctx.stroke();
}

function drawBalls() {
  for (const ball of state.balls) {
    ctx.beginPath();
    ctx.fillStyle = '#112b46';
    ctx.arc(ball.x, ball.y, ball.r, 0, Math.PI * 2);
    ctx.fill();

    ctx.beginPath();
    ctx.fillStyle = '#ffffffb8';
    ctx.arc(ball.x - ball.r * 0.33, ball.y - ball.r * 0.33, ball.r * 0.36, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawOverlayMessage() {
  if (state.status === 'running') {
    return;
  }

  ctx.fillStyle = 'rgba(6, 13, 24, 0.55)';
  ctx.fillRect(0, 0, canvas.clientWidth, canvas.clientHeight);

  ctx.fillStyle = '#ffffff';
  ctx.font = '700 30px Trebuchet MS, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  if (state.status === 'levelwon') {
    ctx.fillText('LEVEL CLEAR', canvas.clientWidth * 0.5, canvas.clientHeight * 0.47);
    ctx.font = '700 18px Trebuchet MS, sans-serif';
    ctx.fillText('Tap Next Level', canvas.clientWidth * 0.5, canvas.clientHeight * 0.55);
  } else {
    ctx.fillText('RUN OVER', canvas.clientWidth * 0.5, canvas.clientHeight * 0.5);
  }
}

function draw() {
  drawRegions();
  drawPreviewCut();
  drawActiveCut();
  drawBalls();
  drawOverlayMessage();
}

function toggleOrientation() {
  state.orientation = state.orientation === 'vertical' ? 'horizontal' : 'vertical';
  triggerFeedback('toggle');
  updateHud();
}

function getCanvasPos(e) {
  const rect = canvas.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

let lastTs = performance.now();
function tick(ts) {
  const dt = Math.min((ts - lastTs) / 1000, 0.033);
  lastTs = ts;

  if (state.status === 'running') {
    updateBalls(dt);
    updateActiveCut(dt);
  }

  draw();
  requestAnimationFrame(tick);
}

canvas.addEventListener('pointerdown', (e) => {
  ensureAudioReady();

  if (state.status !== 'running' || state.activeCut) {
    return;
  }

  state.pointerId = e.pointerId;
  canvas.setPointerCapture(e.pointerId);
  const pos = getCanvasPos(e);
  updatePreview(pos.x, pos.y);
});

canvas.addEventListener('pointermove', (e) => {
  if (state.pointerId !== e.pointerId || state.activeCut) {
    return;
  }
  const pos = getCanvasPos(e);
  updatePreview(pos.x, pos.y);
});

function releasePointer(e) {
  if (state.pointerId !== e.pointerId) {
    return;
  }

  const pos = getCanvasPos(e);
  startCutFromPreview(pos.x, pos.y);
  state.pointerId = null;
  state.previewCut = null;
}

canvas.addEventListener('pointerup', releasePointer);
canvas.addEventListener('pointercancel', releasePointer);

window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') {
    e.preventDefault();
    toggleOrientation();
  }

  if (e.code === 'Enter' && state.status === 'levelwon') {
    startLevel(state.level + 1);
  }
});

restartBtn.addEventListener('click', () => {
  startNewRun();
});

nextLevelBtn.addEventListener('click', () => {
  if (state.status === 'levelwon') {
    startLevel(state.level + 1);
  }
});

if (toggleAimBtn) {
  toggleAimBtn.addEventListener('click', () => {
    ensureAudioReady();
    toggleOrientation();
  });
}

difficultySelect.addEventListener('change', () => {
  startNewRun();
});

const syncViewportHeight = () => {
  const vv = window.visualViewport;
  const height = vv ? vv.height : window.innerHeight;
  document.documentElement.style.setProperty('--app-height', Math.round(height) + 'px');
};

function updateInstallHint() {
  if (!installHintEl) {
    return;
  }

  const ua = navigator.userAgent || '';
  const isiOS = /iPhone|iPad|iPod/i.test(ua);
  const standalone = window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true;
  installHintEl.classList.toggle('hidden', !isiOS || standalone);
}

if (window.visualViewport) {
  window.visualViewport.addEventListener('resize', syncViewportHeight);
}
window.addEventListener('orientationchange', syncViewportHeight);

window.addEventListener('resize', () => {
  syncViewportHeight();
  const previousWidth = canvas.clientWidth || 1;
  const previousHeight = canvas.clientHeight || 1;
  setCanvasSize();
  const sx = canvas.clientWidth / previousWidth;
  const sy = canvas.clientHeight / previousHeight;

  for (const region of state.regions) {
    region.x *= sx;
    region.y *= sy;
    region.w *= sx;
    region.h *= sy;
  }

  for (const ball of state.balls) {
    ball.x *= sx;
    ball.y *= sy;
  }

  if (state.activeCut) {
    if (state.activeCut.orientation === 'vertical') {
      state.activeCut.cut *= sx;
      state.activeCut.negPos *= sy;
      state.activeCut.posPos *= sy;
    } else {
      state.activeCut.cut *= sy;
      state.activeCut.negPos *= sx;
      state.activeCut.posPos *= sx;
    }
  }

  updateHud();
});

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {});
  });
}

syncViewportHeight();
setCanvasSize();
renderHighScores();
startNewRun();
updateInstallHint();

if (scoreboardPanelEl && window.matchMedia('(max-width: 720px)').matches) {
  scoreboardPanelEl.open = false;
} else if (scoreboardPanelEl) {
  scoreboardPanelEl.open = true;
}

requestAnimationFrame(tick);
