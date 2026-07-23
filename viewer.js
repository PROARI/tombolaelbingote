// Game State Object for Viewer (Read-only replica)
let gameState = {
    gameMode: 75, // 90 or 75
    drawnBalls: [],
    ballsPool: [],
    isPlaying: false,
    sfxEnabled: false, // Disabled initially until user unlocks via button
    ttsEnabled: false,
    volume: 0.7,
    selectedVoiceName: ''
};

// Web Audio API Synthesizer Context
let audioCtx = null;
let drumOscNode = null;
let drumGainNode = null;
let drumModNode = null;
let drumModGainNode = null;

// Canvas Simulation Variables
let canvas = null;
let ctx = null;
let simBalls = [];
let animationFrameId = null;
let isSpinning = false;
let drawnBallTarget = null;
let exitAnimationTimer = 0;

// Speech Synthesis
let voices = [];
let currentUtterance = null;

// Sync / Network Variables
let syncCode = '';
let eventSource = null;

// ==========================================
// ACCESS CONTROL & TEMPORARY LICENSING (VIEWER)
// ==========================================
const ACCESS_SECRET = 'ElBingoteSecretKey2026!';
const MASTER_KEY = '4206371Luis*';

function generateSignature(timestamp, secret) {
    const message = timestamp + "|" + secret;
    let hash = 0;
    for (let i = 0; i < message.length; i++) {
        const char = message.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash;
    }
    return Math.abs(hash).toString(16);
}

function validateToken(token) {
    if (!token) return false;
    try {
        const decoded = atob(token);
        const parts = decoded.split('.');
        if (parts.length !== 2) return false;
        const expiry = parseInt(parts[0]);
        const sig = parts[1];
        if (isNaN(expiry)) return false;
        if (expiry <= Date.now()) return false;
        return generateSignature(expiry, ACCESS_SECRET) === sig;
    } catch (e) {
        return false;
    }
}

function checkAccess() {
    const params = new URLSearchParams(window.location.search);
    const urlAccess = params.get('access');
    
    if (urlAccess) {
        if (urlAccess === MASTER_KEY) {
            localStorage.setItem('el_bingote_admin', 'true');
            localStorage.removeItem('el_bingote_token'); // Clear guest token if logging in as admin
            // Clean up access param from URL
            params.delete('access');
            const newUrl = window.location.pathname + (params.toString() ? '?' + params.toString() : '') + window.location.hash;
            history.replaceState({}, '', newUrl);
            return true;
        } else if (validateToken(urlAccess)) {
            localStorage.setItem('el_bingote_token', urlAccess);
            localStorage.removeItem('el_bingote_admin'); // Clear admin status if guest access is used
            // Clean up access param from URL
            params.delete('access');
            const newUrl = window.location.pathname + (params.toString() ? '?' + params.toString() : '') + window.location.hash;
            history.replaceState({}, '', newUrl);
            return true;
        }
    }
    
    if (localStorage.getItem('el_bingote_admin') === 'true') {
        return true;
    }
    
    const savedToken = localStorage.getItem('el_bingote_token');
    if (validateToken(savedToken)) {
        return true;
    }
    
    return false;
}

function showLockScreen() {
    const overlay = document.getElementById('lock-screen-overlay');
    if (overlay) overlay.style.display = 'flex';
}

function hideLockScreen() {
    const overlay = document.getElementById('lock-screen-overlay');
    if (overlay) overlay.style.display = 'none';
}

