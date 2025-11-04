/* Frontend QR Inventory MVP */

// CONFIG ————> REEMPLAZA:
const WEBAPP_URL = 'https://script.google.com/macros/AKfycbwNSzS1Si-s-udLFkyYQjFjIjwiZESDdS29WHDmI5MVQe1IO5Uxi_lSNuD7OX9I5hLJTA/exec';
const ALLOWED_DOMAIN = 'valdishopper.com';

let currentUser = null;
let scanner = null;
let selectedDeviceId = null;
let codeReader = null;
let scanning = false;
let sendQueue = []; // cola offline en memoria; podrías persistir en localStorage

// Google Sign-In v2 (GSI) — botón + callback
window.onload = () => {
  google.accounts.id.initialize({
    client_id: '604540812527-sntcf71p4is92msulnhdd24qm6a0itog.apps.googleusercontent.com',
    callback: handleCredentialResponse,
    auto_select: false
  });
  google.accounts.id.renderButton(
    document.getElementById('signin'),
    { theme: 'outline', size: 'large' }
  );
  google.accounts.id.prompt();

  wireUI();
  listCameras();
};

function handleCredentialResponse(response){
  try {
    const token = response.credential;
    const payload = JSON.parse(atob(token.split('.')[1]));
    const email = payload.email;
    if (!email || !email.endsWith('@' + ALLOWED_DOMAIN)) {
      showStatus('❌ Dominio no permitido', true);
      return;
    }
    currentUser = {
      email,
      name: payload.name || email,
      id_token: token
    };
    document.getElementById('userInfo').textContent = `Conectado como ${currentUser.email}`;
    showStatus('✅ Sesión iniciada');
  } catch (e) {
    showStatus('❌ Error al iniciar sesión', true);
  }
}

function wireUI(){
  document.getElementById('startBtn').addEventListener('click', startScan);
  document.getElementById('stopBtn').addEventListener('click', stopScan);
  document.getElementById('sendManual').addEventListener('click', () => {
    const code = document.getElementById('manualCode').value.trim();
    if (!code) return;
    handleCode(code);
  });
  document.getElementById('cameraSelect').addEventListener('change', (e)=>{
    selectedDeviceId = e.target.value;
    if (scanning) {
      stopScan().then(startScan);
    }
  });

  // Intento de reenvío de cola cada 10s
  setInterval(flushQueue, 10000);
}

async function listCameras(){
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    const videos = devices.filter(d => d.kind === 'videoinput');
    const sel = document.getElementById('cameraSelect');
    sel.innerHTML = '';
    videos.forEach(v => {
      const opt = document.createElement('option');
      opt.value = v.deviceId;
      opt.textContent = v.label || `Cam ${sel.length+1}`;
      sel.appendChild(opt);
    });
    if (videos[0]) selectedDeviceId = videos[0].deviceId;
  } catch (e) {
    showStatus('⚠️ No se pudo listar cámaras', true);
  }
}

async function startScan(){
  if (!currentUser) {
    showStatus('Inicia sesión con Google para escanear', true);
    return;
  }
  if (scanning) return;
  try {
    codeReader = new ZXing.BrowserMultiFormatReader();
    const video = document.getElementById('preview');
    const hints = null;
    scanning = true;
    showStatus('Escaneando... Acerca un QR');
    await codeReader.decodeFromVideoDevice(selectedDeviceId, video, (result, err) => {
      if (result) {
        handleCode(result.getText());
      }
    });
  } catch (e) {
    scanning = false;
    showStatus('❌ No se pudo iniciar escáner', true);
  }
}

async function stopScan(){
  if (codeReader) {
    try { await codeReader.reset(); } catch(_){}
    codeReader = null;
  }
  scanning = false;
}

function currentPayloadFor(code){
  const mode   = document.getElementById('mode').value;
  const fromType = document.getElementById('fromType').value || null;
  const fromId   = document.getElementById('fromId').value.trim() || null;
  const toType   = document.getElementById('toType').value || null;
  const toId     = document.getElementById('toId').value.trim() || null;
  const notes    = document.getElementById('notes').value.trim();

  return {
    email: currentUser?.email,
    name: currentUser?.name,
    mode,
    code,
    from: fromType ? { type: fromType, id: fromId } : null,
    to:   toType ? { type: toType, id: toId } : null,
    notes
  };
}

function handleCode(code){
  showStatus(`Leyó: ${code}`);
  const payload = currentPayloadFor(code);
  enqueue(payload);
  flushQueue();
}

function enqueue(p){
  sendQueue.push(p);
  renderQueue();
}

function renderQueue(){
  const div = document.getElementById('queue');
  if (!sendQueue.length) {
    div.textContent = 'Cola vacía.';
    return;
  }
  const items = sendQueue.map((p,i)=> `${i+1}. ${p.mode} → ${p.code}`).join('\n');
  div.textContent = items;
}

async function flushQueue(){
  if (!sendQueue.length) return;
  const next = sendQueue[0];
  try {
    const res = await fetch(WEBAPP_URL, {
      method: 'POST',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify(next)
    });
    const js = await res.json();
    if (js.ok) {
      sendQueue.shift();
      renderQueue();
      showStatus('✔️ Movimiento registrado');
    } else {
      showStatus('⚠️ Error backend: ' + (js.error || res.statusText), true);
    }
  } catch (e) {
    // sin red: mantener en cola
    showStatus('⏳ Sin conexión. Guardado en cola...', true);
  }
}

function showStatus(msg, isErr=false){
  const el = document.getElementById('status');
  el.textContent = msg;
  el.className = 'status ' + (isErr ? 'error' : 'ok');
}
