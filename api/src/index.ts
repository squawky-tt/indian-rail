import { OpenAPIHono, createRoute, z } from '@hono/zod-openapi'
import { swaggerUI } from '@hono/swagger-ui'
import { bearerAuth } from 'hono/bearer-auth'
import { html } from 'hono/html'

type Bindings = {
  DB: D1Database
}

const app = new OpenAPIHono<{ Bindings: Bindings }>()

// --- Zod Schemas for OpenAPI Validation & Types ---

const TrainSchema = z.object({
  train_number: z.string().openapi({ example: '12951' }),
  train_name: z.string().openapi({ example: 'Mumbai Rajdhani' }),
})

const RouteStopSchema = z.object({
  arrival_time: z.string().nullable().openapi({ example: '08:32' }),
  departure_time: z.string().nullable().openapi({ example: '08:35' }),
  stop_sequence: z.number().openapi({ example: 1 }),
  station_code: z.string().openapi({ example: 'NDLS' }),
  station_name: z.string().openapi({ example: 'New Delhi' }),
})

const LiveTrainSchema = z.object({
  train_number: z.string().openapi({ example: '12951' }),
  train_name: z.string().openapi({ example: 'Mumbai Rajdhani' }),
  arrival_time: z.string().nullable().openapi({ example: '08:32' }),
  departure_time: z.string().nullable().openapi({ example: '08:35' }),
})

const SearchStationSchema = z.object({
  station_code: z.string().openapi({ example: 'NDLS' }),
  station_name: z.string().openapi({ example: 'New Delhi' }),
})

// --- OpenAPI Security Component ---
app.openAPIRegistry.registerComponent('securitySchemes', 'Bearer', {
  type: 'http',
  scheme: 'bearer',
  description: 'Enter any dummy token to satisfy Claude Web (e.g. train-key-123)',
})

// --- Middleware ---

// Track API Stats (Non-blocking)
app.use('/api/*', async (c, next) => {
  await next()
  const endpoint = c.req.routePath || c.req.path
  
  // Track hits only for actual api routes, excluding docs
  if (!endpoint.includes('/api/docs')) {
    c.executionCtx.waitUntil(
      c.env.DB.prepare(`
        INSERT INTO APIStats (endpoint, hit_count) VALUES (?, 1)
        ON CONFLICT(endpoint) DO UPDATE SET hit_count = hit_count + 1
      `).bind(endpoint).run().catch(() => {})
    )
  }
})

// Require dummy token for all /api/* routes EXCEPT /api/docs
app.use('/api/*', async (c, next) => {
  if (c.req.path === '/api/docs') {
    return next()
  }
  const auth = bearerAuth({ token: 'train-key-123' })
  return auth(c, next)
})


// --- Routes Definition ---

const getTrainRoute = createRoute({
  method: 'get',
  path: '/api/trains/{number}',
  summary: 'Get train details',
  description: 'Fetches the details of a specific Indian Railways train by its 5-digit number.',
  security: [{ Bearer: [] }],
  request: {
    params: z.object({
      number: z.string().min(5).max(5).openapi({ example: '12951' })
    })
  },
  responses: {
    200: {
      content: { 'application/json': { schema: z.object({ train: TrainSchema }) } },
      description: 'Train found'
    },
    404: {
      content: { 'application/json': { schema: z.object({ error: z.string() }) } },
      description: 'Train not found'
    }
  }
})

const getTrainScheduleRoute = createRoute({
  method: 'get',
  path: '/api/trains/{number}/route',
  summary: 'Get full train route and schedule',
  description: 'Fetches the entire chronological route, stops, and schedule for a specific train.',
  security: [{ Bearer: [] }],
  request: {
    params: z.object({
      number: z.string().min(5).max(5).openapi({ example: '12951' })
    })
  },
  responses: {
    200: {
      content: { 'application/json': { schema: z.object({ route: z.array(RouteStopSchema) }) } },
      description: 'Successful route retrieval'
    }
  }
})

const getLiveStationRoute = createRoute({
  method: 'get',
  path: '/api/stations/{code}/live',
  summary: 'Get live station departures',
  description: 'Acts as a live departure board, fetching all trains passing through a specific station code.',
  security: [{ Bearer: [] }],
  request: {
    params: z.object({
      code: z.string().openapi({ example: 'NDLS' })
    })
  },
  responses: {
    200: {
      content: { 'application/json': { schema: z.object({ station: z.string(), trains: z.array(LiveTrainSchema) }) } },
      description: 'Successful station board retrieval'
    }
  }
})