function submitGuestAccess() {
    const tokenInput = document.getElementById('lock-guest-token');
    const errorEl = document.getElementById('lock-guest-error');
    if (!tokenInput || !errorEl) return;
    
    let val = tokenInput.value.trim();
    if (val.includes('access=')) {
        try {
            const url = new URL(val);
            val = url.searchParams.get('access') || val;
        } catch (e) {
            const match = val.match(/access=([^&]+)/);
            if (match) val = match[1];
        }
    }
    
    if (validateToken(val) || val === MASTER_KEY) {
        errorEl.style.display = 'none';
        if (val === MASTER_KEY) {
            localStorage.setItem('el_bingote_admin', 'true');
            localStorage.removeItem('el_bingote_token'); // Clear guest token if logging in as admin
        } else {
            localStorage.setItem('el_bingote_token', val);
            localStorage.removeItem('el_bingote_admin'); // Clear admin status if guest access is used
        }
        hideLockScreen();
        startViewerPlatform();
    } else {
        errorEl.style.display = 'block';
    }
}

// Initialize the Application on Load
window.addEventListener('DOMContentLoaded', () => {
    initViewer();
});

async function initViewer() {
    if (!checkAccess()) {
        showLockScreen();
        return;
    }
    
    await startViewerPlatform();
}

async function startViewerPlatform() {
    canvas = document.getElementById('drum-canvas');
    ctx = canvas.getContext('2d');

    // Extract game parameter from URL
    const params = new URLSearchParams(window.location.search);
    syncCode = params.get('game');
    
    if (!syncCode) {
        showStatus('error', 'Código de canal ausente en la URL.');
        alert('Por favor, abre esta pantalla desde el botón de transmisión en la configuración del juego.');
        return;
    }

    // Load Speech voice list
    setupSpeech();

    // Initial State Fetch from ntfy.sh cache
    showStatus('connecting', 'Sincronizando estado...');
    const initialState = await fetchLatestState();
    if (initialState) {
        syncState(initialState);
    } else {
        // Fallback defaults
        renderBoard();
        updateStats();
        renderHistory();
        renderBigBall();
        initSimulationBalls();
    }
    
    // Start physics simulation loop
    startSimulation();

    // Connect to live EventSource stream
    connectLiveStream();

    // Unlock speech synthesis when voice changes (if any)
    if ('speechSynthesis' in window && window.speechSynthesis.onvoiceschanged !== undefined) {
        window.speechSynthesis.onvoiceschanged = () => {
            voices = window.speechSynthesis.getVoices();
        };
    }
}

// Show sync status dot and message
function showStatus(status, text) {
    const dot = document.getElementById('sync-dot');
    const textEl = document.getElementById('sync-text');
    if (!dot || !textEl) return;

    dot.className = 'status-dot';
    if (status === 'connected') {
        dot.classList.add('connected');
        textEl.textContent = 'En vivo';
    } else if (status === 'connecting') {
        dot.classList.add('connecting');
        textEl.textContent = text || 'Conectando...';
    } else {
        textEl.textContent = text || 'Desconectado';
    }
}

// Fetch the last state published on the channel
async function fetchLatestState() {
    try {
        const response = await fetch(`https://ntfy.sh/el-bingote-${syncCode}/json?poll=1`);
        if (!response.ok) return null;
        const text = await response.text();
        if (!text.trim()) return null;
        
        const lines = text.trim().split('\n');
        // Loop backwards to find the last valid state payload
        for (let i = lines.length - 1; i >= 0; i--) {
            if (!lines[i]) continue;
            const data = JSON.parse(lines[i]);
            if (data.event === 'message' && data.message) {
                return JSON.parse(data.message);
            }
        }
    } catch (e) {
        console.error("Error al obtener estado inicial:", e);
    }
    return null;
}

// Connect EventSource to listen for updates in real-time
function connectLiveStream() {
    if (eventSource) {
        eventSource.close();
    }

    eventSource = new EventSource(`https://ntfy.sh/el-bingote-${syncCode}/sse`);

    eventSource.onopen = () => {
        showStatus('connected');
    };

    eventSource.onerror = (err) => {
        console.error("EventSource connection lost, retrying...", err);
        showStatus('connecting', 'Reconectando...');
    };

    eventSource.onmessage = (event) => {
        try {
            const data = JSON.parse(event.data);
            if (data.message) {
                const statePayload = JSON.parse(data.message);
                handleBroadcastEvent(statePayload);
            }
        } catch (e) {
            console.error("Error parsing live stream payload:", e);
        }
    };
}

