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

// 2. PLAYER IDENTITY (Uses sessionStorage for separate tabs on same device)
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
const GRAVITY = 680;       // px/sec^2 (tuned for floatier, longer jump)
const JUMP_FORCE = -375;   // px/sec (clears 48px creature with margin)
const BULLET_SPEED = 780;  // px/sec
const BOX_SPEED = 140;     // px/sec
const SHOOT_COOLDOWN = 320;// ms (~10 shooting chances per creature)
let lastShootTime = 0;

// The Spiral - Creature 08 (2.5D Volumetric SVG Sprite)
const CREATURE_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 200 200">
  <defs>
    <!-- 2.5D Multi-layer Glow & Depth Filter -->
    <filter id="glow25d" x="-30%" y="-30%" width="160%" height="160%">
      <feDropShadow dx="0" dy="4" stdDeviation="5" flood-color="#c04bff" flood-opacity="0.75"/>
      <feDropShadow dx="0" dy="0" stdDeviation="8" flood-color="#ff3fa8" flood-opacity="0.55"/>
    </filter>

    <!-- 3D Spherical Eye Gradient -->
    <radialGradient id="eye3d" cx="38%" cy="32%" r="65%">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="45%" stop-color="#f0e2ff"/>
      <stop offset="85%" stop-color="#d0b0f8"/>
      <stop offset="100%" stop-color="#5a188a"/>
    </radialGradient>

    <!-- 2.5D Body Volumetric Cylindrical Gradient -->
    <linearGradient id="body3d" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#2a0845"/>
      <stop offset="25%" stop-color="#12041f"/>
      <stop offset="50%" stop-color="#0a0312"/>
      <stop offset="75%" stop-color="#180529"/>
      <stop offset="100%" stop-color="#ff3fa8" stop-opacity="0.85"/>
    </linearGradient>

    <clipPath id="c8"><circle cx="100" cy="78" r="36"/></clipPath>
    <path id="sp" fill="none" stroke-width="2" d="M100 100a1.5 1.5 0 0 1 0 3a3 3 0 0 1 0-6a4.5 4.5 0 0 1 0 9a6 6 0 0 1 0-12a7.5 7.5 0 0 1 0 15a9 9 0 0 1 0-18a10.5 10.5 0 0 1 0 21a12 12 0 0 1 0-24a13.5 13.5 0 0 1 0 27a15 15 0 0 1 0-30a16.5 16.5 0 0 1 0 33a18 18 0 0 1 0-36a19.5 19.5 0 0 1 0 39a21 21 0 0 1 0-42a22.5 22.5 0 0 1 0 45a24 24 0 0 1 0-48a25.5 25.5 0 0 1 0 51a27 27 0 0 1 0-54a28.5 28.5 0 0 1 0 57a30 30 0 0 1 0-60a31.5 31.5 0 0 1 0 63a33 33 0 0 1 0-66a34.5 34.5 0 0 1 0 69a36 36 0 0 1 0-72"/>
    <g id="ha" fill="none" stroke="#d9b0ff" stroke-width="2.5" stroke-linecap="round">
      <path d="M0 0L-4-16M0 0L-9-13M0 0L-13-8M0 0L-14-1M0 0L-11 6M0 0L2-17"/>
    </g>
  </defs>

  <!-- 2.5D Ground Perspective Shadow -->
  <ellipse cx="100" cy="192" rx="76" ry="7" fill="#000000" opacity="0.6"/>

  <!-- Depth Aura & Concentric Resonator Rings -->
  <circle cx="100" cy="78" r="62" fill="none" stroke="#c04bff" stroke-width="6" stroke-dasharray="14 14" opacity="0.18"/>
  <circle cx="100" cy="78" r="46" fill="none" stroke="#c04bff" stroke-width="2.2" opacity="0.45"/>
  <circle cx="100" cy="78" r="41" fill="none" stroke="#ff3fa8" stroke-width="1.8" opacity="0.6"/>

  <!-- Main Creature Group with 2.5D Depth Glow -->
  <g filter="url(#glow25d)">
    <!-- Back Horn Tendrils in Perspective -->
    <g transform="translate(58 130) rotate(-20)"><use href="#ha"/></g>
    <g transform="translate(142 130) scale(-1 1) rotate(-20)"><use href="#ha"/></g>

    <!-- 2.5D Shaded Volumetric Body -->
    <path d="M100 30C60 30 46 70 48 110C50 150 34 168 28 190L60 180L80 192L100 182L120 192L140 180L172 190C166 168 150 150 152 110C154 70 140 30 100 30Z" 
          fill="url(#body3d)" stroke="#ff3fa8" stroke-width="3" stroke-opacity="0.9"/>

    <!-- 3D Spherical Eyeball Orb -->
    <circle cx="100" cy="78" r="36" fill="url(#eye3d)" stroke="#3a0060" stroke-width="1.5"/>

    <!-- Dual Hypnotic Eye Spirals -->
    <g clip-path="url(#c8)">
      <g transform="translate(0 -22)">
        <use href="#sp" stroke="#250040" stroke-width="2.2"/>
        <use href="#sp" stroke="#ff3fa8" stroke-width="1.8" opacity="0.85"/>
      </g>
    </g>

    <!-- 2.5D Recessed Oral Cavity & Teeth -->
    <g>
      <path d="M56 124Q100 184 144 124Q100 146 56 124Z" fill="#040108" stroke="#1f0730" stroke-width="1"/>
      <path d="M60 128Q100 172 140 128" stroke="#f3eaff" stroke-width="4.5" fill="none" stroke-dasharray="1.6 2.4"/>
      <path d="M66 132Q100 150 134 132" stroke="#f3eaff" stroke-width="3.4" fill="none" stroke-dasharray="1.6 2.4"/>
      <path d="M84 148q16 14 32 0q-16 8-32 0z" fill="#ff3fa8"/>
    </g>
  </g>
