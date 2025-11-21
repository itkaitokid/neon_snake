const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// --- Constants & Config ---
const GRID_SIZE = 20;
const TILE_COUNT = canvas.width / GRID_SIZE; // 30x30 grid
const MIN_OPEN_AREA = Math.max(10, Math.floor(TILE_COUNT / 3));
const SCORE_GROWTH_BASE = 1.5;
const SCORE_BASE_SCALE = 0.19;
const HUNGER_INTERVAL = 5; // seconds without eating
const HUNGER_SPEED_STEP = 1; // additional speed per interval
const BASE_LEVEL_SPEED = 5;
const LEVEL_SPEED_STEP_INTERVAL = 4;
const MAX_LEVEL_SPEED = 20;
const HUNGER_FIB_SEQUENCE = [1, 2, 3, 5];
const SPECIAL_RESPAWN_INTERVAL = 10; // seconds between spawns
const SPECIAL_LIFETIME = 5; // seconds a special food stays
const WALL_BREAK_DURATION = 10; // seconds of wall breaking
const AUTO_RETRY_DELAY = 600; // ms before auto-restarting in auto play

const COLORS = {
    snakeHead: '#00ff88',
    snakeBody: '#00cc6a',
    food: '#ff0055',
    wall: '#00ccff',
    particle: '#ffffff'
};

// --- Game State ---
let state = {
    snake: [],
    velocity: { x: 0, y: 0 },
    foods: [],
    score: 0n,
    level: 1,
    isRunning: false,
    isPaused: false,
    lastRenderTime: 0,
    obstacles: [], // Array of {x, y}
    particles: [], // Array of particle objects
    autoPlay: false,
    levelScoreSnapshot: 0,
    timeSinceLastFood: 0,
    speedBoost: 0,
    previousUpdateTime: null,
    hungerCount: 0,
    specialFood: null,
    specialFoodTimer: 0,
    wallBreakTimer: 0,
    specialSpawnTimer: 0
};
let autoRetryTimeout = null;

// Level Configuration
const TOTAL_LEVELS = 200;
const BASE_PATTERN_POOL = [
    'none',
    'border',
    'center_block',
    'tunnel',
    'random',
    'cross',
    'diag_lines',
    'box_maze',
    'grid_dots',
    'spiral',
    'plus_maze',
    'final_boss'
];
const LEVELS = generateLevelConfigs(TOTAL_LEVELS);

function generateLevelConfigs(totalLevels) {
    const configs = [];
    for (let i = 1; i <= totalLevels; i++) {
        const growthSteps = Math.floor((i - 1) / LEVEL_SPEED_STEP_INTERVAL);
        const speed = Math.min(BASE_LEVEL_SPEED + growthSteps, MAX_LEVEL_SPEED);
        const scoreMultiplier = +(1 + (i - 1) * 0.05).toFixed(2);
        configs.push({
            speed,
            scoreMultiplier,
            patterns: buildPatternMix(i)
        });
    }
    return configs;
}

function getLevelConfig(levelNumber) {
    const index = Math.min(Math.max(levelNumber - 1, 0), LEVELS.length - 1);
    return LEVELS[index];
}

function getFoodGoal(levelNumber) {
    const mod = levelNumber % 10;
    const tens = Math.floor(levelNumber / 10);
    return Math.max(1, mod + tens);
}

function getFoodBatchSize(levelNumber = state.level) {
    const goal = getFoodGoal(levelNumber);
    return Math.max(1, Math.ceil(goal / 2));
}

function shouldAllowDeadEndPlacement(eatenCount = state.foodEaten || 0) {
    const foodGoal = getFoodGoal(state.level);
    return eatenCount + 1 >= foodGoal;
}

