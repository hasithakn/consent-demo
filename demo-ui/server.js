const express = require('express');
const fetch = require('node-fetch');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const fs = require('fs');
const path = require('path');
const https = require('https');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const PORT = 3010;

// ----- Configuration -----
const APIM_GW        = process.env.APIM_GW        || 'https://localhost:8243';
const IS_BASE        = process.env.IS_BASE         || 'https://localhost:9446';
const IS_PUBLIC_BASE = process.env.IS_PUBLIC_BASE  || 'https://localhost:9446';
const OPENFGC_BASE   = process.env.OPENFGC_BASE    || 'http://localhost:3000';
const ORG_ID         = 'DEMO-ORG-001';
const REDIRECT_URI   = process.env.REDIRECT_URI    || 'http://localhost:3010/auth-callback.html';

// IS app credentials — set via env vars or dynamically via /api/apply-credentials
const CLIENT_ID      = process.env.CLIENT_ID     || '';
const CLIENT_SECRET  = process.env.CLIENT_SECRET || '';

// Active credentials — updated at runtime when credentials are applied via the onboarding portal
let activeClientId     = CLIENT_ID;
let activeClientSecret = CLIENT_SECRET;

// Conditional auth script embedded here (same content as is/is-conditional-script.js)
const CIBA_CONDITIONAL_SCRIPT = `var isCiba;
var isCibaWebLink;

function onLoginRequest(context) {
    var responseType = context.request.params.response_type[0];
    var CIBAWebLinkParam = context.request.params.ciba_web_auth_link;

    if (responseType.indexOf("cibaAuthCode") >= 0) {
        isCiba = true;
    } else {
        isCiba = false;
    }

    if (CIBAWebLinkParam != null) {
        isCibaWebLink = true;
    } else {
        isCibaWebLink = false;
    }

    if (!isCiba) {
        executeStep(1);
    } else {
        if (isCibaWebLink) {
            executeStep(1);
        } else {
            executeStep(2);
        }
    }
}`;

// ----- Signing key config (rotate by updating these env vars) -----
const SIGNING_KEY_PATH = process.env.SIGNING_KEY_PATH || path.join(__dirname, 'signing.key');
const SIGNING_KID      = process.env.SIGNING_KID      || 'sCekNgSWIauQ34klRhDGqfwpjc4';

// Disable TLS verification for self-signed certs (demo only)
const agent = new https.Agent({ rejectUnauthorized: false });

let PRIVATE_KEY   = null;
let setupComplete = false;

// In-memory store of KYC requests
const kycRequests = [];

// Consent elements (display config only — elements are seeded by clean-and-populate-openfgc.sh)
const CONSENT_ELEMENTS = [
  { name: 'first_name',      jsonPath: '$.person.first_name',      mandatory: true,  defaultSelected: true,  display: 'First Name' },
  { name: 'last_name',       jsonPath: '$.person.last_name',       mandatory: true,  defaultSelected: true,  display: 'Last Name' },
  { name: 'date_of_birth',   jsonPath: '$.person.date_of_birth',   mandatory: true,  defaultSelected: true,  display: 'Date of Birth' },
  { name: 'gender',          jsonPath: '$.person.gender',          mandatory: false, defaultSelected: true,  display: 'Gender' },
  { name: 'nationality',     jsonPath: '$.person.nationality',     mandatory: true,  defaultSelected: false, display: 'Nationality' },
  { name: 'middle_name',     jsonPath: '$.person.middle_name',     mandatory: false, defaultSelected: false, display: 'Middle Name' },
  { name: 'place_of_birth',  jsonPath: '$.person.place_of_birth',  mandatory: false, defaultSelected: false, display: 'Place of Birth' },
  { name: 'marital_status',  jsonPath: '$.person.marital_status',  mandatory: false, defaultSelected: false, display: 'Marital Status' },
  { name: 'tax_id',          jsonPath: '$.person.tax_id',          mandatory: false, defaultSelected: false, display: 'Tax ID' },
  { name: 'source_of_funds', jsonPath: '$.person.source_of_funds', mandatory: false, defaultSelected: false, display: 'Source of Funds' },
  { name: 'contact',         jsonPath: '$.person.contact',         mandatory: false, defaultSelected: false, display: 'Contact Details' },
  { name: 'identifiers',     jsonPath: '$.person.identifiers',     mandatory: false, defaultSelected: false, display: 'Identity Documents' },
  { name: 'employment',      jsonPath: '$.person.employment',      mandatory: false, defaultSelected: false, display: 'Employment Details' },
];

async function apiFetch(url, opts = {}) {
  return fetch(url, { ...opts, agent });
}

