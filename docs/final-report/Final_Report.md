---
title: "TANGO Financial Event Intelligence Platform"
subtitle: "SENG3011 Sprint 3 Final Design Report"
author:
  - "Team Tango"
date: "2026-04-24"
toc: true
numbersections: true
---

# Executive Summary

TANGO is a full-stack financial event intelligence product that converts raw market data into structured ADAGE 3.0 event datasets, enabling interactive exploration, charting, export, and predictive volatility-risk insights in a single application.

Unlike typical finance APIs that provide only raw OHLC (Open, High, Low, Close) data, TANGO operationalises the pipeline from ingestion to higher-order event intelligence. Users can create datasets for specific tickers and date ranges, automatically generate deterministic derived events (e.g., jumps, drops, volatility spikes, trend crossovers), visualise candlestick charts, compute event statistics, export datasets, and run a predictive volatility-spike risk model enhanced by cross-domain external signals.

The system is built as a microservices-based backend deployed behind a single API Gateway, paired with a Next.js frontend that provides an accessible and polished user experience. CI/CD and automated reporting (combined lint + coverage summaries) are designed to improve vitality: maintainability, reliability, and confidence in change.

# 1. Business Documentation

## 1.1 Business Case

### 1.1.1 Product Overview

The TANGO Financial Event Intelligence Platform is a full-stack application that transforms raw financial market data into structured, actionable insights. Traditional financial APIs provide access to raw OHLC data, but they require significant preprocessing and technical expertise to extract meaningful patterns. This creates a barrier for users who need rapid, data-driven decision-making.

TANGO addresses this by providing an integrated system that collects and standardises financial data into ADAGE 3.0 datasets, then generates higher-level signals including deterministic derived events (trend and volatility indicators) and predictive risk signals. Outputs are delivered through an intuitive frontend interface for interactive exploration and decision support.

A key innovation is the Volatility Spike Prediction Microservice, extending the platform from descriptive analytics to predictive intelligence. By integrating external signals from collaborating APIs (Mango API for macroeconomic time series, GridX for electricity grid shock signals), the model incorporates cross-domain factors that can influence market volatility.

### 1.1.2 Problem Statement

Despite the abundance of financial data, extracting meaningful insights remains complex and resource-intensive:

- Raw financial data is unstructured and lacks interpretability.
- Developers repeatedly re-implement core analytics (volatility, trend indicators, derived signals).
- Existing workflows are often reactive (historical inspection) rather than predictive.
- Cross-domain signals (macroeconomic and infrastructure shocks) are difficult to integrate.

### 1.1.3 Solution

TANGO provides an end-to-end solution:

- Converts raw financial data into standardised ADAGE 3.0 event datasets.
- Stores datasets for efficient retrieval and reuse.
- Provides real-time visualisation through an interactive dashboard.
- Adds predictive analytics via a volatility spike risk model.
- Integrates external APIs to enrich decision-making beyond market time series alone.

### 1.1.4 Business Value

- Time efficiency: eliminates repetitive preprocessing and metric recomputation.
- Improved decision-making: predictive risk scores enable proactive mitigation strategies.
- Cross-domain intelligence: Mango and GridX signals add explanatory power and richer drivers.
- Accessibility: frontend reduces dependence on deep engineering expertise.
- Scalability and reusability: microservices and shared dataset model support extension.

### 1.1.5 Target Users

- Financial analysts and portfolio managers
- Retail investors seeking data-driven insights
- Fintech developers building analytics workflows
- Research teams developing predictive models

## 1.2 Use Cases / User Stories

### UC1: Dataset Creation and Financial Event Analysis

User story: As a financial analyst, I want to create and populate a dataset of stock data so that I can analyse trends and identify significant financial events.

Success criteria:

- User creates a named dataset.
- User adds tickers, exchange, and date range and ingests OHLC events.
- System generates derived events and stores the dataset for later retrieval.

### UC2: Interactive Visualisation of Financial Trends

User story: As a user, I want to visualise stock data and trends so that I can quickly understand market behaviour without manual analysis.

Success criteria:

- User selects a dataset and views charts and event summaries in the UI.
- Chart rendering is stable and fast enough for demonstration.

