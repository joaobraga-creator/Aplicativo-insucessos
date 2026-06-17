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
const captureView = document.querySelector('#captureView');
const historyView = document.querySelector('#historyView');
const navButtons = document.querySelectorAll('.subnav button');
const historySearch = document.querySelector('#historySearch');
const searchHistoryButton = document.querySelector('#searchHistory');
const refreshHistoryButton = document.querySelector('#refreshHistory');
const historyStatus = document.querySelector('#historyStatus');
const historyEmpty = document.querySelector('#historyEmpty');
const historyList = document.querySelector('#historyList');
const waybillModal = document.querySelector('#waybillModal');
const waybillContent = document.querySelector('#waybillContent');
const closeWaybillButton = document.querySelector('#closeWaybill');
const printWaybillButton = document.querySelector('#printWaybill');

const ctx = canvas.getContext('2d');
let scans = loadScans();
let scannedAt = loadScannedAt();
let drawing = false;
let hasSignature = false;
let cameraStream = null;
let cameraTimer = null;
let barcodeDetector = null;
let zxingReader = null;
let zxingControls = null;
let lastCameraCode = '';
let lastCameraCodeAt = 0;
let historyLoaded = false;

function nowIso() {
  return new Date().toISOString();
}

function setStatus(message, type = '') {
  statusText.textContent = message;
  statusText.className = type;
}

function setHistoryStatus(message, type = '') {
  historyStatus.textContent = message;
  historyStatus.className = `hint ${type}`.trim();
}

function normalizeCode(value) {
  return String(value || '').trim().replace(/\s+/g, '').toUpperCase();
}

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  })[char]);
}

function formatDateTime(value) {
  if (value === null || value === undefined || value === '') return '-';
  const rawValue = value.value || value;
  const rawString = String(rawValue);
  const numericValue = Number(rawString);
  const date = Number.isFinite(numericValue)
    ? new Date(numericValue * 1000)
    : new Date(rawValue);
  if (Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(date);
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

function showView(view, activeButton = null) {
  const isHistory = view === 'history';
  captureView.hidden = isHistory;
  historyView.hidden = !isHistory;
  navButtons.forEach((button) => {
    const fallbackTab = isHistory ? 'history' : 'panel';
    button.classList.toggle('active', activeButton ? button === activeButton : button.dataset.tab === fallbackTab);
  });
  if (isHistory && !historyLoaded) loadHistory();
  if (!isHistory) scanInput.focus();
}

function renderHistory(rows) {
  historyEmpty.hidden = rows.length > 0;
  historyList.innerHTML = rows.map((row) => {
    const shipments = Array.isArray(row.shipment_ids) ? row.shipment_ids : [];
    const visibleShipments = shipments.slice(0, 12).map((id) => `<span>${escapeHtml(id)}</span>`).join('');
    const hiddenCount = Math.max(Number(row.package_count || 0) - shipments.length, 0);
    const extra = hiddenCount ? `<span>+${hiddenCount}</span>` : '';

    return `
      <article class="history-card">
        <header>
          <div>
            <h2>${escapeHtml(row.nodo_place || 'Nodo nao informado')}</h2>
            <p>${escapeHtml(row.session_id)}</p>
          </div>
          <strong class="history-badge">${Number(row.package_count || 0)} pacotes</strong>
        </header>
        <div class="history-meta">
          <span>${escapeHtml(row.driver_name || 'Motorista nao informado')}</span>
          <span>${escapeHtml(row.driver_plate || 'Placa nao informada')}</span>
          <span>${escapeHtml(row.carrier || 'Transportadora nao informada')}</span>
          <span>${escapeHtml(row.route_id || 'Rota nao informada')}</span>
          <span>${formatDateTime(row.signed_at)}</span>
        </div>
        <div class="history-shipments">${visibleShipments}${extra}</div>
        <button class="secondary history-open" type="button" data-session-id="${escapeHtml(row.session_id)}">Abrir romaneio</button>
      </article>
    `;
  }).join('');
}

async function loadHistory() {
  try {
    setHistoryStatus('Carregando historico...');
    refreshHistoryButton.disabled = true;
    searchHistoryButton.disabled = true;
    const params = new URLSearchParams({ limit: '100' });
    const query = historySearch.value.trim();
    if (query) params.set('q', query);

    const response = await fetch(`/api/nodo-conferences/history?${params.toString()}`);
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.message || 'Falha ao carregar historico.');
    }

    historyLoaded = true;
    renderHistory(result.rows || []);
    setHistoryStatus(`${(result.rows || []).length} conferencias encontradas.`, 'success');
  } catch (error) {
    renderHistory([]);
    setHistoryStatus(error.message, 'error');
  } finally {
    refreshHistoryButton.disabled = false;
    searchHistoryButton.disabled = false;
  }
}