// Handle real-time incoming events
function handleBroadcastEvent(payload) {
    const { event, gameMode, drawnBalls, ballsPool, isPlaying, isSpinning: operatorSpinning, drawnBallNumber } = payload;

    // Check if gameMode has changed (requires board rebuild)
    const modeChanged = gameState.gameMode !== gameMode;
    gameState.gameMode = gameMode;
    gameState.isPlaying = isPlaying;

    if (modeChanged) {
        updateGameModeUI();
        renderBoard();
        initSimulationBalls();
    }

    switch (event) {
        case 'spin':
            startSpinningSequence();
            break;
            
        case 'extract':
            const extractNum = payload.data?.num;
            if (extractNum) {
                startExtractionSequence(extractNum);
            }
            break;

        case 'extracted':
            const extractedNum = payload.data?.num;
            // Complete state sync
            gameState.drawnBalls = drawnBalls;
            gameState.ballsPool = ballsPool;
            
            // If the local simulation isn't already animating the exit of this ball:
            if (!drawnBallTarget || drawnBallTarget.number !== extractedNum) {
                // Instantly force UI draw
                completeBallExtraction(extractedNum);
            }
            break;

        case 'reset':
            gameState.drawnBalls = [];
            gameState.ballsPool = ballsPool;
            isSpinning = false;
            drawnBallTarget = null;
            renderBoard();
            updateStats();
            renderHistory();
            renderBigBall();
            initSimulationBalls();
            playResetSFX();
            break;

        case 'sync':
        default:
            // Generic state synchronization
            syncState(payload);
            break;
    }
}

// Synchronize game state variables and update UI
function syncState(state) {
    const modeChanged = gameState.gameMode !== state.gameMode;
    gameState.gameMode = state.gameMode;
    gameState.drawnBalls = state.drawnBalls || [];
    gameState.ballsPool = state.ballsPool || [];
    gameState.isPlaying = state.isPlaying;

    updateGameModeUI();
    renderBoard();

    // Check if currently spinning
    if (state.isSpinning && !isSpinning) {
        startSpinningSequence();
    } else if (!state.isSpinning && isSpinning) {
        isSpinning = false;
        stopDrumRollingSound();
    }

    // Check if target ball is animating
    if (state.drawnBallNumber) {
        startExtractionSequence(state.drawnBallNumber);
    } else {
        drawnBallTarget = null;
    }

    updateStats();
    renderHistory();
    renderBigBall();
    initSimulationBalls();
}

function updateGameModeUI() {
    const modeLbl = document.getElementById('viewer-mode-lbl');
    if (modeLbl) {
        modeLbl.textContent = `${gameState.gameMode} Bolas`;
    }
}

// Trigger high-speed spin animation
function startSpinningSequence() {
    if (isSpinning || drawnBallTarget) return;
    isSpinning = true;
    triggerSimulationSpin(true);
    startDrumRollingSound();
    
    // Update Big Ball screen UI to spinning state
    renderBigBallSpinner();
}

function renderBigBallSpinner() {
    const container = document.getElementById('big-ball-container');
    const value = document.getElementById('big-ball-value');
    const subtext = document.getElementById('big-ball-subtext');
    if (!container || !value || !subtext) return;
    
    container.className = 'big-ball-container-empty';
    value.innerHTML = '<span class="big-ball-number-single">??</span>';
    subtext.textContent = 'GIRANDO TÓMBOLA...';
}

