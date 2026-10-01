// ==========================================
// 1. SUPABASE CREDENTIALS (PASTE YOURS HERE)
// ==========================================
const SUPABASE_URL = "https://pxubennkaogxynrhkyuk.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_O-CeDULC2SWZb6ullHg95w_nfC2u8uq";

// Safe Client Initialization
let supabaseClient = null;
if (window.supabase && SUPABASE_URL && SUPABASE_URL.startsWith("https://")) {
  supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
}

// 2. PLAYER IDENTITY (Uses sessionStorage so two tabs on the same machine get distinct IDs)
let playerId = sessionStorage.getItem("coop_runner_pid");
if (!playerId) {
  playerId = "p_" + Math.random().toString(36).substring(2, 9);
  sessionStorage.setItem("coop_runner_pid", playerId);
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

// Game State
let currentRoom = null;
let realtimeChannel = null;
let myRole = null; // 'p1' or 'p2'
let animationId = null;
let lastFrameTime = performance.now();

// Physics & Tuning Constants
const GROUND_Y = 190;
const GRAVITY = 600;       // px/sec^2
const JUMP_FORCE = -270;   // px/sec
const BULLET_SPEED = 780;  // px/sec
const BOX_SPEED = 140;     // px/sec (~3.5 seconds across screen)
const SHOOT_COOLDOWN = 320;// ms (~10 shooting chances per box)
let lastShootTime = 0;

// Characters on Shared Track
const p1 = { x: 55, y: GROUND_Y - 24, vy: 0, w: 24, h: 24, dead: false, score: 0 };
const p2 = { x: 105, y: GROUND_Y - 24, vy: 0, w: 24, h: 24, dead: false, score: 0 };

let bullets = [];
let currentBox = null;
let boxIdCounter = 0;
let boxSpawnTimer = 0.5;   // Seconds before next box spawns
let particles = [];        // Destruction and hit effects

// Check for Invite Link on Load
window.addEventListener("DOMContentLoaded", () => {
  const params = new URLSearchParams(window.location.search);
  const code = params.get("game");
  if (code && supabaseClient) {
    const clean = code.trim().toUpperCase();
    inputCode.value = clean;
    joinRoom(clean);
  }
});

// Event Listeners
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

// Controls (Pointer + Keyboard)
ctrlJump.addEventListener("pointerdown", (e) => { e.preventDefault(); performJump(); });
ctrlShoot.addEventListener("pointerdown", (e) => { e.preventDefault(); performShoot(); });

window.addEventListener("keydown", (e) => {
  if (e.repeat) return;
  if (e.code === "Space" || e.code === "ArrowUp" || e.code === "KeyW") {
    e.preventDefault();
    performJump();
  }
  if (e.code === "KeyF" || e.code === "KeyX" || e.code === "Enter") {
    e.preventDefault();
    performShoot();
  }
});

// Jump Execution
function performJump() {
  if (!currentRoom || currentRoom.status !== "playing") return;
  const me = myRole === "p1" ? p1 : p2;
  if (me.dead) return;

  // Jump allowed only when grounded
  if (me.y >= GROUND_Y - me.h - 1) {
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

  const now = performance.now();
  if (now - lastShootTime < SHOOT_COOLDOWN) return;
  lastShootTime = now;

  const bulletData = {
    id: "b_" + myRole + "_" + now + "_" + Math.floor(Math.random() * 1000),
    x: me.x + me.w + 4,
    y: me.y + me.h / 2,
    vx: BULLET_SPEED,
    owner: myRole
  };

  bullets.push(bulletData);

  if (realtimeChannel) {
    realtimeChannel.send({
      type: "broadcast",
      event: "shoot",
      payload: bulletData
    });
  }
}

// Room Creation
async function createRoom() {
  if (!supabaseClient) {
    lobbyError.textContent = "Supabase client not initialized. Check credentials.";
    return;
  }
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
    lobbyError.textContent = "Failed to create room: " + error.message;
    return;
  }

  myRole = "p1";
  enterGameView(data);
}

// Room Join
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
      lobbyError.textContent = "Room is full.";
      return;
    }
    enterGameView(room);
  }
}

// Switch to Game Screen
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

