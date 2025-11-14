const apiBase = document.body.dataset.apiBase ?? window.location.origin;
const mapElement = document.getElementById('map');
const jobTotalElement = document.getElementById('job-total');
const jobListElement = document.getElementById('job-list');
const jobTemplate = document.getElementById('job-item-template');
const filterLatInput = document.getElementById('filter-lat');
const filterLngInput = document.getElementById('filter-lng');
const filterRadiusInput = document.getElementById('filter-radius');
const applyFilterButton = document.getElementById('apply-filter');
const resetFilterButton = document.getElementById('reset-filter');

const addJobForm = document.getElementById('add-job-form');
const removeJobForm = document.getElementById('remove-job-form');
const importForm = document.getElementById('import-form');

const map = L.map(mapElement).setView([35.478915, -79.192561], 12);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
  attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
}).addTo(map);

const state = {
  jobs: [],
  markers: [],
  locationIndex: []
};

refreshJobs();

applyFilterButton?.addEventListener('click', async () => {
  const lat = filterLatInput.value;
  const lng = filterLngInput.value;
  const radius = filterRadiusInput.value;
  await refreshJobs({ lat, lng, radius });
});

resetFilterButton?.addEventListener('click', async () => {
  filterLatInput.value = '';
  filterLngInput.value = '';
  filterRadiusInput.value = '';
  await refreshJobs();
});

addJobForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const formData = new FormData(addJobForm);
  const payload = Object.fromEntries(formData.entries());
  payload.latitude = Number(payload.latitude);
  payload.longitude = Number(payload.longitude);

  try {
    await apiRequest('/api/jobs', {
      method: 'POST',
      body: JSON.stringify(payload)
    });
    addJobForm.reset();
    await refreshJobs();
    alert('Job posted successfully.');
  } catch (error) {
    console.error(error);
    alert(`Unable to add job: ${error.message}`);
  }
});

removeJobForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const formData = new FormData(removeJobForm);
  const jobId = formData.get('jobId');
  if (!jobId) {
    return;
  }
  try {
    await apiRequest(`/api/jobs/${encodeURIComponent(jobId)}`, { method: 'DELETE' });
    removeJobForm.reset();
    await refreshJobs();
    alert('Job removed successfully.');
  } catch (error) {
    console.error(error);
    alert(`Unable to remove job: ${error.message}`);
  }
});

importForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const formData = new FormData(importForm);
  const source = {
    name: formData.get('name'),
    url: formData.get('url')
  };

  const fieldMapRaw = formData.get('fieldMap');
  if (fieldMapRaw) {
    try {
      source.fieldMap = JSON.parse(fieldMapRaw);
    } catch (error) {
      alert('Field map must be valid JSON.');
      return;
    }
  }

  const defaultsRaw = formData.get('defaults');
  if (defaultsRaw) {
    try {
      source.defaults = JSON.parse(defaultsRaw);
    } catch (error) {
      alert('Defaults must be valid JSON.');
      return;
    }
  }

  try {
    await apiRequest('/api/import', {
      method: 'POST',
      body: JSON.stringify({ source })
    });
    await refreshJobs();
    alert('Import completed successfully.');
  } catch (error) {
    console.error(error);
    alert(`Import failed: ${error.message}`);
  }
});

async function refreshJobs(params) {
  try {
    const query = new URLSearchParams();
    if (params?.lat) query.set('lat', params.lat);
    if (params?.lng) query.set('lng', params.lng);
    if (params?.radius) query.set('radius', params.radius);

    const response = await apiRequest(`/api/jobs${query.toString() ? `?${query.toString()}` : ''}`);
    const jobs = response.jobs ?? [];
    state.jobs = jobs;
    renderJobSummary();
    renderMap();
    renderJobList();
  } catch (error) {
    console.error(error);
    jobTotalElement.textContent = `Failed to load jobs: ${error.message}`;
  }
}