// Trigger simulation target ball animation
function startExtractionSequence(num) {
    isSpinning = false;
    triggerSimulationSpin(false);
    stopDrumRollingSound();

    let simBall = simBalls.find(b => b.number === num);
    if (!simBall) {
        simBall = createSingleSimBall(num);
        simBalls.push(simBall);
    }
    
    drawnBallTarget = simBall;
    drawnBallTarget.isTarget = true;
    exitAnimationTimer = 0;
    
    renderBigBallSpinner();
}

// Finalize drawn ball UI update (called either by simulation completion or forced by sync event)
function completeBallExtraction(num) {
    drawnBallTarget = null;
    
    if (!gameState.drawnBalls.includes(num)) {
        gameState.drawnBalls.push(num);
    }
    gameState.ballsPool = gameState.ballsPool.filter(x => x !== num);
    simBalls = simBalls.filter(b => b.number !== num);
    
    playPopSFX();
    speakBallText(formatSpeechText(num));

    const cell = document.getElementById(`cell-${num}`);
    if (cell) cell.classList.add('called');

    updateStats();
    renderHistory();
    renderBigBall();
}

// Toggle Sound setting based on user interaction (browser restriction bypass)
function toggleViewerSound() {
    initAudio();
    const btn = document.getElementById('btn-sound-viewer');
    const icon = document.getElementById('sound-icon');
    const text = document.getElementById('sound-text');
    if (!btn || !icon || !text) return;

    if (gameState.sfxEnabled) {
        gameState.sfxEnabled = false;
        gameState.ttsEnabled = false;
        btn.classList.remove('active');
        icon.textContent = '🔇';
        text.textContent = 'Activar Sonido';
    } else {
        gameState.sfxEnabled = true;
        gameState.ttsEnabled = true;
        btn.classList.add('active');
        icon.textContent = '🔊';
        text.textContent = 'Sonido Activado';
        
        // Play click test
        playClickSFX();
        speakBallText("Sonido activado");
    }
}

// ==========================================
// AUDIO & SOUND SYNTHESIS
// ==========================================

function initAudio() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
    if (audioCtx.state === 'suspended') {
        audioCtx.resume();
    }
}