function setWaybillLoading(message = 'Carregando romaneio...') {
  waybillContent.innerHTML = `<p id="waybillStatus" class="hint" role="status">${escapeHtml(message)}</p>`;
}

function renderWaybill(row) {
  const packages = Array.isArray(row.packages) ? row.packages : [];
  const packageRows = packages.map((item, index) => `
    <tr>
      <td>${index + 1}</td>
      <td>${escapeHtml(item.shipment_id || '')}</td>
      <td>${escapeHtml(item.scan_sequence || index + 1)}</td>
      <td>${formatDateTime(item.scanned_at)}</td>
    </tr>
  `).join('');
  const signature = row.signature_png
    ? `<img class="waybill-signature-img" src="${escapeHtml(row.signature_png)}" alt="Assinatura do motorista">`
    : '<div class="waybill-no-signature">Assinatura nao encontrada.</div>';

  waybillContent.innerHTML = `
    <header class="waybill-header">
      <div>
        <p class="eyebrow">Romaneio de conferencia</p>
        <h1 id="waybillTitle">Retirada NEX - ${escapeHtml(row.nodo_place || 'Nodo nao informado')}</h1>
        <p>${escapeHtml(row.session_id || '')}</p>
      </div>
      <strong>${Number(row.package_count || packages.length || 0)} pacotes</strong>
    </header>

    <section class="waybill-grid">
      <div>
        <span>Nodo / place</span>
        <strong>${escapeHtml(row.nodo_place || '-')}</strong>
      </div>
      <div>
        <span>Data da assinatura</span>
        <strong>${formatDateTime(row.signed_at)}</strong>
      </div>
      <div>
        <span>Motorista</span>
        <strong>${escapeHtml(row.driver_name || '-')}</strong>
      </div>
      <div>
        <span>Documento</span>
        <strong>${escapeHtml(row.driver_document || '-')}</strong>
      </div>
      <div>
        <span>Placa</span>
        <strong>${escapeHtml(row.driver_plate || '-')}</strong>
      </div>
      <div>
        <span>Transportadora</span>
        <strong>${escapeHtml(row.carrier || '-')}</strong>
      </div>
      <div>
        <span>Rota</span>
        <strong>${escapeHtml(row.route_id || '-')}</strong>
      </div>
      <div>
        <span>Operador</span>
        <strong>${escapeHtml(row.operator_name || '-')}</strong>
      </div>
    </section>

    <section class="waybill-notes">
      <span>Observacao</span>
      <p>${escapeHtml(row.notes || '-')}</p>
    </section>

    <section class="waybill-packages">
      <h2>Pacotes conferidos</h2>
      <table>
        <thead>
          <tr>
            <th>#</th>
            <th>Shipment ID</th>
            <th>Sequencia</th>
            <th>Escaneado em</th>
          </tr>
        </thead>
        <tbody>${packageRows}</tbody>
      </table>
    </section>

    <section class="waybill-signature">
      <h2>Assinatura do motorista</h2>
      ${signature}
      <div class="waybill-signature-line">
        <span>${escapeHtml(row.driver_name || 'Motorista')}</span>
      </div>
    </section>
  `;
}

