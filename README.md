# LocalCareers

LocalCareers is a lightweight prototype that visualises open positions from nearby
businesses on top of an interactive map. The API aggregates listings from company
career pages (JSON feeds) and lets store managers post or remove openings directly.

## Features

- 📍 **Map-first interface** – A Leaflet map displays hiring locations with markers
  that show the number of available jobs. Click any location to see a popup with
  the current postings and quick links to apply.
- 🧭 **Radius filtering** – Enter a latitude, longitude, and radius (miles) to limit
  results to a custom area.
- 🏪 **Business portal** – Local businesses can publish new roles, remove filled
  positions, or ingest their public careers feed without leaving the map view.
- 🔄 **Import jobs from websites** – Point the importer at a JSON feed (array or
  `{ jobs: [...] }` response) and map custom field names; the server will deduplicate
  listings per source automatically.

## Project layout

```
LocalCareers/
├── README.md
├── server/
│   ├── data/jobs.json      # Persistent data store (seeded with sample Food Lion roles)
│   └── src/
│       ├── dataStore.js    # File-based persistence helpers
│       ├── importer.js     # Remote feed importer and field mapping
│       └── index.js        # HTTP API (no external dependencies required)
└── web/
    ├── index.html          # Map UI and business portal
    ├── style.css           # Styling for the interface
    └── app.js              # Client-side logic & Leaflet integration
```

## Getting started

### 1. Launch the API

The API relies solely on built-in Node.js modules. Make sure Node 18+ is installed
so that the native `fetch` implementation is available.

```bash
node server/src/index.js
```

The server listens on `http://localhost:4000` by default. Use the `PORT`
environment variable to bind to a different port.

### 2. Serve the web client

Any static file server works. Two easy options:

```bash
# Python
python3 -m http.server 5173 --directory web

# or Node
npx http-server web --port 5173
```

Then browse to `http://localhost:5173`. The `<body>` tag in `web/index.html` points
the client to `http://localhost:4000`, so adjust the `data-api-base` attribute if you
run the API elsewhere.

## API endpoints

| Method | Path            | Description                                                                           |
| ------ | --------------- | ------------------------------------------------------------------------------------- |
| GET    | `/health`       | Basic health check                                                                    |
| GET    | `/api/jobs`     | Returns `{ jobs: [...] }`. Optional query params: `lat`, `lng`, `radius` (miles).     |
| POST   | `/api/jobs`     | Creates a job. Required body fields: `title`, `company`, `address`, `latitude`, `longitude`, `url`. |
| DELETE | `/api/jobs/:id` | Removes a job by identifier.                                                          |
| POST   | `/api/import`   | Imports jobs from a JSON feed. Body: `{ source: { name, url, fieldMap?, defaults? } }` |
| GET    | `/api/sources`  | Lists import sources with timestamps.                                                 |

### Importer tips

The importer expects a JSON array or an object with a `jobs` (or `data`) array.
Use `fieldMap` to translate remote field names. Nested values use dot notation:

```json
{
  "source": {
    "name": "Food Lion Careers",
    "url": "https://example.com/feed.json",
    "fieldMap": {
      "title": "positionTitle",
      "latitude": "coordinates.lat",
      "longitude": "coordinates.lng"
    },
    "defaults": {
      "company": "Food Lion",
      "city": "Sanford",
      "state": "NC"
    }
  }
}
```

Listings are deduplicated by `company + title + address` per source on each import.

## Data persistence

Jobs are stored inside `server/data/jobs.json`. The file ships with two sample
openings so the interface loads meaningful data immediately. The API updates the
file atomically with each create, import, or delete call, making it suitable for
lightweight deployments on single-instance hosts.

## Roadmap ideas

- Integrate a background scheduler to re-import feeds on an interval.
- Add geocoding helpers so businesses can enter only an address.
- Support authentication or API keys for the business portal actions.
- Extend the importer to parse RSS/Atom feeds in addition to JSON payloads.
