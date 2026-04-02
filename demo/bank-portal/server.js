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

// IS app credentials — set via env vars (printed by start.sh / is/setup.sh logs)
const CLIENT_ID      = process.env.CLIENT_ID     || '';
const CLIENT_SECRET  = process.env.CLIENT_SECRET || '';
const TPP_CLIENT_ID  = CLIENT_ID;

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
  { name: 'first_name',      jsonPath: '$.person.first_name',      mandatory: true,  display: 'First Name' },
  { name: 'last_name',       jsonPath: '$.person.last_name',       mandatory: true,  display: 'Last Name' },
  { name: 'date_of_birth',   jsonPath: '$.person.date_of_birth',   mandatory: true,  display: 'Date of Birth' },
  { name: 'gender',          jsonPath: '$.person.gender',          mandatory: true,  display: 'Gender' },
  { name: 'nationality',     jsonPath: '$.person.nationality',     mandatory: true,  display: 'Nationality' },
  { name: 'middle_name',     jsonPath: '$.person.middle_name',     mandatory: false, display: 'Middle Name' },
  { name: 'place_of_birth',  jsonPath: '$.person.place_of_birth',  mandatory: false, display: 'Place of Birth' },
  { name: 'marital_status',  jsonPath: '$.person.marital_status',  mandatory: false, display: 'Marital Status' },
  { name: 'tax_id',          jsonPath: '$.person.tax_id',          mandatory: false, display: 'Tax ID' },
  { name: 'source_of_funds', jsonPath: '$.person.source_of_funds', mandatory: false, display: 'Source of Funds' },
  { name: 'contact',         jsonPath: '$.person.contact',         mandatory: false, display: 'Contact Details' },
  { name: 'identifiers',     jsonPath: '$.person.identifiers',     mandatory: false, display: 'Identity Documents' },
  { name: 'employment',      jsonPath: '$.person.employment',      mandatory: false, display: 'Employment Details' },
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

  if (!CLIENT_ID || !CLIENT_SECRET) {
    console.error('[Setup] FATAL: CLIENT_ID and CLIENT_SECRET env vars are required');
    process.exit(1);
  }

  setupComplete = true;
  console.log(`[Setup] Ready — client_id: ${CLIENT_ID}, kid: ${SIGNING_KID}`);
}

// ===== Consent helpers =====

async function createConsentInOpenFGC(selectedElements, mandatoryElements) {
  const headers = { 'org-id': ORG_ID, 'TPP-client-id': TPP_CLIENT_ID, 'Content-Type': 'application/json' };

  const mandatorySet = new Set(mandatoryElements || CONSENT_ELEMENTS.filter(e => e.mandatory).map(e => e.name));
  const requestedElements = selectedElements
    ? CONSENT_ELEMENTS.filter(e => selectedElements.includes(e.name))
    : CONSENT_ELEMENTS;

  // Create a unique purpose per request (elements already exist in OpenFGC from seed script)
  const purposeName = `kyc_data_access_${Date.now()}`;
  const purposeBody = {
    name: purposeName,
    description: 'KYC data access for bank account opening',
    clientId: TPP_CLIENT_ID,
    elements: requestedElements.map(e => ({ name: e.name, isMandatory: mandatorySet.has(e.name) }))
  };
  console.log(`[OpenFGC] POST /api/v1/consent-purposes — name=${purposeName}, elements=${requestedElements.map(e=>e.name).join(',')}`);
  let r = await fetch(`${OPENFGC_BASE}/api/v1/consent-purposes`, {
    method: 'POST', headers, body: JSON.stringify(purposeBody)
  });
  const purposeText = await r.text();
  if (!r.ok) {
    console.error('[OpenFGC] Purpose creation failed:', r.status, purposeText);
    return null;
  }
  let purposeId; try { purposeId = JSON.parse(purposeText).id; } catch(e) { purposeId = '?'; }
  console.log(`[OpenFGC] Purpose created — id=${purposeId}`);

  // Create consent record
  const consentBody = {
    type: 'kyc',
    clientId: TPP_CLIENT_ID,
    recurringIndicator: false,
    validityTime: 0, frequency: 0, dataAccessValidityDuration: 0,
    purposes: [{ name: purposeName, elements: requestedElements.map(e => ({ name: e.name, isUserApproved: false })) }],
    authorizations: [], attributes: {}
  };
  console.log(`[OpenFGC] POST /api/v1/consents — purpose=${purposeName}`);
  r = await fetch(`${OPENFGC_BASE}/api/v1/consents`, {
    method: 'POST', headers, body: JSON.stringify(consentBody)
  });
  const consentText = await r.text();
  if (!r.ok) {
    console.error('[OpenFGC] Consent creation failed:', r.status, consentText);
    return null;
  }
  const consentId = JSON.parse(consentText).id;
  console.log(`[OpenFGC] Consent created — id=${consentId}`);
  return consentId;
}

