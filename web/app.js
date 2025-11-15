const apiBase = document.body.dataset.apiBase ?? window.location.origin;

const mapElement = document.getElementById('map');
const jobTotalElement = document.getElementById('job-total');
const jobListElement = document.getElementById('job-list');
const jobTemplate = document.getElementById('job-item-template');
const filterAddressInput = document.getElementById('filter-address');
const filterRadiusInput = document.getElementById('filter-radius');
const applyFilterButton = document.getElementById('apply-filter');
const resetFilterButton = document.getElementById('reset-filter');

const addJobForm = document.getElementById('add-job-form');
const removeJobForm = document.getElementById('remove-job-form');
const importForm = document.getElementById('import-form');

let map = null;
let infoWindow = null;
let autocomplete = null;
let lastSelectedPlace = null;

const state = {
  jobs: [],
  markers: [],
  locationIndex: [],
  searchOverlay: null,
  searchCenter: null
};

applyFilterButton?.addEventListener('click', async () => {
  const address = filterAddressInput.value.trim();
  const radius = filterRadiusInput.value;

  if (!address) {
    alert('Please enter an address to search around.');
    filterAddressInput.focus();
    return;
  }

  if (!map || !window.google?.maps) {
    alert('The map is still loading. Please try again in a moment.');
    return;
  }

  const originalLabel = applyFilterButton.textContent;
  applyFilterButton.disabled = true;
  applyFilterButton.textContent = 'Searching…';

  try {
    const radiusValue = radius ? Number(radius) : undefined;
    const result = await resolveSearchLocation(address);
    if (!result) {
      alert('Unable to find that address. Try selecting one of the suggestions.');
      return;
    }

    await refreshJobs({ lat: result.lat, lng: result.lng, radius: radiusValue });
    map.setCenter({ lat: result.lat, lng: result.lng });
    map.setZoom(Math.max(map.getZoom(), 13));
  } catch (error) {
    console.error(error);
    alert(`Search failed: ${error.message}`);
  } finally {
    applyFilterButton.disabled = false;
    applyFilterButton.textContent = originalLabel;
  }
});

resetFilterButton?.addEventListener('click', async () => {
  filterAddressInput.value = '';
  filterRadiusInput.value = '';
  state.searchCenter = null;
  lastSelectedPlace = null;
  await refreshJobs({});
});

