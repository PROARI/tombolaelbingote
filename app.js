// Game State Object
let gameState = {
    gameMode: 75, // 90 or 75
    drawnBalls: [],
    ballsPool: [],
    isPlaying: false,
    autoSpeed: 4, // in seconds
    sfxEnabled: true,
    ttsEnabled: true,
    volume: 0.7,
    selectedVoiceName: '',
    syncCode: ''
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

// Initialize the Application on Load
window.addEventListener('DOMContentLoaded', () => {
    initApp();
});

// ==========================================
// ACCESS CONTROL & TEMPORARY LICENSING
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
            params.delete('access');
            const newUrl = window.location.pathname + (params.toString() ? '?' + params.toString() : '') + window.location.hash;
            history.replaceState({}, '', newUrl);
            return true;
        } else if (validateToken(urlAccess)) {
            localStorage.setItem('el_bingote_token', urlAccess);
            localStorage.removeItem('el_bingote_admin'); // Clear admin status if guest access is used
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

function switchLockTab(tab) {
    const btnGuest = document.getElementById('tab-btn-guest');
    const btnAdmin = document.getElementById('tab-btn-admin');
    const formGuest = document.getElementById('form-lock-guest');
    const formAdmin = document.getElementById('form-lock-admin');
    
    if (!btnGuest || !btnAdmin || !formGuest || !formAdmin) return;
    
    if (tab === 'guest') {
        btnGuest.classList.add('active');
        btnAdmin.classList.remove('active');
        formGuest.classList.add('active');
        formAdmin.classList.remove('active');
    } else {
        btnAdmin.classList.add('active');
        btnGuest.classList.remove('active');
        formAdmin.classList.add('active');
        formGuest.classList.remove('active');
    }
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
    
    if (validateToken(val)) {
        errorEl.style.display = 'none';
        localStorage.setItem('el_bingote_token', val);
        localStorage.removeItem('el_bingote_admin'); // Clear admin status if guest access is used
        hideLockScreen();
        startPlatform();
    } else {
        errorEl.style.display = 'block';
    }
}

function submitAdminAccess() {
    const keyInput = document.getElementById('lock-admin-key');
    const errorEl = document.getElementById('lock-admin-error');
    if (!keyInput || !errorEl) return;
    
    const val = keyInput.value.trim();
    if (val === MASTER_KEY) {
        errorEl.style.display = 'none';
        localStorage.setItem('el_bingote_admin', 'true');
        hideLockScreen();
        startPlatform();
    } else {
        errorEl.style.display = 'block';
    }
}

function logoutAdmin() {
    localStorage.removeItem('el_bingote_admin');
    localStorage.removeItem('el_bingote_token');
    window.location.reload();
}

function generateTemporaryLink() {
    const durationSelect = document.getElementById('access-duration');
    const shareInput = document.getElementById('access-share-url');
    if (!durationSelect || !shareInput) return;
    
    const hours = parseInt(durationSelect.value);
    const expiry = Date.now() + hours * 3600000;
    const sig = generateSignature(expiry, ACCESS_SECRET);
    const token = btoa(expiry + "." + sig);
    
    let baseUrl = window.location.href.split('?')[0].split('#')[0];
    if (baseUrl.endsWith('/')) {
        baseUrl = baseUrl + 'index.html';
    }
    const generatedUrl = baseUrl + '?access=' + token;
    shareInput.value = generatedUrl;
}

function copyAccessLink() {
    const input = document.getElementById('access-share-url');
    if (input && input.value) {
        input.select();
        input.setSelectionRange(0, 99999);
        navigator.clipboard.writeText(input.value)
            .then(() => {
                const btn = document.getElementById('btn-copy-access');
                const originalText = btn.textContent;
                btn.textContent = '✅ Copiado';
                setTimeout(() => {
                    btn.textContent = originalText;
                }, 2000);
            })
            .catch(err => {
                console.error("Error al copiar enlace: ", err);
            });
    }
}

function initApp() {
    // Add confirmation modal key listeners (runs always)
    window.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            closeConfirmModal();
            closeAlertModal();
            closeConfigModal();
        }
    });

    if (!checkAccess()) {
        showLockScreen();
        return;
    }
    
    startPlatform();
}

