import { upsertJobs } from './dataStore.js';
import { ensureJobCoordinates } from './geocoder.js';

export async function importFromSource(sourceConfig) {
  if (!sourceConfig?.url) {
    throw new Error('A source URL is required for importing jobs.');
  }

  const response = await fetch(sourceConfig.url);
  if (!response.ok) {
    throw new Error(`Failed to fetch ${sourceConfig.url}: ${response.status} ${response.statusText}`);
  }

  const payload = await response.json();
  const items = Array.isArray(payload)
    ? payload
    : Array.isArray(payload?.jobs)
      ? payload.jobs
      : Array.isArray(payload?.data)
        ? payload.data
        : [];

  if (!items.length) {
    throw new Error(`No job entries were found at ${sourceConfig.url}`);
  }

  const mappedJobs = [];
  for (const item of items) {
    const job = mapJob(item, sourceConfig);
    if (!job.title || !job.company || !job.address || !job.url) {
      continue;
    }

    const withCoordinates = await ensureJobCoordinates(job);
    if (!withCoordinates) {
      continue;
    }

    mappedJobs.push(withCoordinates);
  }

  if (!mappedJobs.length) {
    throw new Error('No valid job postings were produced after mapping.');
  }

  const imported = await upsertJobs(mappedJobs, {
    id: sourceConfig.id ?? sourceConfig.name ?? sourceConfig.url,
    name: sourceConfig.name ?? sourceConfig.url,
    type: sourceConfig.type ?? 'remote-feed',
    url: sourceConfig.url,
    fetchedAt: new Date().toISOString()
  });

  return {
    imported,
    total: imported.length
  };
}

function mapJob(item, sourceConfig) {
  const fieldMap = sourceConfig.fieldMap ?? {};
  const defaults = sourceConfig.defaults ?? {};
  const categories = Array.isArray(sourceConfig.categories) ? sourceConfig.categories : undefined;

  const job = {
    title: readField(item, fieldMap.title ?? 'title'),
    company: readField(item, fieldMap.company ?? 'company') ?? defaults.company,
    address: readField(item, fieldMap.address ?? 'address') ?? defaults.address,
    city: readField(item, fieldMap.city ?? 'city') ?? defaults.city,
    state: readField(item, fieldMap.state ?? 'state') ?? defaults.state,
    postalCode: readField(item, fieldMap.postalCode ?? 'postalCode') ?? defaults.postalCode,
    latitude: readField(item, fieldMap.latitude ?? 'latitude') ?? defaults.latitude,
    longitude: readField(item, fieldMap.longitude ?? 'longitude') ?? defaults.longitude,
    url: readField(item, fieldMap.url ?? 'url') ?? defaults.url,
    description: readField(item, fieldMap.description ?? 'description') ?? defaults.description,
    categories: categories ?? readCategories(item, fieldMap.categories ?? 'categories'),
    source: {
      name: sourceConfig.name ?? sourceConfig.url,
      type: sourceConfig.type ?? 'remote-feed',
      url: sourceConfig.url
    }
  };

  return job;
}

function readField(item, key) {
  if (!key) {
    return undefined;
  }

  if (key.includes('.')) {
    return key.split('.').reduce((value, part) => (value ? value[part] : undefined), item);
  }

  return item?.[key];
}

function readCategories(item, key) {
  const value = readField(item, key);
  if (Array.isArray(value)) {
    return value;
  }
  if (typeof value === 'string') {
    return value.split(',').map((entry) => entry.trim()).filter(Boolean);
  }
  return [];
}