const searchTrainsRoute = createRoute({
  method: 'get',
  path: '/api/search/trains',
  summary: 'Search trains by name',
  description: 'Search for a train by its name using a natural language query.',
  security: [{ Bearer: [] }],
  request: {
    query: z.object({ query: z.string().openapi({ example: 'Rajdhani' }) })
  },
  responses: {
    200: {
      content: { 'application/json': { schema: z.object({ trains: z.array(TrainSchema) }) } },
      description: 'Search results'
    }
  }
})

const searchStationsRoute = createRoute({
  method: 'get',
  path: '/api/search/stations',
  summary: 'Search stations by name',
  description: 'Search for a station by its city or name to find its station code.',
  security: [{ Bearer: [] }],
  request: {
    query: z.object({ query: z.string().openapi({ example: 'Delhi' }) })
  },
  responses: {
    200: {
      content: { 'application/json': { schema: z.object({ stations: z.array(SearchStationSchema) }) } },
      description: 'Search results'
    }
  }
})

const getTrainsBetweenStationsRoute = createRoute({
  method: 'get',
  path: '/api/routes',
  summary: 'Find trains between two stations',
  description: 'Find all trains running between two specific station codes.',
  security: [{ Bearer: [] }],
  request: {
    query: z.object({ 
      from: z.string().openapi({ example: 'NDLS' }),
      to: z.string().openapi({ example: 'BCT' })
    })
  },
  responses: {
    200: {
      content: { 'application/json': { schema: z.object({ trains: z.array(TrainSchema) }) } },
      description: 'Trains found'
    }
  }
})

// --- Handlers ---

app.openapi(getTrainRoute, async (c) => {
  const { number } = c.req.valid('param')
  const { results } = await c.env.DB.prepare('SELECT * FROM Trains WHERE train_number = ?').bind(number).all()
  if (results.length === 0) return c.json({ error: 'Train not found' }, 404)
  return c.json({ train: results[0] as z.infer<typeof TrainSchema> }, 200)
})

app.openapi(getTrainScheduleRoute, async (c) => {
  const { number } = c.req.valid('param')
  const { results } = await c.env.DB.prepare(`
    SELECT t.arrival_time, t.departure_time, t.stop_sequence, s.station_code, s.station_name
    FROM TrainSchedules t 
    JOIN Stations s ON t.station_code = s.station_code 
    WHERE t.train_number = ? 
    ORDER BY t.stop_sequence ASC
  `).bind(number).all()
  return c.json({ route: results as z.infer<typeof RouteStopSchema>[] }, 200)
})

app.openapi(getLiveStationRoute, async (c) => {
  const code = c.req.valid('param').code.toUpperCase()
  const { results } = await c.env.DB.prepare(`
    SELECT t.train_number, tr.train_name, t.arrival_time, t.departure_time 
    FROM TrainSchedules t 
    JOIN Trains tr ON t.train_number = tr.train_number 
    WHERE t.station_code = ? 
    ORDER BY t.arrival_time ASC
  `).bind(code).all()
  return c.json({ station: code, trains: results as z.infer<typeof LiveTrainSchema>[] }, 200)
})

app.openapi(searchTrainsRoute, async (c) => {
  const { query } = c.req.valid('query')
  const { results } = await c.env.DB.prepare('SELECT * FROM Trains WHERE train_name LIKE ?').bind(`%${query}%`).all()
  return c.json({ trains: results as z.infer<typeof TrainSchema>[] }, 200)
})

app.openapi(searchStationsRoute, async (c) => {
  const { query } = c.req.valid('query')
  const { results } = await c.env.DB.prepare('SELECT station_code, station_name FROM Stations WHERE station_name LIKE ?').bind(`%${query}%`).all()
  return c.json({ stations: results as z.infer<typeof SearchStationSchema>[] }, 200)
})

app.openapi(getTrainsBetweenStationsRoute, async (c) => {
  const { from, to } = c.req.valid('query')
  const { results } = await c.env.DB.prepare(`
    SELECT t1.train_number, tr.train_name 
    FROM TrainSchedules t1 
    JOIN TrainSchedules t2 ON t1.train_number = t2.train_number 
    JOIN Trains tr ON t1.train_number = tr.train_number 
    WHERE t1.station_code = ? AND t2.station_code = ? AND t1.stop_sequence < t2.stop_sequence
  `).bind(from.toUpperCase(), to.toUpperCase()).all()
  return c.json({ trains: results as z.infer<typeof TrainSchema>[] }, 200)
})

