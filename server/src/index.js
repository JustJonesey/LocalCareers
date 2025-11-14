import { createServer } from 'node:http';
import { URL } from 'node:url';
import { getJobs, addJob, removeJob, getSources } from './dataStore.js';
import { importFromSource } from './importer.js';

const PORT = Number(process.env.PORT) || 4000;
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS?.split(',').map((origin) => origin.trim()) ?? ['*'];

const server = createServer(async (req, res) => {
  try {
    applyCors(req, res);
    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const url = new URL(req.url, `http://${req.headers.host}`);

    if (req.method === 'GET' && url.pathname === '/health') {
      return sendJson(res, 200, { status: 'ok' });
    }

    if (req.method === 'GET' && url.pathname === '/api/jobs') {
      const jobs = await getJobs();
      const filtered = applyFilters(jobs, url.searchParams);
      return sendJson(res, 200, { jobs: filtered });
    }

    if (req.method === 'GET' && url.pathname === '/api/sources') {
      const sources = await getSources();
      return sendJson(res, 200, { sources });
    }

    if (req.method === 'POST' && url.pathname === '/api/jobs') {
      const body = await readBody(req);
      validateJobPayload(body);
      const job = await addJob(body);
      return sendJson(res, 201, { job });
    }

    if (req.method === 'DELETE' && url.pathname.startsWith('/api/jobs/')) {
      const jobId = decodeURIComponent(url.pathname.replace('/api/jobs/', ''));
      const removed = await removeJob(jobId);
      if (!removed) {
        return sendJson(res, 404, { error: 'Job not found' });
      }
      return sendJson(res, 200, { removed: true });
    }

    if (req.method === 'POST' && url.pathname === '/api/import') {
      const body = await readBody(req);
      const result = await importFromSource(body.source ?? body);
      return sendJson(res, 201, result);
    }

    sendJson(res, 404, { error: 'Not found' });
  } catch (error) {
    console.error(error);
    sendJson(res, 500, { error: error.message ?? 'Server error' });
  }
});

server.listen(PORT, () => {
  console.log(`LocalCareers API listening on http://localhost:${PORT}`);
});

function applyCors(req, res) {
  const origin = req.headers.origin;
  if (ALLOWED_ORIGINS.includes('*') || (origin && ALLOWED_ORIGINS.includes(origin))) {
    res.setHeader('Access-Control-Allow-Origin', origin ?? '*');
  }
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
}

async function readBody(req) {
  const chunks = [];
  for await (const chunk of req) {
    chunks.push(chunk);
  }
  const raw = Buffer.concat(chunks).toString('utf-8') || '{}';
  return JSON.parse(raw);
}

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

function applyFilters(jobs, params) {
  const lat = Number(params.get('lat'));
  const lng = Number(params.get('lng'));
  const radius = Number(params.get('radius'));

  if (Number.isFinite(lat) && Number.isFinite(lng) && Number.isFinite(radius)) {
    return jobs.filter((job) => {
      const distance = distanceInMiles(lat, lng, Number(job.latitude), Number(job.longitude));
      return distance <= radius;
    });
  }

  return jobs;
}

function distanceInMiles(lat1, lon1, lat2, lon2) {
  const earthRadiusMiles = 3958.8;
  const dLat = degToRad(lat2 - lat1);
  const dLon = degToRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(degToRad(lat1)) * Math.cos(degToRad(lat2)) *
      Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return earthRadiusMiles * c;
}

function degToRad(degrees) {
  return degrees * (Math.PI / 180);
}

function validateJobPayload(payload = {}) {
  const required = ['title', 'company', 'address', 'latitude', 'longitude', 'url'];
  const missing = required.filter((key) => !payload[key]);
  if (missing.length) {
    throw new Error(`Missing required fields: ${missing.join(', ')}`);
  }
}