function createCIBARequestJWT(consentId) {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign({
    iss: CLIENT_ID, iat: now, exp: now + 1500,
    aud: `${IS_PUBLIC_BASE}/oauth2/token`,
    binding_message: 'KYCAccess',
    login_hint: 'john',
    scope: 'openid user:data',
    nbf: now - 2000,
    jti: `jti-${uuidv4()}`,
    claims: { id_token: { intent_id: { value: consentId, essential: true } } },
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI
  }, PRIVATE_KEY, { algorithm: 'PS256', header: { kid: SIGNING_KID, alg: 'PS256' } });
}

async function saveConsentAttribute(consentId, key, value) {
  const r = await fetch(`${OPENFGC_BASE}/api/v1/consents/${consentId}`, {
    method: 'PUT',
    headers: { 'org-id': ORG_ID, 'TPP-client-id': TPP_CLIENT_ID, 'Content-Type': 'application/json' },
    body: JSON.stringify({ attributes: { [key]: value } })
  });
  if (!r.ok) console.error(`[Consent] Failed to save attribute ${key}:`, r.status, await r.text());
}

async function initiateCIBA(consentId) {
  console.log(`[CIBA] Initiating CIBA for consentId=${consentId}`);
  const cibaJwt = createCIBARequestJWT(consentId);
  console.log(`[CIBA] POST ${IS_BASE}/oauth2/ciba — client_id=${CLIENT_ID}`);
  const r = await apiFetch(`${IS_BASE}/oauth2/ciba`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ' + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')
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

function buildWebAuthLink(consentId, authReqId) {
  const params = new URLSearchParams({
    binding_message: 'KYCAccess', client_id: CLIENT_ID, nonce: authReqId,
    response_type: 'cibaAuthCode', scope: 'openid user:data',
    intent_id: consentId, redirect_uri: REDIRECT_URI,
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
      Authorization: 'Basic ' + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64')
    },
    body: `grant_type=urn%3Aopenid%3Aparams%3Agrant-type%3Aciba&auth_req_id=${encodeURIComponent(authReqId)}`
  });
  const text = await r.text();
  let data; try { data = JSON.parse(text); } catch(e) { data = {}; }
  if (r.ok) {
    console.log(`[Poll] Token exchange OK — token_type=${data.token_type}, scope="${data.scope}", expires_in=${data.expires_in}, has_id_token=${!!data.id_token}`);
    return data;
  }
  if (data.error === 'authorization_pending' || data.error === 'slow_down') return { pending: true };
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
      const result = await pollForToken(req.authReqId);
      if (result.pending) continue;
      if (result.error) {
        req.status = 'rejected';
        req.statusMessage = result.description || result.error;
        req.updatedAt = new Date().toISOString();
        continue;
      }
      const tokenPayload = JSON.parse(Buffer.from(result.access_token.split('.')[1], 'base64').toString());
      console.log(`[Poll] Token received for req=${req.id} — ALL claims: ${JSON.stringify(tokenPayload)}`);
      console.log(`[Poll] NIN for KYC call: ${req.nin}`);
      req.accessToken = result.access_token;

      // Check for explicit rejection in consent record
      try {
        const cr = await fetch(`${OPENFGC_BASE}/api/v1/consents/${req.consentId}`, { headers: { 'org-id': ORG_ID } });
        if (cr.ok) {
          const cd = await cr.json();
          const auth = (cd.authorizations || []).find(a => a.authorizationStatus);
          if (auth && auth.authorizationStatus === 'rejected') {
            req.status = 'rejected';
            req.statusMessage = 'Citizen denied the consent request';
            req.updatedAt = new Date().toISOString();
            continue;
          }
        }
      } catch (e) { /* proceed */ }

      req.status = 'approved';
      req.statusMessage = 'Consent approved, fetching KYC data...';
      const kycData = await invokeKYCAPI(result.access_token, req.nin);
      if (kycData.error) {
        req.status = 'error';
        req.statusMessage = `KYC API Error ${kycData.error}: ${kycData.body || '(no body)'}`.substring(0, 300);
        console.error(`[Poll] KYC API error for req=${req.id}: status=${kycData.error} body=${kycData.body}`);
      } else {
        req.status = 'data_available';
        req.statusMessage = 'KYC data verified and available';
        req.kycData = kycData;
      }
      req.updatedAt = new Date().toISOString();
    } catch (e) {
      console.error(`[Poll] Error for ${req.id}:`, e.message);
    }
  }
}, 4000);

