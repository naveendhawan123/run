// ==========================================
// 1. SUPABASE CREDENTIALS (PASTE YOURS HERE)
// ==========================================
const SUPABASE_URL = "https://pxubennkaogxynrhkyuk.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_O-CeDULC2SWZb6ullHg95w_nfC2u8uq";

// Safe client initialization
let supabaseClient = null;
if (window.supabase && SUPABASE_URL.startsWith("https://")) {
  supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

// Player Identity
let playerId = localStorage.getItem("coop_runner_id");
if (!playerId) {
  playerId = "user_" + Math.random().toString(36).substring(2, 9);
  localStorage.setItem("coop_runner_id", playerId);
}

// DOM Elements
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

const ctrlJump = document.getElementById("ctrl-jump");
const ctrlShoot = document.getElementById("ctrl-shoot");

const canvas = document.getElementById("game-canvas");
const ctx = canvas.getContext("2d");

// Networking State
let currentRoom = null;
let realtimeChannel = null;
let myRole = null; // 'p1' or 'p2'
let animationId = null;

// Game World Constants
const GROUND_Y = 190;
const GRAVITY = 0.58;
const JUMP_FORCE = -10.2;
const BULLET_SPEED = 11;
const BOX_SPEED = 2.4; // Travel time from 600 to 90 is ~3.5 seconds (~210 frames)
const SHOOT_COOLDOWN_MS = 280; // Allows ~11 shots per incoming box
let lastShootTime = 0;

// Shared Track Characters
// P1 stands slightly behind P2 so both are distinct and visible
const p1 = { x: 50, y: GROUND_Y - 24, vy: 0, w: 24, h: 24, dead: false, score: 0 };
const p2 = { x: 95, y: GROUND_Y - 24, vy: 0, w: 24, h: 24, dead: false, score: 0 };

let bullets = [];
let currentBox = null;
let boxIdCounter = 0;
let boxSpawnDelay = 30; // Frames before first/next box spawns

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

// Button and Keyboard Controls
ctrlJump.addEventListener("pointerdown", (e) => { e.preventDefault(); performJump(); });
ctrlShoot.addEventListener("pointerdown", (e) => { e.preventDefault(); performShoot(); });

window.addEventListener("keydown", (e) => {
  if (e.repeat) return;
  // Jump Keys: Space, Up, W
  if (e.code === "Space" || e.code === "ArrowUp" || e.code === "KeyW") {
    e.preventDefault();
    performJump();
  }
  // Shoot Keys: F, X, Enter
  if (e.code === "KeyF" || e.code === "KeyX" || e.code === "Enter") {
    e.preventDefault();
    performShoot();
  }
});

// Jump Execution
function performJump() {
  if (!currentRoom || currentRoom.status !== "playing") return;
  const me = myRole === "p1" ? p1 : p2;

  // Jump only if on the ground and not dead
  if (!me.dead && me.y >= GROUND_Y - me.h) {
    me.vy = JUMP_FORCE;

    if (realtimeChannel) {
      realtimeChannel.send({
        type: "broadcast",
        event: "jump",
        payload: { role: myRole }
      });
    }
  }
}

// Shoot Execution
function performShoot() {
  if (!currentRoom || currentRoom.status !== "playing") return;
  const me = myRole === "p1" ? p1 : p2;
  if (me.dead) return;

  const now = Date.now();
  if (now - lastShootTime < SHOOT_COOLDOWN_MS) return;
  lastShootTime = now;

  // Spawn local bullet from gun tip
  const gunX = me.x + me.w + 4;
  const gunY = me.y + me.h / 2;
  bullets.push({ x: gunX, y: gunY, vx: BULLET_SPEED, owner: myRole });

  // Broadcast shot to opponent
  if (realtimeChannel) {
    realtimeChannel.send({
      type: "broadcast",
      event: "shoot",
      payload: { role: myRole, x: gunX, y: gunY }
    });
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

// Setup Game Screen
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

// Realtime Network Synchronization
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
      const target = payload.payload.role === "p1" ? p1 : p2;
      if (target.y >= GROUND_Y - target.h) {
        target.vy = JUMP_FORCE;
      }
    })
    .on("broadcast", { event: "shoot" }, (payload) => {
      const { role, x, y } = payload.payload;
      bullets.push({ x, y, vx: BULLET_SPEED, owner: role });
    })
    .on("broadcast", { event: "damage" }, (payload) => {
      const { boxId } = payload.payload;
      if (currentBox && currentBox.id === boxId) {
        applyBoxDamage(currentBox);
      }
    })
    .on("broadcast", { event: "player_dead" }, (payload) => {
      const { role } = payload.payload;
      if (role === "p1") p1.dead = true;
      if (role === "p2") p2.dead = true;
      checkMatchOver();
    })
    .on("broadcast", { event: "restart" }, () => {
      startMatch();
    })
    .subscribe();
}

