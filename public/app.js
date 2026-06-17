const formFields = {
  nodo_place: document.querySelector('#nodoPlace'),
  driver_name: document.querySelector('#driverName'),
  driver_document: document.querySelector('#driverDocument'),
  driver_plate: document.querySelector('#driverPlate'),
  carrier: document.querySelector('#carrier'),
  route_id: document.querySelector('#routeId'),
  operator_name: document.querySelector('#operatorName'),
  notes: document.querySelector('#notes')
};

const scanInput = document.querySelector('#scanInput');
const addScanButton = document.querySelector('#addScan');
const clearScansButton = document.querySelector('#clearScans');
const submitButton = document.querySelector('#submitConference');
const scanList = document.querySelector('#scanList');
const emptyState = document.querySelector('#emptyState');
const scanCount = document.querySelector('#scanCount');
const statusText = document.querySelector('#statusText');
const canvas = document.querySelector('#signaturePad');
const clearSignatureButton = document.querySelector('#clearSignature');
const cameraToggle = document.querySelector('#cameraToggle');
const cameraPreview = document.querySelector('#cameraPreview');
const cameraHint = document.querySelector('#cameraHint');

const ctx = canvas.getContext('2d');
let scans = loadScans();
let scannedAt = loadScannedAt();
let drawing = false;
let hasSignature = false;
let cameraStream = null;
let cameraTimer = null;
let barcodeDetector = null;

function nowIso() {
  return new Date().toISOString();
}

function setStatus(message, type = '') {
  statusText.textContent = message;
  statusText.className = type;
}

function normalizeCode(value) {
  return String(value || '').trim().replace(/\s+/g, '').toUpperCase();
}

function loadScans() {
  try {
    return JSON.parse(localStorage.getItem('nodo.scans') || '[]');
  } catch {
    return [];
  }
}

function loadScannedAt() {
  try {
    return JSON.parse(localStorage.getItem('nodo.scannedAt') || '{}');
  } catch {
    return {};
  }
}

function saveDraft() {
  localStorage.setItem('nodo.scans', JSON.stringify(scans));
  localStorage.setItem('nodo.scannedAt', JSON.stringify(scannedAt));
}

function renderScans() {
  scanCount.textContent = scans.length;
  emptyState.hidden = scans.length > 0;
  scanList.innerHTML = scans.map((code, index) => `
    <li>
      <small>${index + 1}</small>
      <strong>${code}</strong>
      <button type="button" data-remove="${code}" aria-label="Remover ${code}">X</button>
    </li>
  `).join('');
}

function addScan(value) {
  const code = normalizeCode(value);
  if (!code) return;
  if (scans.includes(code)) {
    setStatus(`${code} ja esta na lista.`, 'error');
    scanInput.select();
    return;
  }

  scans = [code, ...scans];
  scannedAt[code] = nowIso();
  scanInput.value = '';
  setStatus(`${code} adicionado.`, 'success');
  saveDraft();
  renderScans();
  scanInput.focus();
}

function resizeSignaturePad() {
  const data = hasSignature ? canvas.toDataURL('image/png') : null;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(600, Math.floor(rect.width * window.devicePixelRatio));
  canvas.height = Math.max(220, Math.floor(rect.height * window.devicePixelRatio));
  ctx.setTransform(window.devicePixelRatio, 0, 0, window.devicePixelRatio, 0, 0);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = 3;
  ctx.strokeStyle = '#111827';
  if (data) {
    const image = new Image();
    image.onload = () => ctx.drawImage(image, 0, 0, rect.width, rect.height);
    image.src = data;
  }
}

function pointerPoint(event) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top
  };
}

function startDrawing(event) {
  drawing = true;
  hasSignature = true;
  const point = pointerPoint(event);
  ctx.beginPath();
  ctx.moveTo(point.x, point.y);
}

function draw(event) {
  if (!drawing) return;
  event.preventDefault();
  const point = pointerPoint(event);
  ctx.lineTo(point.x, point.y);
  ctx.stroke();
}

function stopDrawing() {
  drawing = false;
}

function clearSignature() {
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  hasSignature = false;
}