### UC3: Predicting Volatility Spikes

User story: As a portfolio manager, I want to predict potential volatility spikes so that I can mitigate risk and optimise investment strategies.

Success criteria:

- User trains a model on a dataset and runs predictions.
- Results include risk levels and top drivers, and optionally incorporate macro and grid signals.

### UC4: Cross-Domain Data Integration for Risk Analysis

User story: As an analyst, I want to incorporate external economic and infrastructure data into financial analysis so that I can better understand market drivers.

Success criteria:

- System fetches Mango macro series and GridX shock data and uses them in predictive outputs.

### UC5: Dataset Retrieval and Export

User story: As a developer, I want to retrieve and export processed datasets so that I can use them in downstream applications or models.

Success criteria:

- User exports CSV and/or retrieves event subsets and statistics by filter.

# 2. Technical Documentation

## 2.1 System Architecture (SC4/C4-style)

![System Architecture Diagram](assets/architecture.png)

### 2.1.1 Component Overview

Frontend (Next.js):

- Next.js + shadcn/ui.
- Uses internal Next.js route handlers under `app/api/*` to call upstream services.
- Stores auth tokens in HTTP-only cookies.

Backend (combined API Gateway + Lambdas):

- Single HTTP API Gateway exposes routes:
  - `/auth/{proxy+}` (Auth)
  - `/datasets*` (Collection + Retrieval)
  - `/charts` (Visualisation)
  - `/predict/*` (Predictive)
  - `/docs` and `/status` (Docs and health)
- Microservices are implemented as Lambdas:
  - `auth`, `collection`, `retrieval`, `visualisation`, `predictive`, plus `docs` and `e2e-runner`.

Authentication:

- AWS Cognito user pool + client.
- JWT verification enforced for non-auth routes.

Data storage:

- DynamoDB stores dataset metadata keyed by user + dataset id.
- S3 stores ADAGE dataset JSON documents at `datasets/<userId>/<datasetId>.json`.
- Predictive models are stored under the same bucket (e.g., `models/...`) to support reuse.

Deployment targets:

- LocalStack for local parity testing (CDK deploy against a LocalStack container).
- AWS dev deployment on pushes to `main`.
- Optional AWS production deployment for manual runs.

## 2.2 Sequence Diagrams (Mapped to Use Cases)

### 2.2.1 UC1: Create Dataset + Ingest OHLC + Derived Events

![Sequence Diagram: Dataset ingestion](assets/seq_uc1_dataset_ingest.png)

Narrative:

1. User signs in and creates a dataset via `POST /datasets`.
2. User ingests events via `PUT /datasets/{datasetId}/events` with tickers, exchange, and date range.
3. Collection service fetches OHLC from Yahoo Finance and maps results into ADAGE `stock_ohlc` events.
4. Collection derives additional deterministic events:
   - `price_jump`, `price_drop`
   - `volatility_spike`
   - `trend_crossover`
5. Dataset is persisted to S3 (full ADAGE JSON) and metadata updated in DynamoDB.

Failure modes:

- Invalid parameters -> 400
- Dataset not found -> 404
- Upstream Yahoo Finance failure -> request fails (strict mode)

### 2.2.2 UC2: Retrieve Dataset + Stats + Export + Chart

![Sequence Diagram: Retrieval and visualisation](assets/seq_uc2_visualise.png)

Narrative:

- Retrieval service supports:
  - `GET /datasets` (metadata list)
  - `GET /datasets/{datasetId}` (metadata + sample events)
  - `GET /datasets/{datasetId}/events` (filtered events)
  - `GET /datasets/{datasetId}/events/stats` (event type counts)
  - `GET /datasets/{datasetId}/export` (CSV export)
- Visualisation service supports:
  - `GET /charts` returns a PNG candlestick chart for OHLC events stored in S3.

### 2.2.3 UC3 and UC4: Train Model + Predict + Mango/GridX

![Sequence Diagram: Predictive workflow](assets/seq_uc3_predict.png)

Narrative:

1. User trains a predictive model: `POST /predict/models/train`.
2. Predictive service reads the dataset from S3, computes feature vectors, fits a logistic regression model, and stores it to S3.
3. User runs prediction: `POST /predict/run`.
4. Service loads stored model, computes probabilities per symbol, and returns ranked predictions with:
   - `p_spike_7d`
   - `risk_level` buckets
   - top driver contributions