function createRNG(seed) {
    let s = seed >>> 0;
    return function () {
        s = (s + 0x6D2B79F5) | 0;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function buildPatternMix(levelNumber) {
    const rng = createRNG(levelNumber * 1337 + 17);
    const mix = [];
    const pool = [...BASE_PATTERN_POOL];
    
    const baseIndex = (levelNumber - 1) % pool.length;
    mix.push(instantiatePattern(pool[baseIndex], levelNumber, rng));
    pool.splice(baseIndex, 1);
    
    const mixSize = Math.min(4, 1 + Math.floor(levelNumber / 18) + (rng() > 0.6 ? 1 : 0));
    for (let i = 0; i < mixSize && pool.length; i++) {
        const pickIndex = Math.floor(rng() * pool.length);
        const type = pool.splice(pickIndex, 1)[0];
        mix.push(instantiatePattern(type, levelNumber, rng));
    }

    if (!mix.some(p => p.type === 'random')) {
        mix.push(instantiatePattern('random', levelNumber, rng));
    }

    return mix.filter(Boolean);
}

function instantiatePattern(type, levelNumber, rng) {
    switch (type) {
        case 'border': {
            const gateSize = levelNumber < 25 ? 1 : 2;
            return {
                type: 'border',
                gateSize,
                gatePositions: [
                    Math.floor(TILE_COUNT / 2),
                    Math.floor((TILE_COUNT / 4) + (rng() * TILE_COUNT / 4))
                ]
            };
        }
        case 'center_block':
            return {
                type: 'center_block',
                size: 3 + (levelNumber % 4),
                offset: 3 + Math.floor(rng() * 4)
            };
        case 'tunnel':
            return {
                type: 'tunnel',
                offsets: [
                    Math.floor(rng() * 10),
                    Math.floor(rng() * 15)
                ]
            };
        case 'random':
            return {
                type: 'random',
                density: 0.01 + Math.min(0.06, (levelNumber / TOTAL_LEVELS) * 0.05 + rng() * 0.02)
            };
        case 'cross':
            return {
                type: 'cross',
                thickness: 1 + (levelNumber % 2),
                gap: Math.max(4, 8 - Math.floor(levelNumber / 10))
            };
        case 'diag_lines':
            return {
                type: 'diag_lines',
                width: 2,
                spacing: 5 + (levelNumber % 4)
            };
        case 'box_maze':
            return {
                type: 'box_maze',
                ringStep: 4 + (levelNumber % 3),
                gateSize: 1 + (levelNumber % 2)
            };
        case 'grid_dots':
            return {
                type: 'grid_dots',
                spacing: 3 + (levelNumber % 3),
                offset: Math.floor(rng() * 3)
            };
        case 'spiral':
            return {
                type: 'spiral',
                spacing: 3 + (levelNumber % 2)
            };
        case 'plus_maze':
            return {
                type: 'plus_maze',
                spacing: 5 + (levelNumber % 4)
            };
        case 'final_boss':
            return {
                type: 'final_boss',
                chaosDensity: 0.04 + (levelNumber / TOTAL_LEVELS) * 0.03
            };
        case 'none':
        default:
            return { type: 'none' };
    }
}

function createObstacleAdder(collection) {
    const occupied = new Set();
    return (x, y) => {
        if (x < 0 || x >= TILE_COUNT || y < 0 || y >= TILE_COUNT) return;
        const key = toKey(x, y);
        if (occupied.has(key)) return false;
        occupied.add(key);
        collection.push({ x, y });
        return true;
    };
}

function applyPattern(spec = {}, addObstacle, rng) {
    const type = spec.type || 'none';
    const rand = rng || Math.random;
    
    if (type === 'combo' && Array.isArray(spec.patterns)) {
        spec.patterns.forEach(child => applyPattern(child, addObstacle, rand));
        return;
    }
    
    switch (type) {
        case 'none':
            return;
        case 'border': {
            const gateSize = spec.gateSize ?? 0;
            const gates = spec.gatePositions || [Math.floor(TILE_COUNT / 2)];
            const skip = (i) => gateSize > 0 && gates.some(g => Math.abs(i - g) <= gateSize);
            for (let i = 0; i < TILE_COUNT; i++) {
                if (!skip(i)) {
                    addObstacle(i, 0);
                    addObstacle(i, TILE_COUNT - 1);
                }
            }
            for (let i = 0; i < TILE_COUNT; i++) {
                if (!skip(i)) {
                    addObstacle(0, i);
                    addObstacle(TILE_COUNT - 1, i);
                }
            }
            break;
        }
        case 'center_block': {
            const size = Math.max(2, spec.size || 4);
            const offset = Math.max(2, spec.offset || 5);
            const positions = [
                { x: offset, y: offset },
                { x: TILE_COUNT - offset - size, y: offset },
                { x: offset, y: TILE_COUNT - offset - size },
                { x: TILE_COUNT - offset - size, y: TILE_COUNT - offset - size }
            ];
            positions.forEach(pos => {
                for (let dx = 0; dx < size; dx++) {
                    for (let dy = 0; dy < size; dy++) {
                        addObstacle(pos.x + dx, pos.y + dy);
                    }
                }
            });
            break;
        }
        case 'tunnel': {
            const offsets = spec.offsets || [0, 0];
            const walls = [
                { x: 4 + offsets[0], y: 5, len: 10, dir: 'h' },
                { x: 10 + offsets[1], y: 18, len: 12, dir: 'h' },
                { x: 15, y: 4 + offsets[0], len: 12, dir: 'v' },
                { x: 6, y: 12 + offsets[1], len: 9, dir: 'v' }
            ];
            walls.forEach(w => {
                for (let i = 0; i < w.len; i++) {
                    if (w.dir === 'h') {
                        addObstacle((w.x + i) % TILE_COUNT, w.y % TILE_COUNT);
                    } else {
                        addObstacle(w.x % TILE_COUNT, (w.y + i) % TILE_COUNT);
                    }
                }
            });
            break;
        }
        case 'random': {
            const density = spec.density || 0.02;
            const count = spec.count || Math.max(5, Math.round(density * TILE_COUNT * TILE_COUNT));
            let attempts = 0;
            let placed = 0;
            while (placed < count && attempts < count * 5) {
                const x = Math.floor(rand() * TILE_COUNT);
                const y = Math.floor(rand() * TILE_COUNT);
                if (addObstacle(x, y)) {
                    placed++;
                }
                attempts++;
            }
            break;
        }
        case 'cross': {
            const center = Math.floor(TILE_COUNT / 2);
            const thickness = spec.thickness || 1;
            const padding = spec.gap || 4;
            for (let offset = -thickness; offset <= thickness; offset++) {
                for (let i = padding; i < TILE_COUNT - padding; i++) {
                    addObstacle(i, center + offset);
                    addObstacle(center + offset, i);
                }
            }
            break;
        }
        case 'diag_lines': {
            const spacing = spec.spacing || 6;
            const width = spec.width || 2;
            for (let i = 0; i < TILE_COUNT; i++) {
                if (i % spacing < width) {
                    addObstacle(i, i);
                    addObstacle(TILE_COUNT - 1 - i, i);
                }
            }
            break;
        }
        case 'box_maze': {
            const step = spec.ringStep || 5;
            const gateSize = spec.gateSize || 1;
            for (let b = step; b < TILE_COUNT / 2 - 1; b += step) {
                for (let i = b; i < TILE_COUNT - b; i++) {
                    const skip = Math.abs(i - Math.floor(TILE_COUNT / 2)) <= gateSize;
                    if (!skip) {
                        addObstacle(i, b);
                        addObstacle(i, TILE_COUNT - 1 - b);
                        addObstacle(b, i);
                        addObstacle(TILE_COUNT - 1 - b, i);
                    }
                }
            }
            break;
        }
        case 'grid_dots': {
            const spacing = Math.max(2, spec.spacing || 4);
            const offset = spec.offset || 2;
            for (let x = offset; x < TILE_COUNT; x += spacing) {
                for (let y = offset; y < TILE_COUNT; y += spacing) {
                    addObstacle(x, y);
                }
            }
            break;
        }
        case 'spiral': {
            let min = spec.spacing || 3;
            let max = TILE_COUNT - (spec.spacing || 3) - 1;
            while (min <= max) {
                for (let x = min; x <= max; x++) {
                    addObstacle(x, min);
                    addObstacle(x, max);
                }
                for (let y = min; y <= max; y++) {
                    addObstacle(min, y);
                    addObstacle(max, y);
                }
                min += (spec.spacing || 3);
                max -= (spec.spacing || 3);
            }
            break;
        }
        case 'plus_maze': {
            const spacing = spec.spacing || 6;
            for (let x = spacing; x < TILE_COUNT - spacing; x += spacing) {
                for (let y = spacing; y < TILE_COUNT - spacing; y += spacing) {
                    addObstacle(x, y);
                    addObstacle(x + 1, y);
                    addObstacle(x - 1, y);
                    addObstacle(x, y + 1);
                    addObstacle(x, y - 1);
                }
            }
            break;
        }
        case 'final_boss': {
            applyPattern({ type: 'border', gateSize: 1 }, addObstacle, rand);
            applyPattern({ type: 'cross', thickness: 1 }, addObstacle, rand);
            const density = spec.chaosDensity || 0.05;
            applyPattern({ type: 'random', density }, addObstacle, rand);
            break;
        }
        default:
            break;
    }
}

// --- Elements ---
const scoreEl = document.getElementById('score');
const levelEl = document.getElementById('level');
const finalScoreEl = document.getElementById('final-score');
const startScreen = document.getElementById('start-screen');
const gameOverScreen = document.getElementById('game-over-screen');
const levelUpScreen = document.getElementById('level-up-screen');
const autoPlayBtn = document.getElementById('autoplay-btn');
const controlButtons = document.querySelectorAll('.control-btn');
const dirToArrow = {
    up: 'ArrowUp',
    down: 'ArrowDown',
    left: 'ArrowLeft',
    right: 'ArrowRight'
};
const arrowToDir = {
    ArrowUp: 'up',
    ArrowDown: 'down',
    ArrowLeft: 'left',
    ArrowRight: 'right'
};
const controlButtonMap = {};
controlButtons.forEach(btn => {
    controlButtonMap[btn.dataset.dir] = btn;
});

// --- Input Handling ---
let inputQueue = []; // Buffer inputs to prevent self-collision on quick turns

const DIRECTION_VECTORS = [
    { key: 'ArrowUp', x: 0, y: -1 },
    { key: 'ArrowDown', x: 0, y: 1 },
    { key: 'ArrowLeft', x: -1, y: 0 },
    { key: 'ArrowRight', x: 1, y: 0 }
];

const DIRECTION_MAP = DIRECTION_VECTORS.reduce((map, dir) => {
    map[dir.key] = dir;
    return map;
}, {});

const INITIAL_DIRECTION_PRIORITY = ['ArrowUp', 'ArrowRight', 'ArrowLeft', 'ArrowDown'];

document.addEventListener('keydown', (e) => {
    if (!state.isRunning) return;
    
    const code = e.code;
    const key = e.key.toLowerCase();

    // Prevent default scrolling for arrow keys and Space
    if(["ArrowUp","ArrowDown","ArrowLeft","ArrowRight", "Space"].indexOf(code) > -1) {
        e.preventDefault();
    }

    // WASD Support
    if (code === 'KeyW' || key === 'w') queueArrowKey('ArrowUp');
    else if (code === 'KeyS' || key === 's') queueArrowKey('ArrowDown');
    else if (code === 'KeyA' || key === 'a') queueArrowKey('ArrowLeft');
    else if (code === 'KeyD' || key === 'd') queueArrowKey('ArrowRight');
    else if (code.startsWith('Arrow')) queueArrowKey(code);
});

controlButtons.forEach(btn => {
    btn.addEventListener('touchstart', (e) => {
        e.preventDefault();
        enqueueDirection(btn.dataset.dir);
    }, { passive: false });
    btn.addEventListener('click', () => {
        enqueueDirection(btn.dataset.dir);
    });
});

function enqueueDirection(dir) {
    queueArrowKey(dirToArrow[dir]);
}

function queueArrowKey(arrowKey) {
    if (!state.isRunning || !arrowKey) return;
    inputQueue.push(arrowKey);
    highlightControlButton(arrowKey);
}

function highlightControlButton(arrowKey) {
    controlButtons.forEach(btn => btn.classList.remove('active'));
    const dir = arrowToDir[arrowKey];
    if (dir && controlButtonMap[dir]) {
        controlButtonMap[dir].classList.add('active');
    }
}
// --- Mobile Touch Controls ---
let touchStartX = 0;
let touchStartY = 0;

canvas.addEventListener('touchstart', (e) => {
    touchStartX = e.changedTouches[0].screenX;
    touchStartY = e.changedTouches[0].screenY;
    e.preventDefault(); // Stop scrolling
}, {passive: false});

canvas.addEventListener('touchend', (e) => {
    const touchEndX = e.changedTouches[0].screenX;
    const touchEndY = e.changedTouches[0].screenY;
    
    const dx = touchEndX - touchStartX;
    const dy = touchEndY - touchStartY;
    
    if (Math.abs(dx) > Math.abs(dy)) {
        // Horizontal Swipe
        if (Math.abs(dx) > 30) { // Threshold
            inputQueue.push(dx > 0 ? 'ArrowRight' : 'ArrowLeft');
        }
    } else {
        // Vertical Swipe
        if (Math.abs(dy) > 30) {
            inputQueue.push(dy > 0 ? 'ArrowDown' : 'ArrowUp');
        }
    }
    e.preventDefault();
}, {passive: false});

if (autoPlayBtn) {
    autoPlayBtn.addEventListener('click', () => toggleAutoPlay());
    updateAutoPlayButton();
}

function processInput() {
    if (inputQueue.length === 0) return;

    const key = inputQueue.shift();
    const goingUp = state.velocity.y === -1;
    const goingDown = state.velocity.y === 1;
    const goingRight = state.velocity.x === 1;
    const goingLeft = state.velocity.x === -1;

    switch (key) {
        case 'ArrowUp':
            if (!goingDown) state.velocity = { x: 0, y: -1 };
            break;
        case 'ArrowDown':
            if (!goingUp) state.velocity = { x: 0, y: 1 };
            break;
        case 'ArrowLeft':
            if (!goingRight) state.velocity = { x: -1, y: 0 };
            break;
        case 'ArrowRight':
            if (!goingLeft) state.velocity = { x: 1, y: 0 };
            break;
    }
}

// --- Game Logic ---

function findStartPlacement(head, obstacleKeys) {
    if (!head) return null;
    for (let key of INITIAL_DIRECTION_PRIORITY) {
        const dir = DIRECTION_MAP[key];
        if (!dir) continue;
        const segments = buildInitialSegments(head, dir, obstacleKeys);
        if (segments) {
            return {
                segments,
                velocity: { x: dir.x, y: dir.y }
            };
        }
    }
    return null;
}

function buildInitialSegments(head, direction, obstacleKeys) {
    if (!direction) return null;
    const nextHead = applyDirection(head, direction);
    if (obstacleKeys.has(toKey(nextHead.x, nextHead.y))) {
        return null;
    }
    const segments = [{ x: head.x, y: head.y }];
    const tailDir = { x: -direction.x, y: -direction.y };
    let current = { ...head };
    for (let i = 1; i < 3; i++) {
        current = applyDirection(current, tailDir);
        const key = toKey(current.x, current.y);
        if (obstacleKeys.has(key)) {
            return null;
        }
        segments.push({ x: current.x, y: current.y });
    }
    return segments;
}

function findFirstAvailablePlacement(obstacleKeys) {
    for (let x = 0; x < TILE_COUNT; x++) {
        for (let y = 0; y < TILE_COUNT; y++) {
            const candidate = { x, y };
            const placement = findStartPlacement(candidate, obstacleKeys);
            if (placement) {
                return {
                    position: candidate,
                    placement
                };
            }
        }
    }
    return null;
}

// Removed initGame in favor of startNewGame/startLevelLogic split
function resetSnake() {
    state.wallBreakTimer = Math.max(state.wallBreakTimer || 0, 5);
    const obstacleKeys = buildObstacleKeySet();
    const tryPositions = [
        { x: 5, y: 5 },
        { x: Math.floor(TILE_COUNT / 2), y: Math.floor(TILE_COUNT / 2) }
    ];
    let spawnConfig = null;
    let bestCandidate = null;
    let bestArea = -1;

    const evaluateCandidate = (candidate) => {
        const placement = findStartPlacement(candidate, obstacleKeys);
        if (!placement) return false;
        const area = getReachableAreaSize(candidate, obstacleKeys);
        if (area > bestArea) {
            bestArea = area;
            bestCandidate = {
                position: { ...candidate },
                placement
            };
        }
        if (area >= MIN_OPEN_AREA) {
            spawnConfig = {
                position: { ...candidate },
                placement
            };
            return true;
        }
        return false;
    };

    tryPositions.some(evaluateCandidate);

    if (!spawnConfig) {
        for (let x = 1; x < TILE_COUNT - 1 && !spawnConfig; x++) {
            for (let y = 1; y < TILE_COUNT - 3; y++) {
                if (evaluateCandidate({ x, y })) break;
            }
        }
    }

    if (!spawnConfig && bestCandidate) {
        spawnConfig = bestCandidate;
    }

    if (!spawnConfig) {
        spawnConfig = findFirstAvailablePlacement(obstacleKeys);
    }

    const placement = spawnConfig.placement || findStartPlacement(spawnConfig.position, obstacleKeys);
    if (placement) {
        state.snake = placement.segments;
        state.velocity = placement.velocity;
    } else {
        const fallback = spawnConfig.position || { x: 5, y: 5 };
        state.snake = [
            { x: fallback.x, y: fallback.y },
            { x: fallback.x, y: (fallback.y + 1) % TILE_COUNT },
            { x: fallback.x, y: (fallback.y + 2) % TILE_COUNT }
    ];
    state.velocity = { x: 0, y: -1 };
    }
    state.foodEaten = 0;
}

function buildObstacleKeySet() {
    const keys = new Set();
    state.obstacles.forEach(obs => keys.add(toKey(obs.x, obs.y)));
    return keys;
}

function canPlaceSnakeSegments(x, y, obstacleKeys) {
    return Boolean(findStartPlacement({ x, y }, obstacleKeys));
}

function getReachableAreaSize(start, obstacleKeys) {
    if (!start) return 0;
    const startKey = toKey(start.x, start.y);
    if (obstacleKeys.has(startKey)) return 0;
    const visited = new Set([startKey]);
    const queue = [{ ...start }];
    while (queue.length) {
        const current = queue.shift();
        for (let dir of DIRECTION_VECTORS) {
            const neighbor = applyDirection(current, dir);
            const key = toKey(neighbor.x, neighbor.y);
            if (visited.has(key)) continue;
            if (obstacleKeys.has(key)) continue;
            visited.add(key);
            queue.push(neighbor);
        }
    }
    return visited.size;
}

function loadLevel(levelIndex) {
    state.level = levelIndex;
    levelEl.innerText = state.level;
    
    // Generate obstacles based on level
    state.obstacles = [];
    const config = getLevelConfig(levelIndex);
    const patterns = (config.patterns && config.patterns.length)
        ? config.patterns
        : [{ type: config.obstacles || 'none' }];
    
    const rng = createRNG(levelIndex * 7919);
    const addObstacle = createObstacleAdder(state.obstacles);
    
    patterns.forEach(spec => applyPattern(spec, addObstacle, rng));
    ensureFlowLanes(levelIndex);
    ensureConnectivity(levelIndex);
    enforceWallDensity();
}

function ensureFlowLanes(levelIndex) {
    const lanes = buildLanePlan(levelIndex);
    if (!lanes.length) return;
    state.obstacles = state.obstacles.filter(obs => {
        return !lanes.some(lane => {
            if (lane.axis === 'row') {
                return Math.abs(obs.y - lane.coord) <= lane.thickness;
            }
            return Math.abs(obs.x - lane.coord) <= lane.thickness;
        });
    });
}

function buildLanePlan(levelIndex) {
    const lanes = [];
    const mid = Math.floor(TILE_COUNT / 2);
    const third = Math.floor(TILE_COUNT / 3);
    const defaultThickness = 0; // inclusive

    // Always ensure at least one horizontal and vertical lane
    lanes.push({
        axis: 'row',
        coord: (mid + levelIndex) % TILE_COUNT,
        thickness: defaultThickness
    });
    lanes.push({
        axis: 'col',
        coord: (mid + Math.floor(levelIndex / 2)) % TILE_COUNT,
        thickness: defaultThickness
    });

    if (levelIndex === 29) {
        lanes.push(
            { axis: 'row', coord: mid, thickness: 1 },
            { axis: 'col', coord: mid, thickness: 1 },
            { axis: 'row', coord: third, thickness: 0 },
            { axis: 'col', coord: TILE_COUNT - third - 1, thickness: 0 }
        );
    }

    return lanes;
}

function ensureConnectivity(levelIndex) {
    const blockedSet = new Set(state.obstacles.map(obs => toKey(obs.x, obs.y)));
    const openCells = [];
    for (let x = 0; x < TILE_COUNT; x++) {
        for (let y = 0; y < TILE_COUNT; y++) {
            const key = toKey(x, y);
            if (!blockedSet.has(key)) {
                openCells.push({ x, y });
            }
        }
    }

    if (!openCells.length) {
        const mid = Math.floor(TILE_COUNT / 2);
        const key = toKey(mid, mid);
        blockedSet.delete(key);
        openCells.push({ x: mid, y: mid });
    }

    const start = openCells[0];
    const openTotal = openCells.length;
    let reachable = floodFillReachable(start, blockedSet);
    let guard = 0;

    while (reachable.size < openTotal && guard < 50) {
        const unreachable = openCells.find(cell => !reachable.has(toKey(cell.x, cell.y)));
        if (!unreachable) break;
        const path = findConnectionPath(unreachable, reachable, blockedSet);
        if (!path || !path.length) break;
        path.forEach(cell => blockedSet.delete(toKey(cell.x, cell.y)));
        reachable = floodFillReachable(start, blockedSet);
        guard++;
    }

    state.obstacles = Array.from(blockedSet).map(keyToCoord);
}

function enforceWallDensity(maxRatio = 0.5) {
    const totalTiles = TILE_COUNT * TILE_COUNT;
    const maxWalls = Math.floor(totalTiles * maxRatio);
    if (state.obstacles.length <= maxWalls) return;
    
    const rng = createRNG(state.level * 997 + 71);
    const decorated = state.obstacles.map(obs => ({
        obs,
        weight: rng()
    }));
    decorated.sort((a, b) => a.weight - b.weight);
    state.obstacles = decorated.slice(0, maxWalls).map(entry => entry.obs);
    
    ensureRowColumnGaps();
}

function ensureRowColumnGaps() {
    const blocked = new Set(state.obstacles.map(obs => toKey(obs.x, obs.y)));
    for (let y = 0; y < TILE_COUNT; y++) {
        let blockedCount = 0;
        for (let x = 0; x < TILE_COUNT; x++) {
            if (blocked.has(toKey(x, y))) blockedCount++;
        }
        if (blockedCount >= TILE_COUNT) {
            const remover = state.obstacles.find(obs => obs.y === y);
            if (remover) {
                blocked.delete(toKey(remover.x, remover.y));
            }
        }
    }
    for (let x = 0; x < TILE_COUNT; x++) {
        let blockedCount = 0;
        for (let y = 0; y < TILE_COUNT; y++) {
            if (blocked.has(toKey(x, y))) blockedCount++;
        }
        if (blockedCount >= TILE_COUNT) {
            const remover = state.obstacles.find(obs => obs.x === x);
            if (remover) {
                blocked.delete(toKey(remover.x, remover.y));
            }
        }
    }
    state.obstacles = Array.from(blocked).map(keyToCoord);
}

function floodFillReachable(start, blockedSet) {
    const startKey = toKey(start.x, start.y);
    if (blockedSet.has(startKey)) {
        return new Set();
    }
    const visited = new Set([startKey]);
    const queue = [{ ...start }];
    while (queue.length) {
        const current = queue.shift();
        for (let dir of DIRECTION_VECTORS) {
            const neighbor = applyDirection(current, dir);
            const key = toKey(neighbor.x, neighbor.y);
            if (visited.has(key) || blockedSet.has(key)) continue;
            visited.add(key);
            queue.push(neighbor);
        }
    }
    return visited;
}

function findConnectionPath(start, targetSet, blockedSet) {
    const startKey = toKey(start.x, start.y);
    const queue = [{ ...start }];
    const visited = new Set([startKey]);
    const parent = new Map();

    while (queue.length) {
        const current = queue.shift();
        const currentKey = toKey(current.x, current.y);
        if (targetSet.has(currentKey)) {
            return reconstructPath(currentKey, parent);
        }
        for (let dir of DIRECTION_VECTORS) {
            const neighbor = applyDirection(current, dir);
            const key = toKey(neighbor.x, neighbor.y);
            if (visited.has(key)) continue;
            visited.add(key);
            parent.set(key, currentKey);
            queue.push(neighbor);
        }
    }
    return null;
}

function reconstructPath(key, parent) {
    const path = [];
    let currentKey = key;
    path.push(keyToCoord(currentKey));
    while (parent.has(currentKey)) {
        currentKey = parent.get(currentKey);
        path.push(keyToCoord(currentKey));
    }
    return path;
}

// Helper to check if position is occupied
function isPositionOccupied(x, y, options = {}) {
    const { ignoreTail = false, ignoreWalls = false } = options;
    // Check obstacles
    if (!ignoreWalls) {
        for (let obs of state.obstacles) {
            if (obs.x === x && obs.y === y) return true;
        }
    }
    // Check snake
    const snakeSegments = ignoreTail ? state.snake.slice(0, -1) : state.snake;
    for (let segment of snakeSegments) {
        if (segment.x === x && segment.y === y) return true;
    }
    return false;
}

function spawnFoodBatch() {
    const goal = getFoodGoal(state.level);
    const batchSize = getFoodBatchSize();
    state.foods = [];
    state.timeSinceLastFood = 0;
    state.speedBoost = 0;
    state.previousUpdateTime = null;
    state.hungerCount = 0;
    state.specialFood = null;
    state.specialFoodTimer = 0;
    for (let i = 0; i < batchSize; i++) {
        spawnSingleFood({
            requireReachable: true,
            allowDeadEnd: shouldAllowDeadEndPlacement(state.foodEaten || 0)
        });
    }
}

function spawnSingleFood(options = {}) {
    const settings = {
        requireReachable: false,
        allowDeadEnd: true,
        relaxedDeadEnd: false,
        relaxedReachable: false,
        ...options
    };
    let valid = false;
    let attempts = 0;
    const maxAttempts = 500;
    while (!valid && attempts < maxAttempts) {
        const candidate = {
            x: Math.floor(Math.random() * TILE_COUNT),
            y: Math.floor(Math.random() * TILE_COUNT)
        };
        
        if (isValidFoodSpot(candidate.x, candidate.y, settings)) {
            addFoodToState(candidate);
        valid = true;
        }
        attempts++;
    }
    
    // Fallback: Scan grid if random fails
    if (!valid) {
        for (let x = 0; x < TILE_COUNT; x++) {
             for (let y = 0; y < TILE_COUNT; y++) {
                 if (isValidFoodSpot(x, y, settings)) {
                     addFoodToState({ x, y });
                     valid = true;
                break;
            }
        }
             if (valid) break;
        }
    }

    if (!valid) {
        if (!settings.allowDeadEnd && !settings.relaxedDeadEnd) {
            console.warn('No turn-friendly food spot found. Relaxing dead-end constraint.');
            spawnSingleFood({
                ...settings,
                allowDeadEnd: true,
                relaxedDeadEnd: true
            });
            return;
        }
        if (settings.requireReachable && !settings.relaxedReachable) {
            console.warn('No reachable food position found. Relaxing reachability constraint.');
            spawnSingleFood({
                ...settings,
                requireReachable: false,
                relaxedReachable: true
            });
            return;
        }
    }
}

function addFoodToState(pos) {
    if (!pos) return;
    const exists = state.foods.some(food => food.x === pos.x && food.y === pos.y);
    if (!exists) {
        state.foods.push({ x: pos.x, y: pos.y });
    }
}

function removeFood(target) {
    if (!target) return;
    state.foods = state.foods.filter(food => !(food.x === target.x && food.y === target.y));
}

function getCollidingFood(pos) {
    if (!pos) return null;
    return state.foods.find(food => food.x === pos.x && food.y === pos.y) || null;
}

function isValidFoodSpot(x, y, options = {}) {
    const { requireReachable = false, allowDeadEnd = true } = options;
    if (isPositionOccupied(x, y)) return false;
    if (state.foods.some(food => food.x === x && food.y === y)) return false;
    if (state.snake.length && state.snake[0].x === x && state.snake[0].y === y) return false;
    if (requireReachable && !isReachableFromSnake(x, y)) return false;
    if (!allowDeadEnd && isDeadEnd(x, y)) return false;
    return true;
}

function isReachableFromSnake(x, y) {
    if (!state.snake.length) return true;
    const head = state.snake[0];
    return hasPath(head, { x, y }, { ignoreTail: true });
}

function getOpenNeighborCount(x, y) {
    let count = 0;
    for (let dir of DIRECTION_VECTORS) {
        const nx = (x + dir.x + TILE_COUNT) % TILE_COUNT;
        const ny = (y + dir.y + TILE_COUNT) % TILE_COUNT;
        if (!isPositionOccupied(nx, ny)) {
            count++;
        }
    }
    return count;
}

function isDeadEnd(x, y) {
    return getOpenNeighborCount(x, y) <= 1;
}

function hasPath(start, target, options = {}) {
    if (!start || !target) return false;
    const ignoreTail = options.ignoreTail || false;
    const blocked = buildBlockedSet(ignoreTail);
    const startKey = toKey(start.x, start.y);
    const targetKey = toKey(target.x, target.y);

    const queue = [{ ...start }];
    const visited = new Set([startKey]);

    while (queue.length) {
        const current = queue.shift();
        const currentKey = toKey(current.x, current.y);
        if (currentKey === targetKey) return true;

        for (let dir of DIRECTION_VECTORS) {
            const neighbor = applyDirection(current, dir);
            const key = toKey(neighbor.x, neighbor.y);
            if (visited.has(key)) continue;
            if (key !== targetKey && blocked.has(key)) continue;
            visited.add(key);
            queue.push(neighbor);
        }
    }
    return false;
}

function getAutoPlayMove() {
    if (!state.autoPlay) return null;
    if (!state.foods.length) return null;
    
    const ignoreWalls = Boolean(state.wallBreakTimer && state.wallBreakTimer > 0);
    
    const safeDirection = findSafeFoodDirection(true, { ignoreWalls });
    if (safeDirection && !isOppositeDirection(DIRECTION_VECTORS.find(d => d.key === safeDirection))) {
        return safeDirection;
    }
    
    let direction = findPathDirection({ ignoreWalls });
    if (direction && !isOppositeDirection(direction)) {
        return direction.key;
    }
    direction = findSafeFallbackDirection({ ignoreWalls });
    if (direction && !isOppositeDirection(direction)) {
        return direction.key;
    }
    return null;
}

function findPathDirection(options = {}) {
    if (!state.snake.length || state.foods.length === 0) return null;
    const head = state.snake[0];
    const target = getClosestFood(head);
    if (!target) return null;
    const headKey = toKey(head.x, head.y);
    const targetKey = toKey(target.x, target.y);
    const queue = [{ ...head }];
    const visited = new Set([headKey]);
    const prev = new Map();
    const blocked = buildBlockedSet(false, options);
    let foundKey = null;
    
    while (queue.length > 0) {
        const current = queue.shift();
        const currentKey = toKey(current.x, current.y);
        if (currentKey === targetKey) {
            foundKey = currentKey;
                    break;
                }
        for (let dir of DIRECTION_VECTORS) {
            const neighbor = applyDirection(current, dir);
            const key = toKey(neighbor.x, neighbor.y);
            if (visited.has(key)) continue;
            const isTarget = key === targetKey;
            if (!isTarget && blocked.has(key)) continue;
            visited.add(key);
            prev.set(key, { from: currentKey, dirKey: dir.key });
            queue.push(neighbor);
        }
    }
    
    if (!foundKey) return null;
    if (foundKey === headKey) return null;
    
    let stepKey = foundKey;
    while (prev.has(stepKey)) {
        const data = prev.get(stepKey);
        if (data.from === headKey) {
            return DIRECTION_VECTORS.find(d => d.key === data.dirKey) || null;
        }
        stepKey = data.from;
    }
    return null;
}

function findSafeFallbackDirection(options = {}) {
    if (!state.snake.length) return null;
    const head = state.snake[0];
    const target = getClosestFood(head) || head;
    let bestDirection = null;
    let bestScore = Infinity;
    
    for (let dir of DIRECTION_VECTORS) {
        if (isOppositeDirection(dir)) continue;
        const nextPos = applyDirection(head, dir);
        if (isPositionOccupied(nextPos.x, nextPos.y, options)) continue;
        const score = computeWrapDistance(nextPos, target);
        if (score < bestScore) {
            bestScore = score;
            bestDirection = dir;
        }
    }
    return bestDirection;
}

const SCORE_SUFFIXES = [
    { value: 10n ** 33n, suffix: 'Dc' },
    { value: 10n ** 30n, suffix: 'No' },
    { value: 10n ** 27n, suffix: 'Oc' },
    { value: 10n ** 24n, suffix: 'Sp' },
    { value: 10n ** 21n, suffix: 'Sx' },
    { value: 10n ** 18n, suffix: 'Qi' },
    { value: 10n ** 15n, suffix: 'Q' },
    { value: 10n ** 12n, suffix: 'T' },
    { value: 10n ** 9n, suffix: 'B' },
    { value: 10n ** 6n, suffix: 'M' },
    { value: 10n ** 3n, suffix: 'K' }
];

function formatScore(value) {
    const bigValue = BigInt(value);
    for (let { value: threshold, suffix } of SCORE_SUFFIXES) {
        if (bigValue >= threshold) {
            const scaled = Number(bigValue) / Number(threshold);
            return scaled.toFixed(2).replace(/\.?0+$/, '') + suffix;
        }
    }
    return bigValue.toString();
}

function formatNumberWithCommas(value) {
    return BigInt(value).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

function getRainbowColor(time, offset = 0) {
    const hue = (time / 15 + offset * 20) % 360;
    return `hsl(${hue}, 100%, 65%)`;
}

function applyHungerPenalty() {
    while ((state.timeSinceLastFood || 0) >= HUNGER_INTERVAL) {
        state.timeSinceLastFood -= HUNGER_INTERVAL;
        state.speedBoost = (state.speedBoost || 0) + HUNGER_SPEED_STEP;
        const fibCount = HUNGER_FIB_SEQUENCE[Math.min(state.hungerCount, HUNGER_FIB_SEQUENCE.length - 1)];
        state.hungerCount = Math.min(state.hungerCount + 1, HUNGER_FIB_SEQUENCE.length - 1);
        for (let i = 0; i < fibCount; i++) {
            spawnSingleFood({
                requireReachable: true,
                allowDeadEnd: shouldAllowDeadEndPlacement(state.foodEaten || 0)
            });
        }
    }
}

function findSafeFoodDirection(includeSpecial = false, options = {}) {
    if (!state.snake.length) return null;
    const head = state.snake[0];
    let candidates = [...state.foods];
    if (includeSpecial && state.specialFood) {
        candidates.unshift({ ...state.specialFood, special: true });
    }
    const foods = candidates.sort((a, b) => computeWrapDistance(head, a) - computeWrapDistance(head, b));
    for (let food of foods) {
        const path = findPathToFood(food, options);
        if (!path || path.length === 0) continue;
        if (food.special || options.ignoreWalls || pathEnsuresEscape(path, options)) {
            const direction = directionFromStep(head, path[0]);
            if (direction) return direction;
        }
    }
    return null;
}

function findPathToFood(target, options = {}) {
    if (!state.snake.length || !target) return null;
    const head = state.snake[0];
    const headKey = toKey(head.x, head.y);
    const targetKey = toKey(target.x, target.y);
    const queue = [{ ...head }];
    const visited = new Set([headKey]);
    const prev = new Map();
    const blocked = buildBlockedSet(false, options);
    
    while (queue.length) {
        const current = queue.shift();
        const currentKey = toKey(current.x, current.y);
        if (currentKey === targetKey) {
            return reconstructFullPath(targetKey, prev);
        }
        for (let dir of DIRECTION_VECTORS) {
            const neighbor = applyDirection(current, dir);
            const key = toKey(neighbor.x, neighbor.y);
            if (visited.has(key)) continue;
            const isTarget = key === targetKey;
            if (!isTarget && blocked.has(key)) continue;
            visited.add(key);
            prev.set(key, { from: currentKey, position: neighbor });
            queue.push(neighbor);
        }
    }
    return null;
}

function reconstructFullPath(targetKey, prev) {
    const nodes = [];
    let currentKey = targetKey;
    while (prev.has(currentKey)) {
        const info = prev.get(currentKey);
        nodes.unshift({ ...info.position });
        currentKey = info.from;
    }
    return nodes;
}

function pathEnsuresEscape(path, options = {}) {
    if (!path || !path.length) return false;
    if (options.ignoreWalls || (state.wallBreakTimer && state.wallBreakTimer > 0)) return true;
    const simulated = simulatePath(path);
    if (!simulated || !simulated.length) return false;
    const head = simulated[0];
    const open = getOpenNeighborCountCustom(head, simulated, options);
    return open > 0;
}

function simulatePath(path) {
    const simSnake = state.snake.map(seg => ({ ...seg }));
    for (let i = 0; i < path.length; i++) {
        const step = path[i];
        simSnake.unshift({ x: step.x, y: step.y });
        if (i < path.length - 1) {
            simSnake.pop();
        }
    }
    return simSnake;
}

function getOpenNeighborCountCustom(head, snakeSegments, options = {}) {
    let count = 0;
    for (let dir of DIRECTION_VECTORS) {
        const nx = (head.x + dir.x + TILE_COUNT) % TILE_COUNT;
        const ny = (head.y + dir.y + TILE_COUNT) % TILE_COUNT;
        if (!isOccupiedCustom(nx, ny, snakeSegments, options)) {
            count++;
        }
    }
    return count;
}

function isOccupiedCustom(x, y, snakeSegments, options = {}) {
    if (!options.ignoreWalls) {
        for (let obs of state.obstacles) {
            if (obs.x === x && obs.y === y) return true;
        }
    }
    for (let segment of snakeSegments) {
        if (segment.x === x && segment.y === y) return true;
    }
    return false;
}

function isSnakeOccupying(x, y, options = {}) {
    const { includeTail = true } = options;
    if (state.snake.length <= 1) return false;
    const limit = includeTail ? state.snake.length : Math.max(state.snake.length - 1, 1);
    for (let i = 1; i < limit; i++) {
        const segment = state.snake[i];
        if (segment.x === x && segment.y === y) {
            return true;
        }
    }
    return false;
}

function directionFromStep(head, step) {
    for (let dir of DIRECTION_VECTORS) {
        const nx = (head.x + dir.x + TILE_COUNT) % TILE_COUNT;
        const ny = (head.y + dir.y + TILE_COUNT) % TILE_COUNT;
        if (nx === step.x && ny === step.y) {
            return dir.key;
        }
    }
    return null;
}

function updateSpecialTimers(deltaSeconds = 0) {
    if (state.specialFood) {
        state.specialFoodTimer -= deltaSeconds;
        if (state.specialFoodTimer <= 0) {
            state.specialFood = null;
            state.specialFoodTimer = 0;
            state.specialSpawnTimer = 0;
        }
    }
    if (state.wallBreakTimer && state.wallBreakTimer > 0) {
        state.wallBreakTimer = Math.max(state.wallBreakTimer - deltaSeconds, 0);
    }
}

function maybeSpawnSpecialFood() {
    if (state.specialFood) return;
    if ((state.specialSpawnTimer || 0) < SPECIAL_RESPAWN_INTERVAL) return;
    spawnSpecialFood();
}

function spawnSpecialFood() {
    for (let attempt = 0; attempt < 200; attempt++) {
        const x = Math.floor(Math.random() * TILE_COUNT);
        const y = Math.floor(Math.random() * TILE_COUNT);
        if (!isValidFoodSpot(x, y, { requireReachable: true, allowDeadEnd: true })) continue;
        state.specialFood = { x, y };
        state.specialFoodTimer = SPECIAL_LIFETIME;
        state.specialSpawnTimer = 0;
        return;
    }
}

function getClosestFood(origin) {
    if (!origin || state.foods.length === 0) return null;
    let closest = null;
    let bestScore = Infinity;
    for (let food of state.foods) {
        const score = computeWrapDistance(origin, food);
        if (score < bestScore) {
            bestScore = score;
            closest = food;
        }
    }
    return closest;
}

function buildBlockedSet(ignoreTail = false, options = {}) {
    const blocked = new Set();
    if (!options.ignoreWalls) {
        state.obstacles.forEach(obs => blocked.add(toKey(obs.x, obs.y)));
    }
    const limit = ignoreTail ? Math.max(state.snake.length - 1, 1) : state.snake.length;
    for (let i = 1; i < limit; i++) {
        const segment = state.snake[i];
        blocked.add(toKey(segment.x, segment.y));
    }
    return blocked;
}

function applyDirection(position, dir) {
    return {
        x: (position.x + dir.x + TILE_COUNT) % TILE_COUNT,
        y: (position.y + dir.y + TILE_COUNT) % TILE_COUNT
    };
}

function toKey(x, y) {
    return `${x},${y}`;
}

function keyToCoord(key) {
    const [x, y] = key.split(',').map(Number);
    return { x, y };
}

function computeWrapDistance(a, b) {
    if (!a || !b) return Infinity;
    const dx = Math.min(Math.abs(a.x - b.x), TILE_COUNT - Math.abs(a.x - b.x));
    const dy = Math.min(Math.abs(a.y - b.y), TILE_COUNT - Math.abs(a.y - b.y));
    return dx + dy;
}

function isOppositeDirection(dir) {
    if (state.snake.length <= 1) return false;
    return dir.x === -state.velocity.x && dir.y === -state.velocity.y;
}

function update(currentTime) {
    const config = getLevelConfig(state.level);
    const speed = config.speed + (state.speedBoost || 0);
    
    if ((currentTime - state.lastRenderTime) / 1000 < 1 / speed) return false;
    
    state.lastRenderTime = currentTime;
    
    const deltaSeconds = state.previousUpdateTime ? (currentTime - state.previousUpdateTime) / 1000 : 0;
    state.previousUpdateTime = currentTime;
    state.timeSinceLastFood = (state.timeSinceLastFood || 0) + deltaSeconds;
    state.specialSpawnTimer = (state.specialSpawnTimer || 0) + deltaSeconds;
    updateSpecialTimers(deltaSeconds);
    applyHungerPenalty();
    maybeSpawnSpecialFood();
    
    const autoMove = getAutoPlayMove();
    if (autoMove) {
        inputQueue = [autoMove];
        highlightControlButton(autoMove);
    }
    
    processInput();

    const head = { ...state.snake[0] };
    head.x += state.velocity.x;
    head.y += state.velocity.y;

    // Wall Wrapping (if no border obstacle) or Collision
    // For this version, let's implement wrapping by default, 
    // but if there is an obstacle at the wrap point, it dies.
    if (head.x < 0) head.x = TILE_COUNT - 1;
    if (head.x >= TILE_COUNT) head.x = 0;
    if (head.y < 0) head.y = TILE_COUNT - 1;
    if (head.y >= TILE_COUNT) head.y = 0;

    const eatenFood = getCollidingFood(head);
    const willEat = Boolean(eatenFood);

    // Check Death
    if (checkCollision(head, willEat)) {
        gameOver();
        return false;
    }

    state.snake.unshift(head);

    // Eat Food
    let ateSpecial = false;
    if (state.specialFood && head.x === state.specialFood.x && head.y === state.specialFood.y) {
        ateSpecial = true;
        state.specialFood = null;
        state.specialFoodTimer = 0;
    }

    if (willEat || ateSpecial) {
        const config = getLevelConfig(state.level);
        const baseScore = 10;
        const multiplier = config.scoreMultiplier || 1;
        const levelFactor = Math.pow(SCORE_GROWTH_BASE, state.level);
        const points = BigInt(Math.round(SCORE_BASE_SCALE * baseScore * multiplier * levelFactor));
        
        state.score += points;
        scoreEl.innerText = formatScore(state.score);
        if (ateSpecial) {
            state.wallBreakTimer = WALL_BREAK_DURATION;
        }
        if (!ateSpecial && eatenFood) {
            createParticles(eatenFood.x * GRID_SIZE, eatenFood.y * GRID_SIZE, COLORS.food);
            removeFood(eatenFood);
            
        state.foodEaten = (state.foodEaten || 0) + 1;
            const foodGoal = getFoodGoal(state.level);
        
            if (state.foodEaten >= foodGoal) {
             state.foodEaten = 0; // Reset for next level
             levelUp();
            } else if (state.foods.length < getFoodBatchSize()) {
                spawnSingleFood({
                    requireReachable: true,
                    allowDeadEnd: shouldAllowDeadEndPlacement(state.foodEaten)
                });
            }
            state.timeSinceLastFood = 0;
            state.speedBoost = 0;
            state.previousUpdateTime = currentTime;
        }
    } else {
        state.snake.pop();
    }
    
    return true;
}

function checkCollision(pos, willEat = false) {
    // Self collision
    const snakeLength = state.snake.length;
    const limit = willEat ? snakeLength : Math.max(snakeLength - 1, 0);
    for (let i = 0; i < limit; i++) {
        if (pos.x === state.snake[i].x && pos.y === state.snake[i].y) {
            return true;
        }
    }
    // Obstacle collision
    for (let i = 0; i < state.obstacles.length; i++) {
        const obs = state.obstacles[i];
        if (pos.x === obs.x && pos.y === obs.y) {
            if (state.wallBreakTimer && state.wallBreakTimer > 0) {
                state.obstacles.splice(i, 1);
                i--;
                continue;
            }
            return true;
        }
    }
    return false;
}

function levelUp() {
    state.isPaused = true;
    levelUpScreen.classList.remove('hidden');
    levelUpScreen.classList.add('active');
    
    setTimeout(() => {
        state.level++;
        loadLevel(state.level);
        state.levelScoreSnapshot = Number(state.score);
        resetSnake();
        inputQueue = [];
        spawnFoodBatch();
        state.foodEaten = 0;
        state.lastRenderTime = 0;
        
        levelUpScreen.classList.add('hidden');
        levelUpScreen.classList.remove('active');
        state.isPaused = false;
    }, 2000);
}

function gameOver() {
    state.isRunning = false;
    finalScoreEl.innerText = formatNumberWithCommas(state.score);
    
    if (state.autoPlay) {
        scheduleAutoRetry();
        return;
    }
    
    gameOverScreen.classList.remove('hidden');
    gameOverScreen.classList.add('active');
}

function scheduleAutoRetry() {
    if (autoRetryTimeout) {
        clearTimeout(autoRetryTimeout);
    }
    
    gameOverScreen.classList.add('hidden');
    gameOverScreen.classList.remove('active');
    
    autoRetryTimeout = setTimeout(() => {
        autoRetryTimeout = null;
        if (!state.autoPlay) {
            gameOverScreen.classList.remove('hidden');
            gameOverScreen.classList.add('active');
            return;
        }
        retryCurrentLevel();
    }, AUTO_RETRY_DELAY);
}

// --- Rendering ---

function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // Helper: Draw Pseudo-3D Block
    const drawBlock = (x, y, color, shadowColor, height = 4) => {
        const px = x * GRID_SIZE;
        const py = y * GRID_SIZE;
        const s = GRID_SIZE - 2; // spacing
        
        // Side (Shadow) - extruded downwards
        ctx.fillStyle = shadowColor;
        ctx.shadowBlur = 0;
        // Draw side rect
        ctx.fillRect(px, py + s, s, height); 
        
        // Main Face (Top)
        ctx.fillStyle = color;
        // Optional: Glow
        ctx.shadowBlur = 10;
        ctx.shadowColor = color;
        
        // Shift top face slightly up to create depth effect
        // Actually, "up" in 2D screen space usually means Y-, but for "extrusion" 
        // let's say we view from top-front. So the front face is at y, and top face is at y-height?
        // No, simpler: The "Base" is at (px, py). The "Height" extends up (y-).
        // Let's try: Draw shadow at (px, py + height), Top at (px, py).
        // Actually the standard top-down game look is:
        // Top Face at (x, y - h). Side Face connects (x,y) to (x, y-h).
        // But our grid logic is fixed at (x,y).
        // Let's just offset the Top Face by (0, -height).
        
        // Draw Side (Bottom part visible)
        ctx.fillStyle = shadowColor;
        ctx.fillRect(px, py + s - height, s, height); 
        
        // Draw Top
        ctx.fillStyle = color;
        ctx.fillRect(px, py - height, s, s);
    };
    
    // To handle depth correctly (objects in front cover objects behind), 
    // we need to draw from Top (y=0) to Bottom (y=MAX).
    // Collect all entities
    let entities = [];
    
    // Add Obstacles
    state.obstacles.forEach(obs => {
        entities.push({ type: 'wall', x: obs.x, y: obs.y });
    });
    
    // Add Food
    state.foods.forEach(food => {
        entities.push({ type: 'food', x: food.x, y: food.y });
    });
    
    // Add Snake
    state.snake.forEach((seg, idx) => {
        entities.push({ type: 'snake', x: seg.x, y: seg.y, index: idx });
    });
    
    if (state.specialFood) {
        entities.push({ type: 'special', x: state.specialFood.x, y: state.specialFood.y });
    }
    
    // Sort by Y, then X
    entities.sort((a, b) => (a.y - b.y) || (a.x - b.x));
    
    // Draw entities
    entities.forEach(e => {
        if (e.type === 'wall') {
            // Wall: Tall block
            drawBlock(e.x, e.y, COLORS.wall, '#008fb3', 10);
        } else if (e.type === 'food' || e.type === 'special') {
            // Food: Floating sphere-ish
            const bounce = Math.sin(Date.now() / 200) * 3;
            const px = e.x * GRID_SIZE + GRID_SIZE/2;
            const py = e.y * GRID_SIZE + GRID_SIZE/2 - 5 + bounce;
            
            const color = e.type === 'special' ? '#ff8800' : COLORS.food;
            ctx.shadowBlur = 20;
            ctx.shadowColor = color;
            ctx.fillStyle = color;
            
            // Shadow on ground
            ctx.globalAlpha = 0.3;
            ctx.beginPath();
            ctx.ellipse(px, e.y * GRID_SIZE + GRID_SIZE - 2, 6, 3, 0, 0, Math.PI*2);
            ctx.fill();
            ctx.globalAlpha = 1.0;
            
            // Food Body
            ctx.beginPath();
            ctx.arc(px, py, 6, 0, Math.PI * 2);
            ctx.fill();
            
        } else if (e.type === 'snake') {
            const isHead = e.index === 0;
            const rainbowActive = state.wallBreakTimer && state.wallBreakTimer > 0;
            const baseColor = isHead ? COLORS.snakeHead : COLORS.snakeBody;
            const color = rainbowActive ? getRainbowColor(Date.now(), e.index) : baseColor;
            const shadow = rainbowActive ? color : (isHead ? '#00b35f' : '#008f4b');
            const height = isHead ? 6 : 4;
            
            drawBlock(e.x, e.y, color, shadow, height);
            
            // Eyes for head
            if (isHead) {
                ctx.fillStyle = '#000';
                ctx.shadowBlur = 0;
                // Adjust for height offset
                const eyeY = e.y * GRID_SIZE - height + 4;
                
                // Determine direction for eyes
                let ex1=5, ex2=11, ey=5;
                if (state.velocity.x === 1) { ex1=10; ex2=10; ey=2; } // Right (simplified)
                
                ctx.fillRect(e.x * GRID_SIZE + 5, eyeY, 4, 4);
                ctx.fillRect(e.x * GRID_SIZE + 11, eyeY, 4, 4);
            }
        }
    });

    // Draw Particles (on top of everything)
    updateAndDrawParticles();
    drawWrapHints();
    drawPowerUpTimer();
}

function drawPowerUpTimer() {
    if (!state.wallBreakTimer || state.wallBreakTimer <= 0) return;
    
    const timeLeft = Math.ceil(state.wallBreakTimer);
    const text = `POWER UP: ${timeLeft}s`;
    
    ctx.save();
    ctx.font = 'bold 20px Orbitron';
    ctx.fillStyle = '#fff';
    ctx.textAlign = 'center';
    ctx.shadowBlur = 10;
    ctx.shadowColor = '#ff0055';
    
    const scale = 1 + Math.sin(Date.now() / 120) * 0.08;
    ctx.translate(canvas.width / 2, 40);
    ctx.scale(scale, scale);
    ctx.fillText(text, 0, 0);
    ctx.restore();
}

function drawWrapHints() {
    if (!state.snake.length) return;
    const head = state.snake[0];
    const margin = 3;
    const size = GRID_SIZE * 0.5;
    const color = 'rgba(0, 255, 136, 0.25)';
    
    ctx.fillStyle = color;
    
    const leftBlocked = state.obstacles.some(obs => obs.x === 0);
    const rightBlocked = state.obstacles.some(obs => obs.x === TILE_COUNT - 1);
    const topBlocked = state.obstacles.some(obs => obs.y === 0);
    const bottomBlocked = state.obstacles.some(obs => obs.y === TILE_COUNT - 1);
    
    if (!leftBlocked) {
        ctx.fillRect(
            margin,
            head.y * GRID_SIZE + (GRID_SIZE - size) / 2,
            size,
            size
        );
    }
    if (!rightBlocked) {
        ctx.fillRect(
            canvas.width - size - margin,
            head.y * GRID_SIZE + (GRID_SIZE - size) / 2,
            size,
            size
        );
    }
    if (!topBlocked) {
        ctx.fillRect(
            head.x * GRID_SIZE + (GRID_SIZE - size) / 2,
            margin,
            size,
            size
        );
    }
    if (!bottomBlocked) {
        ctx.fillRect(
            head.x * GRID_SIZE + (GRID_SIZE - size) / 2,
            canvas.height - size - margin,
            size,
            size
        );
    }
}

// --- Particles System ---
function createParticles(x, y, color) {
    for (let i = 0; i < 10; i++) {
        state.particles.push({
            x: x + GRID_SIZE / 2,
            y: y + GRID_SIZE / 2,
            vx: (Math.random() - 0.5) * 4,
            vy: (Math.random() - 0.5) * 4,
            life: 1.0,
            color: color
        });
    }
}

function updateAndDrawParticles() {
    for (let i = state.particles.length - 1; i >= 0; i--) {
        let p = state.particles[i];
        p.x += p.vx;
        p.y += p.vy;
        p.life -= 0.05;
        
        if (p.life <= 0) {
            state.particles.splice(i, 1);
            continue;
        }
        
        ctx.globalAlpha = p.life;
        ctx.fillStyle = p.color;
        ctx.shadowBlur = 0;
        ctx.beginPath();
        ctx.arc(p.x, p.y, 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.globalAlpha = 1.0;
    }
}

// --- Main Loop ---
function gameLoop(currentTime) {
    if (!state.isRunning) return;
    
    window.requestAnimationFrame(gameLoop);
    
    if (!state.isPaused) {
        update(currentTime);
    }
    // Always draw to keep animations (particles) smooth
    draw();
}

// --- UI Handlers ---
function hideScreens() {
    startScreen.classList.add('hidden');
    startScreen.classList.remove('active');
    gameOverScreen.classList.add('hidden');
    gameOverScreen.classList.remove('active');
    levelUpScreen.classList.add('hidden');
    levelUpScreen.classList.remove('active');
}

function showStartScreen() {
    hideScreens();
    startScreen.classList.remove('hidden');
    startScreen.classList.add('active');
}

function toggleAutoPlay(forceValue) {
    const nextValue = typeof forceValue === 'boolean' ? forceValue : !state.autoPlay;
    state.autoPlay = nextValue;
    if (!state.autoPlay && autoRetryTimeout) {
        clearTimeout(autoRetryTimeout);
        autoRetryTimeout = null;
    }
    updateAutoPlayButton();
}

function updateAutoPlayButton() {
    if (!autoPlayBtn) return;
    autoPlayBtn.innerText = `AUTO PLAY: ${state.autoPlay ? 'ON' : 'OFF'}`;
    autoPlayBtn.classList.toggle('active', state.autoPlay);
}

// Init Function (Fresh Start)
function startNewGame() {
    const startLevelInput = document.getElementById('start-level');
    const requestedLevel = parseInt(startLevelInput.value, 10) || 1;
    const startLevel = Math.min(Math.max(requestedLevel, 1), TOTAL_LEVELS);
    if (startLevelInput) {
        startLevelInput.value = startLevel;
    }
    
    state.score = 0n;
    state.level = startLevel;
    startLevelLogic();
}

// Retry Function (Restart Current Level)
function retryCurrentLevel() {
    state.score = BigInt(state.levelScoreSnapshot || 0);
    scoreEl.innerText = formatScore(state.score);
    startLevelLogic();
}

function startLevelLogic() {
    state.levelScoreSnapshot = Number(state.score);
    state.foodEaten = 0;
    state.particles = [];
    inputQueue = [];
    
    // Load level obstacles FIRST
    loadLevel(state.level);
    
    // Then reset snake (so it can avoid obstacles)
    resetSnake();
    
    spawnFoodBatch();
    
    state.isRunning = true;
    state.isPaused = false;
    state.lastRenderTime = 0;
    
    scoreEl.innerText = formatScore(state.score);
    levelEl.innerText = state.level;
    
    hideScreens();
    window.requestAnimationFrame(gameLoop);
}

document.getElementById('start-btn').addEventListener('click', startNewGame);
document.getElementById('restart-btn').addEventListener('click', retryCurrentLevel);
document.getElementById('home-btn').addEventListener('click', showStartScreen);

// Initial Draw
draw();