function startPlatform() {
    canvas = document.getElementById('drum-canvas');
    ctx = canvas.getContext('2d');

    // Load voices for Speech Synthesis
    setupSpeech();

    // Load game state from local storage or set defaults
    loadGameState();

    // Set UI elements from state
    document.getElementById('chk-sfx').checked = gameState.sfxEnabled;
    document.getElementById('chk-tts').checked = gameState.ttsEnabled;
    document.getElementById('volume-slider').value = gameState.volume;
    document.getElementById('speed-slider').value = gameState.autoSpeed;
    document.getElementById('speed-value').textContent = gameState.autoSpeed;

    // Set up interface according to mode
    updateGameModeUI();
    renderBoard();
    updateStats();
    renderHistory();
    renderBigBall();

    // Initialize physics simulation
    initSimulationBalls();
    startSimulation();

    // Initialize synchronization state for real-time viewer
    initSyncState();

    // Show admin access section if logged in as admin and no valid guest token is present
    const adminSec = document.getElementById('admin-access-section');
    if (adminSec) {
        const isAdmin = localStorage.getItem('el_bingote_admin') === 'true';
        const hasValidToken = validateToken(localStorage.getItem('el_bingote_token'));
        if (isAdmin && !hasValidToken) {
            adminSec.style.display = 'block';
        } else {
            adminSec.style.display = 'none';
        }
    }
}

// ==========================================
// STATE MANAGEMENT & LOCAL STORAGE
// ==========================================

function saveGameState() {
    localStorage.setItem('el_bingote_state', JSON.stringify(gameState));
}

function loadGameState() {
    const saved = localStorage.getItem('el_bingote_state');
    if (saved) {
        try {
            const parsed = JSON.parse(saved);
            // Deep copy variables
            gameState.drawnBalls = parsed.drawnBalls || [];
            
            // Default to 75 balls if no game is in progress
            if (gameState.drawnBalls.length === 0) {
                gameState.gameMode = 75;
            } else {
                gameState.gameMode = parsed.gameMode || 75;
            }
            gameState.autoSpeed = parsed.autoSpeed || 4;
            gameState.sfxEnabled = parsed.sfxEnabled !== undefined ? parsed.sfxEnabled : true;
            gameState.ttsEnabled = parsed.ttsEnabled !== undefined ? parsed.ttsEnabled : true;
            gameState.volume = parsed.volume !== undefined ? parsed.volume : 0.7;
            gameState.selectedVoiceName = parsed.selectedVoiceName || '';
            gameState.syncCode = parsed.syncCode || '';
            
            // Re-generate pools
            rebuildBallsPool();
        } catch (e) {
            console.error("Error reading saved game state, resetting", e);
            resetGameState();
        }
    } else {
        resetGameState();
    }
}

function resetGameState() {
    gameState.drawnBalls = [];
    gameState.isPlaying = false;
    rebuildBallsPool();
    saveGameState();
}

function rebuildBallsPool() {
    gameState.ballsPool = [];
    const maxBalls = gameState.gameMode;
    for (let i = 1; i <= maxBalls; i++) {
        if (!gameState.drawnBalls.includes(i)) {
            gameState.ballsPool.push(i);
        }
    }
}

// ==========================================
// REAL-TIME SYNC UTILITIES
// ==========================================

