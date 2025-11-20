const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// --- Constants & Config ---
const GRID_SIZE = 20;
const TILE_COUNT = canvas.width / GRID_SIZE; // 30x30 grid

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
    food: { x: 0, y: 0 },
    score: 0,
    level: 1,
    isRunning: false,
    isPaused: false,
    lastRenderTime: 0,
    obstacles: [], // Array of {x, y}
    particles: [] // Array of particle objects
};

// Level Configuration
const LEVELS = [
    { speed: 8, obstacles: [], scoreMultiplier: 1 }, // Level 1
    { speed: 9, obstacles: 'border', scoreMultiplier: 1.2 }, // Level 2
    { speed: 10, obstacles: 'center_block', scoreMultiplier: 1.5 }, // Level 3
    { speed: 11, obstacles: 'tunnel', scoreMultiplier: 1.8 }, // Level 4
    { speed: 12, obstacles: 'random', scoreMultiplier: 2 }, // Level 5
    { speed: 13, obstacles: 'cross', scoreMultiplier: 2.5 }, // Level 6
    { speed: 14, obstacles: 'diag_lines', scoreMultiplier: 3 }, // Level 7
    { speed: 15, obstacles: 'box_maze', scoreMultiplier: 3.5 }, // Level 8
    { speed: 16, obstacles: 'grid_dots', scoreMultiplier: 4 }, // Level 9
    { speed: 18, obstacles: 'final_boss', scoreMultiplier: 5 } // Level 10
];

// --- Elements ---
const scoreEl = document.getElementById('score');
const levelEl = document.getElementById('level');
const finalScoreEl = document.getElementById('final-score');
const startScreen = document.getElementById('start-screen');
const gameOverScreen = document.getElementById('game-over-screen');
const levelUpScreen = document.getElementById('level-up-screen');

// --- Input Handling ---
let inputQueue = []; // Buffer inputs to prevent self-collision on quick turns

document.addEventListener('keydown', (e) => {
    if (!state.isRunning) return;
    
    // Prevent default scrolling for arrow keys
    if(["ArrowUp","ArrowDown","ArrowLeft","ArrowRight"].indexOf(e.code) > -1) {
        e.preventDefault();
    }

    const key = e.key;
    // Add to queue
    inputQueue.push(key);
});

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

// Removed initGame in favor of startNewGame/startLevelLogic split
function resetSnake() {
    state.snake = [
        { x: 5, y: 5 },
        { x: 5, y: 6 },
        { x: 5, y: 7 }
    ];
    state.velocity = { x: 0, y: -1 };
    state.foodEaten = 0;
}

