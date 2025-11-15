const API_KEY = process.env.GOOGLE_MAPS_API_KEY ?? process.env.MAPS_API_KEY ?? '';

export async function geocodeAddress({ address, city, state, postalCode }) {
  const query = buildQuery(address, city, state, postalCode);
  if (!query) {
    throw new Error('An address is required to geocode a job.');
  }

  if (!API_KEY) {
    throw new Error('Google Maps API key is not configured on the server.');
  }

  const url = new URL('https://maps.googleapis.com/maps/api/geocode/json');
  url.searchParams.set('address', query);
  url.searchParams.set('key', API_KEY);

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error('Google Maps geocoding service is unavailable right now.');
  }

  const payload = await response.json();
  if (payload.status === 'ZERO_RESULTS') {
    return null;
  }

  if (payload.status !== 'OK' || !payload.results?.length) {
    const message = payload.error_message ?? payload.status ?? 'Unknown geocoding error';
    throw new Error(`Google geocoding failed: ${message}`);
  }

  const [firstResult] = payload.results;
  const { lat, lng } = firstResult.geometry.location;
  return {
    latitude: Number(lat),
    longitude: Number(lng),
    formattedAddress: firstResult.formatted_address
  };
}

export async function ensureJobCoordinates(job) {
  if (hasCoordinates(job)) {
    return {
      ...job,
      latitude: Number(job.latitude),
      longitude: Number(job.longitude)
    };
  }

  const geocoded = await geocodeAddress(job);
  if (!geocoded) {
    return null;
  }

  return {
    ...job,
    latitude: geocoded.latitude,
    longitude: geocoded.longitude,
    address: job.address ?? geocoded.formattedAddress
  };
}

function hasCoordinates(job) {
  return isFiniteNumber(job?.latitude) && isFiniteNumber(job?.longitude);
}

function buildQuery(address, city, state, postalCode) {
  const parts = [address, city, state, postalCode].map((value) => value?.toString().trim()).filter(Boolean);
  return parts.join(', ');
}

function isFiniteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number);
}
