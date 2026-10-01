// ==========================================
// 1. SUPABASE CREDENTIALS (PASTE YOURS HERE)
// ==========================================
const SUPABASE_URL = "https://pxubennkaogxynrhkyuk.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_O-CeDULC2SWZb6ullHg95w_nfC2u8uq";

// Safe initialization
let supabaseClient = null;
if (window.supabase && SUPABASE_URL.startsWith("https://")) {
  supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

// Player Identity
let playerId = localStorage.getItem("runner_player_id");
if (!playerId) {
  playerId = "user_" + Math.random().toString(36).substring(2, 9);
  localStorage.setItem("runner_player_id", playerId);
}

// UI Elements
const lobbyView = document.getElementById("lobby-view");
const gameView = document.getElementById("game-view");
const btnCreate = document.getElementById("btn-create");
const btnJoin = document.getElementById("btn-join");
const inputCode = document.getElementById("input-code");
const lobbyError = document.getElementById("lobby-error");

const lblCode = document.getElementById("lbl-code");
const btnCopy = document.getElementById("btn-copy");
const copyMsg = document.getElementById("copy-msg");
const lblRole = document.getElementById("lbl-role");
const lblStatus = document.getElementById("lbl-status");
const gameOverBox = document.getElementById("game-over-box");
const lblWinner = document.getElementById("lbl-winner");
const lblScores = document.getElementById("lbl-scores");
const btnRematch = document.getElementById("btn-rematch");
const btnLeave = document.getElementById("btn-leave");

const canvas = document.getElementById("game-canvas");
const ctx = canvas.getContext("2d");

// Room & Networking State
let currentRoom = null;
let realtimeChannel = null;
let myRole = null; // 'p1' or 'p2'
let animationId = null;

// Game World Constants
const GRAVITY = 0.55;
const JUMP_FORCE = -9.5;
const SPEED = 4.2;

// Runner States
const p1 = { x: 50, y: 80, vy: 0, ground: 80, w: 22, h: 22, dead: false, score: 0 };
const p2 = { x: 50, y: 200, vy: 0, ground: 200, w: 22, h: 22, dead: false, score: 0 };
let obstacles = [];
let obstacleTimer = 0;
let nextSpawnInterval = 90;
let prngSeed = 1;

// PRNG for synchronized obstacle generation
function pseudoRandom() {
  prngSeed = (prngSeed * 9301 + 49297) % 233280;
  return prngSeed / 233280;
}

// Auto-join via URL param
window.addEventListener("DOMContentLoaded", () => {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("game");
  if (code && supabaseClient) {
    inputCode.value = code.toUpperCase();
    joinRoom(code.toUpperCase());
  }
});

// Lobby Listeners
btnCreate.addEventListener("click", createRoom);
btnJoin.addEventListener("click", () => {
  const code = inputCode.value.trim().toUpperCase();
  if (code) joinRoom(code);
});

btnCopy.addEventListener("click", () => {
  const url = `${window.location.origin}${window.location.pathname}?game=${currentRoom.id}`;
  navigator.clipboard.writeText(url).then(() => {
    copyMsg.textContent = "Copied!";
    setTimeout(() => { copyMsg.textContent = ""; }, 2000);
  });
});

btnRematch.addEventListener("click", triggerRematch);
btnLeave.addEventListener("click", leaveRoom);

// Input Handlers (Space, Up Arrow, Canvas Click/Touch)
window.addEventListener("keydown", (e) => {
  if (e.code === "Space" || e.code === "ArrowUp") {
    e.preventDefault();
    performJump();
  }
});

canvas.addEventListener("pointerdown", (e) => {
  e.preventDefault();
  performJump();
});

// Jump Execution
function performJump() {
  if (!currentRoom || currentRoom.status !== "playing") return;

  const me = myRole === "p1" ? p1 : p2;
  if (!me.dead && me.y >= me.ground) {
    me.vy = JUMP_FORCE;

    // Broadcast jump instantly to the opponent
    if (realtimeChannel) {
      realtimeChannel.send({
        type: "broadcast",
        event: "jump",
        payload: { role: myRole }
      });
    }
  }
}

// Room Creation
async function createRoom() {
  if (!supabaseClient) return;
  lobbyError.textContent = "";
  const code = Math.random().toString(36).substring(2, 8).toUpperCase();

  const { data, error } = await supabaseClient
    .from("runner_games")
    .insert([{
      id: code,
      player_1: playerId,
      player_2: null,
      status: "waiting",
      start_time: null
    }])
    .select()
    .single();

  if (error) {
    lobbyError.textContent = "Failed to create room.";
    return;
  }

  myRole = "p1";
  enterGameView(data);
}

// Join Room
async function joinRoom(code) {
  if (!supabaseClient) return;
  lobbyError.textContent = "";

  const { data: room, error } = await supabaseClient
    .from("runner_games")
    .select()
    .eq("id", code)
    .single();

  if (error || !room) {
    lobbyError.textContent = "Room not found.";
    return;
  }

  if (!room.player_2 && room.player_1 !== playerId) {
    const { data: updated, error: updateError } = await supabaseClient
      .from("runner_games")
      .update({
        player_2: playerId,
        status: "playing",
        start_time: Date.now()
      })
      .eq("id", code)
      .select()
      .single();

    if (updateError) {
      lobbyError.textContent = "Could not join room.";
      return;
    }
    myRole = "p2";
    enterGameView(updated);
  } else {
    myRole = room.player_1 === playerId ? "p1" : room.player_2 === playerId ? "p2" : null;
    if (!myRole) {
      lobbyError.textContent = "Room is already full.";
      return;
    }
    enterGameView(room);
  }
}

// Enter Game Screen
function enterGameView(room) {
  currentRoom = room;
  lobbyView.style.display = "none";
  gameView.style.display = "block";
  lblCode.textContent = room.id;

  lblRole.textContent = myRole === "p1" ? "You: Player 1 (Blue)" : "You: Player 2 (Orange)";

  const url = new URL(window.location);
  url.searchParams.set("game", room.id);
  window.history.pushState({}, "", url);

  subscribeNetwork(room.id);

  if (room.status === "playing") {
    startMatch();
  } else {
    lblStatus.textContent = "Waiting for Player 2...";
    drawLobbyPlaceholder();
  }
}

// Supabase Realtime Listener (Postgres updates + Instant Broadcasts)
function subscribeNetwork(code) {
  if (realtimeChannel) {
    supabaseClient.removeChannel(realtimeChannel);
  }

  realtimeChannel = supabaseClient
    .channel(`runner_${code}`)
    .on(
      "postgres_changes",
      { event: "UPDATE", schema: "public", table: "runner_games", filter: `id=eq.${code}` },
      (payload) => {
        currentRoom = payload.new;
        if (currentRoom.status === "playing" && !animationId) {
          startMatch();
        }
      }
    )
    .on("broadcast", { event: "jump" }, (payload) => {
      const targetRole = payload.payload.role;
      const target = targetRole === "p1" ? p1 : p2;
      if (target.y >= target.ground) {
        target.vy = JUMP_FORCE;
      }
    })
    .on("broadcast", { event: "player_dead" }, (payload) => {
      const { role, score } = payload.payload;
      if (role === "p1") { p1.dead = true; p1.score = score; }
      if (role === "p2") { p2.dead = true; p2.score = score; }
      checkMatchOver();
    })
    .on("broadcast", { event: "restart" }, () => {
      startMatch();
    })
    .subscribe();
}

// Start Game Loop
function startMatch() {
  lblStatus.textContent = "Running!";
  gameOverBox.style.display = "none";

  // Reset Runners
  p1.y = p1.ground; p1.vy = 0; p1.dead = false; p1.score = 0;
  p2.y = p2.ground; p2.vy = 0; p2.dead = false; p2.score = 0;

  // Initialize Seed with Room Code for identical obstacles
  prngSeed = 0;
  for (let i = 0; i < currentRoom.id.length; i++) {
    prngSeed += currentRoom.id.charCodeAt(i);
  }

  obstacles = [];
  obstacleTimer = 0;
  nextSpawnInterval = 80;

  if (animationId) cancelAnimationFrame(animationId);
  animationId = requestAnimationFrame(gameLoop);
}

// Main Frame Loop
function gameLoop() {
  updateGame();
  renderGame();

  if (!p1.dead || !p2.dead) {
    animationId = requestAnimationFrame(gameLoop);
  } else {
    animationId = null;
    checkMatchOver();
  }
}

// Update Physics & Obstacles
function updateGame() {
  // Update Player 1
  if (!p1.dead) {
    p1.vy += GRAVITY;
    p1.y += p1.vy;
    if (p1.y > p1.ground) { p1.y = p1.ground; p1.vy = 0; }
    p1.score++;
  }

  // Update Player 2
  if (!p2.dead) {
    p2.vy += GRAVITY;
    p2.y += p2.vy;
    if (p2.y > p2.ground) { p2.y = p2.ground; p2.vy = 0; }
    p2.score++;
  }

  // Spawn Obstacles Deterministically
  obstacleTimer++;
  if (obstacleTimer >= nextSpawnInterval) {
    obstacleTimer = 0;
    nextSpawnInterval = Math.floor(65 + pseudoRandom() * 60); // 65 - 125 frames gap
    const obsWidth = Math.floor(16 + pseudoRandom() * 12);
    const obsHeight = Math.floor(22 + pseudoRandom() * 10);

    obstacles.push({
      x: canvas.width,
      w: obsWidth,
      h: obsHeight
    });
  }

  // Move Obstacles & Check Collisions
  for (let i = obstacles.length - 1; i >= 0; i--) {
    const ob = obstacles[i];
    ob.x -= SPEED;

    // Collision check for Player 1 (Lane 1: ground = 102)
    if (!p1.dead) {
      if (checkCollision(p1, ob, 102)) {
        p1.dead = true;
        if (myRole === "p1") broadcastDeath(p1.score);
      }
    }

    // Collision check for Player 2 (Lane 2: ground = 222)
    if (!p2.dead) {
      if (checkCollision(p2, ob, 222)) {
        p2.dead = true;
        if (myRole === "p2") broadcastDeath(p2.score);
      }
    }

    // Cleanup offscreen obstacles
    if (ob.x + ob.w < 0) {
      obstacles.splice(i, 1);
    }
  }
}

// AABB Collision Detection
function checkCollision(player, obstacle, laneGroundY) {
  const pBox = { left: player.x, right: player.x + player.w, top: player.y, bottom: player.y + player.h };
  const oBox = { left: obstacle.x, right: obstacle.x + obstacle.w, top: laneGroundY - obstacle.h, bottom: laneGroundY };

  return (
    pBox.right > oBox.left &&
    pBox.left < oBox.right &&
    pBox.bottom > oBox.top &&
    pBox.top < oBox.bottom
  );
}

function broadcastDeath(finalScore) {
  if (realtimeChannel) {
    realtimeChannel.send({
      type: "broadcast",
      event: "player_dead",
      payload: { role: myRole, score: finalScore }
    });
  }
}

// Render Canvas
function renderGame() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Lane Dividers & Grounds
  ctx.strokeStyle = "#333";
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(0, 130);
  ctx.lineTo(canvas.width, 130);
  ctx.stroke();

  // Lane 1 Ground line
  ctx.strokeStyle = "#555";
  ctx.beginPath();
  ctx.moveTo(0, 102);
  ctx.lineTo(canvas.width, 102);
  ctx.stroke();

  // Lane 2 Ground line
  ctx.beginPath();
  ctx.moveTo(0, 222);
  ctx.lineTo(canvas.width, 222);
  ctx.stroke();

  // Draw Obstacles (Mirrored in both lanes)
  ctx.fillStyle = "#ff4444";
  obstacles.forEach((ob) => {
    // Top lane obstacle
    ctx.fillRect(ob.x, 102 - ob.h, ob.w, ob.h);
    // Bottom lane obstacle
    ctx.fillRect(ob.x, 222 - ob.h, ob.w, ob.h);
  });

  // Draw Player 1 (Blue)
  ctx.fillStyle = p1.dead ? "#555" : "#00aaff";
  ctx.fillRect(p1.x, p1.y, p1.w, p1.h);
  ctx.fillStyle = "#fff";
  ctx.font = "10px monospace";
  ctx.fillText(`P1: ${p1.score}${p1.dead ? " (OUT)" : ""}`, 10, 20);

  // Draw Player 2 (Orange)
  ctx.fillStyle = p2.dead ? "#555" : "#ff8800";
  ctx.fillRect(p2.x, p2.y, p2.w, p2.h);
  ctx.fillStyle = "#fff";
  ctx.fillText(`P2: ${p2.score}${p2.dead ? " (OUT)" : ""}`, 10, 150);
}