// Start Game Loop
function startMatch() {
  lblStatus.textContent = "Game Active - Defend & Jump!";
  gameOverBox.style.display = "none";

  // Reset character physics
  p1.y = GROUND_Y - p1.h; p1.vy = 0; p1.dead = false; p1.score = 0;
  p2.y = GROUND_Y - p2.h; p2.vy = 0; p2.dead = false; p2.score = 0;

  bullets = [];
  currentBox = null;
  boxIdCounter = 0;
  boxSpawnDelay = 30;

  if (animationId) cancelAnimationFrame(animationId);
  animationId = requestAnimationFrame(gameLoop);
}

// Main Frame Loop
function gameLoop() {
  updatePhysics();
  renderCanvas();

  if (!p1.dead || !p2.dead) {
    animationId = requestAnimationFrame(gameLoop);
  } else {
    animationId = null;
    checkMatchOver();
  }
}

// Update Game World
function updatePhysics() {
  // Update Player 1 Physics
  if (!p1.dead) {
    p1.vy += GRAVITY;
    p1.y += p1.vy;
    if (p1.y > GROUND_Y - p1.h) {
      p1.y = GROUND_Y - p1.h;
      p1.vy = 0;
    }
  }

  // Update Player 2 Physics
  if (!p2.dead) {
    p2.vy += GRAVITY;
    p2.y += p2.vy;
    if (p2.y > GROUND_Y - p2.h) {
      p2.y = GROUND_Y - p2.h;
      p2.vy = 0;
    }
  }

  // Spawn Box if none exists
  if (!currentBox) {
    boxSpawnDelay--;
    if (boxSpawnDelay <= 0) {
      boxIdCounter++;
      currentBox = {
        id: boxIdCounter,
        x: canvas.width,
        y: GROUND_Y - 32,
        w: 32,
        h: 32,
        hp: 3,
        maxHp: 3
      };
      boxSpawnDelay = 40;
    }
  }

  // Update Bullets
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    b.x += b.vx;

    // Check collision with the active box
    if (currentBox && b.x >= currentBox.x && b.x <= currentBox.x + currentBox.w &&
        b.y >= currentBox.y && b.y <= currentBox.y + currentBox.h) {

      // Remove bullet
      bullets.splice(i, 1);

      // Only the shooter registers the hit and broadcasts it to prevent duplicate damage
      if (b.owner === myRole) {
        applyBoxDamage(currentBox);
        if (realtimeChannel) {
          realtimeChannel.send({
            type: "broadcast",
            event: "damage",
            payload: { boxId: currentBox.id }
          });
        }
      }
      continue;
    }

    // Clean up off-screen bullets
    if (b.x > canvas.width) {
      bullets.splice(i, 1);
    }
  }

  // Update Box Position & Player Collision
  if (currentBox) {
    currentBox.x -= BOX_SPEED;

    // Check collision with Player 2 (front runner at x=95)
    if (!p2.dead && isBoxCollidingWith(p2, currentBox)) {
      p2.dead = true;
      if (myRole === "p2") broadcastDeath("p2");
    }

    // Check collision with Player 1 (back runner at x=50)
    if (!p1.dead && isBoxCollidingWith(p1, currentBox)) {
      p1.dead = true;
      if (myRole === "p1") broadcastDeath("p1");
    }

    // Remove box if it safely leaves the screen
    if (currentBox.x + currentBox.w < 0) {
      currentBox = null;
      boxSpawnDelay = 45;
    }
  }
}

// Reduce Box HP & Handle Destruction
function applyBoxDamage(box) {
  box.hp--;
  if (box.hp <= 0) {
    // Both players get +1 score for destroying the box together
    if (!p1.dead) p1.score++;
    if (!p2.dead) p2.score++;
    currentBox = null;
    boxSpawnDelay = 50; // Delay before next box spawns
  }
}