function renderJobSummary() {
  const total = state.jobs.length;
  jobTotalElement.textContent = `${total} job${total === 1 ? '' : 's'} found`;
}

function renderMap() {
  state.markers.forEach((marker) => marker.remove());
  state.markers = [];

  const locations = groupJobsByLocation(state.jobs);
  state.locationIndex = locations;

  locations.forEach((location) => {
    const marker = L.marker([location.latitude, location.longitude], {
      icon: L.divIcon({
        html: `<div class="marker-count" aria-hidden="true">${location.jobs.length}</div>`,
        className: 'job-marker',
        iconSize: [36, 36]
      })
    });

    marker.bindTooltip(`${location.jobs.length} job${location.jobs.length === 1 ? '' : 's'} at ${location.label}`, {
      direction: 'top',
      offset: [0, -18]
    });

    marker.on('click', () => {
      marker.bindPopup(createPopupContent(location)).openPopup();
    });

    marker.addTo(map);
    state.markers.push(marker);
  });

  if (locations.length) {
    const bounds = L.latLngBounds(locations.map((location) => [location.latitude, location.longitude]));
    map.fitBounds(bounds.pad(0.2));
  }
}

function renderJobList() {
  jobListElement.innerHTML = '';
  state.jobs.forEach((job) => {
    const node = jobTemplate.content.firstElementChild.cloneNode(true);
    node.querySelector('.job-item__title').textContent = job.title;
    node.querySelector('.job-item__company').textContent = `${job.company} · ${job.address}`;
    node.querySelector('.job-item__address').textContent = `${formatCityState(job.city, job.state)} ${job.postalCode ?? ''}`.trim();
    node.querySelector('.job-item__link').href = job.url;
    node.querySelector('.job-item__meta').textContent = `Job ID: ${job.id} · Updated ${formatDate(job.updatedAt ?? job.createdAt)}`;
    node.querySelector('.job-item__focus').addEventListener('click', () => focusJob(job));
    jobListElement.appendChild(node);
  });
}

function groupJobsByLocation(jobs) {
  const mapByLocation = new Map();

  jobs.forEach((job) => {
    const key = `${job.latitude}-${job.longitude}-${job.address ?? ''}`;
    if (!mapByLocation.has(key)) {
      mapByLocation.set(key, {
        label: job.address ?? 'Job location',
        latitude: Number(job.latitude),
        longitude: Number(job.longitude),
        jobs: []
      });
    }
    mapByLocation.get(key).jobs.push(job);
  });

  return Array.from(mapByLocation.values());
}

function createPopupContent(location) {
  const container = document.createElement('div');
  container.className = 'popup-content';
  const heading = document.createElement('h3');
  heading.textContent = location.label;
  container.appendChild(heading);

  const list = document.createElement('ul');
  list.className = 'popup-job-list';
  location.jobs.forEach((job) => {
    const item = document.createElement('li');
    const link = document.createElement('a');
    link.href = job.url;
    link.target = '_blank';
    link.rel = 'noopener';
    link.textContent = `${job.title} — ${job.company}`;
    item.appendChild(link);
    list.appendChild(item);
  });
  container.appendChild(list);

  return container;
}

function focusJob(job) {
  map.setView([Number(job.latitude), Number(job.longitude)], 16, {
    animate: true
  });
}

async function apiRequest(path, options = {}) {
  const url = new URL(path, apiBase);
  const response = await fetch(url, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...(options.headers ?? {})
    }
  });

  if (!response.ok) {
    const errorBody = await response.json().catch(() => ({}));
    const message = errorBody.error ?? response.statusText;
    throw new Error(message);
  }

  return response.json().catch(() => ({}));
}

function formatDate(value) {
  if (!value) {
    return 'recently';
  }
  try {
    const date = new Date(value);
    return date.toLocaleDateString();
  } catch (error) {
    return value;
  }
}

function formatCityState(city, state) {
  const parts = [city, state].filter(Boolean);
  return parts.join(', ');
}