function generateSyncCode() {
    const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
    let code = '';
    for (let i = 0; i < 12; i++) {
        code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
}

function getViewerUrl() {
    let baseUrl = window.location.href.split('?')[0].split('#')[0];
    if (baseUrl.endsWith('/')) {
        baseUrl = baseUrl + 'viewer.html';
    } else if (baseUrl.endsWith('index.html')) {
        baseUrl = baseUrl.replace('index.html', 'viewer.html');
    } else {
        baseUrl = baseUrl + '/viewer.html';
    }
    
    let url = baseUrl + '?game=' + gameState.syncCode;
    
    // Append temporary access token for the viewer
    let token = localStorage.getItem('el_bingote_token');
    const isAdmin = localStorage.getItem('el_bingote_admin') === 'true';
    if (isAdmin && !token) {
        // If we are admin but don't have a guest token in storage, generate a temporary 24h token for the viewer automatically
        const expiry = Date.now() + 24 * 3600000;
        const sig = generateSignature(expiry, ACCESS_SECRET);
        token = btoa(expiry + "." + sig);
    }
    
    if (token) {
        url += '&access=' + token;
    }
    
    return url;
}

function initSyncState() {
    if (!gameState.syncCode) {
        gameState.syncCode = generateSyncCode();
        saveGameState();
    }
    // Update input value with sharing URL
    const urlInput = document.getElementById('sync-share-url');
    if (urlInput) {
        urlInput.value = getViewerUrl();
    }
    // Initial broadcast of sync to cache the current state
    broadcastState('sync');
}

function openViewerTab() {
    window.open(getViewerUrl(), '_blank');
}

function copySyncLink() {
    const urlInput = document.getElementById('sync-share-url');
    if (urlInput) {
        urlInput.select();
        urlInput.setSelectionRange(0, 99999);
        navigator.clipboard.writeText(urlInput.value)
            .then(() => {
                const btn = document.getElementById('btn-copy-sync');
                const originalText = btn.textContent;
                btn.textContent = '✅ Copiado';
                setTimeout(() => {
                    btn.textContent = originalText;
                }, 2000);
            })
            .catch(err => {
                console.error("Error al copiar enlace: ", err);
            });
    }
}

function broadcastState(event, data = {}) {
    if (!gameState.syncCode) return;
    
    const payload = {
        event: event,
        gameMode: gameState.gameMode,
        drawnBalls: gameState.drawnBalls,
        ballsPool: gameState.ballsPool,
        isPlaying: gameState.isPlaying,
        isSpinning: isSpinning,
        drawnBallNumber: drawnBallTarget ? drawnBallTarget.number : null,
        data: data,
        timestamp: Date.now()
    };
    
    // Broadcast status over ntfy.sh
    fetch('https://ntfy.sh/el-bingote-' + gameState.syncCode, {
        method: 'POST',
        body: JSON.stringify(payload),
        headers: {
            'Content-Type': 'application/json'
        }
    }).catch(err => {
        console.warn("Failed to broadcast state change:", err);
    });
}

function setGameMode(mode) {
    if (gameState.drawnBalls.length > 0) {
        showAlert("No se puede cambiar el modo de juego una vez iniciado. Reinicia el juego primero.");
        return;
    }
    gameState.gameMode = mode;
    resetGameState();
    
    updateGameModeUI();
    renderBoard();
    updateStats();
    renderHistory();
    renderBigBall();
    
    initSimulationBalls();
    playClickSFX();

    // Broadcast change
    broadcastState('mode_change');
}

function updateGameModeUI() {
    const btn90 = document.getElementById('btn-mode-90');
    const btn75 = document.getElementById('btn-mode-75');
    if (gameState.gameMode === 90) {
        btn90.classList.add('active');
        btn75.classList.remove('active');
    } else {
        btn75.classList.add('active');
        btn90.classList.remove('active');
    }
}

// ==========================================
// WEB AUDIO SYNTHESIZER ENGINE
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
    
    // Modulator for the roll (frequency modulation to simulate tumbling)
    drumModNode = audioCtx.createOscillator();
    drumModGainNode = audioCtx.createGain();
    
    // Main rumble carrier
    drumOscNode = audioCtx.createOscillator();
    drumGainNode = audioCtx.createGain();
    
    drumModNode.type = 'sine';
    drumModNode.frequency.value = 16; // 16Hz LFO
    drumModGainNode.gain.value = 35; // FM depth
    
    drumOscNode.type = 'triangle';
    drumOscNode.frequency.value = 65; // Base frequency 65Hz
    
    drumGainNode.gain.setValueAtTime(0, now);
    drumGainNode.gain.linearRampToValueAtTime(gameState.volume * 0.45, now + 0.2);
    
    // Connections: mod -> modGain -> carrier frequency
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
// SPEECH SYNTHESIS SYSTEM (VOZ)
// ==========================================

function setupSpeech() {
    if ('speechSynthesis' in window) {
        // Load voices initially
        loadVoices();
        if (window.speechSynthesis.onvoiceschanged !== undefined) {
            window.speechSynthesis.onvoiceschanged = loadVoices;
        }
    } else {
        // Disable TTS UI if not supported
        document.getElementById('chk-tts').checked = false;
        document.getElementById('chk-tts').disabled = true;
        gameState.ttsEnabled = false;
    }
}

function loadVoices() {
    voices = window.speechSynthesis.getVoices();
    const select = document.getElementById('voice-select');
    if (!select) return;
    
    select.innerHTML = '';
    
    // Filter Spanish voices and add them first
    const spanishVoices = voices.filter(v => v.lang.startsWith('es'));
    const otherVoices = voices.filter(v => !v.lang.startsWith('es'));
    
    // Combine, putting Spanish voices at the top
    const sortedVoices = [...spanishVoices, ...otherVoices];
    
    if (sortedVoices.length === 0) {
        select.innerHTML = '<option value="">No se encontraron voces</option>';
        return;
    }
    
    sortedVoices.forEach(voice => {
        const option = document.createElement('option');
        option.value = voice.name;
        option.textContent = `${voice.name} (${voice.lang})`;
        
        // Match saved voice, or select first Spanish voice as default
        if (gameState.selectedVoiceName === voice.name) {
            option.selected = true;
        } else if (!gameState.selectedVoiceName && voice.lang.startsWith('es-')) {
            option.selected = true;
            gameState.selectedVoiceName = voice.name;
        }
        
        select.appendChild(option);
    });
    
    if (!gameState.selectedVoiceName && sortedVoices.length > 0) {
        gameState.selectedVoiceName = sortedVoices[0].name;
    }
}

function changeVoice(voiceName) {
    gameState.selectedVoiceName = voiceName;
    saveGameState();
    playClickSFX();
    speakBallText("El Bingote");
}

function speakBallText(text) {
    if (!gameState.ttsEnabled || !('speechSynthesis' in window)) return;
    
    window.speechSynthesis.cancel(); // Cancel current speaking
    
    currentUtterance = new SpeechSynthesisUtterance(text);
    
    // Find selected voice
    const activeVoice = voices.find(v => v.name === gameState.selectedVoiceName);
    if (activeVoice) {
        currentUtterance.voice = activeVoice;
    }
    
    currentUtterance.volume = gameState.volume;
    currentUtterance.rate = 0.95; // Slightly slower for better clarity
    
    window.speechSynthesis.speak(currentUtterance);
}

// Helper to format spoken text for bingo
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
        // Group by 10s for 90 balls
        if (num <= 18) return 'ball-color-b';
        if (num <= 36) return 'ball-color-i';
        if (num <= 54) return 'ball-color-n';
        if (num <= 72) return 'ball-color-g';
        return 'ball-color-o';
    }
}

