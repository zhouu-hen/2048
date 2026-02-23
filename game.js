/**
 * 2048 – Complete Game Logic
 * Features:
 *  - Extensible difficulty system (3×3 to 6×6, easily expandable)
 *  - Auto-save / load per difficulty (localStorage)
 *  - Per-difficulty best scores
 *  - Full game mechanics: slide, merge, undo
 *  - Smooth CSS animations
 *  - Touch / swipe optimised for mobile
 *  - Score flyup effects
 */

(function () {
  'use strict';

  /* ═══════════════════════════════════════════════════════════
     DIFFICULTY CONFIG
     To add a new difficulty, push another entry here.
     id       – unique key (used for localStorage keys)
     label    – display name
     gridSize – NxN board
     target   – winning tile value
  ═══════════════════════════════════════════════════════════ */
  const DIFFICULTIES = [
    { id: 'easy',   label: '简单', gridSize: 3, target: 512  },
    { id: 'normal', label: '普通', gridSize: 4, target: 2048 },
    { id: 'hard',   label: '困难', gridSize: 5, target: 4096 },
    { id: 'expert', label: '专家', gridSize: 6, target: 8192 },
  ];

  /* ─── Storage keys ─────────────────────────────────────────── */
  const KEY_BEST_SCORES   = '2048-best-scores';
  const KEY_LAST_DIFF     = '2048-last-diff';
  const stateKey = id  => '2048-state-' + id;

  /* ─── Runtime state ────────────────────────────────────────── */
  let diff        = DIFFICULTIES[1];   // current difficulty object
  let SIZE        = diff.gridSize;
  let TARGET      = diff.target;

  let grid        = [];
  let score       = 0;
  let bestScores  = {};                // { easy: 0, normal: 500, ... }
  let tileId      = 0;
  let gameOver    = false;
  let won         = false;
  let keepPlaying = false;

  // Undo
  let prevGrid    = null;
  let prevScore   = 0;

  /* ─── DOM refs ─────────────────────────────────────────────── */
  const scoreEl        = document.getElementById('score');
  const bestScoreEl    = document.getElementById('best-score');
  const tileContainer  = document.getElementById('tile-container');
  const gridContainer  = document.getElementById('grid-container');
  const diffBar        = document.getElementById('difficulty-bar');
  const targetLabel    = document.getElementById('target-label');
  const winTargetLabel = document.getElementById('win-target-label');
  const gameOverlay    = document.getElementById('game-over-overlay');
  const winOverlay     = document.getElementById('win-overlay');
  const finalScoreEl   = document.getElementById('final-score');
  const saveHintEl     = document.getElementById('save-hint');
  const scoreAdds      = document.getElementById('score-additions');

  /* ═══════════════════════════════════════════════════════════
     SAVE / LOAD
  ═══════════════════════════════════════════════════════════ */
  function saveState() {
    try {
      const state = { grid, score, tileId, won, keepPlaying };
      localStorage.setItem(stateKey(diff.id), JSON.stringify(state));
      localStorage.setItem(KEY_BEST_SCORES, JSON.stringify(bestScores));
      localStorage.setItem(KEY_LAST_DIFF, diff.id);
      showSaveHint();
    } catch (_) { /* storage quota exceeded – ignore */ }
  }

  function loadState(d) {
    try {
      const raw = localStorage.getItem(stateKey(d.id));
      if (!raw) return false;
      const s = JSON.parse(raw);
      if (!Array.isArray(s.grid) || s.grid.length !== d.gridSize) return false;

      grid = s.grid.map(row => row.map(cell => {
        if (!cell) return null;
        // Strip in-flight flags so tiles restore without animation
        return { value: cell.value, r: cell.r, c: cell.c,
                 id: cell.id, isNew: false, merged: false };
      }));
      score       = s.score || 0;
      tileId      = s.tileId || maxId(grid);
      won         = s.won || false;
      keepPlaying = s.keepPlaying || false;
      return true;
    } catch (_) { return false; }
  }

  function clearSave(d) {
    localStorage.removeItem(stateKey(d.id));
  }

  function maxId(g) {
    let m = 0;
    for (const row of g)
      for (const c of row)
        if (c && c.id > m) m = c.id;
    return m;
  }

  /* Save-hint flash (shows briefly after each save) */
  let saveHintTimer = null;
  function showSaveHint() {
    saveHintEl.textContent = '进度已自动保存';
    clearTimeout(saveHintTimer);
    saveHintTimer = setTimeout(() => { saveHintEl.textContent = ''; }, 1800);
  }

  /* ═══════════════════════════════════════════════════════════
     DIFFICULTY UI
  ═══════════════════════════════════════════════════════════ */
  function buildDiffBar() {
    diffBar.innerHTML = '';
    DIFFICULTIES.forEach(d => {
      const btn = document.createElement('button');
      btn.className = 'diff-btn' + (d.id === diff.id ? ' active' : '');
      btn.dataset.diffId = d.id;
      btn.setAttribute('aria-label', d.label + ' ' + d.gridSize + '×' + d.gridSize);
      btn.innerHTML =
        '<span>' + d.label + '</span>' +
        '<span class="diff-size">' + d.gridSize + '×' + d.gridSize + '</span>';
      btn.addEventListener('click', () => switchDifficulty(d));
      diffBar.appendChild(btn);
    });
  }

  function updateDiffButtons() {
    diffBar.querySelectorAll('.diff-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.diffId === diff.id);
    });
  }

  function switchDifficulty(d) {
    if (d.id === diff.id) return;
    diff   = d;
    SIZE   = d.gridSize;
    TARGET = d.target;

    updateDiffButtons();
    targetLabel.textContent    = TARGET;
    winTargetLabel.textContent = TARGET;

    // Update CSS --grid-size for the background grid
    document.documentElement.style.setProperty('--grid-size', SIZE);

    // Rebuild background grid cells
    buildGridBackground();

    // Clear all existing tile DOM elements
    tileContainer.innerHTML = '';
    tileEls.clear();
    tileId = 0;

    // Try to restore saved game for this difficulty
    const restored = loadState(d);
    bestScores[d.id] = bestScores[d.id] || 0;

    if (!restored) {
      grid        = emptyGrid();
      score       = 0;
      gameOver    = false;
      won         = false;
      keepPlaying = false;
      prevGrid    = null;
      prevScore   = 0;
      addRandomTile(grid);
      addRandomTile(grid);
    } else {
      gameOver = false;   // will be re-evaluated below
      prevGrid = null;
      prevScore = 0;
    }

    hideOverlays();
    updateScores();
    render(/* animate= */ false);

    // Re-check state without adding a tile (board is fully loaded)
    if (won && !keepPlaying) showWin();
    else if (!canMove())     { gameOver = true; showGameOver(); }
  }

  /* ═══════════════════════════════════════════════════════════
     GRID BACKGROUND GENERATION
  ═══════════════════════════════════════════════════════════ */
  function buildGridBackground() {
    gridContainer.innerHTML = '';
    for (let i = 0; i < SIZE * SIZE; i++) {
      const cell = document.createElement('div');
      cell.className = 'grid-cell';
      gridContainer.appendChild(cell);
    }
  }

  /* ═══════════════════════════════════════════════════════════
     GAME UTILITIES
  ═══════════════════════════════════════════════════════════ */
  function emptyGrid() {
    return Array.from({ length: SIZE }, () => Array(SIZE).fill(null));
  }

  function cloneGrid(g) {
    return g.map(row => row.map(cell => (cell ? { ...cell } : null)));
  }

  function emptyPositions(g) {
    const pos = [];
    for (let r = 0; r < SIZE; r++)
      for (let c = 0; c < SIZE; c++)
        if (!g[r][c]) pos.push({ r, c });
    return pos;
  }

  function randomFrom(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }

  function makeTile(value, r, c) {
    return { value, r, c, id: ++tileId, isNew: true, merged: false };
  }

  function addRandomTile(g) {
    const empties = emptyPositions(g);
    if (!empties.length) return;
    const { r, c } = randomFrom(empties);
    g[r][c] = makeTile(Math.random() < 0.9 ? 2 : 4, r, c);
  }

  /* ═══════════════════════════════════════════════════════════
     MOVE LOGIC
  ═══════════════════════════════════════════════════════════ */
  /**
   * Slide one line leftward (array order), merging adjacent equals.
   * Returns { line, gained }.
   */
  function slideLine(line) {
    const tiles = line.filter(Boolean);
    const result = [];
    let gained = 0;
    let i = 0;
    while (i < tiles.length) {
      if (i + 1 < tiles.length && tiles[i].value === tiles[i + 1].value) {
        const val = tiles[i].value * 2;
        gained += val;
        result.push({ ...tiles[i], value: val, merged: true, isNew: false });
        i += 2;
      } else {
        result.push({ ...tiles[i], merged: false, isNew: false });
        i++;
      }
    }
    while (result.length < SIZE) result.push(null);
    return { line: result, gained };
  }

  function move(direction) {
    let totalGained = 0;
    let changed = false;
    const newGrid = emptyGrid();

    if (direction === 'left' || direction === 'right') {
      for (let r = 0; r < SIZE; r++) {
        let row = grid[r].map(c => (c ? { ...c } : null));
        if (direction === 'right') row.reverse();
        const { line, gained } = slideLine(row);
        if (direction === 'right') line.reverse();
        totalGained += gained;
        for (let c = 0; c < SIZE; c++) {
          if (line[c]) { line[c].r = r; line[c].c = c; }
          newGrid[r][c] = line[c];
        }
      }
    } else {
      for (let c = 0; c < SIZE; c++) {
        let col = grid.map(row => (row[c] ? { ...row[c] } : null));
        if (direction === 'down') col.reverse();
        const { line, gained } = slideLine(col);
        if (direction === 'down') line.reverse();
        totalGained += gained;
        for (let r = 0; r < SIZE; r++) {
          if (line[r]) { line[r].r = r; line[r].c = c; }
          newGrid[r][c] = line[r];
        }
      }
    }

    // Detect whether the board changed
    outer:
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const o = grid[r][c], n = newGrid[r][c];
        if ((!o && n) || (o && !n)) { changed = true; break outer; }
        if (o && n && (o.id !== n.id || o.r !== n.r || o.c !== n.c)) {
          changed = true; break outer;
        }
      }
    }
    if (!changed) return false;

    // Save undo snapshot
    prevGrid  = cloneGrid(grid);
    prevScore = score;

    grid   = newGrid;
    score += totalGained;
    if (totalGained > 0) showScoreAdd(totalGained);
    updateScores();

    addRandomTile(grid);
    render(/* animate= */ true);
    checkState();

    saveState();   // auto-save after every valid move
    return true;
  }

  /* ═══════════════════════════════════════════════════════════
     STATE CHECKS
  ═══════════════════════════════════════════════════════════ */
  function checkState() {
    if (!keepPlaying && !won) {
      for (const row of grid)
        for (const cell of row)
          if (cell && cell.value === TARGET) {
            won = true;
            setTimeout(showWin, 350);
            return;
          }
    }
    if (!canMove()) {
      gameOver = true;
      setTimeout(showGameOver, 350);
    }
  }

  function canMove() {
    for (let r = 0; r < SIZE; r++)
      for (let c = 0; c < SIZE; c++) {
        if (!grid[r][c]) return true;
        const v = grid[r][c].value;
        if (c + 1 < SIZE && grid[r][c + 1] && grid[r][c + 1].value === v) return true;
        if (r + 1 < SIZE && grid[r + 1][c] && grid[r + 1][c].value === v) return true;
      }
    return false;
  }

  /* ═══════════════════════════════════════════════════════════
     RENDERING
  ═══════════════════════════════════════════════════════════ */
  const tileEls = new Map();   // tileId → HTMLElement

  function getMetrics() {
    const w = tileContainer.offsetWidth;
    const h = tileContainer.offsetHeight;
    const gapc = getComputedStyle(document.documentElement);
    const gap  = parseFloat(gapc.getPropertyValue('--gap')) || 12;
    return {
      cellW: (w - gap * (SIZE - 1)) / SIZE,
      cellH: (h - gap * (SIZE - 1)) / SIZE,
      gap,
    };
  }

  function tilePos(r, c, cellW, cellH, gap) {
    return { left: c * (cellW + gap), top: r * (cellH + gap), w: cellW, h: cellH };
  }

  function calcFontSize(value, cellW) {
    if (value < 100)   return Math.round(cellW * 0.44);
    if (value < 1000)  return Math.round(cellW * 0.36);
    if (value < 10000) return Math.round(cellW * 0.29);
    return                    Math.round(cellW * 0.22);
  }

  function tileDataValue(v) {
    const known = [2,4,8,16,32,64,128,256,512,1024,2048,4096,8192];
    return known.includes(v) ? String(v) : 'super';
  }

  /**
   * @param {boolean} animate – false when restoring from save (skip new-tile anim)
   */
  function render(animate) {
    const { cellW, cellH, gap } = getMetrics();
    const activeIds = new Set();

    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const tile = grid[r][c];
        if (!tile) continue;
        activeIds.add(tile.id);

        const pos = tilePos(r, c, cellW, cellH, gap);
        let el = tileEls.get(tile.id);

        if (!el) {
          el = document.createElement('div');
          el.className = 'tile';
          tileContainer.appendChild(el);
          tileEls.set(tile.id, el);

          // Place without transition first
          el.style.transition = 'none';
          applyTileStyle(el, tile, pos, cellW);

          // Force reflow, then re-enable transition
          el.getBoundingClientRect();
          el.style.transition = '';

          if (animate && tile.isNew) {
            el.classList.remove('tile-new');
            void el.offsetWidth;
            el.classList.add('tile-new');
          }
        } else {
          // Slide to new position
          el.style.transition = '';
          el.style.left   = pos.left + 'px';
          el.style.top    = pos.top  + 'px';
          el.style.width  = pos.w    + 'px';
          el.style.height = pos.h    + 'px';
          el.style.fontSize = calcFontSize(tile.value, cellW) + 'px';

          if (tile.merged) {
            el.setAttribute('data-value', tileDataValue(tile.value));
            el.classList.toggle('tile-super', tile.value > 8192);
            el.textContent = tile.value;
            el.classList.remove('tile-merged', 'tile-new');
            void el.offsetWidth;
            el.classList.add('tile-merged');
          }
        }
      }
    }

    // Remove stale tiles
    for (const [id, el] of tileEls) {
      if (!activeIds.has(id)) {
        el.remove();
        tileEls.delete(id);
      }
    }
  }

  function applyTileStyle(el, tile, pos, cellW) {
    el.style.left      = pos.left + 'px';
    el.style.top       = pos.top  + 'px';
    el.style.width     = pos.w    + 'px';
    el.style.height    = pos.h    + 'px';
    el.style.fontSize  = calcFontSize(tile.value, cellW) + 'px';
    el.setAttribute('data-value', tileDataValue(tile.value));
    el.classList.toggle('tile-super', tile.value > 8192);
    el.textContent = tile.value;
  }

  /* Reposition all tiles on window resize (no animation) */
  function reposition() {
    const { cellW, cellH, gap } = getMetrics();
    for (let r = 0; r < SIZE; r++) {
      for (let c = 0; c < SIZE; c++) {
        const tile = grid[r][c];
        if (!tile) continue;
        const el = tileEls.get(tile.id);
        if (!el) continue;
        const pos = tilePos(r, c, cellW, cellH, gap);
        el.style.transition = 'none';
        el.style.left   = pos.left + 'px';
        el.style.top    = pos.top  + 'px';
        el.style.width  = pos.w    + 'px';
        el.style.height = pos.h    + 'px';
        el.style.fontSize = calcFontSize(tile.value, cellW) + 'px';
      }
    }
  }

  /* ═══════════════════════════════════════════════════════════
     SCORE
  ═══════════════════════════════════════════════════════════ */
  function updateScores() {
    scoreEl.textContent = score;
    if (score > (bestScores[diff.id] || 0)) {
      bestScores[diff.id] = score;
    }
    bestScoreEl.textContent = bestScores[diff.id] || 0;
  }

  function showScoreAdd(amount) {
    const el  = document.createElement('div');
    el.className = 'score-addition';
    el.textContent = '+' + amount;
    const rect = scoreEl.getBoundingClientRect();
    el.style.left = rect.left + 'px';
    el.style.top  = rect.top  + 'px';
    scoreAdds.appendChild(el);
    el.addEventListener('animationend', () => el.remove());
  }

  /* ═══════════════════════════════════════════════════════════
     OVERLAYS
  ═══════════════════════════════════════════════════════════ */
  function showGameOver() {
    finalScoreEl.textContent = score;
    gameOverlay.classList.add('active');
  }

  function showWin() {
    winTargetLabel.textContent = TARGET;
    winOverlay.classList.add('active');
  }

  function hideOverlays() {
    gameOverlay.classList.remove('active');
    winOverlay.classList.remove('active');
  }

  /* ═══════════════════════════════════════════════════════════
     NEW GAME / UNDO
  ═══════════════════════════════════════════════════════════ */
  function newGame() {
    hideOverlays();
    tileContainer.innerHTML = '';
    tileEls.clear();
    tileId = 0;

    grid        = emptyGrid();
    score       = 0;
    gameOver    = false;
    won         = false;
    keepPlaying = false;
    prevGrid    = null;
    prevScore   = 0;

    addRandomTile(grid);
    addRandomTile(grid);

    updateScores();
    render(/* animate= */ true);
    clearSave(diff);      // discard the old save for fresh start
    saveState();
  }

  function undo() {
    if (!prevGrid) return;
    hideOverlays();
    gameOver = false;
    won      = false;

    tileContainer.innerHTML = '';
    tileEls.clear();

    grid      = prevGrid;
    score     = prevScore;
    prevGrid  = null;

    updateScores();
    render(/* animate= */ false);
    saveState();
  }

  /* ═══════════════════════════════════════════════════════════
     INPUT HANDLERS
  ═══════════════════════════════════════════════════════════ */
  document.addEventListener('keydown', function (e) {
    const dirMap = {
      ArrowLeft: 'left',  ArrowRight: 'right',
      ArrowUp:   'up',    ArrowDown:  'down',
      a: 'left', A: 'left',
      d: 'right',D: 'right',
      w: 'up',   W: 'up',
      s: 'down', S: 'down',
    };
    const dir = dirMap[e.key];
    if (dir) {
      e.preventDefault();
      if (!gameOver) move(dir);
    }
  });

  /* Touch / swipe */
  let touchX = 0, touchY = 0;
  const MIN_SWIPE = 30;

  document.getElementById('game-board').addEventListener('touchstart', e => {
    touchX = e.touches[0].clientX;
    touchY = e.touches[0].clientY;
  }, { passive: true });

  document.getElementById('game-board').addEventListener('touchend', e => {
    if (!e.changedTouches.length || gameOver) return;
    const dx = e.changedTouches[0].clientX - touchX;
    const dy = e.changedTouches[0].clientY - touchY;
    if (Math.max(Math.abs(dx), Math.abs(dy)) < MIN_SWIPE) return;
    if (Math.abs(dx) > Math.abs(dy)) move(dx > 0 ? 'right' : 'left');
    else                              move(dy > 0 ? 'down'  : 'up');
  }, { passive: true });

  /* Buttons */
  document.getElementById('new-game-btn')    .addEventListener('click', newGame);
  document.getElementById('undo-btn')        .addEventListener('click', undo);
  document.getElementById('restart-btn')     .addEventListener('click', newGame);
  document.getElementById('continue-btn')    .addEventListener('click', () => {
    keepPlaying = true;
    hideOverlays();
    saveState();
  });
  document.getElementById('new-game-win-btn').addEventListener('click', newGame);

  /* Resize – recompute tile pixel positions */
  let resizeTimer;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(reposition, 80);
  });

  /* ═══════════════════════════════════════════════════════════
     INIT
  ═══════════════════════════════════════════════════════════ */
  function init() {
    // Load persisted best scores
    try {
      bestScores = JSON.parse(localStorage.getItem(KEY_BEST_SCORES)) || {};
    } catch (_) { bestScores = {}; }

    // Restore last-used difficulty
    const lastDiffId = localStorage.getItem(KEY_LAST_DIFF);
    const savedDiff  = DIFFICULTIES.find(d => d.id === lastDiffId) || DIFFICULTIES[1];
    diff   = savedDiff;
    SIZE   = diff.gridSize;
    TARGET = diff.target;

    // Build difficulty buttons
    buildDiffBar();

    // Set CSS --grid-size
    document.documentElement.style.setProperty('--grid-size', SIZE);

    // Update target labels
    targetLabel.textContent    = TARGET;
    winTargetLabel.textContent = TARGET;

    // Build background grid cells
    buildGridBackground();

    // Try to restore a saved game; fall back to new game
    const restored = loadState(diff);
    if (!restored) {
      grid = emptyGrid();
      addRandomTile(grid);
      addRandomTile(grid);
    }

    updateScores();
    render(/* animate= */ false);

    // Show appropriate overlay after restore
    if (restored) {
      if (won && !keepPlaying) showWin();
      else if (!canMove())    { gameOver = true; showGameOver(); }
    }
  }

  init();

})();