5. If enabled, macro series from Mango and grid shock overlay from GridX are incorporated.

Failure modes:

- Not enough training rows -> 400 with guidance
- Dataset/model not found -> 404
- Mango/GridX unavailable -> prediction proceeds but marks drivers accordingly

## 2.3 Other Models (Required)

### 2.3.1 UI Model (Wireframes / Annotated Screenshots)

![UI overview](assets/ui_overview.png)

Include annotated screenshots for:

- Login and signup (auth)
- Dataset list + create flow
- Dataset detail: ingestion, stats, chart, export
- Predictive panel: train + run + results table

### 2.3.2 Data Model

![Data model](assets/data_model.png)

DynamoDB (metadata):

- PK: `USER#<userId>`
- SK: `DATASET#<datasetId>`
- Stores: name, description, filters, `time_object`, etc.

S3 (datasets and models):

- Dataset JSON: `datasets/<userId>/<datasetId>.json` (ADAGE `AdageData`)
- Predictive models: stored under the bucket (e.g., `models/<userId>/<modelId>.json`)

### 2.3.3 Deployment Model

![Deployment model](assets/deployment.png)

Show:

- LocalStack deploy (docker compose + CDK local)
- AWS dev deploy (GitHub Actions)
- Optional prod deploy (manual)

## 2.4 APIs Used (Collaboration + External)

| API / Service | Provider / Team | Usage |
| --- | --- | --- |
| Yahoo Finance Chart API | External | Source of daily OHLC time series during dataset ingestion |
| Mango API (AMI API) | Mango | Macroeconomic series (CPI/unemployment) used in predictive features/summaries |
| GridX | F14A Delta | Electricity price shock signal used as overlay risk driver |
| TANGO Combined HTTP API | Team Tango | Single API Gateway exposing auth/datasets/charts/predict endpoints |
| AWS Cognito | AWS | User auth and token issuance |
| AWS S3 | AWS | Dataset and model storage |
| AWS DynamoDB | AWS | Dataset metadata index |
| AWS Lambda + API Gateway | AWS | Serverless execution + routing |

## 2.5 Testing Strategy (Updated)

### 2.5.1 Unit Tests (Backend)

- Jest per microservice (`auth`, `collection`, `retrieval`, `visualisation`, `predictive`, `e2e-runner`).
- Unit tests mock external dependencies (AWS SDK and cross-service calls) to verify behavior in isolation.
- Coverage artifacts are produced per service and aggregated into a combined CI report.

### 2.5.2 Integration Tests (HTTP Contract)

- Postman collections stored in `integration-tests/*.collection.json`.
- Run locally via Newman against the LocalStack-deployed API Gateway.
- A deployed Lambda "E2E runner" bundles Newman and can run all collections in one invocation after deploy.

### 2.5.3 Frontend E2E (Backend-Free)

- Playwright tests mock all `/api/*` calls so they pass even if the backend is unavailable.
- CI enforces a "never call real upstream" policy via a dead `TANGO_API_BASE_URL` during Playwright runs.

### 2.5.4 What We Do Not Test (And Why)

- Pixel-perfect chart rendering is not asserted; tests focus on valid PNG output and functional endpoints to keep CI stable and fast.
- External API availability (Yahoo/Mango/GridX) is treated as an integration risk; failure modes are handled and surfaced.

## 2.6 DevOps Environment and Settings

### 2.6.1 CI Pipelines

Backend (`seng3011-tango-apis`):

- Lint matrix + test matrix across all services.
- Coverage and lint artifacts are aggregated into combined outputs for fast verification.

Frontend (`seng3011-frontend`):

- CI gates: Prettier check, ESLint, typecheck, build, then Playwright mocked suite.

### 2.6.2 CDK Deploy + Environments

- Automated deploy to AWS dev on pushes to `main`.
- Optional production deploy only via manual workflow dispatch.
- Dev deploy invokes the E2E runner Lambda and fails if collections fail.

### 2.6.3 Local Parity (LocalStack)

