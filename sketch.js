/*
Machine Watching Hands - Clean Surveillance Version
p5.js + MediaPipe Gesture Recognizer

Gestures:
- Open_Palm   -> attract nearby balloons
- Closed_Fist -> pop nearby balloons
- Thumb_Up    -> freeze time

Visual style:
- no white background
- no grey grid
- camera feed is the full background
- no laser gesture
*/

let myGestureRecognizer = null;
let gestureResults = null;
let myCapture = null;
let lastVideoTime = -1;
let videoReady = false;
let recognizerReady = false;
let initError = "";

const CAM_SIZE = 640;
const USE_DELEGATE = "GPU"; // change to "CPU" if needed
const MAX_NUM_HANDS = 2;

const HAND_CONNECTIONS = [
  [0,1],[1,2],[2,3],[3,4],
  [0,5],[5,6],[6,7],[7,8],
  [5,9],[9,10],[10,11],[11,12],
  [9,13],[13,14],[14,15],[15,16],
  [13,17],[17,18],[18,19],[19,20],
  [0,17]
];

let balloons = [];
let particles = [];
let scans = [];

let score = 0;
let gameDuration = 45 * 1000;
let startTime = 0;
let gameOver = false;
let freezeUntil = 0;

let lastOpenPalmTime = 0;
let lastFistTime = 0;
let lastThumbTime = 0;

let machineMessages = [
  "SUBJECT DETECTED",
  "GESTURE CLASSIFIED",
  "BODY TRANSLATED TO COMMAND",
  "MOVEMENT TRACKED",
  "SURVEILLANCE ACTIVE"
];

// --------------------------------------------------
function setup() {
  let c = createCanvas(CAM_SIZE, CAM_SIZE);
  c.style("background", "transparent");
  textFont("monospace");

  myCapture = createCapture(
    {
      video: {
        width: CAM_SIZE,
        height: CAM_SIZE,
        facingMode: "user",
      },
      audio: false,
    },
    () => {
      videoReady = true;
    }
  );

  myCapture.size(CAM_SIZE, CAM_SIZE);
  myCapture.hide();

  startTime = millis();

  for (let i = 0; i < 12; i++) {
    balloons.push(new Balloon());
  }

  initGestureRecognizer();
}

// --------------------------------------------------
async function initGestureRecognizer() {
  try {
    const mediapipe_module = await import(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision/vision_bundle.js"
    );

    const GestureRecognizer = mediapipe_module.GestureRecognizer;
    const FilesetResolver = mediapipe_module.FilesetResolver;

    const vision = await FilesetResolver.forVisionTasks(
      "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm"
    );

    myGestureRecognizer = await GestureRecognizer.createFromOptions(vision, {
      baseOptions: {
        delegate: USE_DELEGATE,
        modelAssetPath:
          "https://storage.googleapis.com/mediapipe-models/gesture_recognizer/gesture_recognizer/float16/1/gesture_recognizer.task",
      },
      runningMode: "VIDEO",
      numHands: MAX_NUM_HANDS,
    });

    recognizerReady = true;
    predictWebcam();
  } catch (err) {
    console.error(err);
    initError = String(err);
  }
}

// --------------------------------------------------
async function predictWebcam() {
  if (!videoReady || !recognizerReady || !myCapture || !myCapture.elt || !myGestureRecognizer) {
    requestAnimationFrame(predictWebcam);
    return;
  }

  const video = myCapture.elt;

  if (video.readyState < 2) {
    requestAnimationFrame(predictWebcam);
    return;
  }

  const nowMs = performance.now();

  if (lastVideoTime !== video.currentTime) {
    gestureResults = myGestureRecognizer.recognizeForVideo(video, nowMs);
    lastVideoTime = video.currentTime;
  }

  requestAnimationFrame(predictWebcam);
}

// --------------------------------------------------
function draw() {
  clear(); // no white background
  drawCamera();

  if (!gameOver) {
    handleGestures();
    updateGame();
  }

  drawBalloons();
  drawParticles();
  drawScans();
  drawHands();
  drawHUD();

  if (!gameOver && millis() - startTime >= gameDuration) {
    gameOver = true;
  }

  if (gameOver) {
    drawGameOver();
  }
}