// --- OpenAPI & UI Setup ---

app.doc('/openapi.json', {
  openapi: '3.0.0',
  info: {
    version: '1.0.0',
    title: 'Indian Railways NTES API (MCP Compatible)',
    description: 'An API to query trains, routes, and live station boards. Fully compatible as an MCP Server.',
  },
})

// Move Swagger UI to /api/docs
app.get('/api/docs', swaggerUI({ url: '/openapi.json' }))

// --- Aesthetic Homepage ---
app.get('/', (c) => {
  return c.html(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>Indian Railways API</title>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800&display=swap" rel="stylesheet">
      <style>
        :root {
          --bg: #0f172a;
          --card-bg: rgba(30, 41, 59, 0.7);
          --text: #f8fafc;
          --accent: #3b82f6;
          --accent-hover: #2563eb;
        }
        body {
          margin: 0; font-family: 'Inter', system-ui, sans-serif;
          background: linear-gradient(135deg, #020617, #0f172a, #1e293b);
          color: var(--text); min-height: 100vh;
          display: flex; flex-direction: column; align-items: center; justify-content: center;
        }
        .container {
          max-width: 800px; padding: 3rem 2rem; text-align: center;
          background: var(--card-bg); backdrop-filter: blur(16px);
          border-radius: 1.5rem; border: 1px solid rgba(255, 255, 255, 0.05);
          box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
          animation: fadeIn 1s ease-out;
          margin: 1rem;
        }
        h1 {
          font-size: 3.5rem; margin-top: 0; margin-bottom: 1rem; font-weight: 800;
          background: linear-gradient(to right, #60a5fa, #3b82f6, #93c5fd);
          -webkit-background-clip: text; -webkit-text-fill-color: transparent;
        }
        p { font-size: 1.2rem; color: #cbd5e1; margin-bottom: 2.5rem; line-height: 1.6; }
        .btn-group { display: flex; gap: 1rem; justify-content: center; flex-wrap: wrap; }
        .btn {
          padding: 1rem 2rem; border-radius: 0.75rem; text-decoration: none;
          font-weight: 600; font-size: 1.1rem; transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
          border: none; cursor: pointer; display: inline-flex; align-items: center; gap: 0.5rem;
        }
        .btn-primary {
          background: var(--accent); color: white;
          box-shadow: 0 4px 14px 0 rgba(59, 130, 246, 0.39);
        }
        .btn-primary:hover {
          background: var(--accent-hover); transform: translateY(-3px);
          box-shadow: 0 6px 20px rgba(59, 130, 246, 0.4);
        }
        .btn-secondary {
          background: rgba(255, 255, 255, 0.05); color: white;
          border: 1px solid rgba(255, 255, 255, 0.1);
        }
        .btn-secondary:hover {
          background: rgba(255, 255, 255, 0.1); transform: translateY(-3px);
          border-color: rgba(255, 255, 255, 0.2);
        }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(20px); } to { opacity: 1; transform: translateY(0); } }
        
        .endpoints {
          margin-top: 3rem; text-align: left; background: rgba(0,0,0,0.2);
          padding: 1.5rem; border-radius: 1rem; font-size: 0.9rem;
        }
        .endpoints h3 { margin-top: 0; color: #94a3b8; font-size: 1rem; text-transform: uppercase; letter-spacing: 1px; }
        .endpoint { display: flex; align-items: center; gap: 1rem; margin-bottom: 0.5rem; padding: 0.5rem; border-radius: 0.5rem; transition: background 0.2s; }
        .endpoint:hover { background: rgba(255,255,255,0.05); }
        .method { background: #10b981; color: #022c22; padding: 0.2rem 0.5rem; border-radius: 0.25rem; font-weight: 800; font-size: 0.75rem; }
        .path { font-family: monospace; color: #cbd5e1; }
      </style>
    </head>
    <body>
      <div class="container">
        <h1>Indian Railways API</h1>
        <p>A lightning-fast, modern API for Indian Railways data.<br/>AI-agent compatible with advanced search capabilities for trains, stations, and routes.</p>
        <div class="btn-group">
          <a href="/api/docs" class="btn btn-primary">
            <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 6.253v13m0-13C10.832 5.477 9.246 5 7.5 5S4.168 5.477 3 6.253v13C4.168 18.477 5.754 18 7.5 18s3.332.477 4.5 1.253m0-13C13.168 5.477 14.754 5 16.5 5c1.747 0 3.332.477 4.5 1.253v13C19.832 18.477 18.247 18 16.5 18c-1.746 0-3.332.477-4.5 1.253"></path></svg>
            API Documentation
          </a>
          <a href="/stats" class="btn btn-secondary">
            <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"></path></svg>
            View Live Stats
          </a>
        </div>
        
        <div class="endpoints">
          <h3>Available Endpoints</h3>
          <div class="endpoint"><span class="method">GET</span><span class="path">/api/trains/{number}</span></div>
          <div class="endpoint"><span class="method">GET</span><span class="path">/api/trains/{number}/route</span></div>
          <div class="endpoint"><span class="method">GET</span><span class="path">/api/search/trains?query={name}</span></div>
          <div class="endpoint"><span class="method">GET</span><span class="path">/api/search/stations?query={name}</span></div>
          <div class="endpoint"><span class="method">GET</span><span class="path">/api/routes?from={code}&to={code}</span></div>
        </div>
      </div>
    </body>
    </html>
  `)
})

// --- Stats Dashboard ---
app.get('/stats', async (c) => {
  let results: any[] = []
  try {
    const res = await c.env.DB.prepare('SELECT * FROM APIStats ORDER BY hit_count DESC').all()
    results = res.results
  } catch (e) {
    // If table doesn't exist yet, it's fine
  }
  
  return c.html(`
    <!DOCTYPE html>
    <html lang="en">
    <head>
      <meta charset="UTF-8">
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <title>API Stats Dashboard</title>
      <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800&display=swap" rel="stylesheet">
      <style>
        body { 
          font-family: 'Inter', system-ui, sans-serif; 
          background: linear-gradient(135deg, #020617, #0f172a); 
          color: #f8fafc; padding: 2rem; margin: 0; min-height: 100vh;
        }
        .container { 
          max-width: 900px; margin: 0 auto; 
          background: rgba(30, 41, 59, 0.7); padding: 3rem; 
          border-radius: 1.5rem; border: 1px solid rgba(255,255,255,0.05); 
          backdrop-filter: blur(16px);
          box-shadow: 0 25px 50px -12px rgba(0, 0, 0, 0.5);
        }
        .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 2rem; }
        h1 { margin: 0; font-size: 2.5rem; font-weight: 800; background: linear-gradient(to right, #60a5fa, #3b82f6); -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
        .back-link { 
          color: #94a3b8; text-decoration: none; font-weight: 600; 
          display: inline-flex; align-items: center; gap: 0.5rem; transition: color 0.2s;
        }
        .back-link:hover { color: #f8fafc; }
        table { width: 100%; border-collapse: collapse; background: rgba(0,0,0,0.2); border-radius: 1rem; overflow: hidden; }
        th, td { padding: 1.2rem 1.5rem; text-align: left; }
        th { background: rgba(0,0,0,0.4); font-weight: 600; color: #94a3b8; text-transform: uppercase; font-size: 0.85rem; letter-spacing: 1px; }
        tr { border-bottom: 1px solid rgba(255,255,255,0.05); }
        tr:last-child { border-bottom: none; }
        tr:hover td { background: rgba(255,255,255,0.05); }
        .endpoint-path { font-family: monospace; color: #60a5fa; font-size: 1.1rem; }
        .hit-badge { background: #3b82f6; color: white; padding: 0.2rem 0.8rem; border-radius: 2rem; font-weight: 800; font-size: 0.9rem; }
        .empty-state { text-align: center; padding: 3rem; color: #94a3b8; font-size: 1.1rem; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>📊 API Usage Stats</h1>
          <a href="/" class="back-link">
            <svg width="20" height="20" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 19l-7-7m0 0l7-7m-7 7h18"></path></svg>
            Back to Home
          </a>
        </div>
        
        ${results.length === 0 ? '<div class="empty-state">No API hits recorded yet.</div>' : ''}
        
        ${results.length > 0 ? `
        <table>
          <thead><tr><th>Endpoint Path</th><th>Total Hits</th></tr></thead>
          <tbody>
            ${results.map(row => `
              <tr>
                <td class="endpoint-path">${row.endpoint}</td>
                <td><span class="hit-badge">${row.hit_count}</span></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
        ` : ''}
      </div>
    </body>
    </html>
  `)
})

export default app