function loadLevel(levelIndex) {
    state.level = levelIndex;
    levelEl.innerText = state.level;
    
    // Generate obstacles based on level
    state.obstacles = [];
    const config = LEVELS[(levelIndex - 1) % LEVELS.length]; // Loop levels if exceeds
    
    // Simple Map Generation
    if (config.obstacles === 'border') {
        for (let i = 0; i < TILE_COUNT; i++) {
            state.obstacles.push({x: i, y: 0}); // Top
            state.obstacles.push({x: i, y: TILE_COUNT-1}); // Bottom
            state.obstacles.push({x: 0, y: i}); // Left
            state.obstacles.push({x: TILE_COUNT-1, y: i}); // Right
        }
    } else if (config.obstacles === 'center_block') {
        // Level 3: 4 Corner Pillars
        // 4x4 blocks near corners
        const size = 4;
        const offset = 5;
        
        const positions = [
            {x: offset, y: offset}, // Top-Left
            {x: TILE_COUNT - offset - size, y: offset}, // Top-Right
            {x: offset, y: TILE_COUNT - offset - size}, // Bottom-Left
            {x: TILE_COUNT - offset - size, y: TILE_COUNT - offset - size} // Bottom-Right
        ];

        for (let pos of positions) {
            for (let x = 0; x < size; x++) {
                for (let y = 0; y < size; y++) {
                    state.obstacles.push({x: pos.x + x, y: pos.y + y});
                }
            }
        }

    } else if (config.obstacles === 'tunnel') {
        // Level 4: Scattered Clusters (Maze-like chunks)
        // Place a few horizontal and vertical walls randomly but fixed pattern for consistency
        
        const walls = [
            // Horizontal walls
            {x: 5, y: 5, len: 10, dir: 'h'},
            {x: 15, y: 25, len: 10, dir: 'h'},
            {x: 10, y: 15, len: 10, dir: 'h'},
            
            // Vertical walls
            {x: 20, y: 5, len: 10, dir: 'v'},
            {x: 5, y: 20, len: 8, dir: 'v'},
            {x: 25, y: 15, len: 8, dir: 'v'}
        ];

        for (let w of walls) {
            for (let i = 0; i < w.len; i++) {
                if (w.dir === 'h') {
                    state.obstacles.push({x: w.x + i, y: w.y});
                } else {
                    state.obstacles.push({x: w.x, y: w.y + i});
                }
            }
        }
    } else if (config.obstacles === 'random') {
        for (let i = 0; i < 30; i++) {
            state.obstacles.push({
                x: Math.floor(Math.random() * TILE_COUNT),
                y: Math.floor(Math.random() * TILE_COUNT)
            });
        }
    } else if (config.obstacles === 'cross') {
        // Level 6: Giant Cross
        const center = Math.floor(TILE_COUNT / 2);
        for (let i = 5; i < TILE_COUNT - 5; i++) {
            state.obstacles.push({x: i, y: center});
            state.obstacles.push({x: center, y: i});
        }
    } else if (config.obstacles === 'diag_lines') {
        // Level 7: Diagonal Lines
        for (let i = 0; i < TILE_COUNT; i++) {
             if (i % 6 === 0 || i % 6 === 1) {
                 state.obstacles.push({x: i, y: i});
                 state.obstacles.push({x: TILE_COUNT - 1 - i, y: i});
             }
        }
    } else if (config.obstacles === 'box_maze') {
        // Level 8: Concentric boxes
        const boxes = [5, 10];
        for (let b of boxes) {
             for (let i = b; i < TILE_COUNT - b; i++) {
                 // Top & Bottom with gaps
                 if (i !== Math.floor(TILE_COUNT/2)) {
                    state.obstacles.push({x: i, y: b});
                    state.obstacles.push({x: i, y: TILE_COUNT - 1 - b});
                 }
                 // Left & Right with gaps
                 if (i !== Math.floor(TILE_COUNT/2)) {
                    state.obstacles.push({x: b, y: i});
                    state.obstacles.push({x: TILE_COUNT - 1 - b, y: i});
                 }
             }
        }
    } else if (config.obstacles === 'grid_dots') {
        // Level 9: Grid of dots
        for (let x = 2; x < TILE_COUNT; x += 4) {
            for (let y = 2; y < TILE_COUNT; y += 4) {
                state.obstacles.push({x, y});
            }
        }
    } else if (config.obstacles === 'final_boss') {
        // Level 10: Chaos (Random + Border + Cross)
        // Border
        for (let i = 0; i < TILE_COUNT; i++) {
            state.obstacles.push({x: i, y: 0});
            state.obstacles.push({x: i, y: TILE_COUNT-1});
            state.obstacles.push({x: 0, y: i});
            state.obstacles.push({x: TILE_COUNT-1, y: i});
        }
        // Random interior
        for (let i = 0; i < 50; i++) {
             let rx = Math.floor(Math.random() * (TILE_COUNT-2)) + 1;
             let ry = Math.floor(Math.random() * (TILE_COUNT-2)) + 1;
             state.obstacles.push({x: rx, y: ry});
        }
    }
}

function placeFood() {
    let valid = false;
    while (!valid) {
        state.food = {
            x: Math.floor(Math.random() * TILE_COUNT),
            y: Math.floor(Math.random() * TILE_COUNT)
        };
        
        valid = true;
        // Check collision with snake
        for (let segment of state.snake) {
            if (segment.x === state.food.x && segment.y === state.food.y) {
                valid = false;
                break;
            }
        }
        // Check collision with obstacles
        if (valid) {
            for (let obs of state.obstacles) {
                if (obs.x === state.food.x && obs.y === state.food.y) {
                    valid = false;
                    break;
                }
            }
        }
    }
}