// --------------------------------------------------
function drawCamera() {
  if (!myCapture) return;

  push();
  translate(width, 0);
  scale(-1, 1);
  noTint();
  image(myCapture, 0, 0, width, height);
  pop();
}

// --------------------------------------------------
function updateGame() {
  let frozen = millis() < freezeUntil;

  for (let b of balloons) {
    if (!frozen) b.update();
  }

  for (let i = balloons.length - 1; i >= 0; i--) {
    if (balloons[i].y > height + 100) {
      balloons.splice(i, 1);
      balloons.push(new Balloon(true));
    }
  }

  for (let i = particles.length - 1; i >= 0; i--) {
    particles[i].update();
    if (particles[i].dead()) particles.splice(i, 1);
  }

  for (let i = scans.length - 1; i >= 0; i--) {
    scans[i].update();
    if (scans[i].dead()) scans.splice(i, 1);
  }

  while (balloons.length < 12) {
    balloons.push(new Balloon());
  }
}

// --------------------------------------------------
function drawBalloons() {
  for (let b of balloons) b.draw();
}

function drawParticles() {
  for (let p of particles) p.draw();
}

function drawScans() {
  for (let s of scans) s.draw();
}

// --------------------------------------------------
function handleGestures() {
  if (!gestureResults || !gestureResults.gestures || !gestureResults.landmarks) return;

  for (let i = 0; i < gestureResults.gestures.length; i++) {
    if (!gestureResults.gestures[i] || gestureResults.gestures[i].length === 0) continue;

    const gesture = gestureResults.gestures[i][0];
    const gestureName = gesture.categoryName;
    const scoreVal = gesture.score;

    // higher threshold for more stable recognition
    if (scoreVal < 0.68) continue;

    const palmCenter = averagePoints([
      getMappedPoint(gestureResults.landmarks[i][0]),
      getMappedPoint(gestureResults.landmarks[i][5]),
      getMappedPoint(gestureResults.landmarks[i][9]),
      getMappedPoint(gestureResults.landmarks[i][13]),
      getMappedPoint(gestureResults.landmarks[i][17])
    ]);

    scans.push(new ScanPulse(palmCenter.x, palmCenter.y, gestureName));

    // Open palm = attract
    if (gestureName === "Open_Palm" && millis() - lastOpenPalmTime > 120) {
      attractBalloons(palmCenter.x, palmCenter.y, 140);
      lastOpenPalmTime = millis();
    }

    // Closed fist = pop
    if (gestureName === "Closed_Fist" && millis() - lastFistTime > 380) {
      popNearbyBalloons(palmCenter.x, palmCenter.y, 95);
      lastFistTime = millis();
    }

    // Thumb up = freeze
    if (gestureName === "Thumb_Up" && millis() - lastThumbTime > 2500) {
      freezeUntil = millis() + 1400;
      lastThumbTime = millis();

      for (let k = 0; k < 20; k++) {
        particles.push(
          new Particle(
            random(width),
            random(height),
            color(0, 180, 255),
            random(-1.2, 1.2),
            random(-1.2, 1.2),
            random(12, 22)
          )
        );
      }
    }
  }
}

// --------------------------------------------------
function attractBalloons(x, y, radius) {
  for (let b of balloons) {
    let d = dist(x, y, b.x, b.y);
    if (d < radius) {
      let angle = atan2(y - b.y, x - b.x);
      b.x += cos(angle) * 1.8;
      b.y += sin(angle) * 1.8;
    }
  }

  for (let a = 0; a < 5; a++) {
    let ang = random(TWO_PI);
    let rr = random(5, radius * 0.4);
    particles.push(
      new Particle(
        x + cos(ang) * rr,
        y + sin(ang) * rr,
        color(120, 180, 255),
        random(-0.5, 0.5),
        random(-0.5, 0.5),
        random(10, 18)
      )
    );
  }
}

