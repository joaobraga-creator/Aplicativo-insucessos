import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import express from 'express';
import { BigQuery } from '@google-cloud/bigquery';

const app = express();
const port = Number(process.env.PORT || 8080);
const projectId = process.env.BQ_PROJECT_ID || 'meli-bi-data';
const queryPath = process.env.QUERY_PATH || new URL('./query_insucessos_nex_mlb.sql', import.meta.url);
const scanTable = process.env.BQ_SCAN_TABLE || 'meli-bi-data.nex_operacao.nodo_package_conferences';
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const bigquery = new BigQuery({ projectId });
let cache = { rows: [], updatedAt: null, expiresAt: 0 };

function cors(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

function text(value, maxLength = 500) {
  return String(value || '').trim().slice(0, maxLength);
}

function normalizeShipmentId(value) {
  return text(value, 80).replace(/\s+/g, '').toUpperCase();
}

function bqTimestamp(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  const safeDate = Number.isNaN(date.getTime()) ? new Date() : date;
  return safeDate.toISOString().replace('T', ' ').replace('Z', ' UTC');
}

function parseTableId(tableId) {
  const parts = tableId.split('.');
  if (parts.length !== 3 || parts.some((part) => !part)) {
    throw new Error('BQ_SCAN_TABLE must use project.dataset.table format');
  }
  return { project: parts[0], dataset: parts[1], table: parts[2] };
}

function buildConferenceRows(payload, req) {
  const shipmentIds = Array.isArray(payload.shipment_ids)
    ? [...new Set(payload.shipment_ids.map(normalizeShipmentId).filter(Boolean))]
    : [];

  if (!shipmentIds.length) {
    const error = new Error('Informe ao menos um shipment_id escaneado.');
    error.statusCode = 400;
    throw error;
  }

  if (shipmentIds.length > 5000) {
    const error = new Error('O limite por envio e 5.000 pacotes. Envie em lotes menores.');
    error.statusCode = 400;
    throw error;
  }

  const signaturePng = text(payload.signature_png, 250000);
  if (!signaturePng.startsWith('data:image/png;base64,')) {
    const error = new Error('A assinatura do motorista e obrigatoria.');
    error.statusCode = 400;
    throw error;
  }

  const signedAt = bqTimestamp();
  const sessionId = crypto.randomUUID();
  const conference = {
    session_id: sessionId,
    nodo_place: text(payload.nodo_place, 120).toUpperCase(),
    driver_name: text(payload.driver_name, 160).toUpperCase(),
    driver_document: text(payload.driver_document, 80),
    driver_plate: text(payload.driver_plate, 40).toUpperCase(),
    carrier: text(payload.carrier, 120).toUpperCase(),
    route_id: text(payload.route_id, 120).toUpperCase(),
    operator_name: text(payload.operator_name, 160).toUpperCase(),
    notes: text(payload.notes, 1000),
    signature_png: signaturePng,
    signed_at: signedAt,
    source_app: 'render-nodo-scan',
    user_agent: text(req.get('user-agent'), 500)
  };

  return shipmentIds.map((shipmentId, index) => ({
    insertId: `${sessionId}-${shipmentId}`,
    json: {
      ...conference,
      shipment_id: shipmentId,
      scan_sequence: index + 1,
      scanned_at: payload.scanned_at?.[shipmentId] ? bqTimestamp(payload.scanned_at[shipmentId]) : signedAt
    }
  }));
}

app.use(express.json({ limit: '8mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.options('/api/insucessos-nex-mlb', (_req, res) => {
  cors(res);
  res.status(204).end();
});

app.options('/api/nodo-conferences', (_req, res) => {
  cors(res);
  res.status(204).end();
});

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, service: 'nex-nodo-tools-api' });
});

app.get('/api/insucessos-nex-mlb', async (req, res) => {
  cors(res);

  const ttlSeconds = Number(req.query.ttl || process.env.CACHE_TTL_SECONDS || 300);
  if (cache.expiresAt > Date.now()) {
    return res.json({ source: 'cache', updated_at: cache.updatedAt, rows: cache.rows });
  }

  try {
    const query = await fs.readFile(queryPath, 'utf8');
    const [job] = await bigquery.createQueryJob({
      query,
      location: process.env.BQ_LOCATION || 'US',
      maximumBytesBilled: process.env.BQ_MAX_BYTES_BILLED
        ? Number(process.env.BQ_MAX_BYTES_BILLED)
        : undefined
    });
    const [rows] = await job.getQueryResults();
    const updatedAt = rows[0]?.updated_at || new Date().toISOString();
    cache = {
      rows,
      updatedAt,
      expiresAt: Date.now() + ttlSeconds * 1000
    };
    res.json({ source: 'bigquery', updated_at: updatedAt, rows });
  } catch (error) {
    res.status(500).json({
      error: 'BIGQUERY_QUERY_FAILED',
      message: error.message
    });
  }
});

app.post('/api/nodo-conferences', async (req, res) => {
  cors(res);

  try {
    const rows = buildConferenceRows(req.body || {}, req);
    const tableRef = parseTableId(scanTable);
    await bigquery
      .dataset(tableRef.dataset, { projectId: tableRef.project })
      .table(tableRef.table)
      .insert(rows, { raw: true });

    res.status(201).json({
      ok: true,
      session_id: rows[0].json.session_id,
      inserted_rows: rows.length,
      table: scanTable
    });
  } catch (error) {
    const statusCode = error.statusCode || 500;
    res.status(statusCode).json({
      error: statusCode === 400 ? 'INVALID_CONFERENCE' : 'BIGQUERY_INSERT_FAILED',
      message: error.message,
      errors: error.errors
    });
  }
});

app.listen(port, () => {
  console.log(`NEX Nodo tools API listening on port ${port}`);
});