</svg>`;

const creatureImg = new Image();
creatureImg.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(CREATURE_SVG);

// Characters on Shared Track (Player Height = 24)
const p1 = { x: 55, y: GROUND_Y - 24, vy: 0, w: 24, h: 24, dead: false, score: 0 };
const p2 = { x: 105, y: GROUND_Y - 24, vy: 0, w: 24, h: 24, dead: false, score: 0 };

let bullets = [];
let currentBox = null;
let boxIdCounter = 0;
let boxSpawnTimer = 0.5;   // Seconds before next spawn
let particles = [];

// Auto-join via URL param
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

// Realtime Network Handler
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

// Main Frame Loop
function gameLoop(now) {
  const dt = Math.min((now - lastFrameTime) / 1000, 0.1);
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

// Physics & Collision Logic
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

  // 4. Host Spawns Creature (2x player height = 48px)
  const isHost = (myRole === "p1") || (p1.dead && myRole === "p2");
  if (!currentBox) {
    boxSpawnTimer -= dt;
    if (boxSpawnTimer <= 0 && isHost) {
      boxIdCounter++;
      const newCreature = {
        id: "box_" + boxIdCounter + "_" + Date.now(),
        x: canvas.width,
        y: GROUND_Y - 48, // 2x player height (48px)
        w: 48,
        h: 48,
        hp: 3,
        maxHp: 3
      };
      currentBox = newCreature;

      if (realtimeChannel) {
        realtimeChannel.send({
          type: "broadcast",
          event: "spawn_box",
          payload: newCreature
        });
      }
    }
  }

  // 5. Update Bullets and Collision with Creature
  for (let i = bullets.length - 1; i >= 0; i--) {
    const b = bullets[i];
    b.x += b.vx * dt;

    if (currentBox &&
        b.x >= currentBox.x && b.x <= currentBox.x + currentBox.w &&
        b.y >= currentBox.y && b.y <= currentBox.y + currentBox.h) {

      const targetBoxId = currentBox.id;
      bullets.splice(i, 1);

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

  // 6. Update Creature Movement & Player Collision
  if (currentBox) {
    currentBox.x -= BOX_SPEED * dt;

    if (!p2.dead && checkPlayerBoxCollision(p2, currentBox)) {
      p2.dead = true;
      if (myRole === "p2") broadcastDeath("p2");
    }

    if (!p1.dead && checkPlayerBoxCollision(p1, currentBox)) {
      p1.dead = true;
      if (myRole === "p1") broadcastDeath("p1");
    }

    if (currentBox.x + currentBox.w < -10) {
      currentBox = null;
      boxSpawnTimer = 0.6;
    }
  }
}

// Creature Hit & Destruction Handling
function applyHit(boxId, shooter) {
  if (!currentBox || currentBox.id !== boxId) return;

  currentBox.hp--;
  spawnParticles(currentBox.x + currentBox.w / 2, currentBox.y + currentBox.h / 2, 6, "#ff3fa8");

  if (currentBox.hp <= 0) {
    if (shooter === "p1") p1.score++;
    if (shooter === "p2") p2.score++;

    spawnParticles(currentBox.x + currentBox.w / 2, currentBox.y + currentBox.h / 2, 20, "#c04bff");

    currentBox = null;
    boxSpawnTimer = 0.8;
  }
}

// Collision Check
function checkPlayerBoxCollision(player, box) {
  const pRight = player.x + player.w;
  const pLeft = player.x;
  const pBottom = player.y + player.h;

  const bRight = box.x + box.w;
  const bLeft = box.x;
  const bTop = box.y;

  const horizontalOverlap = pRight > bLeft + 2 && pLeft < bRight - 2;
  const verticalHit = pBottom > bTop + 4;

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
    const speed = 40 + Math.random() * 140;
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

  // Draw 2.5D Creature with Health Indicator
  if (currentBox) {
    if (creatureImg.complete) {
      ctx.drawImage(creatureImg, currentBox.x, currentBox.y, currentBox.w, currentBox.h);
    } else {
      ctx.fillStyle = "#c04bff";
      ctx.fillRect(currentBox.x, currentBox.y, currentBox.w, currentBox.h);
    }

    // Mini Health Bar above creature's head
    const hpRatio = Math.max(0, currentBox.hp / currentBox.maxHp);
    ctx.fillStyle = "#222";
    ctx.fillRect(currentBox.x, currentBox.y - 8, currentBox.w, 4);
    ctx.fillStyle = hpRatio > 0.35 ? "#4caf50" : "#ff3fa8";
    ctx.fillRect(currentBox.x, currentBox.y - 8, currentBox.w * hpRatio, 4);

    // Hit Count Indicator (3/3, 2/3, 1/3)
    ctx.fillStyle = "#fff";
    ctx.font = "bold 10px monospace";
    ctx.textAlign = "center";
    ctx.fillText(`${currentBox.hp}/${currentBox.maxHp}`, currentBox.x + currentBox.w / 2, currentBox.y - 12);
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
  ctx.fillText(`P1 Creatures Destroyed: ${p1.score}${p1.dead ? " (OUT)" : ""}`, 10, 20);
  ctx.fillText(`P2 Creatures Destroyed: ${p2.score}${p2.dead ? " (OUT)" : ""}`, 10, 38);
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
    lblScores.textContent = `Creatures Destroyed: P1: ${p1.score} | P2: ${p2.score}`;
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