function payload() {
  return {
    nodo_place: formFields.nodo_place.value,
    driver_name: formFields.driver_name.value,
    driver_document: formFields.driver_document.value,
    driver_plate: formFields.driver_plate.value,
    carrier: formFields.carrier.value,
    route_id: formFields.route_id.value,
    operator_name: formFields.operator_name.value,
    notes: formFields.notes.value,
    shipment_ids: scans,
    scanned_at: scannedAt,
    signature_png: hasSignature ? canvas.toDataURL('image/png') : ''
  };
}

function validateBeforeSubmit() {
  const required = ['nodo_place', 'driver_name', 'driver_plate'];
  for (const key of required) {
    if (!formFields[key].value.trim()) {
      formFields[key].focus();
      throw new Error('Preencha nodo, motorista e placa antes de salvar.');
    }
  }
  if (!scans.length) {
    scanInput.focus();
    throw new Error('Escaneie ao menos um pacote antes de salvar.');
  }
  if (!hasSignature) {
    canvas.focus();
    throw new Error('Colete a assinatura do motorista antes de salvar.');
  }
}

async function submitConference() {
  try {
    validateBeforeSubmit();
    submitButton.disabled = true;
    setStatus('Salvando no BigQuery...');

    const response = await fetch('/api/nodo-conferences', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload())
    });
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.message || 'Falha ao salvar conferencia.');
    }

    scans = [];
    scannedAt = {};
    saveDraft();
    renderScans();
    clearSignature();
    setStatus(`Salvo. Sessao ${result.session_id}, ${result.inserted_rows} pacotes.`, 'success');
  } catch (error) {
    setStatus(error.message, 'error');
  } finally {
    submitButton.disabled = false;
  }
}

async function stopCamera() {
  clearInterval(cameraTimer);
  cameraTimer = null;
  if (cameraStream) {
    cameraStream.getTracks().forEach((track) => track.stop());
  }
  cameraStream = null;
  cameraPreview.hidden = true;
  cameraToggle.textContent = 'Camera';
}

async function startCamera() {
  if (!('BarcodeDetector' in window)) {
    setStatus('Camera para codigo de barras nao esta disponivel neste navegador.', 'error');
    return;
  }

  barcodeDetector ||= new BarcodeDetector({
    formats: ['code_128', 'code_39', 'ean_13', 'qr_code']
  });
  cameraStream = await navigator.mediaDevices.getUserMedia({
    video: { facingMode: 'environment' },
    audio: false
  });
  cameraPreview.srcObject = cameraStream;
  cameraPreview.hidden = false;
  await cameraPreview.play();
  cameraToggle.textContent = 'Parar';
  cameraHint.textContent = 'Aponte para o codigo. O app adiciona automaticamente quando conseguir ler.';

  cameraTimer = setInterval(async () => {
    try {
      const codes = await barcodeDetector.detect(cameraPreview);
      if (codes[0]?.rawValue) addScan(codes[0].rawValue);
    } catch {
      clearInterval(cameraTimer);
    }
  }, 700);
}

addScanButton.addEventListener('click', () => addScan(scanInput.value));
scanInput.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    addScan(scanInput.value);
  }
});
scanList.addEventListener('click', (event) => {
  const code = event.target.dataset.remove;
  if (!code) return;
  scans = scans.filter((item) => item !== code);
  delete scannedAt[code];
  saveDraft();
  renderScans();
});
clearScansButton.addEventListener('click', () => {
  scans = [];
  scannedAt = {};
  saveDraft();
  renderScans();
  scanInput.focus();
});
canvas.addEventListener('pointerdown', startDrawing);
canvas.addEventListener('pointermove', draw);
canvas.addEventListener('pointerup', stopDrawing);
canvas.addEventListener('pointerleave', stopDrawing);
clearSignatureButton.addEventListener('click', clearSignature);
submitButton.addEventListener('click', submitConference);
cameraToggle.addEventListener('click', async () => {
  try {
    if (cameraStream) {
      await stopCamera();
    } else {
      await startCamera();
    }
  } catch (error) {
    setStatus(error.message, 'error');
    await stopCamera();
  }
});
window.addEventListener('resize', resizeSignaturePad);

resizeSignaturePad();
renderScans();
scanInput.focus();
