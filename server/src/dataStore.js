import { readFile, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_PATH = resolve(__dirname, '../data/jobs.json');

const DEFAULT_DATA = {
  jobs: [],
  sources: []
};

async function readData() {
  try {
    const raw = await readFile(DATA_PATH, 'utf-8');
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === 'ENOENT') {
      await writeData(DEFAULT_DATA);
      return { ...DEFAULT_DATA };
    }
    throw error;
  }
}

async function writeData(data) {
  const serialized = JSON.stringify(data, null, 2);
  await writeFile(DATA_PATH, serialized, 'utf-8');
}

export async function getJobs() {
  const data = await readData();
  return data.jobs.map(({ lookupKey, ...job }) => job);
}

export async function getSources() {
  const data = await readData();
  return data.sources ?? [];
}

export async function addJob(jobInput) {
  const data = await readData();
  const job = withIdentifiers(jobInput);
  data.jobs.push(job);
  await writeData(data);
  const { lookupKey, ...safeJob } = job;
  return safeJob;
}

export async function removeJob(jobId) {
  const data = await readData();
  const originalLength = data.jobs.length;
  data.jobs = data.jobs.filter((job) => job.id !== jobId);
  await writeData(data);
  return data.jobs.length !== originalLength;
}

export async function upsertJobs(jobInputs, sourceInfo) {
  const data = await readData();
  const normalizedSource = normalizeSource(sourceInfo);
  const seenKeys = new Set();

  const transformed = jobInputs.map((jobInput) => {
    const job = withIdentifiers(jobInput, normalizedSource);
    seenKeys.add(job.lookupKey);
    return job;
  });

  const remainingJobs = data.jobs.filter((job) => {
    if (job.source?.id !== normalizedSource.id) {
      return true;
    }
    return !seenKeys.has(job.lookupKey);
  });

  data.jobs = [...remainingJobs, ...transformed];
  data.sources = mergeSources(data.sources, normalizedSource);

  await writeData(data);
  return transformed.map(({ lookupKey, ...job }) => job);
}

function withIdentifiers(jobInput, source) {
  const nowIso = new Date().toISOString();
  const job = {
    id: jobInput.id ?? randomUUID(),
    title: jobInput.title?.trim(),
    company: jobInput.company?.trim(),
    address: jobInput.address?.trim(),
    city: jobInput.city?.trim(),
    state: jobInput.state?.trim(),
    postalCode: jobInput.postalCode?.trim(),
    latitude: Number(jobInput.latitude),
    longitude: Number(jobInput.longitude),
    url: jobInput.url,
    description: jobInput.description?.trim(),
    categories: jobInput.categories ?? [],
    source: source ?? normalizeSource(jobInput.source),
    createdAt: jobInput.createdAt ?? nowIso,
    updatedAt: nowIso
  };

  job.lookupKey = buildLookupKey(job);
  return job;
}

function buildLookupKey(job) {
  const parts = [job.company, job.title, job.address]
    .filter(Boolean)
    .map((value) => value.toLowerCase());
  return parts.join('::');
}

function normalizeSource(sourceInput = {}) {
  if (typeof sourceInput === 'string') {
    return {
      id: sourceInput,
      name: sourceInput,
      type: 'custom'
    };
  }

  return {
    id: sourceInput.id ?? sourceInput.name ?? randomUUID(),
    name: sourceInput.name ?? 'Imported',
    type: sourceInput.type ?? 'custom',
    url: sourceInput.url,
    fetchedAt: sourceInput.fetchedAt ?? new Date().toISOString()
  };
}

function mergeSources(existingSources = [], updatedSource) {
  const others = existingSources.filter((source) => source.id !== updatedSource.id);
  return [...others, updatedSource];
}