// ===== Setup: load signing key =====
function setup() {
  if (!fs.existsSync(SIGNING_KEY_PATH)) {
    console.error('[Setup] FATAL: signing key not found at', SIGNING_KEY_PATH);
    process.exit(1);
  }
  PRIVATE_KEY = fs.readFileSync(SIGNING_KEY_PATH, 'utf8');

  if (!activeClientId || !activeClientSecret) {
    console.warn('[Setup] No CLIENT_ID/CLIENT_SECRET — server ready, waiting for credentials.');
    console.warn('[Setup] Use the Digital Locker Onboarding Portal to register and apply credentials.');
    return; // setupComplete stays false; bank portal will poll until credentials are applied
  }

  setupComplete = true;
  console.log(`[Setup] Ready — client_id: ${activeClientId}, kid: ${SIGNING_KID}`);
}

// ===== Activity log helper =====
function addLog(req, msg) {
  if (!req.activityLog) req.activityLog = [];
  req.activityLog.push({ time: new Date().toISOString(), msg });
}

// ===== Consent helpers =====

async function createConsentInOpenFGC(selectedElements, mandatoryElements) {
  const headers = { 'org-id': ORG_ID, 'TPP-client-id': activeClientId, 'Content-Type': 'application/json' };

  const mandatorySet = new Set(mandatoryElements || CONSENT_ELEMENTS.filter(e => e.mandatory).map(e => e.name));
  const requestedElements = selectedElements
    ? CONSENT_ELEMENTS.filter(e => selectedElements.includes(e.name))
    : CONSENT_ELEMENTS;

  // Create a unique purpose per request — consent is created later by the citizen consent servlet
  const purposeName = `kyc_data_access_${Date.now()}`;
  const purposeBody = {
    name: purposeName,
    description: 'KYC data access for bank account opening',
    clientId: activeClientId,
    elements: requestedElements.map(e => ({ name: e.name, isMandatory: mandatorySet.has(e.name) }))
  };
  console.log(`[OpenFGC] POST /api/v1/consent-purposes — name=${purposeName}, elements=${requestedElements.map(e=>e.name).join(',')}`);
  const r = await fetch(`${OPENFGC_BASE}/api/v1/consent-purposes`, {
    method: 'POST', headers, body: JSON.stringify(purposeBody)
  });
  const purposeText = await r.text();
  if (!r.ok) {
    console.error('[OpenFGC] Purpose creation failed:', r.status, purposeText);
    return null;
  }
  let purposeId; try { purposeId = JSON.parse(purposeText).id; } catch(e) { purposeId = '?'; }
  console.log(`[OpenFGC] Purpose created — id=${purposeId}`);
  return purposeId;
}

function createCIBARequestJWT(purposeId) {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign({
    iss: activeClientId, iat: now, exp: now + 1500,
    aud: `${IS_PUBLIC_BASE}/oauth2/token`,
    binding_message: 'KYCAccess',
    login_hint: 'john',
    scope: 'openid user:data',
    nbf: now - 2000,
    jti: `jti-${uuidv4()}`,
    claims: { id_token: { intent_id: { value: purposeId, essential: true } } },
    client_id: activeClientId,
    redirect_uri: REDIRECT_URI
  }, PRIVATE_KEY, { algorithm: 'PS256', header: { kid: SIGNING_KID, alg: 'PS256' } });
}


async function initiateCIBA(purposeId) {
  console.log(`[CIBA] Initiating CIBA for purposeId=${purposeId}`);
  const cibaJwt = createCIBARequestJWT(purposeId);
  console.log(`[CIBA] POST ${IS_BASE}/oauth2/ciba — client_id=${activeClientId}`);
  const r = await apiFetch(`${IS_BASE}/oauth2/ciba`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ' + Buffer.from(`${activeClientId}:${activeClientSecret}`).toString('base64')
    },
    body: `request=${encodeURIComponent(cibaJwt)}`
  });
  const text = await r.text();
  console.log(`[CIBA] Response status=${r.status} body=${text}`);
  if (r.ok) {
    let data; try { data = JSON.parse(text); } catch (e) { data = {}; }
    const result = { authReqId: data.auth_req_id, expiresIn: data.expires_in };
    if (data.web_auth_url) {
      console.log(`[CIBA] IS returned web_auth_url=${data.web_auth_url}`);
      result.webAuthUrl = data.web_auth_url;
    }
    return result;
  }
  console.error('[CIBA] Failed:', r.status, text);
  return null;
}