// AABB Collision Detection (Passes if feet are above box top)
function isBoxCollidingWith(player, box) {
  const playerLeft = player.x;
  const playerRight = player.x + player.w;
  const playerBottom = player.y + player.h;

  const boxLeft = box.x;
  const boxRight = box.x + box.w;
  const boxTop = box.y;

  const horizontallyOverlap = playerRight > boxLeft && playerLeft < boxRight;
  const hitGroundLevel = playerBottom > boxTop + 4; // Tolerance for jump clearance

  return horizontallyOverlap && hitGroundLevel;
}

function broadcastDeath(role) {
  if (realtimeChannel) {
    realtimeChannel.send({
      type: "broadcast",
      event: "player_dead",
      payload: { role }
    });
  }
}

// Render Shared Track
function renderCanvas() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Single Shared Ground Track
  ctx.strokeStyle = "#444";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, GROUND_Y);
  ctx.lineTo(canvas.width, GROUND_Y);
  ctx.stroke();

  // Draw Approaching Box (Red) with Health Bar & Counter
  if (currentBox) {
    ctx.fillStyle = "#d32f2f";
    ctx.fillRect(currentBox.x, currentBox.y, currentBox.w, currentBox.h);

    // Box Outline
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1;
    ctx.strokeRect(currentBox.x, currentBox.y, currentBox.w, currentBox.h);

    // Box Hit / HP Label inside the box
    ctx.fillStyle = "#fff";
    ctx.font = "bold 12px monospace";
    ctx.textAlign = "center";
    ctx.fillText(`${currentBox.hp}/${currentBox.maxHp}`, currentBox.x + currentBox.w / 2, currentBox.y + 20);

    // Mini Health Bar above box
    const barWidth = currentBox.w;
    const hpPercent = currentBox.hp / currentBox.maxHp;
    ctx.fillStyle = "#333";
    ctx.fillRect(currentBox.x, currentBox.y - 8, barWidth, 4);
    ctx.fillStyle = hpPercent > 0.35 ? "#4caf50" : "#ff9800";
    ctx.fillRect(currentBox.x, currentBox.y - 8, barWidth * hpPercent, 4);
  }

  // Draw Flying Bullets (Yellow)
  ctx.fillStyle = "#ffeb3b";
  bullets.forEach(b => {
    ctx.fillRect(b.x, b.y - 2, 7, 3);
  });

  // Draw Player 1 (Blue)
  drawPlayer(p1, "#00aaff", "P1");

  // Draw Player 2 (Orange)
  drawPlayer(p2, "#ff8800", "P2");

  // Score HUD
  ctx.textAlign = "left";
  ctx.font = "12px monospace";
  ctx.fillStyle = "#fff";
  ctx.fillText(`P1 Boxes Destroyed: ${p1.score}${p1.dead ? " (DEAD)" : ""}`, 10, 20);
  ctx.fillText(`P2 Boxes Destroyed: ${p2.score}${p2.dead ? " (DEAD)" : ""}`, 10, 38);
}

// Draw Character with Gun Barrel
function drawPlayer(player, color, tag) {
  if (player.dead) {
    ctx.fillStyle = "#555";
  } else {
    ctx.fillStyle = color;
  }

  // Body
  ctx.fillRect(player.x, player.y, player.w, player.h);

  // Gun Barrel protruding forward
  if (!player.dead) {
    ctx.fillStyle = "#aaa";
    ctx.fillRect(player.x + player.w, player.y + player.h / 2 - 2, 6, 4);
  }

  // Tag above character
  ctx.fillStyle = "#fff";
  ctx.font = "10px monospace";
  ctx.textAlign = "center";
  ctx.fillText(tag, player.x + player.w / 2, player.y - 5);
}

function checkMatchOver() {
  if (p1.dead && p2.dead) {
    lblStatus.textContent = "Match Over - Both Eliminated!";
    gameOverBox.style.display = "block";
    lblScores.textContent = `Boxes Destroyed: P1: ${p1.score} | P2: ${p2.score}`;
  }
}

function drawLobbyPlaceholder() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = "#666";
  ctx.font = "14px monospace";
  ctx.textAlign = "center";
  ctx.fillText("Waiting for Player 2 to join...", canvas.width / 2, canvas.height / 2);
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