// ===== Background: revocation check via gateway =====
setInterval(async () => {
  for (const req of kycRequests) {
    if (req.status !== 'data_available' || !req.accessToken) continue;
    try {
      const result = await invokeKYCAPI(req.accessToken, req.nin);
      if (result.consentRevoked) {
        req.status = 'revoked';
        req.statusMessage = `Consent revoked — gateway rejected access at ${new Date().toLocaleString()}`;
        req.kycData = null;
        req.updatedAt = new Date().toISOString();
        console.log(`[Revoke] Request ${req.id} — consent revoked`);
      }
    } catch (e) { /* ignore transient errors */ }
  }
}, 10000);

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
  res.json({ ready: setupComplete, clientId: CLIENT_ID ? CLIENT_ID.substring(0, 8) + '...' : null });
});

app.get('/api/config', (_req, res) => {
  res.json({ elements: CONSENT_ELEMENTS.map(e => ({ name: e.name, display: e.display, mandatory: e.mandatory, defaultMandatory: e.mandatory })) });
});

app.post('/api/kyc-request', async (req, res) => {
  if (!setupComplete) return res.status(503).json({ error: 'Setup not complete' });
  const { nin, customerName, accountType, elements, mandatoryElements } = req.body;
  if (!nin) return res.status(400).json({ error: 'NIN is required' });

  try {
    const consentId = await createConsentInOpenFGC(elements, mandatoryElements);
    if (!consentId) return res.status(500).json({ error: 'Failed to create consent' });

    const ciba = await initiateCIBA(consentId);
    if (!ciba) return res.status(500).json({ error: 'Failed to initiate CIBA authorization' });

    await saveConsentAttribute(consentId, 'auth_req_id', ciba.authReqId);
    const webAuthLink = ciba.webAuthUrl || buildWebAuthLink(consentId, ciba.authReqId);
    console.log(`[KYC-Request] webAuthLink source=${ciba.webAuthUrl ? 'IS-returned' : 'built-locally'}: ${webAuthLink}`);

    const kycReq = {
      id: uuidv4(), nin,
      customerName: customerName || 'N/A',
      accountType: accountType || 'Savings',
      consentId, authReqId: ciba.authReqId, webAuthLink,
      status: 'pending_approval', statusMessage: 'Waiting for citizen consent',
      kycData: null, accessToken: null,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      createdBy: 'Branch Officer'
    };
    kycRequests.unshift(kycReq);
    res.json({ id: kycReq.id, status: kycReq.status, webAuthLink, consentId });
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

app.get('/api/requests/:id', async (req, res) => {
  const kycReq = kycRequests.find(r => r.id === req.params.id);
  if (!kycReq) return res.status(404).json({ error: 'Not found' });
  if (kycReq.status === 'data_available' && kycReq.accessToken) {
    try {
      const result = await invokeKYCAPI(kycReq.accessToken, kycReq.nin);
      if (result.consentRevoked) {
        kycReq.status = 'revoked';
        kycReq.statusMessage = `Consent revoked — gateway rejected access at ${new Date().toLocaleString()}`;
        kycReq.kycData = null;
        kycReq.updatedAt = new Date().toISOString();
      }
    } catch (e) { /* show cached state */ }
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

// Start listening immediately — setup retries in the background
// The UI shows a loading indicator until /api/status returns ready:true
app.listen(PORT, () => {
  console.log(`\nBank Portal    → http://localhost:${PORT}/`);
  console.log(`Citizen App    → http://localhost:${PORT}/citizen/`);
  console.log(`Auth callback  → ${REDIRECT_URI}`);
  console.log(`Signing kid    → ${SIGNING_KID}`);
});

setup();