function checkMatchOver() {
  if (p1.dead && p2.dead) {
    lblStatus.textContent = "Game Over!";
    gameOverBox.style.display = "block";

    if (p1.score > p2.score) {
      lblWinner.textContent = "Player 1 (Blue) Wins!";
    } else if (p2.score > p1.score) {
      lblWinner.textContent = "Player 2 (Orange) Wins!";
    } else {
      lblWinner.textContent = "It's a Tie!";
    }

    lblScores.textContent = `P1 Score: ${p1.score} | P2 Score: ${p2.score}`;
  }
}

function drawLobbyPlaceholder() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#555";
  ctx.font = "14px monospace";
  ctx.textAlign = "center";
  ctx.fillText("Waiting for Player 2 to join...", canvas.width / 2, canvas.height / 2);
  ctx.textAlign = "left";
}

// Rematch Handling
function triggerRematch() {
  if (realtimeChannel) {
    realtimeChannel.send({
      type: "broadcast",
      event: "restart",
      payload: {}
    });
  }
  startMatch();
}

function leaveRoom() {
  if (realtimeChannel) {
    supabaseClient.removeChannel(realtimeChannel);
    realtimeChannel = null;
  }
  if (animationId) {
    cancelAnimationFrame(animationId);
    animationId = null;
  }
  currentRoom = null;

  const url = new URL(window.location);
  url.searchParams.delete("game");
  window.history.pushState({}, "", url);

  gameView.style.display = "none";
  lobbyView.style.display = "block";
  inputCode.value = "";
}