function playClickSFX() {
    if (!gameState.sfxEnabled) return;
    initAudio();
    
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    
    osc.type = 'sine';
    osc.frequency.setValueAtTime(1000, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(120, audioCtx.currentTime + 0.1);
    
    gain.gain.setValueAtTime(gameState.volume * 0.15, audioCtx.currentTime);
    gain.gain.linearRampToValueAtTime(0.01, audioCtx.currentTime + 0.1);
    
    osc.start();
    osc.stop(audioCtx.currentTime + 0.12);
}

function playPopSFX() {
    if (!gameState.sfxEnabled) return;
    initAudio();
    
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    
    osc.type = 'sine';
    osc.frequency.setValueAtTime(180, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(600, audioCtx.currentTime + 0.25);
    
    gain.gain.setValueAtTime(gameState.volume * 0.2, audioCtx.currentTime);
    gain.gain.linearRampToValueAtTime(0.01, audioCtx.currentTime + 0.25);
    
    osc.start();
    osc.stop(audioCtx.currentTime + 0.26);
}

function playResetSFX() {
    if (!gameState.sfxEnabled) return;
    initAudio();
    
    const now = audioCtx.currentTime;
    const notes = [261.63, 329.63, 392.00, 523.25]; // C4, E4, G4, C5 arpeggio
    
    notes.forEach((freq, idx) => {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        
        osc.type = 'sine';
        osc.frequency.value = freq;
        
        gain.gain.setValueAtTime(0, now + idx * 0.08);
        gain.gain.linearRampToValueAtTime(gameState.volume * 0.15, now + idx * 0.08 + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.08 + 0.3);
        
        osc.start(now + idx * 0.08);
        osc.stop(now + idx * 0.08 + 0.35);
    });
}

function startDrumRollingSound() {
    if (!gameState.sfxEnabled) return;
    initAudio();
    
    const now = audioCtx.currentTime;
    
    drumModNode = audioCtx.createOscillator();
    drumModGainNode = audioCtx.createGain();
    drumOscNode = audioCtx.createOscillator();
    drumGainNode = audioCtx.createGain();
    
    drumModNode.type = 'sine';
    drumModNode.frequency.value = 16;
    drumModGainNode.gain.value = 35;
    
    drumOscNode.type = 'triangle';
    drumOscNode.frequency.value = 65;
    
    drumGainNode.gain.setValueAtTime(0, now);
    drumGainNode.gain.linearRampToValueAtTime(gameState.volume * 0.45, now + 0.2);
    
    drumModNode.connect(drumModGainNode);
    drumModGainNode.connect(drumOscNode.frequency);
    drumOscNode.connect(drumGainNode);
    drumGainNode.connect(audioCtx.destination);
    
    drumModNode.start();
    drumOscNode.start();
}

function stopDrumRollingSound() {
    if (!drumOscNode) return;
    const now = audioCtx ? audioCtx.currentTime : 0;
    
    try {
        if (drumGainNode && audioCtx) {
            drumGainNode.gain.setValueAtTime(drumGainNode.gain.value, now);
            drumGainNode.gain.exponentialRampToValueAtTime(0.001, now + 0.3);
        }
        
        setTimeout(() => {
            if (drumOscNode) { drumOscNode.stop(); drumOscNode = null; }
            if (drumModNode) { drumModNode.stop(); drumModNode = null; }
            drumGainNode = null;
            drumModGainNode = null;
        }, 350);
    } catch (e) {
        console.error("Error stopping sound", e);
    }
}

// ==========================================
// SPEECH SYNTHESIS SYSTEM
// ==========================================

function setupSpeech() {
    if ('speechSynthesis' in window) {
        loadVoices();
    }
}

function loadVoices() {
    voices = window.speechSynthesis.getVoices();
    // Default to the first Spanish voice available
    const spanishVoice = voices.find(v => v.lang.startsWith('es'));
    if (spanishVoice) {
        gameState.selectedVoiceName = spanishVoice.name;
    } else if (voices.length > 0) {
        gameState.selectedVoiceName = voices[0].name;
    }
}

function speakBallText(text) {
    if (!gameState.ttsEnabled || !('speechSynthesis' in window)) return;
    
    window.speechSynthesis.cancel();
    
    currentUtterance = new SpeechSynthesisUtterance(text);
    
    const activeVoice = voices.find(v => v.name === gameState.selectedVoiceName);
    if (activeVoice) {
        currentUtterance.voice = activeVoice;
    }
    
    currentUtterance.volume = gameState.volume;
    currentUtterance.rate = 0.95;
    
    window.speechSynthesis.speak(currentUtterance);
}

function formatSpeechText(number) {
    if (gameState.gameMode === 75) {
        const letter = getBallLetter75(number);
        return `${letter}. ${number}.`;
    } else {
        return `Número, ${number}.`;
    }
}

// ==========================================
// RENDER INTERFACE COMPONENTS
// ==========================================

function getBallLetter75(num) {
    if (num <= 15) return 'B';
    if (num <= 30) return 'I';
    if (num <= 45) return 'N';
    if (num <= 60) return 'G';
    return 'O';
}

function getBallColorClass(num) {
    if (gameState.gameMode === 75) {
        const letter = getBallLetter75(num).toLowerCase();
        return `ball-color-${letter}`;
    } else {
        if (num <= 18) return 'ball-color-b';
        if (num <= 36) return 'ball-color-i';
        if (num <= 54) return 'ball-color-n';
        if (num <= 72) return 'ball-color-g';
        return 'ball-color-o';
    }
}

function renderBoard() {
    const grid = document.getElementById('board-grid');
    if (!grid) return;
    grid.innerHTML = '';
    
    if (gameState.gameMode === 90) {
        grid.className = 'board-grid grid-90';
        for (let i = 1; i <= 90; i++) {
            const cell = document.createElement('div');
            cell.className = 'board-cell';
            cell.textContent = i;
            cell.id = `cell-${i}`;
            if (gameState.drawnBalls.includes(i)) {
                cell.classList.add('called');
            }
            grid.appendChild(cell);
        }
    } else {
        grid.className = 'board-grid grid-75';
        
        const letters = ['B', 'I', 'N', 'G', 'O'];
        for (let i = 0; i < 5; i++) {
            const letter = letters[i];
            
            const hdrCell = document.createElement('div');
            hdrCell.className = 'board-cell board-col-hdr';
            hdrCell.textContent = letter;
            grid.appendChild(hdrCell);
            
            const startNum = (i * 15) + 1;
            const endNum = startNum + 14;
            for (let num = startNum; num <= endNum; num++) {
                const cell = document.createElement('div');
                cell.className = 'board-cell';
                cell.textContent = num;
                cell.id = `cell-${num}`;
                if (gameState.drawnBalls.includes(num)) {
                    cell.classList.add('called');
                }
                grid.appendChild(cell);
            }
        }
    }
}

function updateStats() {
    const total = gameState.gameMode;
    const drawn = gameState.drawnBalls.length;
    const remaining = total - drawn;
    const percent = total > 0 ? Math.round((drawn / total) * 100) : 0;
    
    const drawnEl = document.getElementById('stat-drawn');
    const remainingEl = document.getElementById('stat-remaining');
    const percentEl = document.getElementById('stat-percent');
    
    if (drawnEl) drawnEl.textContent = drawn;
    if (remainingEl) remainingEl.textContent = remaining;
    if (percentEl) percentEl.textContent = `${percent}%`;
}

function renderHistory() {
    const list = document.getElementById('history-list');
    if (!list) return;
    list.innerHTML = '';
    
    if (gameState.drawnBalls.length === 0) {
        list.innerHTML = '<div class="history-empty-msg">No se han extraído bolillas aún.</div>';
        return;
    }
    
    const history = [...gameState.drawnBalls].reverse().slice(0, 5);
    const visibleHistory = (drawnBallTarget && history.length > 0) ? history.slice(1) : history;
    
    if (visibleHistory.length === 0) {
        list.innerHTML = '<div class="history-empty-msg">Sorteando...</div>';
        return;
    }
    
    visibleHistory.forEach(num => {
        const ball = document.createElement('div');
        ball.className = `history-ball ${getBallColorClass(num)}`;
        
        if (gameState.gameMode === 75) {
            const letter = getBallLetter75(num);
            ball.innerHTML = `<span class="hist-letter">${letter}</span><span class="hist-number">${num}</span>`;
        } else {
            ball.innerHTML = `<span class="hist-number-single">${num}</span>`;
        }
        
        list.appendChild(ball);
    });
}

// Render the big ball container
function renderBigBall() {
    const container = document.getElementById('big-ball-container');
    const value = document.getElementById('big-ball-value');
    const subtext = document.getElementById('big-ball-subtext');
    if (!container || !value || !subtext) return;
    
    if (gameState.drawnBalls.length === 0) {
        container.className = 'big-ball-container-empty';
        value.innerHTML = '<span class="big-ball-number-single">--</span>';
        subtext.textContent = 'Esperando sorteo...';
        return;
    }
    
    const num = gameState.drawnBalls[gameState.drawnBalls.length - 1];
    
    if (drawnBallTarget) {
        container.className = 'big-ball-container-empty';
        value.innerHTML = '<span class="big-ball-number-single">??</span>';
        subtext.textContent = 'GIRANDO TÓMBOLA...';
        return;
    }
    
    container.className = `big-ball-container-active ${getBallColorClass(num)}`;
    
    if (gameState.gameMode === 75) {
        const letter = getBallLetter75(num);
        value.innerHTML = `<span class="big-ball-letter">${letter}</span><span class="big-ball-number">${num}</span>`;
        subtext.textContent = `BOLA EXTRAÍDA: ${letter}-${num}`;
    } else {
        value.innerHTML = `<span class="big-ball-number-single">${num}</span>`;
        subtext.textContent = `BOLA EXTRAÍDA: NÚMERO ${num}`;
    }
}

// ==========================================
// CANVAS GRAPHICS & BALL PHYSICS SIMULATOR
// ==========================================

class SimulationBall {
    constructor(number, x, y, radius, colorClass) {
        this.number = number;
        this.x = x;
        this.y = y;
        this.vx = (Math.random() - 0.5) * 4;
        this.vy = (Math.random() - 0.5) * 4;
        this.radius = radius;
        this.colorClass = colorClass;
        this.mass = 1;
        this.isTarget = false;
    }
}

function initSimulationBalls() {
    simBalls = [];
    const maxBalls = gameState.gameMode;
    
    if (!canvas) return;
    const canvasWidth = canvas.width;
    const canvasHeight = canvas.height;
    const cx = canvasWidth / 2;
    const cy = canvasHeight / 2;
    const R = cx - 22;
    
    const ballRadius = gameState.gameMode === 90 ? 10 : 11;
    
    for (let i = 1; i <= maxBalls; i++) {
        if (!gameState.drawnBalls.includes(i)) {
            const angle = Math.random() * Math.PI * 2;
            const radius = Math.random() * (R - ballRadius - 15);
            const bx = cx + Math.cos(angle) * radius;
            const by = cy + Math.sin(angle) * radius;
            
            const b = new SimulationBall(i, bx, by, ballRadius, getBallColorClass(i));
            simBalls.push(b);
        }
    }
}

function triggerSimulationSpin(spin) {
    if (spin) {
        simBalls.forEach(b => {
            b.vx = (Math.random() - 0.5) * 22;
            b.vy = (Math.random() - 0.5) * 22;
        });
    }
}

function createSingleSimBall(num) {
    if (!canvas) return null;
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    return new SimulationBall(num, cx, cy - 20, 10, getBallColorClass(num));
}

function startSimulation() {
    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
    }
    
    function loop() {
        updateSimulationPhysics();
        drawSimulationCanvas();
        animationFrameId = requestAnimationFrame(loop);
    }
    
    animationFrameId = requestAnimationFrame(loop);
}

function updateSimulationPhysics() {
    if (!canvas) return;
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const R = cx - 20;
    
    const gravity = isSpinning ? 0 : 0.15;
    const friction = 0.985;
    
    simBalls.forEach(b => {
        if (b.isTarget) {
            const exitX = cx;
            const exitY = cy + R + 25;
            
            const dx = exitX - b.x;
            const dy = exitY - b.y;
            
            b.x += dx * 0.1;
            b.y += dy * 0.1;
            
            exitAnimationTimer++;
            if (exitAnimationTimer > 40 || Math.abs(dx) < 2 && Math.abs(dy) < 2) {
                b.isTarget = false;
                completeBallExtraction(b.number);
            }
            return;
        }
        
        b.vy += gravity;
        b.vx *= friction;
        b.vy *= friction;
        
        if (isSpinning) {
            b.vx += (Math.random() - 0.5) * 1.5;
            b.vy += (Math.random() - 0.5) * 1.5;
        }
        
        b.x += b.vx;
        b.y += b.vy;
        
        const dx = b.x - cx;
        const dy = b.y - cy;
        const dist = Math.sqrt(dx*dx + dy*dy);
        
        if (dist + b.radius > R) {
            const nx = dx / dist;
            const ny = dy / dist;
            
            const dot = b.vx * nx + b.vy * ny;
            
            if (dot > 0) {
                b.vx = b.vx - 2 * dot * nx;
                b.vy = b.vy - 2 * dot * ny;
                
                b.vx *= 0.75;
                b.vy *= 0.75;
            }
            
            b.x = cx + nx * (R - b.radius - 1);
            b.y = cy + ny * (R - b.radius - 1);
        }
    });
    
    for (let i = 0; i < simBalls.length; i++) {
        const bA = simBalls[i];
        if (bA.isTarget) continue;
        
        for (let j = i + 1; j < simBalls.length; j++) {
            const bB = simBalls[j];
            if (bB.isTarget) continue;
            
            const dx = bB.x - bA.x;
            const dy = bB.y - bA.y;
            const dist = Math.sqrt(dx*dx + dy*dy);
            const minDist = bA.radius + bB.radius;
            
            if (dist < minDist && dist > 0.1) {
                const overlap = minDist - dist;
                const nx = dx / dist;
                const ny = dy / dist;
                
                bA.x -= nx * overlap * 0.5;
                bA.y -= ny * overlap * 0.5;
                bB.x += nx * overlap * 0.5;
                bB.y += ny * overlap * 0.5;
                
                const kx = bA.vx - bB.vx;
                const ky = bA.vy - bB.vy;
                
                const p = 2 * (nx * kx + ny * ky) / (bA.mass + bB.mass);
                
                bA.vx -= p * bB.mass * nx;
                bA.vy -= p * bB.mass * ny;
                bB.vx += p * bA.mass * nx;
                bB.vy += p * bA.mass * ny;
            }
        }
    }
}

function drawSimulationCanvas() {
    if (!canvas) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const R = cx - 20;
    
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.stroke();
    
    ctx.fillStyle = 'rgba(15, 23, 42, 0.4)';
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fill();
    
    ctx.fillStyle = '#020617';
    ctx.strokeStyle = '#64748b';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cy + R - 5, 20, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    
    simBalls.forEach(b => {
        let gradientColors = ['#ff5722', '#d84315'];
        let labelColor = '#ffffff';
        
        switch(b.colorClass) {
            case 'ball-color-b': gradientColors = ['#3b82f6', '#1d4ed8']; break;
            case 'ball-color-i': gradientColors = ['#ef4444', '#b91c1c']; break;
            case 'ball-color-n': gradientColors = ['#f8fafc', '#94a3b8']; labelColor = '#0f172a'; break;
            case 'ball-color-g': gradientColors = ['#10b981', '#047857']; break;
            case 'ball-color-o': gradientColors = ['#f59e0b', '#b45309']; break;
        }
        
        const grad = ctx.createRadialGradient(
            b.x - b.radius * 0.3, b.y - b.radius * 0.3, b.radius * 0.1,
            b.x, b.y, b.radius
        );
        grad.addColorStop(0, gradientColors[0]);
        grad.addColorStop(1, gradientColors[1]);
        
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2);
        ctx.fill();
        
        ctx.strokeStyle = 'rgba(0,0,0,0.15)';
        ctx.lineWidth = 1;
        ctx.stroke();
        
        ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.beginPath();
        ctx.arc(b.x - b.radius * 0.3, b.y - b.radius * 0.3, b.radius * 0.25, 0, Math.PI * 2);
        ctx.fill();
        
        if (b.radius > 8) {
            ctx.fillStyle = labelColor;
            ctx.font = `bold ${b.radius * 1.1}px Arial`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(b.number, b.x, b.y + 0.5);
        }
    });
    
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1.5;
    
    for (let offset = -R + 30; offset < R; offset += 35) {
        if (offset === 0) continue;
        const xOffset = Math.abs(offset);
        const radius = Math.sqrt(R*R - xOffset*xOffset);
        
        ctx.beginPath();
        ctx.ellipse(cx + offset/2, cy, Math.abs(offset/2), R, 0, 0, Math.PI * 2);
        ctx.stroke();
    }
    
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
    for (let r = 40; r < R; r += 40) {
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();
    }
}