async function openWaybill(sessionId) {
  waybillModal.hidden = false;
  document.body.classList.add('modal-open');
  setWaybillLoading();

  try {
    const response = await fetch(`/api/nodo-conferences/history/${encodeURIComponent(sessionId)}`);
    const result = await response.json();
    if (!response.ok) {
      throw new Error(result.message || 'Falha ao carregar romaneio.');
    }
    renderWaybill(result.row);
  } catch (error) {
    setWaybillLoading(error.message);
  }
}

function closeWaybill() {
  waybillModal.hidden = true;
  document.body.classList.remove('modal-open');
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

function addCameraScan(value) {
  const code = normalizeCode(value);
  const now = Date.now();
  if (!code) return;
  if (code === lastCameraCode && now - lastCameraCodeAt < 2500) return;
  lastCameraCode = code;
  lastCameraCodeAt = now;
  addScan(code);
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
    historyLoaded = false;
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
  if (zxingControls) {
    zxingControls.stop();
  }
  zxingControls = null;
  if (cameraStream) {
    cameraStream.getTracks().forEach((track) => track.stop());
  }
  cameraStream = null;
  cameraPreview.srcObject = null;
  cameraPreview.hidden = true;
  cameraToggle.textContent = 'Camera';
  cameraHint.textContent = 'Use o leitor do nodo ou a camera do celular. A leitura continua enquanto a camera estiver aberta.';
}

async function startNativeBarcodeDetector() {
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
      if (codes[0]?.rawValue) addCameraScan(codes[0].rawValue);
    } catch {
      clearInterval(cameraTimer);
    }
  }, 700);
}

async function startZxingCamera() {
  if (!window.ZXingBrowser?.BrowserMultiFormatReader) {
    throw new Error('Leitor de camera nao carregou. Use o scanner fisico ou tente atualizar a pagina.');
  }

  zxingReader ||= new ZXingBrowser.BrowserMultiFormatReader(undefined, {
    delayBetweenScanAttempts: 350,
    delayBetweenScanSuccess: 900
  });
  cameraPreview.hidden = false;
  cameraToggle.textContent = 'Parar';
  cameraHint.textContent = 'Aponte para o codigo. Se pedir permissao, libere a camera do navegador.';

  zxingControls = await zxingReader.decodeFromVideoDevice(undefined, cameraPreview, (result) => {
    if (result) addCameraScan(result.getText());
  });
}

async function startCamera() {
  setStatus('');
  if (!navigator.mediaDevices?.getUserMedia) {
    throw new Error('Este navegador nao liberou acesso a camera. Use HTTPS ou o scanner fisico.');
  }

  if ('BarcodeDetector' in window) {
    try {
      await startNativeBarcodeDetector();
      return;
    } catch {
      await stopCamera();
    }
  }

  await startZxingCamera();
}

addScanButton.addEventListener('click', () => addScan(scanInput.value));
navButtons.forEach((button) => {
  button.addEventListener('click', () => showView(button.dataset.view, button));
});
searchHistoryButton.addEventListener('click', loadHistory);
refreshHistoryButton.addEventListener('click', loadHistory);
historySearch.addEventListener('keydown', (event) => {
  if (event.key === 'Enter') {
    event.preventDefault();
    loadHistory();
  }
});
historyList.addEventListener('click', (event) => {
  const button = event.target.closest('[data-session-id]');
  if (!button) return;
  openWaybill(button.dataset.sessionId);
});
closeWaybillButton.addEventListener('click', closeWaybill);
waybillModal.addEventListener('click', (event) => {
  if (event.target.matches('[data-close-waybill]')) closeWaybill();
});
printWaybillButton.addEventListener('click', () => window.print());
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !waybillModal.hidden) closeWaybill();
});
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