function renderBoard() {
    const grid = document.getElementById('board-grid');
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
            // Manual overrides allowed by clicking cells when not spinning
            cell.onclick = () => handleCellManualClick(i);
            grid.appendChild(cell);
        }
    } else {
        grid.className = 'board-grid grid-75';
        
        const letters = ['B', 'I', 'N', 'G', 'O'];
        for (let i = 0; i < 5; i++) {
            const letter = letters[i];
            
            // Letter Header cell
            const hdrCell = document.createElement('div');
            hdrCell.className = 'board-cell board-col-hdr';
            hdrCell.textContent = letter;
            grid.appendChild(hdrCell);
            
            // 15 Number cells belonging to this letter
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
                cell.onclick = () => handleCellManualClick(num);
                grid.appendChild(cell);
            }
        }
    }
}

function handleCellManualClick(num) {
    if (isSpinning || drawnBallTarget) return; // Ignore during extraction animations
    
    initAudio();
    if (gameState.drawnBalls.includes(num)) {
        // Toggle off (remove ball)
        gameState.drawnBalls = gameState.drawnBalls.filter(x => x !== num);
        rebuildBallsPool();
        const cell = document.getElementById(`cell-${num}`);
        if (cell) cell.classList.remove('called');
        playClickSFX();
    } else {
        // Toggle on (add ball)
        gameState.drawnBalls.push(num);
        rebuildBallsPool();
        const cell = document.getElementById(`cell-${num}`);
        if (cell) cell.classList.add('called');
        playPopSFX();
        speakBallText(formatSpeechText(num));
    }
    
    updateStats();
    renderHistory();
    renderBigBall();
    initSimulationBalls(); // Remove/Restore from virtual drum
    saveGameState();
}