addJobForm?.addEventListener('submit', async (event) => {
  event.preventDefault();
  const formData = new FormData(addJobForm);
  const payload = Object.fromEntries(formData.entries());

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

async function initMap() {
  if (!window.google?.maps || !mapElement) {
    showMapError('Unable to load the map right now. Please refresh to try again.');
    return;
  }

  try {
    map = new window.google.maps.Map(mapElement, {
      center: { lat: 39.8283, lng: -98.5795 },
      zoom: 4,
      mapTypeControl: false,
      streetViewControl: false,
      fullscreenControl: false
    });
    infoWindow = new window.google.maps.InfoWindow();

    if (filterAddressInput) {
      autocomplete = new window.google.maps.places.Autocomplete(filterAddressInput, {
        fields: ['formatted_address', 'geometry']
      });

      autocomplete.addListener('place_changed', () => {
        const place = autocomplete?.getPlace();
        if (!place) {
          return;
        }
        lastSelectedPlace = place;
        if (place.formatted_address) {
          filterAddressInput.value = place.formatted_address;
        }
        const location = place.geometry?.location?.toJSON?.();
        if (location) {
          map.panTo(location);
          if (map.getZoom() < 10) {
            map.setZoom(10);
          }
        }
      });
    }

    await refreshJobs();
  } catch (error) {
    console.error('Google Maps failed to initialize', error);
    showMapError('Unable to load the map right now. Please refresh to try again.');
  }
}

window.initMap = initMap;

async function refreshJobs(params) {
  const effectiveParams =
    params ??
    (state.searchCenter
      ? {
          lat: state.searchCenter.lat,
          lng: state.searchCenter.lng,
          radius: state.searchCenter.radius ?? undefined
        }
      : undefined);

  try {
    const query = new URLSearchParams();
    if (effectiveParams?.lat) query.set('lat', effectiveParams.lat);
    if (effectiveParams?.lng) query.set('lng', effectiveParams.lng);
    if (effectiveParams?.radius) query.set('radius', effectiveParams.radius);

    const response = await apiRequest(`/api/jobs${query.toString() ? `?${query.toString()}` : ''}`);
    const jobs = response.jobs ?? [];
    state.jobs = jobs;
    if (effectiveParams?.lat && effectiveParams?.lng) {
      state.searchCenter = {
        lat: Number(effectiveParams.lat),
        lng: Number(effectiveParams.lng),
        radius: effectiveParams?.radius ? Number(effectiveParams.radius) : null
      };
    } else {
      state.searchCenter = null;
    }
    renderJobSummary();
    renderJobList();
    renderMap();
    renderSearchArea();
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
  if (!map || !window.google?.maps) {
    return;
  }

  state.markers.forEach((marker) => marker.setMap(null));
  state.markers = [];

  const locations = groupJobsByLocation(state.jobs);
  state.locationIndex = locations;

  if (!locations.length) {
    return;
  }

  locations.forEach((location) => {
    const marker = new window.google.maps.Marker({
      position: { lat: location.latitude, lng: location.longitude },
      map,
      title: `${location.jobs.length} job${location.jobs.length === 1 ? '' : 's'} at ${location.label}`,
      icon: {
        path: window.google.maps.SymbolPath.CIRCLE,
        scale: 14 + Math.min(location.jobs.length, 6),
        fillColor: '#1c4e80',
        fillOpacity: 0.95,
        strokeColor: '#ffffff',
        strokeWeight: 2
      },
      label: {
        text: String(location.jobs.length),
        color: '#ffffff',
        fontSize: '12px',
        fontWeight: '700'
      }
    });

    marker.__location = location;

    marker.addListener('click', () => {
      if (!infoWindow) {
        return;
      }
      infoWindow.setContent(createPopupContent(location));
      infoWindow.open({ anchor: marker, map, shouldFocus: false });
    });

    state.markers.push(marker);
  });

  if (state.searchCenter) {
    if (locations.length === 1) {
      map.setCenter({ lat: locations[0].latitude, lng: locations[0].longitude });
      map.setZoom(Math.max(map.getZoom(), 15));
    } else {
      const bounds = new window.google.maps.LatLngBounds();
      locations.forEach((location) => {
        bounds.extend({ lat: location.latitude, lng: location.longitude });
      });
      map.fitBounds(bounds, 80);
    }
  }
}

function renderSearchArea() {
  if (!map || !window.google?.maps) {
    return;
  }

  if (state.searchOverlay) {
    state.searchOverlay.setMap(null);
    state.searchOverlay = null;
  }

  if (!state.searchCenter) {
    return;
  }

  const { lat, lng, radius } = state.searchCenter;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return;
  }

  const circle = new window.google.maps.Circle({
    map,
    center: { lat, lng },
    radius: milesToMeters(radius ?? 25),
    strokeColor: '#1c4e80',
    strokeOpacity: 0.85,
    strokeWeight: 1.5,
    fillColor: '#1c4e80',
    fillOpacity: 0.12
  });

  state.searchOverlay = circle;

  if (!state.jobs.length) {
    map.setCenter({ lat, lng });
    map.setZoom(12);
  }
}

function renderJobList() {
  jobListElement.innerHTML = '';
  state.jobs.forEach((job) => {
    const node = jobTemplate.content.firstElementChild.cloneNode(true);
    node.querySelector('.job-item__title').textContent = job.title;
    node.querySelector('.job-item__company').textContent = `${job.company} · ${job.address}`;
    node
      .querySelector('.job-item__address')
      .textContent = `${formatCityState(job.city, job.state)} ${job.postalCode ?? ''}`.trim();
    node.querySelector('.job-item__link').href = job.url;
    node.querySelector('.job-item__meta').textContent = `Job ID: ${job.id} · Updated ${formatDate(
      job.updatedAt ?? job.createdAt
    )}`;
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
  if (!map || !window.google?.maps) {
    return;
  }

  const latitude = Number(job.latitude);
  const longitude = Number(job.longitude);
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return;
  }

  map.panTo({ lat: latitude, lng: longitude });
  if (map.getZoom() < 15) {
    map.setZoom(15);
  }

  const marker = state.markers.find((candidate) =>
    candidate.__location?.jobs.some((entry) => entry.id === job.id)
  );

  if (marker && infoWindow) {
    infoWindow.setContent(createPopupContent(marker.__location));
    infoWindow.open({ anchor: marker, map, shouldFocus: false });
  }
}

async function geocodeAddress(address) {
  if (!window.google?.maps) {
    throw new Error('Map services are unavailable.');
  }

  try {
    const geocoder = new window.google.maps.Geocoder();
    const response = await geocoder.geocode({ address });
    if (!response.results.length) {
      return null;
    }
    const { lat, lng } = response.results[0].geometry.location.toJSON();
    return { lat, lng };
  } catch (error) {
    throw new Error(error?.message ?? 'Address lookup failed.');
  }
}

async function resolveSearchLocation(address) {
  if (lastSelectedPlace?.formatted_address === address && lastSelectedPlace?.geometry?.location) {
    const { lat, lng } = lastSelectedPlace.geometry.location.toJSON();
    return { lat, lng };
  }

  if (lastSelectedPlace?.name === address && lastSelectedPlace?.geometry?.location) {
    const { lat, lng } = lastSelectedPlace.geometry.location.toJSON();
    return { lat, lng };
  }

  return geocodeAddress(address);
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

function milesToMeters(miles) {
  return miles * 1609.344;
}

function showMapError(message) {
  if (!mapElement) {
    return;
  }
  mapElement.innerHTML = '';
  const node = document.createElement('div');
  node.className = 'map-error';
  node.textContent = message;
  mapElement.appendChild(node);
}