// --------------------------------------------------
function popNearbyBalloons(x, y, radius) {
  for (let i = balloons.length - 1; i >= 0; i--) {
    let d = dist(x, y, balloons[i].x, balloons[i].y);
    if (d < radius + balloons[i].r) {
      popBalloon(i, color(255, 80, 80));
    }
  }

  for (let a = 0; a < 16; a++) {
    let ang = random(TWO_PI);
    let rr = random(12, radius);
    particles.push(
      new Particle(
        x + cos(ang) * rr,
        y + sin(ang) * rr,
        color(255, 120, 120),
        random(-2, 2),
        random(-2, 2),
        random(12, 20)
      )
    );
  }
}

// --------------------------------------------------
function popBalloon(index, burstCol) {
  let b = balloons[index];

  for (let k = 0; k < 18; k++) {
    let ang = random(TWO_PI);
    particles.push(
      new Particle(
        b.x,
        b.y,
        burstCol,
        cos(ang) * random(1, 5),
        sin(ang) * random(1, 5),
        random(10, 22)
      )
    );
  }

  score += 10;
  balloons.splice(index, 1);
  balloons.push(new Balloon(true));
}

// --------------------------------------------------
function drawHands() {
  if (!gestureResults || !gestureResults.landmarks) return;

  for (let h = 0; h < gestureResults.landmarks.length; h++) {
    const hand = gestureResults.landmarks[h];

    stroke(255, 30, 70, 220);
    strokeWeight(2);
    noFill();
    for (let c of HAND_CONNECTIONS) {
      let a = getMappedPoint(hand[c[0]]);
      let b = getMappedPoint(hand[c[1]]);
      line(a.x, a.y, b.x, b.y);
    }

    fill(255, 40, 70, 220);
    stroke(0, 180);
    strokeWeight(1);
    for (let i = 0; i < hand.length; i++) {
      let p = getMappedPoint(hand[i]);
      circle(p.x, p.y, i === 8 ? 14 : 10);
    }

    if (gestureResults.gestures[h] && gestureResults.gestures[h].length > 0) {
      let g = gestureResults.gestures[h][0];
      let wrist = getMappedPoint(hand[0]);

      noStroke();
      fill(255, 70, 70);
      textAlign(CENTER, CENTER);
      textSize(18);
      text(g.categoryName, wrist.x, wrist.y - 26);
    }
  }
}

// --------------------------------------------------
function drawHUD() {
  let elapsed = millis() - startTime;
  let remaining = max(0, ceil((gameDuration - elapsed) / 1000));

  push();

  // top-left
  fill(0, 120);
  noStroke();
  rect(12, 12, 260, 118, 10);

  fill(255);
  textAlign(LEFT, TOP);
  textSize(16);
  text("MACHINE WATCHING HANDS", 24, 24);
  textSize(14);
  text("Score: " + score, 24, 50);
  text("Time: " + remaining, 24, 72);
  text("FPS: " + int(frameRate()), 24, 94);

  // bottom-left controls
  fill(0, 120);
  rect(12, height - 96, 320, 84, 10);
  fill(255);
  textSize(13);
  text("Open_Palm = attract balloons", 24, height - 80);
  text("Closed_Fist = pop nearby", 24, height - 58);
  text("Thumb_Up = freeze time", 24, height - 36);

  // top-right status
  let msg = machineMessages[floor(millis() / 1600) % machineMessages.length];
  fill(0, 120);
  rect(width - 240, 12, 228, 58, 10);
  fill(255, 70, 70);
  textSize(13);
  text(msg, width - 224, 30);

  // freeze message
  if (millis() < freezeUntil) {
    fill(0, 140, 255, 180);
    rect(width - 220, height - 68, 200, 42, 10);
    fill(255);
    textAlign(CENTER, CENTER);
    text("TIME FROZEN", width - 120, height - 47);
  }

  // loading
  if (!recognizerReady) {
    fill(0, 150);
    rect(width / 2 - 110, height / 2 - 22, 220, 44, 10);
    fill(255);
    textAlign(CENTER, CENTER);
    text("Loading recognizer...", width / 2, height / 2);
  }

  // error
  if (initError) {
    fill(120, 0, 0, 180);
    rect(20, height - 170, width - 40, 46, 10);
    fill(255);
    textAlign(LEFT, CENTER);
    text(initError, 30, height - 147);
  }

  pop();
}

