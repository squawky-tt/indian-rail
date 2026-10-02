# Indian Railways NTES API & Data Extractor 🚆

This repository contains an end-to-end pipeline for converting the official Indian Railways "Trains at a Glance" (TAG) PDF timetables into a highly structured relational database, and serving that data through a modern, AI-agent-friendly (MCP compatible) REST API.

## Project Phases

### 1. Data Extraction Pipeline (`/`)
The root directory contains robust Python scripts designed to parse incredibly complex, multi-column, border-less PDF tables using spatial bounding boxes and sequential word-stream parsing.
* `download_helpers.py` & `download_pdfs.py`: Scrapes and downloads all necessary helper indexes and 97 timetable PDFs.
* `extract_and_test_master.py`: Parses the Station Code Index and Train Number Index PDFs to build the foundational `Stations` and `Trains` tables.
* `extract_all_schedules.py`: Iterates through all 97 timetable PDFs to build a massive `TrainSchedules` table containing exact arrival/departure times and route sequencing for over 3,600 trains.
* Output: `tag_production_dump.sql` (a massive SQLite database dump).

### 2. The API Server (`/api`)
The API directory contains a modern TypeScript backend built on **Hono.js** and **Cloudflare Workers**. It natively reads the SQLite data using **Cloudflare D1**.
* **OpenAPI Powered**: Built with `@hono/zod-openapi`, the API is fully strongly-typed and automatically generates a `swagger.json`.
* **Agentic / MCP Compatible**: Because it exposes an OpenAPI 3.0 specification, modern AI Agents can natively ingest the `/openapi.json` endpoint and utilize the API as a set of tools (identical to the Model Context Protocol).
* **Interactive UI**: The root endpoint `/` serves a gorgeous Swagger UI dashboard for manual API testing.

## AI Agent Integration (MCP & OpenAPI)

Because this backend emits a standard OpenAPI schema, it functions identically to an MCP (Model Context Protocol) server. Here is how you can plug this train database directly into popular AI agents:

### 1. Claude Desktop & AGY (Native MCP)
You can instantly convert this OpenAPI server into an MCP server using the official OpenAPI MCP proxy wrapper.
1. Open your `mcp.json` or `claude_desktop_config.json`.
2. Add the following to your `mcpServers` object:
```json
"indian-railways": {
  "command": "npx",
  "args": [
    "-y",
    "mcp-openapi-runner",
    "https://train.siv19.dev/openapi.json"
  ]
}
```
3. Restart your agent. It will now automatically have tools like `getTrainRoute` and `getLiveStationRoute`.

### 2. ChatGPT (Custom Actions)
1. Create a **Custom GPT**.
2. Scroll down and click **Create new action**.
3. Under "Schema", select **Import from URL** and paste `https://train.siv19.dev/openapi.json`.
4. ChatGPT will instantly recognize all the endpoints and use them to answer live train questions.

### 3. Google Gemini API (Function Calling)
Google AI Studio recently updated its UI and migrated away from the legacy "Extensions" menu. To use this API with Gemini today, you use **Function Calling**:
1. Open **Google AI Studio** and go to the **Playground**.
2. On the right-hand panel, click **Tools** -> **Add Function**.
3. You can paste the exact JSON parameters from our `openapi.json` into the Function Declaration.
4. When you ask Gemini a question, it will output a structured API call that perfectly matches our Cloudflare backend!
(If you are coding a custom app with the `@google/genai` SDK, you simply pass these OpenAPI schemas into the `tools: [{ functionDeclarations: [...] }]` array).

---

## Hosting Costs (100% Free)

This architecture was specifically engineered to operate entirely on **Cloudflare's Free Tier** (no credit card required). By utilizing serverless compute and serverless SQLite, you avoid the 24/7 idle costs of traditional AWS RDS or EC2 instances.

* **Compute (Cloudflare Workers)**: Free up to **100,000 requests per day**. (Zero cold starts, edge-deployed globally).
* **Database (Cloudflare D1)**: Free up to **5,000,000 read queries per month** and 100,000 write queries per month. Since train schedules are read-heavy, this is virtually unlimited for standard usage.
* **Storage**: D1 allows up to 5GB of storage on the free tier. Our massive Indian Railways SQLite database is roughly ~5MB, utilizing 0.1% of the free quota.

---

## Local Development

### 1. Python Extraction (Optional)
If you want to re-run the extraction:
```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt # (pdfplumber, pandas, etc)
python extract_and_test_master.py
python extract_all_schedules.py
```

### 2. Run the API Locally
First, populate your local Cloudflare D1 environment with the extracted data:
```bash
cd api
npm install
npx wrangler d1 execute indian-rail-db --local --file=../tag_production_dump_clean.sql
```
Then, start the dev server:
```bash
npm run dev
```
Visit `http://localhost:8787` to see the Swagger UI.

---

## Cloudflare Deployment

Deploying to the edge globally takes 3 commands:
```bash
cd api

# 1. Provision the D1 Database in the cloud
npx wrangler d1 create indian-rail-db

# 2. Upload your local SQL dump to the production database
npx wrangler d1 execute indian-rail-db --file=../tag_production_dump_clean.sql

# 3. Deploy the API to Cloudflare Workers
npm run deploy
```

*(Note: If you have configured the `CLOUDFLARE_API_TOKEN` in your GitHub repository secrets, pushing to the `main` branch will automatically deploy the API via GitHub Actions!)*