function update(currentTime) {
    const levelConfigIndex = (state.level - 1) % LEVELS.length;
    const config = LEVELS[levelConfigIndex];
    // Increase speed every time we loop through all levels
    const speedIncrease = Math.floor((state.level - 1) / LEVELS.length) * 2;
    const speed = config.speed + speedIncrease;
    
    if ((currentTime - state.lastRenderTime) / 1000 < 1 / speed) return false;
    
    state.lastRenderTime = currentTime;
    
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

    // Check Death
    if (checkCollision(head)) {
        gameOver();
        return false;
    }

    state.snake.unshift(head);

    // Eat Food
    if (head.x === state.food.x && head.y === state.food.y) {
        const config = LEVELS[(state.level - 1) % LEVELS.length];
        const baseScore = 10;
        const multiplier = config.scoreMultiplier || 1;
        const points = Math.round(baseScore * multiplier);
        
        state.score += points;
        scoreEl.innerText = state.score;
        createParticles(head.x * GRID_SIZE, head.y * GRID_SIZE, COLORS.food);
        placeFood();
        
        // Level Up Condition (e.g. every 100 points or fixed food count?)
        // Let's use food count to make it consistent across levels
        // Current logic uses score % 50 which triggers differently with multipliers
        // Better: Every 5 items eaten? Or Score threshold?
        // Let's stick to score but adjust threshold based on level multiplier
        // Or simpler: Every 5 items.
        
        // Tracking food eaten in state would be better, but let's infer or add it.
        // Adding 'foodEaten' to state.
        state.foodEaten = (state.foodEaten || 0) + 1;
        
        if (state.foodEaten >= 5) {
             state.foodEaten = 0; // Reset for next level
             levelUp();
        }
    } else {
        state.snake.pop();
    }
    
    return true;
}

function checkCollision(pos) {
    // Self collision
    for (let i = 0; i < state.snake.length; i++) {
        if (pos.x === state.snake[i].x && pos.y === state.snake[i].y) {
            return true;
        }
    }
    // Obstacle collision
    for (let obs of state.obstacles) {
        if (pos.x === obs.x && pos.y === obs.y) {
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
        resetSnake();
        inputQueue = [];
        
        levelUpScreen.classList.add('hidden');
        levelUpScreen.classList.remove('active');
        state.isPaused = false;
    }, 2000);
}

function gameOver() {
    state.isRunning = false;
    finalScoreEl.innerText = state.score;
    gameOverScreen.classList.remove('hidden');
    gameOverScreen.classList.add('active');
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
    entities.push({ type: 'food', x: state.food.x, y: state.food.y });
    
    // Add Snake
    state.snake.forEach((seg, idx) => {
        entities.push({ type: 'snake', x: seg.x, y: seg.y, index: idx });
    });
    
    // Sort by Y, then X
    entities.sort((a, b) => (a.y - b.y) || (a.x - b.x));
    
    // Draw entities
    entities.forEach(e => {
        if (e.type === 'wall') {
            // Wall: Tall block
            drawBlock(e.x, e.y, COLORS.wall, '#008fb3', 10);
        } else if (e.type === 'food') {
            // Food: Floating sphere-ish
            const bounce = Math.sin(Date.now() / 200) * 3;
            const px = e.x * GRID_SIZE + GRID_SIZE/2;
            const py = e.y * GRID_SIZE + GRID_SIZE/2 - 5 + bounce;
            
            ctx.shadowBlur = 20;
            ctx.shadowColor = COLORS.food;
            ctx.fillStyle = COLORS.food;
            
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
            const color = isHead ? COLORS.snakeHead : COLORS.snakeBody;
            const shadow = isHead ? '#00b35f' : '#008f4b';
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

// Init Function (Fresh Start)
function startNewGame() {
    const startLevelInput = document.getElementById('start-level');
    const startLevel = parseInt(startLevelInput.value) || 1;
    
    state.score = 0;
    state.level = startLevel;
    startLevelLogic();
}

// Retry Function (Restart Current Level)
function retryCurrentLevel() {
    // Keep state.level, reset score (or keep? let's reset score to 0 for this run)
    // Usually in arcade, you lose score but keep level? 
    // Or maybe resetting score to 0 is harsh if you're at level 10.
    // Let's reset score to 0 to keep it simple (High Score logic is usually separate).
    state.score = 0; 
    startLevelLogic();
}

function startLevelLogic() {
    state.foodEaten = 0;
    resetSnake();
    state.particles = [];
    inputQueue = [];
    
    loadLevel(state.level);
    placeFood();
    
    state.isRunning = true;
    state.isPaused = false;
    state.lastRenderTime = 0;
    
    scoreEl.innerText = state.score;
    levelEl.innerText = state.level;
    
    hideScreens();
    window.requestAnimationFrame(gameLoop);
}

document.getElementById('start-btn').addEventListener('click', startNewGame);
document.getElementById('restart-btn').addEventListener('click', retryCurrentLevel);
document.getElementById('home-btn').addEventListener('click', showStartScreen);

// Initial Draw
draw();