// --------------------------------------------------
function drawGameOver() {
  push();
  fill(0, 180);
  rect(0, 0, width, height);

  fill(255);
  textAlign(CENTER, CENTER);
  textSize(42);
  text("SESSION COMPLETE", width / 2, height / 2 - 70);

  textSize(24);
  text("Final Score: " + score, width / 2, height / 2 - 20);

  textSize(18);
  text("Your hand was watched, classified, and translated.", width / 2, height / 2 + 25);
  text("Press R to restart", width / 2, height / 2 + 60);
  pop();
}

// --------------------------------------------------
function keyPressed() {
  if ((key === "r" || key === "R") && gameOver) {
    restartGame();
  }
}

// --------------------------------------------------
function restartGame() {
  balloons = [];
  particles = [];
  scans = [];
  score = 0;
  gameOver = false;
  freezeUntil = 0;
  startTime = millis();

  for (let i = 0; i < 12; i++) {
    balloons.push(new Balloon());
  }
}

// --------------------------------------------------
function getMappedPoint(lm) {
  return {
    x: map(lm.x, 0, 1, width, 0),
    y: map(lm.y, 0, 1, 0, height)
  };
}

// --------------------------------------------------
function averagePoints(arr) {
  let sx = 0;
  let sy = 0;
  for (let p of arr) {
    sx += p.x;
    sy += p.y;
  }
  return { x: sx / arr.length, y: sy / arr.length };
}

// --------------------------------------------------
class Balloon {
  constructor(fromBottom = false) {
    this.r = random(24, 42);
    this.x = random(this.r, width - this.r);
    this.y = fromBottom ? random(height + 30, height + 120) : random(height * 0.15, height + 80);
    this.speed = random(0.6, 1.8);
    this.wobble = random(TWO_PI);
    this.col = color(random(70, 255), random(70, 255), random(70, 255), 210);
  }

  update() {
    this.y -= this.speed;
    this.x += sin(frameCount * 0.03 + this.wobble) * 0.8;
  }

  draw() {
    push();
    stroke(0, 60);
    strokeWeight(1.2);
    fill(this.col);
    ellipse(this.x, this.y, this.r * 1.2, this.r * 1.45);
    line(
      this.x,
      this.y + this.r * 0.72,
      this.x + sin(frameCount * 0.04 + this.wobble) * 10,
      this.y + this.r * 2.2
    );
    pop();
  }
}

// --------------------------------------------------
class Particle {
  constructor(x, y, col, vx = random(-2, 2), vy = random(-2, 2), life = random(12, 24)) {
    this.x = x;
    this.y = y;
    this.col = col;
    this.vx = vx;
    this.vy = vy;
    this.life = life;
    this.maxLife = life;
    this.size = random(4, 10);
  }

  update() {
    this.x += this.vx;
    this.y += this.vy;
    this.vy += 0.03;
    this.life--;
  }

  draw() {
    push();
    noStroke();
    let a = map(this.life, 0, this.maxLife, 0, 255);
    fill(red(this.col), green(this.col), blue(this.col), a);
    circle(this.x, this.y, this.size);
    pop();
  }

  dead() {
    return this.life <= 0;
  }
}

// --------------------------------------------------
class ScanPulse {
  constructor(x, y, label) {
    this.x = x;
    this.y = y;
    this.label = label;
    this.r = 10;
    this.life = 18;
  }

  update() {
    this.r += 3.5;
    this.life--;
  }

  draw() {
    push();
    noFill();
    stroke(255, 0, 0, map(this.life, 0, 18, 0, 110));
    strokeWeight(1.5);
    circle(this.x, this.y, this.r * 2);

    noStroke();
    fill(255, 0, 0, map(this.life, 0, 18, 0, 150));
    textSize(10);
    textAlign(CENTER, CENTER);
    text(this.label, this.x, this.y - this.r - 8);
    pop();
  }

  dead() {
    return this.life <= 0;
  }
}