function buildWebAuthLink(purposeId, authReqId) {
  const params = new URLSearchParams({
    binding_message: 'KYCAccess', client_id: activeClientId, nonce: authReqId,
    response_type: 'cibaAuthCode', scope: 'openid user:data',
    intent_id: purposeId, redirect_uri: REDIRECT_URI,
    ciba_web_auth_link: 'true', login_hint: 'john', prompt: 'consent'
  });
  const link = `${IS_PUBLIC_BASE}/oauth2/authorize?${params.toString()}`;
  console.log(`[WebAuth] Built web auth link: ${link}`);
  return link;
}

async function pollForToken(authReqId) {
  const r = await apiFetch(`${IS_BASE}/oauth2/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ' + Buffer.from(`${activeClientId}:${activeClientSecret}`).toString('base64')
    },
    body: `grant_type=urn%3Aopenid%3Aparams%3Agrant-type%3Aciba&auth_req_id=${encodeURIComponent(authReqId)}`
  });
  const text = await r.text();
  let data; try { data = JSON.parse(text); } catch(e) { data = {}; }
  if (r.ok) {
    console.log(`[Poll] Token exchange OK — token_type=${data.token_type}, scope="${data.scope}", expires_in=${data.expires_in}, has_id_token=${!!data.id_token}`);
    return data;
  }
  if (data.error === 'authorization_pending' || data.error === 'slow_down') {
    console.log(`[Poll] ${data.error} for auth_req_id=${authReqId.substring(0, 8)}...`);
    return { pending: true };
  }
  console.log(`[Poll] Token exchange error status=${r.status} body=${text}`);
  return { error: data.error || 'unknown', description: data.error_description };
}

async function invokeKYCAPI(accessToken, nic) {
  const url = `${APIM_GW}/kyc/1.0.0/user/${encodeURIComponent(nic)}`;
  const tokenSnippet = accessToken ? accessToken.substring(0, 40) + '...' : '(none)';
  console.log(`[KYC-API] GET ${url}`);
  console.log(`[KYC-API] Request headers — Authorization: Bearer ${tokenSnippet}, Accept: application/json`);
  const r = await apiFetch(url, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' }
  });
  const body = await r.text();
  const respHeaders = {}; r.headers.forEach((v, k) => { respHeaders[k] = v; });
  console.log(`[KYC-API] Response status=${r.status} headers=${JSON.stringify(respHeaders)} body=${body.substring(0, 800)}`);
  if (r.ok) {
    try { return JSON.parse(body); } catch (e) { return { raw: body }; }
  }
  let parsed; try { parsed = JSON.parse(body); } catch (e) { parsed = {}; }
  if (parsed.type === 'Consent Validation Failed' || parsed.message === 'invalid_consent_status') {
    return { error: r.status, consentRevoked: true, body };
  }
  return { error: r.status, body };
}

// ===== Background: token polling =====
setInterval(async () => {
  for (const req of kycRequests) {
    if (req.status !== 'pending_approval') continue;
    try {
      // Log first poll attempt once
      if (!req.activityLog.some(e => e.msg.startsWith('Polling'))) {
        addLog(req, 'Polling for citizen response…');
      }
      const result = await pollForToken(req.authReqId);
      if (result.pending) continue;
      if (result.error) {
        req.status = 'rejected';
        req.statusMessage = result.description || result.error;
        addLog(req, `Citizen rejected — ${result.error}`);
        req.updatedAt = new Date().toISOString();
        continue;
      }
      const tokenPayload = JSON.parse(Buffer.from(result.access_token.split('.')[1], 'base64').toString());
      console.log(`[Poll] Token received for req=${req.id} — ALL claims: ${JSON.stringify(tokenPayload)}`);
      req.accessToken = result.access_token;
      if (result.consent_id) {
        req.consentId = result.consent_id;
        console.log(`[Poll] Consent ID from token response: ${req.consentId}`);
      }
      req.status = 'token_received';
      req.statusMessage = 'Citizen approved — token received. Click "Get KYC Data" to retrieve data.';
      addLog(req, 'Citizen approved — token received');
      req.updatedAt = new Date().toISOString();
    } catch (e) {
      console.error(`[Poll] Error for ${req.id}:`, e.message);
    }
  }
}, 5000);

// ===== Bank portal API routes =====

// Log auth callback params reported from the citizen browser
app.get('/api/log-callback', (req, res) => {
  const { code, error, error_description, session_state } = req.query;
  if (error) {
    console.log(`[AuthCallback] Error — error=${error}, description=${error_description || 'n/a'}`);
  } else {
    console.log(`[AuthCallback] Code received — code=${(code || '').substring(0, 40)}..., session_state=${session_state || 'n/a'}`);
  }
  res.json({ ok: true });
});

app.get('/api/status', (_req, res) => {
  res.json({ ready: setupComplete, clientId: activeClientId ? activeClientId.substring(0, 8) + '...' : null });
});

// Apply credentials from the onboarding portal (or from localStorage on bank portal load)
app.post('/api/apply-credentials', (req, res) => {
  const { clientId, clientSecret } = req.body;
  if (!clientId || !clientSecret) return res.status(400).json({ error: 'clientId and clientSecret are required' });
  activeClientId     = clientId;
  activeClientSecret = clientSecret;
  if (!setupComplete) {
    setupComplete = true;
    console.log(`[Credentials] Applied — client_id: ${clientId.substring(0, 8)}... — server now ready`);
  } else {
    console.log(`[Credentials] Updated — client_id: ${clientId.substring(0, 8)}...`);
  }
  res.json({ ok: true });
});

app.get('/api/config', (_req, res) => {
  res.json({ elements: CONSENT_ELEMENTS.map(e => ({ name: e.name, display: e.display, mandatory: e.mandatory, defaultMandatory: e.mandatory, defaultSelected: e.defaultSelected })) });
});

app.post('/api/kyc-request', async (req, res) => {
  if (!setupComplete) return res.status(503).json({ error: 'Setup not complete' });
  const { nin, customerName, accountType, elements, mandatoryElements } = req.body;
  if (!nin) return res.status(400).json({ error: 'NIN is required' });

  try {
    const tempLog = [];
    const purposeId = await createConsentInOpenFGC(elements, mandatoryElements);
    if (!purposeId) return res.status(500).json({ error: 'Failed to create consent purpose' });
    tempLog.push({ time: new Date().toISOString(), msg: `Purpose created — ${purposeId.substring(0, 8)}…` });
    tempLog.push({ time: new Date().toISOString(), msg: 'Authorise request initiated' });

    const ciba = await initiateCIBA(purposeId);
    if (!ciba) return res.status(500).json({ error: 'Failed to initiate CIBA authorization' });
    tempLog.push({ time: new Date().toISOString(), msg: `Auth request ID received — ${ciba.authReqId.substring(0, 12)}…` });

    const webAuthLink = ciba.webAuthUrl || buildWebAuthLink(purposeId, ciba.authReqId);
    console.log(`[KYC-Request] webAuthLink source=${ciba.webAuthUrl ? 'IS-returned' : 'built-locally'}: ${webAuthLink}`);

    const kycReq = {
      id: uuidv4(), nin,
      customerName: customerName || 'N/A',
      accountType: accountType || 'Savings',
      purposeId, consentId: null, authReqId: ciba.authReqId, webAuthLink,
      status: 'pending_approval', statusMessage: 'Waiting for citizen consent',
      kycData: null, accessToken: null,
      activityLog: tempLog,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      createdBy: 'Branch Officer'
    };
    kycRequests.unshift(kycReq);
    res.json({ id: kycReq.id, status: kycReq.status, webAuthLink, purposeId });
  } catch (e) {
    console.error('[KYC-Request] Error:', e);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/requests', (_req, res) => {
  res.json(kycRequests.map(r => ({
    id: r.id, nin: r.nin, customerName: r.customerName, accountType: r.accountType,
    status: r.status, statusMessage: r.statusMessage,
    createdAt: r.createdAt, updatedAt: r.updatedAt, createdBy: r.createdBy, hasData: !!r.kycData
  })));
});

app.get('/api/requests/:id', (req, res) => {
  const kycReq = kycRequests.find(r => r.id === req.params.id);
  if (!kycReq) return res.status(404).json({ error: 'Not found' });
  res.json({ ...kycReq, accessToken: undefined });
});

// On-demand KYC data fetch — triggered by bank officer clicking "Get KYC Data" or "Update KYC Data"
app.post('/api/requests/:id/fetch', async (req, res) => {
  const kycReq = kycRequests.find(r => r.id === req.params.id);
  if (!kycReq) return res.status(404).json({ error: 'Not found' });
  if (!kycReq.accessToken) return res.status(400).json({ error: 'No access token available' });

  try {
    const result = await invokeKYCAPI(kycReq.accessToken, kycReq.nin);
    if (result.consentRevoked) {
      kycReq.status = 'revoked';
      kycReq.statusMessage = 'Consent revoked — data access denied';
      kycReq.kycData = null;
      kycReq.updatedAt = new Date().toISOString();
      addLog(kycReq, 'Consent revoked — data access denied by gateway');
    } else if (result.error) {
      kycReq.statusMessage = `KYC API Error ${result.error}`;
      kycReq.updatedAt = new Date().toISOString();
      addLog(kycReq, `KYC API error — ${result.error}`);
    } else {
      kycReq.status = 'data_available';
      kycReq.statusMessage = 'KYC data retrieved successfully';
      kycReq.kycData = result;
      kycReq.updatedAt = new Date().toISOString();
      addLog(kycReq, 'KYC data retrieved');
    }
  } catch (e) {
    console.error('[Fetch] Error:', e.message);
    return res.status(500).json({ error: e.message });
  }
  res.json({ ...kycReq, accessToken: undefined });
});

app.delete('/api/requests/:id', (req, res) => {
  const idx = kycRequests.findIndex(r => r.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  kycRequests.splice(idx, 1);
  res.json({ ok: true });
});

// ===== Citizen app API routes =====

// Pending consent requests — read directly from in-process state
app.get('/api/citizen/pending', (_req, res) => {
  res.json(kycRequests
    .filter(r => r.status === 'pending_approval' && r.webAuthLink)
    .slice(0, 1)
    .map(r => ({ id: r.id, nin: r.nin, customerName: r.customerName, webAuthLink: r.webAuthLink, createdAt: r.createdAt })));
});

// Consent history from OpenFGC
app.get('/api/consents', async (_req, res) => {
  try {
    const params = new URLSearchParams();
    params.set('limit', '50');
    params.set('offset', '0');
    const r = await fetch(`${OPENFGC_BASE}/api/v1/consents?${params}`, { headers: { 'org-id': ORG_ID } });
    res.json(await r.json());
  } catch (e) {
    console.error('Consent list error:', e.message);
    res.json({ data: [], metadata: {} });
  }
});

// Single consent — enriched with isMandatory from purpose definition
app.get('/api/consents/:id', async (req, res) => {
  try {
    const r = await fetch(`${OPENFGC_BASE}/api/v1/consents/${encodeURIComponent(req.params.id)}`, {
      headers: { 'org-id': ORG_ID }
    });
    const data = await r.json();
    if (data.purposes) {
      await Promise.all(data.purposes.map(async (purpose) => {
        if (!purpose.name) return;
        try {
          const pr = await fetch(`${OPENFGC_BASE}/api/v1/consent-purposes?name=${encodeURIComponent(purpose.name)}`, { headers: { 'org-id': ORG_ID } });
          if (!pr.ok) return;
          const pd = await pr.json();
          const def = (pd.data || [])[0];
          if (!def || !def.elements) return;
          const mandatoryMap = {};
          def.elements.forEach(e => { mandatoryMap[e.name] = e.isMandatory === true; });
          (purpose.elements || []).forEach(el => { el.isMandatory = mandatoryMap[el.name] || false; });
        } catch (e) { /* ignore enrichment errors */ }
      }));
    }
    res.json(data);
  } catch (e) {
    console.error('Consent detail error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Revoke consent
app.put('/api/consents/:id/revoke', async (req, res) => {
  try {
    const r = await fetch(`${OPENFGC_BASE}/api/v1/consents/${encodeURIComponent(req.params.id)}/revoke`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'org-id': ORG_ID },
      body: JSON.stringify({ actionBy: req.body.actionBy || 'citizen', revocationReason: req.body.reason || 'Revoked by citizen' })
    });
    if (r.ok) res.json(await r.json());
    else res.status(r.status).json({ error: await r.text() });
  } catch (e) {
    console.error('Revoke error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// ===== Admin Portal — Consent element management =====

const ELEMENT_DEFINITIONS = [
  { name: 'first_name',      displayName: 'First Name',          description: 'First Name',          jsonPath: '$.person.first_name',      resourcePath: '/user/{nic}', category: 'Identity' },
  { name: 'last_name',       displayName: 'Last Name',           description: 'Last Name',           jsonPath: '$.person.last_name',       resourcePath: '/user/{nic}', category: 'Identity' },
  { name: 'date_of_birth',   displayName: 'Date of Birth',       description: 'Date of Birth',       jsonPath: '$.person.date_of_birth',   resourcePath: '/user/{nic}', category: 'Identity' },
  { name: 'gender',          displayName: 'Gender',              description: 'Gender',              jsonPath: '$.person.gender',          resourcePath: '/user/{nic}', category: 'Identity' },
  { name: 'nationality',     displayName: 'Nationality',         description: 'Nationality',         jsonPath: '$.person.nationality',     resourcePath: '/user/{nic}', category: 'Identity' },
  { name: 'middle_name',     displayName: 'Middle Name',         description: 'Middle Name',         jsonPath: '$.person.middle_name',     resourcePath: '/user/{nic}', category: 'Identity' },
  { name: 'place_of_birth',  displayName: 'Place of Birth',      description: 'Place of Birth',      jsonPath: '$.person.place_of_birth',  resourcePath: '/user/{nic}', category: 'Identity' },
  { name: 'marital_status',  displayName: 'Marital Status',      description: 'Marital Status',      jsonPath: '$.person.marital_status',  resourcePath: '/user/{nic}', category: 'Identity' },
  { name: 'tax_id',          displayName: 'Tax ID',              description: 'Tax ID',              jsonPath: '$.person.tax_id',          resourcePath: '/user/{nic}', category: 'Financial' },
  { name: 'source_of_funds', displayName: 'Source of Funds',     description: 'Source of Funds',     jsonPath: '$.person.source_of_funds', resourcePath: '/user/{nic}', category: 'Financial' },
  { name: 'contact',         displayName: 'Contact Details',     description: 'Contact Details',     jsonPath: '$.person.contact',         resourcePath: '/user/{nic}', category: 'Contact' },
  { name: 'identifiers',     displayName: 'Identity Documents',  description: 'Identity Documents',  jsonPath: '$.person.identifiers',     resourcePath: '/user/{nic}', category: 'Documents' },
  { name: 'employment',      displayName: 'Employment Details',  description: 'Employment Details',  jsonPath: '$.person.employment',      resourcePath: '/user/{nic}', category: 'Employment' },
];

// Fetch all consent elements from OpenFGC
app.get('/api/elements', async (_req, res) => {
  try {
    const r = await fetch(`${OPENFGC_BASE}/api/v1/consent-elements?limit=100`, {
      headers: { 'org-id': ORG_ID }
    });
    if (!r.ok) return res.status(r.status).json({ error: await r.text() });
    const data = await r.json();
    res.json(data);
  } catch (e) {
    console.error('[Elements] Fetch error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Create all 13 consent elements in OpenFGC (idempotent — skips existing by name)
app.post('/api/create-elements', async (_req, res) => {
  const headers = { 'Content-Type': 'application/json', 'org-id': ORG_ID };
  const results = [];

  // Fetch existing elements to avoid duplicates
  let existing = [];
  try {
    const r = await fetch(`${OPENFGC_BASE}/api/v1/consent-elements?limit=100`, { headers });
    if (r.ok) {
      const d = await r.json();
      existing = (d.data || d || []);
    }
  } catch (e) { /* proceed */ }

  const existingByName = {};
  existing.forEach(el => { existingByName[el.name] = el; });

  // Collect elements that need to be created
  const toCreate = ELEMENT_DEFINITIONS.filter(def => !existingByName[def.name]);
  const alreadyExist = ELEMENT_DEFINITIONS.filter(def => !!existingByName[def.name]);

  alreadyExist.forEach(def => {
    console.log(`[Create-Elements] "${def.name}" already exists — id=${existingByName[def.name].id}`);
    results.push({ name: def.name, id: existingByName[def.name].id, status: 'existing' });
  });

  if (toCreate.length > 0) {
    try {
      // API expects an array — type must be 'resource-field', paths inside properties
      const payload = toCreate.map(def => ({
        name: def.name,
        type: 'resource-field',
        description: def.description,
        properties: { jsonPath: def.jsonPath, resourcePath: def.resourcePath }
      }));
      console.log(`[Create-Elements] POSTing ${toCreate.length} new elements as array...`);
      const r = await fetch(`${OPENFGC_BASE}/api/v1/consent-elements`, {
        method: 'POST', headers, body: JSON.stringify(payload)
      });
      const text = await r.text();
      if (r.ok) {
        let created; try { created = JSON.parse(text); } catch(e) { created = []; }
        // Response may be an array or a single object
        const createdList = Array.isArray(created) ? created : [created];
        const idByName = {};
        createdList.forEach(el => { if (el.name) idByName[el.name] = el.id; });
        toCreate.forEach(def => {
          const id = idByName[def.name] || null;
          console.log(`[Create-Elements] "${def.name}" created — id=${id}`);
          results.push({ name: def.name, id, status: 'created' });
        });
      } else {
        console.error(`[Create-Elements] Batch create failed (HTTP ${r.status}): ${text}`);
        toCreate.forEach(def => results.push({ name: def.name, status: 'error', error: text }));
      }
    } catch (e) {
      toCreate.forEach(def => results.push({ name: def.name, status: 'error', error: e.message }));
    }
  }

  res.json({ results, definitions: ELEMENT_DEFINITIONS });
});

// ===== Onboarding Portal — Register IS application =====
// Mirrors the exact steps performed by is/setup.sh (steps 2–6):
//   2.  Create the IS application with CIBA grant + conditional auth script
//   2b. Configure subject claim to use username
//   3.  Resolve APP_ID and fetch clientId / clientSecret from OIDC inbound config
//   4.  Ensure the 'KYC User Data' API resource exists (scope: user:data)
//   5.  Set application role audience to ORGANIZATION
//   6.  Authorize the API resource in the application

app.post('/api/onboard', async (req, res) => {
  const { appName, description, callbackURLs, jwksUrl } = req.body;
  const name      = (appName || '').trim() || 'National Bank KYC Portal';
  const desc      = (description || '').trim() || 'National Bank Branch Portal – KYC Consent Demo';
  const callbacks = Array.isArray(callbackURLs) ? callbackURLs : [callbackURLs || 'http://localhost:3010/auth-callback.html'];
  const jwks      = (jwksUrl || '').trim() || 'https://keystore.openbankingtest.org.uk/0015800001HQQrZAAX/0015800001HQQrZAAX.jwks';

  const adminAuth = 'Basic ' + Buffer.from('admin:admin').toString('base64');
  const isHdrs = { 'Content-Type': 'application/json', Authorization: adminAuth };

  async function isGet(path) {
    return apiFetch(`${IS_BASE}${path}`, { headers: isHdrs });
  }
  async function isPost(path, body) {
    return apiFetch(`${IS_BASE}${path}`, { method: 'POST', headers: isHdrs, body: JSON.stringify(body) });
  }
  async function isPatch(path, body) {
    return apiFetch(`${IS_BASE}${path}`, { method: 'PATCH', headers: isHdrs, body: JSON.stringify(body) });
  }

  try {
    // ── Step 2: Create application if it does not exist ───────────────────
    console.log(`[Onboard] Checking for existing app: "${name}"...`);
    const listResp = await isGet('/api/server/v1/applications?limit=50');
    const listText = await listResp.text();

    if (!listText.includes(`"${name}"`)) {
      console.log(`[Onboard] Creating application "${name}"...`);
      const appPayload = {
        name,
        description: desc,
        inboundProtocolConfiguration: {
          oidc: {
            grantTypes: ['authorization_code', 'implicit', 'refresh_token', 'urn:openid:params:grant-type:ciba'],
            callbackURLs: callbacks,
            publicClient: false,
            scopeValidators: [],
            accessToken: { type: 'JWT', userAccessTokenExpiryInSeconds: 3600, applicationAccessTokenExpiryInSeconds: 3600 }
          }
        },
        authenticationSequence: {
          type: 'USER_DEFINED',
          steps: [
            { id: 1, options: [{ idp: 'LOCAL', authenticator: 'BasicAuthenticator' }] },
            { id: 2, options: [{ idp: 'LOCAL', authenticator: 'SampleLocalAuthenticator' }] }
          ],
          script: CIBA_CONDITIONAL_SCRIPT
        },
        claimConfiguration: {
          dialect: 'LOCAL',
          claimMappings: [{ applicationClaim: 'http://wso2.org/claims/username', localClaim: { uri: 'http://wso2.org/claims/username' } }],
          requestedClaims: [{ claim: { uri: 'http://wso2.org/claims/username' }, mandatory: true }],
          subject: { claim: { uri: 'http://wso2.org/claims/username' }, includeUserDomain: false, includeTenantDomain: false, useMappedLocalSubject: false }
        },
        advancedConfigurations: {
          certificate: { type: 'JWKS', value: jwks }
        }
      };
      const createResp = await isPost('/api/server/v1/applications', appPayload);
      if (createResp.status !== 201 && createResp.status !== 200) {
        const errText = await createResp.text();
        console.error(`[Onboard] App creation failed (HTTP ${createResp.status}): ${errText}`);
        return res.status(500).json({ error: `Failed to create application (HTTP ${createResp.status}): ${errText}` });
      }
      console.log(`[Onboard] Application created (HTTP ${createResp.status})`);
    } else {
      console.log(`[Onboard] Application "${name}" already exists.`);
    }

    // ── Step 3: Resolve APP_ID and fetch client credentials ───────────────
    const listResp2 = await isGet('/api/server/v1/applications?limit=50');
    const listText2 = await listResp2.text();
    const appIdMatch = listText2.match(new RegExp(`"id":"([^"]+)","name":"${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}"`));
    const appId = appIdMatch ? appIdMatch[1] : null;
    if (!appId) return res.status(500).json({ error: `Could not resolve APP_ID for "${name}"` });
    console.log(`[Onboard] Resolved APP_ID: ${appId}`);

    // ── Step 2b: Ensure callback URLs match (fixes stale registrations) ──
    console.log(`[Onboard] Patching callback URLs to: ${callbacks.join(', ')}`);
    await isPatch(`/api/server/v1/applications/${appId}`, {
      inboundProtocolConfiguration: {
        oidc: { callbackURLs: callbacks }
      }
    });

    // ── Step 2c: Configure subject claim ─────────────────────────────────
    await isPatch(`/api/server/v1/applications/${appId}`, {
      claimConfiguration: {
        dialect: 'LOCAL',
        claimMappings: [{ applicationClaim: 'http://wso2.org/claims/username', localClaim: { uri: 'http://wso2.org/claims/username' } }],
        requestedClaims: [{ claim: { uri: 'http://wso2.org/claims/username' }, mandatory: true }],
        subject: { claim: { uri: 'http://wso2.org/claims/username' }, includeUserDomain: false, includeTenantDomain: false, useMappedLocalSubject: false }
      }
    });

    const oidcResp = await isGet(`/api/server/v1/applications/${appId}/inbound-protocols/oidc`);
    const oidcText = await oidcResp.text();
    const clientIdMatch     = oidcText.match(/"clientId":"([^"]+)"/);
    const clientSecretMatch = oidcText.match(/"clientSecret":"([^"]+)"/);
    const clientId     = clientIdMatch ? clientIdMatch[1] : null;
    const clientSecret = clientSecretMatch ? clientSecretMatch[1] : null;
    if (!clientId || !clientSecret) return res.status(500).json({ error: 'Could not extract client credentials from OIDC config' });
    console.log(`[Onboard] clientId: ${clientId.substring(0, 8)}...`);

    // ── Step 4: Ensure KYC User Data API resource exists ─────────────────
    const apiResResp = await isGet('/api/server/v1/api-resources?filter=name+eq+KYC+User+Data');
    const apiResText = await apiResResp.text();
    let apiResourceId = (apiResText.match(/"id":"([^"]+)"/) || [])[1];

    if (!apiResourceId) {
      console.log('[Onboard] Creating API resource "KYC User Data"...');
      const createApiRes = await isPost('/api/server/v1/api-resources', {
        name: 'KYC User Data', identifier: 'user:data', requiresAuthorization: true,
        scopes: [{ name: 'user:data', displayName: 'User Data', description: 'Access to KYC user data' }]
      });
      console.log(`[Onboard] API resource create: HTTP ${createApiRes.status}`);
      const apiResResp2 = await isGet('/api/server/v1/api-resources?filter=name+eq+KYC+User+Data');
      const apiResText2 = await apiResResp2.text();
      apiResourceId = (apiResText2.match(/"id":"([^"]+)"/) || [])[1];
    }
    console.log(`[Onboard] API resource ID: ${apiResourceId}`);

    // ── Step 5: Set role audience to ORGANIZATION ─────────────────────────
    await isPatch(`/api/server/v1/applications/${appId}`, {
      associatedRoles: { allowedAudience: 'ORGANIZATION' }
    });

    // ── Step 6: Authorize API resource in the application ─────────────────
    const authorizedResp = await isGet(`/api/server/v1/applications/${appId}/authorized-apis`);
    const authorizedText = await authorizedResp.text();
    if (!authorizedText.includes('"user:data"')) {
      console.log('[Onboard] Authorizing API resource in application...');
      const authApiResp = await isPost(`/api/server/v1/applications/${appId}/authorized-apis`, {
        id: apiResourceId, policyIdentifier: 'RBAC', scopes: ['user:data']
      });
      console.log(`[Onboard] API authorized: HTTP ${authApiResp.status}`);
    } else {
      console.log('[Onboard] API resource already authorized.');
    }

    console.log(`[Onboard] Complete — clientId: ${clientId.substring(0, 8)}...`);
    res.json({ clientId, clientSecret, appId });

  } catch (e) {
    console.error('[Onboard] Error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Start listening immediately — setup retries in the background
// The UI shows a loading indicator until /api/status returns ready:true
app.listen(PORT, () => {
  console.log(`\nOnboarding     → http://localhost:${PORT}/digital-locker/`);
  console.log(`Bank Portal    → http://localhost:${PORT}/bank-portal/`);
  console.log(`Citizen App    → http://localhost:${PORT}/digital-locker/citizen/`);
  console.log(`Auth callback  → ${REDIRECT_URI}`);
  console.log(`Signing kid    → ${SIGNING_KID}`);
});

setup();
