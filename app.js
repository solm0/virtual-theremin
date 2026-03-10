const video = document.getElementById("video");
const startBtn = document.getElementById("start");
const canvas = document.getElementById("overlay");
const ctx = canvas.getContext("2d");

canvas.width = 800;
canvas.height = 600;

/* ---------------- AUDIO ---------------- */

let audioStarted = false;
let audioCtx;
let oscillator;
let gainNode;

let smoothFreq = 440;
let smoothVolume = 0;

function startAudio() {

  audioCtx = new (window.AudioContext || window.webkitAudioContext)();

  oscillator = audioCtx.createOscillator();
  gainNode = audioCtx.createGain();

  oscillator.type = "sine";
  oscillator.frequency.value = 440;

  gainNode.gain.value = 0;

  oscillator.connect(gainNode);
  gainNode.connect(audioCtx.destination);

  oscillator.start();

  audioStarted = true;
}

startBtn.onclick = () => {
  if (!audioStarted) startAudio();
};

/* ---------------- UTIL ---------------- */

function dist(a, b) {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  const dz = a.z - b.z;
  return Math.sqrt(dx*dx + dy*dy + dz*dz);
}

function map(v, a1, a2, b1, b2) {
  return b1 + (v - a1) * (b2 - b1) / (a2 - a1);
}

function clamp(v, min, max) {
  return Math.max(min, Math.min(max, v));
}

function logMap(t, minFreq, maxFreq) {
  return minFreq * Math.pow(maxFreq / minFreq, t);
}

/* ---------------- NOTE DETECTION ---------------- */

const NOTES = [
"C","C#","D","D#","E","F","F#","G","G#","A","A#","B"
];

const NOTE_COLORS = {
C:"rgba(255,100,100)",
D:"rgba(255,150,100)",
E:"rgba(255,220,100)",
F:"rgba(120,255,120)",
G:"rgba(120,200,255)",
A:"rgba(150,120,255)",
B:"rgba(220,120,255)"
};

function freqToNote(freq){

  const n = Math.round(
    12 * Math.log2(freq / 440)
  );

  const index = (n + 9) % 12;
  const fixed = (index + 12) % 12;

  return NOTES[fixed];
}

function noteColor(note){
  const base = note[0];
  return NOTE_COLORS[base];
}

/* ---------------- DRAW HAND ---------------- */

const HAND_CONNECTIONS = [
  [0,1],[1,2],[2,3],[3,4],
  [0,5],[5,6],[6,7],[7,8],
  [5,9],[9,10],[10,11],[11,12],
  [9,13],[13,14],[14,15],[15,16],
  [13,17],[17,18],[18,19],[19,20],
  [0,17]
];

function drawPoint(x, y) {

  ctx.beginPath();
  ctx.arc(x, y, 5, 0, Math.PI * 2);
  ctx.fillStyle = "red";
  ctx.fill();
}

function drawLine(x1, y1, x2, y2) {

  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);

  ctx.strokeStyle = "lime";
  ctx.lineWidth = 2;
  ctx.stroke();
}

function drawHand(lm) {

  const points = lm.map(p => ({
    x: (1 - p.x) * canvas.width,
    y: p.y * canvas.height
  }));

  for (const [a,b] of HAND_CONNECTIONS) {
    drawLine(points[a].x,points[a].y,points[b].x,points[b].y);
  }

  for (const p of points) {
    drawPoint(p.x,p.y);
  }
}

/* ---------------- MEDIAPIPE ---------------- */

let lastHands = null;
let lastFace = null;

/* hands */

const hands = new Hands({
  locateFile:(file)=>
  `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`
});

hands.setOptions({
  maxNumHands:2,
  modelComplexity:1,
  minDetectionConfidence:0.3,
  minTrackingConfidence:0.7
});

hands.onResults(results => {

  lastHands = results;

  if (!audioStarted) return;
  if (!results.multiHandLandmarks) return;

  let leftHand = null;
  let rightHand = null;

  for (let i=0;i<results.multiHandLandmarks.length;i++){

    const label = results.multiHandedness[i].label;
    const lm = results.multiHandLandmarks[i];

    if(label==="Right") leftHand = lm;
    if(label==="Left") rightHand = lm;
  }

  if(leftHand){

    const palmSize = dist(leftHand[5], leftHand[17]);

    let volume = map(palmSize,0.15,0.18,0,1);
    volume = clamp(volume,0,1);

    smoothVolume = smoothVolume*0.8 + volume*0.2;

    gainNode.gain.linearRampToValueAtTime(
      smoothVolume,
      audioCtx.currentTime + 0.02
    );
  }

  if(rightHand){

    const thumb = rightHand[4];
    const index = rightHand[8];

    const fingerDist = dist(thumb,index);

    let t = map(fingerDist,0.02,0.5,0,1);
    t = clamp(t,0,1);

    const height = 200;

    let freq = logMap(t,130.81+height,1046.5+height);

    smoothFreq = smoothFreq*0.7 + freq*0.3;

    oscillator.frequency.linearRampToValueAtTime(
      smoothFreq,
      audioCtx.currentTime
    );
  }
});

/* ---------------- FACE MESH ---------------- */

const faceMesh = new FaceMesh({
  locateFile:(file)=>
  `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${file}`
});

faceMesh.setOptions({
  maxNumFaces:1,
  refineLandmarks:false,
  minDetectionConfidence:0.5,
  minTrackingConfidence:0.5
});

faceMesh.onResults(results=>{
  lastFace = results;
});

/* 얼굴 윤곽 인덱스 */

const FACE_OVAL = [
10,338,297,332,284,251,389,356,
454,323,361,288,397,365,379,378,
400,377,152,148,176,149,150,136,
172,58,132,93,234,127,162,21,
54,103,67,109
];

/* ---------------- RENDER ---------------- */

function drawFaceMask(){

  if(!lastFace) return;
  if(!lastFace.multiFaceLandmarks) return;

  const lm = lastFace.multiFaceLandmarks[0];

  const rawPts = FACE_OVAL.map(i=>{

    const p = lm[i];

    return {
      x:(1-p.x)*canvas.width,
      y:p.y*canvas.height
    };

  });

  /* center */

  const cx = rawPts.reduce((a,p)=>a+p.x,0)/rawPts.length;
  const cy = rawPts.reduce((a,p)=>a+p.y,0)/rawPts.length;

  /* scale mask */

  const scale = 1.12;

  const pts = rawPts.map(p=>({
    x: cx + (p.x - cx) * scale,
    y: cy + (p.y - cy) * scale
  }));

  const note = freqToNote(smoothFreq);
  const color = noteColor(note);

  ctx.beginPath();

  ctx.moveTo(pts[0].x,pts[0].y);

  for(let i=1;i<pts.length;i++){
    ctx.lineTo(pts[i].x,pts[i].y);
  }

  ctx.closePath();

  ctx.fillStyle = color;
  ctx.fill();

  ctx.fillStyle="white";
  ctx.font="28px monospace";
  ctx.textAlign="center";

  ctx.fillText(note, cx, cy-30);
  ctx.fillText(Math.round(smoothFreq)+" Hz", cx, cy+10);
}

function render(){

  ctx.clearRect(0,0,canvas.width,canvas.height);

  if(lastHands && lastHands.multiHandLandmarks){
    for(const lm of lastHands.multiHandLandmarks){
      drawHand(lm);
    }
  }

  drawFaceMask();
}

/* ---------------- CAMERA ---------------- */

const camera = new Camera(video,{
  onFrame: async () => {

    await hands.send({image:video});
    await faceMesh.send({image:video});

    render();
  },
  width:320,
  height:240
});

camera.start();