// Realtime Network Handler (self: false avoids duplicate broadcast processing)
function subscribeNetwork(code) {
  if (realtimeChannel) {
    supabaseClient.removeChannel(realtimeChannel);
  }

  realtimeChannel = supabaseClient
    .channel(`runner_${code}`, { config: { broadcast: { self: false } } })
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
      if (!target.dead && target.y >= GROUND_Y - target.h - 1) {
        target.vy = JUMP_FORCE;
      }
    })
    .on("broadcast", { event: "shoot" }, (payload) => {
      bullets.push(payload.payload);
    })
    .on("broadcast", { event: "spawn_box" }, (payload) => {
      currentBox = payload.payload;
    })
    .on("broadcast", { event: "box_hit" }, (payload) => {
      const { boxId, shooter } = payload.payload;
      applyHit(boxId, shooter);
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

// Start Match Loop
function startMatch() {
  lblStatus.textContent = "Defend the track & jump!";
  gameOverBox.style.display = "none";

  p1.y = GROUND_Y - p1.h; p1.vy = 0; p1.dead = false; p1.score = 0;
  p2.y = GROUND_Y - p2.h; p2.vy = 0; p2.dead = false; p2.score = 0;

  bullets = [];
  particles = [];
  currentBox = null;
  boxIdCounter = 0;
  boxSpawnTimer = 0.5;
  lastFrameTime = performance.now();

  if (animationId) cancelAnimationFrame(animationId);
  animationId = requestAnimationFrame(gameLoop);
}

// Main Frame Loop with Delta Time
function gameLoop(now) {
  const dt = Math.min((now - lastFrameTime) / 1000, 0.1); // Clamp to avoid huge jumps
  lastFrameTime = now;

  try {
    updatePhysics(dt);
    renderCanvas();
  } catch (err) {
    console.error("Frame loop caught error:", err);
  }

  if (!p1.dead || !p2.dead) {
    animationId = requestAnimationFrame(gameLoop);
  } else {
    animationId = null;
    checkMatchOver();
  }
}

// Core Physics & Logic
function updatePhysics(dt) {
  // 1. Player 1 Physics
  if (!p1.dead) {
    p1.vy += GRAVITY * dt;
    p1.y += p1.vy * dt;
    if (p1.y > GROUND_Y - p1.h) {
      p1.y = GROUND_Y - p1.h;
      p1.vy = 0;
    }
  }

  // 2. Player 2 Physics
  if (!p2.dead) {
    p2.vy += GRAVITY * dt;
    p2.y += p2.vy * dt;
    if (p2.y > GROUND_Y - p2.h) {
      p2.y = GROUND_Y - p2.h;
      p2.vy = 0;
    }
  }

  // 3. Particles
  for (let i = particles.length - 1; i >= 0; i--) {
    const pt = particles[i];
    pt.x += pt.vx * dt;
    pt.y += pt.vy * dt;
    pt.life -= dt;
    if (pt.life <= 0) particles.splice(i, 1);
  }

  // 4. Host Spawns Boxes (P1 is host, or P2 if P1 is dead)
  const isHost = (myRole === "p1") || (p1.dead && myRole === "p2");
  if (!currentBox) {
    boxSpawnTimer -= dt;
    if (boxSpawnTimer <= 0 && isHost) {
      boxIdCounter++;
      const newBox = {
        id: "box_" + boxIdCounter + "_" + Date.now(),
        x: canvas.width,
        y: GROUND_Y - 28,
        w: 28,
        h: 28,
        hp: 3,
        maxHp: 3
      };
      currentBox = newBox;

      if (realtimeChannel) {
        realtimeChannel.send({
          type: "broadcast",
          event: "spawn_box",
          payload: newBox
        });
      }
    }
  }

  // 5. Update Bullets and Collision with Box
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    b.x += b.vx * dt;

    if (currentBox &&
        b.x >= currentBox.x && b.x <= currentBox.x + currentBox.w &&
        b.y >= currentBox.y && b.y <= currentBox.y + currentBox.h) {

      const targetBoxId = currentBox.id;
      bullets.splice(i, 1);

      // Only the shooter emits the hit event to prevent duplicate damage
      if (b.owner === myRole) {
        applyHit(targetBoxId, myRole);
        if (realtimeChannel) {
          realtimeChannel.send({
            type: "broadcast",
            event: "box_hit",
            payload: { boxId: targetBoxId, shooter: myRole }
          });
        }
      }
      continue;
    }

    if (b.x > canvas.width) {
      bullets.splice(i, 1);
    }
  }

  // 6. Update Box Position & Player Collision
  if (currentBox) {
    currentBox.x -= BOX_SPEED * dt;

    // Check collision with Player 2 (front)
    if (!p2.dead && checkPlayerBoxCollision(p2, currentBox)) {
      p2.dead = true;
      if (myRole === "p2") broadcastDeath("p2");
    }

    // Check collision with Player 1 (back)
    if (!p1.dead && checkPlayerBoxCollision(p1, currentBox)) {
      p1.dead = true;
      if (myRole === "p1") broadcastDeath("p1");
    }

    // Box left screen safely
    if (currentBox.x + currentBox.w < -10) {
      currentBox = null;
      boxSpawnTimer = 0.6;
    }
  }
}

// Box Damage & Destruction (Guaranteed safe from null-pointer errors)
function applyHit(boxId, shooter) {
  if (!currentBox || currentBox.id !== boxId) return;

  currentBox.hp--;
  spawnParticles(currentBox.x + currentBox.w / 2, currentBox.y + currentBox.h / 2, 4, "#ffeb3b");

  if (currentBox.hp <= 0) {
    if (shooter === "p1") p1.score++;
    if (shooter === "p2") p2.score++;

    // Large explosion effect
    spawnParticles(currentBox.x + currentBox.w / 2, currentBox.y + currentBox.h / 2, 14, "#ff4444");

    // Nullify box and schedule next spawn
    currentBox = null;
    boxSpawnTimer = 0.8;
  }
}

// Bounding Box Collision Check (Jumping clears the box safely)
function checkPlayerBoxCollision(player, box) {
  const pRight = player.x + player.w;
  const pLeft = player.x;
  const pBottom = player.y + player.h;

  const bRight = box.x + box.w;
  const bLeft = box.x;
  const bTop = box.y;

  const horizontalOverlap = pRight > bLeft + 2 && pLeft < bRight - 2;
  const verticalHit = pBottom > bTop + 4; // Clear if feet are above box top

  return horizontalOverlap && verticalHit;
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

function spawnParticles(x, y, count, color) {
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 40 + Math.random() * 120;
    particles.push({
      x, y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      color,
      life: 0.35
    });
  }
}

// Canvas Rendering
function renderCanvas() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Ground Track
  ctx.strokeStyle = "#444";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, GROUND_Y);
  ctx.lineTo(canvas.width, GROUND_Y);
  ctx.stroke();

  // Draw Particles
  particles.forEach((pt) => {
    ctx.fillStyle = pt.color;
    ctx.fillRect(pt.x, pt.y, 3, 3);
  });

  // Draw Approaching Box (Red)
  if (currentBox) {
    ctx.fillStyle = "#d32f2f";
    ctx.fillRect(currentBox.x, currentBox.y, currentBox.w, currentBox.h);

    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1;
    ctx.strokeRect(currentBox.x, currentBox.y, currentBox.w, currentBox.h);

    // HP Label: 3/3, 2/3, 1/3
    ctx.fillStyle = "#fff";
    ctx.font = "bold 11px monospace";
    ctx.textAlign = "center";
    ctx.fillText(`${currentBox.hp}/${currentBox.maxHp}`, currentBox.x + currentBox.w / 2, currentBox.y + 18);

    // Health Bar
    const hpRatio = Math.max(0, currentBox.hp / currentBox.maxHp);
    ctx.fillStyle = "#222";
    ctx.fillRect(currentBox.x, currentBox.y - 7, currentBox.w, 4);
    ctx.fillStyle = hpRatio > 0.35 ? "#4caf50" : "#ff9800";
    ctx.fillRect(currentBox.x, currentBox.y - 7, currentBox.w * hpRatio, 4);
  }

  // Draw Bullets
  ctx.fillStyle = "#ffeb3b";
  bullets.forEach((b) => {
    ctx.fillRect(b.x, b.y - 2, 8, 3);
  });

  // Draw Characters
  drawPlayer(p1, "#00aaff", "P1");
  drawPlayer(p2, "#ff8800", "P2");

  // HUD
  ctx.textAlign = "left";
  ctx.font = "12px monospace";
  ctx.fillStyle = "#fff";
  ctx.fillText(`P1 Boxes Destroyed: ${p1.score}${p1.dead ? " (OUT)" : ""}`, 10, 20);
  ctx.fillText(`P2 Boxes Destroyed: ${p2.score}${p2.dead ? " (OUT)" : ""}`, 10, 38);
}

function drawPlayer(player, color, tag) {
  ctx.fillStyle = player.dead ? "#555" : color;
  ctx.fillRect(player.x, player.y, player.w, player.h);

  if (!player.dead) {
    ctx.fillStyle = "#aaa";
    ctx.fillRect(player.x + player.w, player.y + player.h / 2 - 2, 6, 4);
  }

  ctx.fillStyle = "#fff";
  ctx.font = "10px monospace";
  ctx.textAlign = "center";
  ctx.fillText(tag, player.x + player.w / 2, player.y - 5);
}

function checkMatchOver() {
  if (p1.dead && p2.dead) {
    lblStatus.textContent = "Match Over!";
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