function updateStats() {
    const total = gameState.gameMode;
    const drawn = gameState.drawnBalls.length;
    const remaining = total - drawn;
    const percent = total > 0 ? Math.round((drawn / total) * 100) : 0;
    
    document.getElementById('stat-drawn').textContent = drawn;
    document.getElementById('stat-remaining').textContent = remaining;
    document.getElementById('stat-percent').textContent = `${percent}%`;
}

function renderHistory() {
    const list = document.getElementById('history-list');
    list.innerHTML = '';
    
    if (gameState.drawnBalls.length === 0) {
        list.innerHTML = '<div class="history-empty-msg">No se han extraído bolillas aún.</div>';
        return;
    }
    
    // Show last 5 drawn balls, most recent first
    const history = [...gameState.drawnBalls].reverse().slice(0, 5);
    
    // If we are currently animating an extraction, hide the absolute newest from history until animation finishes
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

function renderBigBall() {
    const container = document.getElementById('big-ball-container');
    const value = document.getElementById('big-ball-value');
    const subtext = document.getElementById('big-ball-subtext');
    
    if (gameState.drawnBalls.length === 0) {
        container.className = 'big-ball-container-empty';
        value.innerHTML = '<span class="big-ball-number-single">--</span>';
        subtext.textContent = 'Esperando sorteo...';
        return;
    }
    
    // If animating, display empty/rolling state or previous ball, until exit animation completes
    const num = gameState.drawnBalls[gameState.drawnBalls.length - 1];
    
    if (drawnBallTarget) {
        // Animating extraction
        container.className = 'big-ball-container-empty';
        value.innerHTML = '<span class="big-ball-number-single">??</span>';
        subtext.textContent = 'GIRANDO TÓMBOLA...';
        return;
    }
    
    // Normal display
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
// BINGO DRAW LOGIC
// ==========================================

function drawNextBall() {
    if (isSpinning || drawnBallTarget) return; // Lock if already spinning/drawing
    
    if (gameState.ballsPool.length === 0) {
        showAlert("¡El juego ha terminado! Todas las bolillas han sido extraídas.");
        if (gameState.isPlaying) toggleAutoPlay();
        return;
    }
    
    initAudio();
    isSpinning = true;
    
    // Disable game mode settings
    document.getElementById('btn-mode-90').disabled = true;
    document.getElementById('btn-mode-75').disabled = true;
    
    // Trigger high-speed spin in simulation
    triggerSimulationSpin(true);
    startDrumRollingSound();
    
    // Update Big Ball screen UI to spinning state
    renderBigBall();
    renderHistory();

    // Broadcast spin event
    broadcastState('spin');
    
    // Animation phases
    // Phase 1: Spin drum (1.5s)
    setTimeout(() => {
        // Select random ball from pool
        const randIdx = Math.floor(Math.random() * gameState.ballsPool.length);
        const drawnNum = gameState.ballsPool[randIdx];
        
        // Broadcast selected ball extraction
        broadcastState('extract', { num: drawnNum });

        // Phase 2: Animate ball popping out of drum in canvas
        triggerBallExtractionAnimation(drawnNum);
        stopDrumRollingSound();
        
    }, 1500);
}

function triggerBallExtractionAnimation(num) {
    isSpinning = false;
    triggerSimulationSpin(false); // Restore normal gravity/speed
    
    // Locate the ball in simulation, or create a temporary one if somehow missing
    let simBall = simBalls.find(b => b.number === num);
    if (!simBall) {
        simBall = createSingleSimBall(num);
        simBalls.push(simBall);
    }
    
    drawnBallTarget = simBall;
    drawnBallTarget.isTarget = true;
    exitAnimationTimer = 0;
}

// Called by simulation loop once the target ball reaches the bottom chute exit
function onBallExtracted(num) {
    drawnBallTarget = null;
    
    // Update State
    gameState.drawnBalls.push(num);
    gameState.ballsPool = gameState.ballsPool.filter(x => x !== num);
    
    // Remove ball from canvas simulation pool completely
    simBalls = simBalls.filter(b => b.number !== num);
    
    // Play sound and voice
    playPopSFX();
    speakBallText(formatSpeechText(num));
    
    // Render UI updates
    const cell = document.getElementById(`cell-${num}`);
    if (cell) cell.classList.add('called');
    
    updateStats();
    renderHistory();
    renderBigBall();
    saveGameState();
    
    // Broadcast ball extraction completion
    broadcastState('extracted', { num: num });

    // If auto-play is active, schedule next draw
    if (gameState.isPlaying) {
        if (gameState.ballsPool.length === 0) {
            toggleAutoPlay(); // Stop
            showAlert("¡El juego ha terminado! Todas las bolillas han sido extraídas.");
        } else {
            // Schedule next draw based on speed slider
            setTimeout(() => {
                if (gameState.isPlaying) {
                    drawNextBall();
                }
            }, gameState.autoSpeed * 1000);
        }
    }
}

// ==========================================
// AUTOPLAY & SETTINGS CONTROLS
// ==========================================

function toggleAutoPlay() {
    initAudio();
    const btn = document.getElementById('btn-autoplay');
    const icon = document.getElementById('autoplay-icon');
    const text = document.getElementById('autoplay-text');
    
    if (gameState.isPlaying) {
        // Turn OFF
        gameState.isPlaying = false;
        btn.classList.remove('active');
        icon.textContent = '▶';
        text.textContent = 'Auto-Sorteo';
    } else {
        // Turn ON
        if (gameState.ballsPool.length === 0) {
            showAlert("No quedan bolillas en la tómbola.");
            return;
        }
        gameState.isPlaying = true;
        btn.classList.add('active');
        icon.textContent = '⏸';
        text.textContent = 'Pausar';
        
        // Immediately draw first ball if not currently animating
        if (!isSpinning && !drawnBallTarget) {
            drawNextBall();
        }
    }

    // Broadcast sync status
    broadcastState('sync');
}

function updateAutoSpeed(val) {
    gameState.autoSpeed = parseInt(val);
    document.getElementById('speed-value').textContent = val;
    saveGameState();
}

function toggleSFX(checked) {
    gameState.sfxEnabled = checked;
    saveGameState();
}

function toggleTTS(checked) {
    gameState.ttsEnabled = checked;
    saveGameState();
}

function updateVolume(val) {
    gameState.volume = parseFloat(val);
    saveGameState();
}

// ==========================================
// RESET GAME CONTROLS & MODALS
// ==========================================

function confirmReset() {
    initAudio();
    playClickSFX();
    document.getElementById('confirm-modal').classList.add('active');
}

function closeConfirmModal() {
    document.getElementById('confirm-modal').classList.remove('active');
}

function openConfigModal() {
    initAudio();
    playClickSFX();
    document.getElementById('config-modal').classList.add('active');
}

function closeConfigModal() {
    document.getElementById('config-modal').classList.remove('active');
}

function executeReset() {
    closeConfirmModal();
    
    // Stop autoplay
    if (gameState.isPlaying) {
        toggleAutoPlay();
    }
    
    // Clear speaking
    if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
    }
    
    resetGameState();
    
    // Re-enable mode buttons
    document.getElementById('btn-mode-90').disabled = false;
    document.getElementById('btn-mode-75').disabled = false;
    
    // Render UI updates
    renderBoard();
    updateStats();
    renderHistory();
    renderBigBall();
    
    // Reset canvas balls
    initSimulationBalls();
    
    playResetSFX();

    // Broadcast reset event
    broadcastState('reset');
}

function showAlert(msg, title = "Aviso") {
    document.getElementById('alert-title').textContent = title;
    document.getElementById('alert-message').textContent = msg;
    document.getElementById('alert-modal').classList.add('active');
}

function closeAlertModal() {
    document.getElementById('alert-modal').classList.remove('active');
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
    
    // Retrieve colors/ratios
    const canvasWidth = canvas.width;
    const canvasHeight = canvas.height;
    const cx = canvasWidth / 2;
    const cy = canvasHeight / 2;
    const R = cx - 22; // cage radius
    
    const ballRadius = gameState.gameMode === 90 ? 10 : 11;
    
    // Place balls in remaining pool inside the circular cage
    gameState.ballsPool.forEach(num => {
        // Place randomly inside the circle (using polar coordinates to ensure inside bounds)
        const angle = Math.random() * Math.PI * 2;
        const radius = Math.random() * (R - ballRadius - 15);
        const bx = cx + Math.cos(angle) * radius;
        const by = cy + Math.sin(angle) * radius;
        
        const b = new SimulationBall(num, bx, by, ballRadius, getBallColorClass(num));
        simBalls.push(b);
    });
}

function triggerSimulationSpin(spin) {
    if (spin) {
        // Boost velocity of all balls
        simBalls.forEach(b => {
            b.vx = (Math.random() - 0.5) * 22;
            b.vy = (Math.random() - 0.5) * 22;
        });
    }
}

function createSingleSimBall(num) {
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
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const R = cx - 20; // cage boundary radius
    
    const gravity = isSpinning ? 0 : 0.15; // Gravity when resting, 0 when spinning
    const friction = 0.985; // Air friction
    
    // 1. Move and bounce balls off outer cage
    simBalls.forEach(b => {
        if (b.isTarget) {
            // Animating exit chute!
            // Move ball slowly towards bottom center exit chute
            const exitX = cx;
            const exitY = cy + R + 25; // below the exit hole
            
            const dx = exitX - b.x;
            const dy = exitY - b.y;
            
            b.x += dx * 0.1;
            b.y += dy * 0.1;
            
            // Check if it reached exit
            exitAnimationTimer++;
            if (exitAnimationTimer > 40 || Math.abs(dx) < 2 && Math.abs(dy) < 2) {
                b.isTarget = false;
                onBallExtracted(b.number);
            }
            return;
        }
        
        // Normal ball physics
        b.vy += gravity;
        b.vx *= friction;
        b.vy *= friction;
        
        // Add a tiny random shake when spinning
        if (isSpinning) {
            b.vx += (Math.random() - 0.5) * 1.5;
            b.vy += (Math.random() - 0.5) * 1.5;
        }
        
        b.x += b.vx;
        b.y += b.vy;
        
        // Cage bounce check (circular container boundary)
        const dx = b.x - cx;
        const dy = b.y - cy;
        const dist = Math.sqrt(dx*dx + dy*dy);
        
        if (dist + b.radius > R) {
            // Normal unit vector
            const nx = dx / dist;
            const ny = dy / dist;
            
            // Dot product velocity and normal
            const dot = b.vx * nx + b.vy * ny;
            
            if (dot > 0) {
                // Reflect velocity
                b.vx = b.vx - 2 * dot * nx;
                b.vy = b.vy - 2 * dot * ny;
                
                // RESTITUTION DAMPING
                b.vx *= 0.75;
                b.vy *= 0.75;
            }
            
            // Reposition on border
            b.x = cx + nx * (R - b.radius - 1);
            b.y = cy + ny * (R - b.radius - 1);
        }
    });
    
    // 2. Ball-to-ball collisions (elastic)
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
                // Resolve overlap immediately
                const overlap = minDist - dist;
                const nx = dx / dist;
                const ny = dy / dist;
                
                bA.x -= nx * overlap * 0.5;
                bA.y -= ny * overlap * 0.5;
                bB.x += nx * overlap * 0.5;
                bB.y += ny * overlap * 0.5;
                
                // Elastic velocity impact response
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
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const R = cx - 20;
    
    // 1. Draw Metallic outer ring of raffle drum
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 6;
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.stroke();
    
    // Inner glass backing
    ctx.fillStyle = 'rgba(15, 23, 42, 0.4)';
    ctx.beginPath();
    ctx.arc(cx, cy, R, 0, Math.PI * 2);
    ctx.fill();
    
    // 2. Draw exit hole at bottom
    ctx.fillStyle = '#020617';
    ctx.strokeStyle = '#64748b';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(cx, cy + R - 5, 20, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    
    // 3. Draw balls
    simBalls.forEach(b => {
        // Retrieve color code based on theme class name
        let gradientColors = ['#ff5722', '#d84315']; // fallback orange
        let labelColor = '#ffffff';
        
        switch(b.colorClass) {
            case 'ball-color-b': gradientColors = ['#3b82f6', '#1d4ed8']; break;
            case 'ball-color-i': gradientColors = ['#ef4444', '#b91c1c']; break;
            case 'ball-color-n': gradientColors = ['#f8fafc', '#94a3b8']; labelColor = '#0f172a'; break;
            case 'ball-color-g': gradientColors = ['#10b981', '#047857']; break;
            case 'ball-color-o': gradientColors = ['#f59e0b', '#b45309']; break;
        }
        
        // Draw Ball circle
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
        
        // Ball border
        ctx.strokeStyle = 'rgba(0,0,0,0.15)';
        ctx.lineWidth = 1;
        ctx.stroke();
        
        // Shine spot
        ctx.fillStyle = 'rgba(255, 255, 255, 0.3)';
        ctx.beginPath();
        ctx.arc(b.x - b.radius * 0.3, b.y - b.radius * 0.3, b.radius * 0.25, 0, Math.PI * 2);
        ctx.fill();
        
        // Number Label on Ball (only if ball is big enough to read, e.g. radius > 9)
        if (b.radius > 8) {
            ctx.fillStyle = labelColor;
            ctx.font = `bold ${b.radius * 1.1}px Arial`;
            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';
            ctx.fillText(b.number, b.x, b.y + 0.5);
        }
    });
    
    // 4. Draw front transparent cage grid lines (simulates wire cage structure)
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.05)';
    ctx.lineWidth = 1.5;
    
    // Vertical arcs
    for (let offset = -R + 30; offset < R; offset += 35) {
        if (offset === 0) continue;
        const xOffset = Math.abs(offset);
        const radius = Math.sqrt(R*R - xOffset*xOffset);
        
        ctx.beginPath();
        ctx.ellipse(cx + offset/2, cy, Math.abs(offset/2), R, 0, 0, Math.PI * 2);
        ctx.stroke();
    }
    
    // Horizontal wire circles
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.04)';
    for (let r = 40; r < R; r += 40) {
        ctx.beginPath();
        ctx.arc(cx, cy, r, 0, Math.PI * 2);
        ctx.stroke();
    }
}