- LocalStack deploy uses docker compose + CDK local deployment script.
- Frontend syncs env from backend `.localstack-api.env` into `.env.local` for the correct API base URL.

### 2.6.4 Vitality Initiative (Explicit)

TANGO's vitality improvements focus on reliability and maintainability:

- Combined CI report artifact enables fast diagnosis (coverage + lint in one report).
- LocalStack CDK parity reduces "works on my machine" deployment drift.
- Mocked frontend Playwright tests make UI regression tests stable and backend-independent.
- Deployed E2E runner Lambda enforces integration correctness post-deploy.

# 3. Management Documentation

## 3.1 Team Tango

### 3.1.1 Team Roles and Responsibilities

| Team Member(s) | Role | Responsibilities |
| --- | --- | --- |
| Ahmed El-Sayed | Team Lead | Scrum facilitation, stakeholder communication, blocker management, review coordination |
| Aleksei Radchenkov | Delivery Manager | Jira board management, sprint planning, requirements to tickets, progress tracking |
| Kai Sequeira & Shreya Verma | Engineering Managers | Technical standards, architecture decisions, review/testing/deployment strategy |
| Will Anderson | Product Owner | Product vision, user stories, scope control, acceptance criteria |

### 3.1.2 Role Allocation and Working Model

Describe the team communication rhythm (planning, standups, retro), how review was handled, and how responsibilities were adapted during the term.

## 3.2 Challenges Encountered and Mitigations

- Scheduling and synchronous meeting difficulty: mitigation (asynchronous notes, clearer ownership, smaller tasks).
- Integration complexity (LocalStack/AWS parity, env drift): mitigation (CDK outputs + env sync scripts).
- Ensuring assessable quality evidence: mitigation (combined CI report + deployed E2E runner).

## 3.3 Project Reflection

Provide an honest reflection on what improved, what remained difficult, and what you would do differently (technical and teamwork).

## 3.4 SENG3011 Improvements

List 3-5 actionable suggestions, for example:

- Offer an online option for some tutorials outside presentation weeks.
- Provide clearer examples of acceptable "other models" artefacts (UI/data/deployment).
- Provide earlier guidance on Confluence vs PDF tooling to reduce end-of-term rework.

# Appendix A: Traceability Matrix (Sprint 3 Report Requirements)

| Requirement (Sprint 3) | Where Addressed | Evidence |
| --- | --- | --- |
| Business case (product + need) | 1.1 | Executive Summary + Business Case |
| Use cases/user stories aligned to business case | 1.2 | UC1-UC5 + success criteria |
| Architecture diagram (SC4/C4) | 2.1 | `assets/architecture.png` + component narrative |
| Sequence diagrams mapped to use cases | 2.2 | `assets/seq_*.png` + narratives |
| Other models (UI/data/deployment) | 2.3 | `assets/ui_overview.png`, `assets/data_model.png`, `assets/deployment.png` |
| APIs used table incl. other teams | 2.4 | Yahoo + Mango + GridX + AWS services |
| Updated testing strategy | 2.5 | Jest + Newman + E2E runner + Playwright |
| DevOps description | 2.6 | CI + CDK deploy + LocalStack workflow |
| Management: team + responsibilities | 3.1 | Roles table + working model |
| Management: challenges + reflection | 3.2-3.3 | Challenges and mitigations |
| Improvements to course | 3.4 | Actionable suggestions |

# Appendix B: Endpoint Summary (High-Level)

Auth:

- `POST /auth/signup`
- `POST /auth/login`
- `POST /auth/logout`

Datasets:

- `POST /datasets`
- `GET /datasets`
- `GET /datasets/{datasetId}`
- `PUT /datasets/{datasetId}`
- `DELETE /datasets/{datasetId}`
- `PUT /datasets/{datasetId}/events`
- `GET /datasets/{datasetId}/events`
- `DELETE /datasets/{datasetId}/events`
- `GET /datasets/{datasetId}/events/stats`
- `GET /datasets/{datasetId}/export`

Visualisation:

- `GET /charts`

Predictive:

- `POST /predict/models/train`
- `POST /predict/run`
- `GET /predict/electricity-shock`
- `GET /predict/macro-summary`
