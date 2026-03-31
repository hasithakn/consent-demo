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
const APIM_BASE = process.env.APIM_BASE || 'https://localhost:9443';
const APIM_GW = process.env.APIM_GW || 'https://localhost:8243';
const IS_BASE = process.env.IS_BASE || 'https://localhost:9446';
const IS_PUBLIC_BASE = process.env.IS_PUBLIC_BASE || 'https://localhost:9446';
const OPENFGC_BASE = process.env.OPENFGC_BASE || 'http://localhost:3000';
const JWKS_INTERNAL_URL = process.env.JWKS_INTERNAL_URL || 'http://localhost:8899/jwks.json';
const APIM_AUTH = 'Basic ' + Buffer.from('admin:admin').toString('base64');
const IS_AUTH = 'Basic ' + Buffer.from('admin:admin').toString('base64');
const ORG_ID = 'DEMO-ORG-001';
const IS_KM_NAME = 'WSO2 Identity Server';
const REDIRECT_URI = process.env.REDIRECT_URI || 'http://localhost:3011/auth-callback.html';
const KYC_API_NAME = 'KYCAPI';

// Disable TLS verification for self-signed certs (demo only)
const agent = new https.Agent({ rejectUnauthorized: false });
const fetchOpts = { agent };

// State
let CLIENT_ID = null;
let CLIENT_SECRET = null;
let TPP_CLIENT_ID = null;
let PRIVATE_KEY = null;
let API_ID = null;
let APP_ID = null;
let setupComplete = false;

// In-memory store of KYC requests
const kycRequests = [];

// Consent elements configuration — defines what fields can be requested
const CONSENT_ELEMENTS = [
  { name: 'first_name', jsonPath: '$.person.first_name', mandatory: true, display: 'First Name' },
  { name: 'last_name', jsonPath: '$.person.last_name', mandatory: true, display: 'Last Name' },
  { name: 'date_of_birth', jsonPath: '$.person.date_of_birth', mandatory: true, display: 'Date of Birth' },
  { name: 'gender', jsonPath: '$.person.gender', mandatory: true, display: 'Gender' },
  { name: 'nationality', jsonPath: '$.person.nationality', mandatory: true, display: 'Nationality' },
  { name: 'middle_name', jsonPath: '$.person.middle_name', mandatory: false, display: 'Middle Name' },
  { name: 'place_of_birth', jsonPath: '$.person.place_of_birth', mandatory: false, display: 'Place of Birth' },
  { name: 'marital_status', jsonPath: '$.person.marital_status', mandatory: false, display: 'Marital Status' },
  { name: 'tax_id', jsonPath: '$.person.tax_id', mandatory: false, display: 'Tax ID' },
  { name: 'source_of_funds', jsonPath: '$.person.source_of_funds', mandatory: false, display: 'Source of Funds' },
  { name: 'contact', jsonPath: '$.person.contact', mandatory: false, display: 'Contact Details' },
  { name: 'identifiers', jsonPath: '$.person.identifiers', mandatory: false, display: 'Identity Documents' },
  { name: 'employment', jsonPath: '$.person.employment', mandatory: false, display: 'Employment Details' },
];

// ===== Helper: fetch with SSL disabled =====
async function apiFetch(url, opts = {}) {
  return fetch(url, { ...fetchOpts, ...opts, agent });
}

// ===== Setup: Initialize APIM app and keys =====
async function setup() {
  console.log('[Setup] Starting bank portal initialization...');

  // Load private key
  const keyPath = process.env.PRIVATE_KEY_PATH || path.join(__dirname, '..', 'ciba-test-key.pem');
  if (!fs.existsSync(keyPath)) {
    console.error('[Setup] FATAL: ciba-test-key.pem not found at', keyPath);
    process.exit(1);
  }
  PRIVATE_KEY = fs.readFileSync(keyPath, 'utf8');

  // TPP_CLIENT_ID will be set after we generate keys (= our own CLIENT_ID)

  // Find KYC API
  let r = await apiFetch(`${APIM_BASE}/api/am/publisher/v4/apis?limit=50`, {
    headers: { Authorization: APIM_AUTH }
  });
  const apis = await r.json();
  const kycApi = (apis.list || []).find(a => a.name === KYC_API_NAME);
  if (!kycApi) {
    console.error('[Setup] FATAL: KYC API not found in APIM');
    process.exit(1);
  }
  API_ID = kycApi.id;
  console.log(`[Setup] Found KYC API: ${API_ID}`);

  // Find or create app
  r = await apiFetch(`${APIM_BASE}/api/am/devportal/v3/applications?limit=50`, {
    headers: { Authorization: APIM_AUTH }
  });
  const apps = await r.json();
  const existing = (apps.list || []).find(a => a.name === 'BankPortalApp');

  if (existing) {
    APP_ID = existing.applicationId;
    // Check if keys are usable
    r = await apiFetch(`${APIM_BASE}/api/am/devportal/v3/applications/${APP_ID}/oauth-keys`, {
      headers: { Authorization: APIM_AUTH }
    });
    const keysData = await r.json();
    const usableKey = (keysData.list || []).find(k => k.consumerKey);
    if (usableKey) {
      CLIENT_ID = usableKey.consumerKey;
      CLIENT_SECRET = usableKey.consumerSecret;
      TPP_CLIENT_ID = CLIENT_ID;
      console.log(`[Setup] Reusing existing app ${APP_ID} with keys`);
      await configureISApp();
      setupComplete = true;
      console.log('[Setup] Bank portal ready!');
      return;
    }
    // Stale — delete and recreate
    console.log('[Setup] Stale app found, deleting...');
    await apiFetch(`${APIM_BASE}/api/am/devportal/v3/applications/${APP_ID}`, {
      method: 'DELETE', headers: { Authorization: APIM_AUTH }
    });
  }

  // Create app
  r = await apiFetch(`${APIM_BASE}/api/am/devportal/v3/applications`, {
    method: 'POST',
    headers: { Authorization: APIM_AUTH, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: 'BankPortalApp',
      throttlingPolicy: 'Unlimited',
      description: 'Bank Portal Demo Application',
      tokenType: 'JWT'
    })
  });
  const appData = await r.json();
  APP_ID = appData.applicationId;
  console.log(`[Setup] Created app: ${APP_ID}`);

  // Subscribe
  r = await apiFetch(`${APIM_BASE}/api/am/devportal/v3/subscriptions`, {
    method: 'POST',
    headers: { Authorization: APIM_AUTH, 'Content-Type': 'application/json' },
    body: JSON.stringify({ applicationId: APP_ID, apiId: API_ID, throttlingPolicy: 'Unlimited' })
  });
  console.log(`[Setup] Subscribed: ${r.status}`);

  // Generate keys
  r = await apiFetch(`${APIM_BASE}/api/am/devportal/v3/applications/${APP_ID}/generate-keys`, {
    method: 'POST',
    headers: { Authorization: APIM_AUTH, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      keyType: 'PRODUCTION',
      keyManager: IS_KM_NAME,
      grantTypesToBeSupported: ['authorization_code', 'implicit', 'refresh_token', 'urn:openid:params:grant-type:ciba'],
      callbackUrl: REDIRECT_URI,
      scopes: ['openid', 'gov'],
      validityTime: 3600,
      additionalProperties: {}
    })
  });
  if (r.status === 200 || r.status === 201) {
    const keys = await r.json();
    CLIENT_ID = keys.consumerKey;
    CLIENT_SECRET = keys.consumerSecret;
    TPP_CLIENT_ID = CLIENT_ID;
    console.log(`[Setup] Keys generated. Client ID: ${CLIENT_ID}`);
  } else {
    const err = await r.text();
    console.error('[Setup] FATAL: Key generation failed:', r.status, err);
    process.exit(1);
  }

  // Configure IS app (auth sequence + JWKS)
  await configureISApp();

  setupComplete = true;
  console.log('[Setup] Bank portal ready!');
}

async function configureISApp() {
  // Find IS app matching our client_id
  let r = await apiFetch(`${IS_BASE}/api/server/v1/applications?limit=50`, {
    headers: { Authorization: IS_AUTH }
  });
  const isApps = await r.json();
  let isAppId = null;

  for (const app of (isApps.applications || [])) {
    try {
      const or = await apiFetch(`${IS_BASE}/api/server/v1/applications/${app.id}/inbound-protocols/oidc`, {
        headers: { Authorization: IS_AUTH }
      });
      if (or.status === 200) {
        const oidc = await or.json();
        if (oidc.clientId === CLIENT_ID) {
          isAppId = app.id;
          break;
        }
      }
    } catch (e) { /* skip */ }
  }

  if (!isAppId) {
    console.warn('[Setup] Could not find IS app for client_id');
    return;
  }

  // Set auth sequence
  const scriptPath = process.env.IS_SCRIPT_PATH || path.join(__dirname, '..', 'is-conditional-script.js');
  const script = fs.readFileSync(scriptPath, 'utf8');

  await apiFetch(`${IS_BASE}/api/server/v1/applications/${isAppId}`, {
    method: 'PATCH',
    headers: { Authorization: IS_AUTH, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      authenticationSequence: {
        type: 'USER_DEFINED',
        steps: [
          { id: 1, options: [{ idp: 'LOCAL', authenticator: 'BasicAuthenticator' }] },
          { id: 2, options: [{ idp: 'LOCAL', authenticator: 'SampleLocalAuthenticator' }] }
        ],
        script
      }
    })
  });

  // Set JWKS
  await apiFetch(`${IS_BASE}/api/server/v1/applications/${isAppId}`, {
    method: 'PATCH',
    headers: { Authorization: IS_AUTH, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      advancedConfigurations: {
        certificate: { type: 'JWKS', value: JWKS_INTERNAL_URL }
      }
    })
  });

  // Clean up stale IS apps (old renamed apps and old admin_*_PRODUCTION apps)
  const TARGET_IS_NAME = 'National Bank KYC Portal';
  for (const app of (isApps.applications || [])) {
    if (app.id === isAppId) continue;
    const isStale = app.name === TARGET_IS_NAME || (app.name.startsWith('admin_') && app.name.endsWith('_PRODUCTION'));
    if (isStale) {
      try {
        await apiFetch(`${IS_BASE}/api/server/v1/applications/${app.id}`, {
          method: 'DELETE', headers: { Authorization: IS_AUTH }
        });
        console.log(`[Setup] Cleaned up stale IS app ${app.id} (${app.name})`);
      } catch (e) { /* ignore */ }
    }
  }

  // Rename app to a proper display name
  await apiFetch(`${IS_BASE}/api/server/v1/applications/${isAppId}`, {
    method: 'PATCH',
    headers: { Authorization: IS_AUTH, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      name: TARGET_IS_NAME,
      description: 'National Bank Branch Portal - KYC Consent Demo'
    })
  });

  // Auto-create test user
  await ensureTestUser();

  console.log(`[Setup] IS app ${isAppId} configured`);
}

async function ensureTestUser() {
  try {
    const r = await apiFetch(`${IS_BASE}/scim2/Users?filter=userName+eq+john123`, {
      headers: { Authorization: IS_AUTH, Accept: 'application/json' }
    });
    if (r.ok) {
      const data = await r.json();
      if (data.totalResults > 0) {
        console.log('[Setup] Test user john123 already exists');
        return;
      }
    }
    const cr = await apiFetch(`${IS_BASE}/scim2/Users`, {
      method: 'POST',
      headers: { Authorization: IS_AUTH, 'Content-Type': 'application/scim+json' },
      body: JSON.stringify({
        schemas: ['urn:ietf:params:scim:schemas:core:2.0:User'],
        userName: 'john123',
        password: 'John@123',
        name: { givenName: 'John', familyName: 'Doe' },
        emails: [{ value: 'john@example.com', primary: true }]
      })
    });
    if (cr.status === 201 || cr.status === 200) {
      console.log('[Setup] Created test user john123');
    } else {
      console.warn('[Setup] Failed to create user john123:', cr.status, await cr.text());
    }
  } catch (e) {
    console.warn('[Setup] Error creating test user:', e.message);
  }
}

// ===== Consent + CIBA helpers =====

async function createConsentInOpenFGC(selectedElements, mandatoryElements) {
  const headers = { 'org-id': ORG_ID, 'TPP-client-id': TPP_CLIENT_ID, 'Content-Type': 'application/json' };

  // Filter elements to only those selected
  const mandatorySet = new Set(mandatoryElements || CONSENT_ELEMENTS.filter(e => e.mandatory).map(e => e.name));
  const requestedElements = selectedElements
    ? CONSENT_ELEMENTS.filter(e => selectedElements.includes(e.name))
    : CONSENT_ELEMENTS;

  // Ensure all consent elements exist in OpenFGC
  const existR = await fetch(`${OPENFGC_BASE}/api/v1/consent-elements`, { headers });
  const existingNames = new Set();
  if (existR.ok) {
    const existData = await existR.json();
    (existData.data || []).forEach(e => existingNames.add(e.name));
  }

  const newElements = CONSENT_ELEMENTS.filter(e => !existingNames.has(e.name));
  if (newElements.length > 0) {
    const createR = await fetch(`${OPENFGC_BASE}/api/v1/consent-elements`, {
      method: 'POST', headers,
      body: JSON.stringify(newElements.map(elem => ({
        name: elem.name, type: 'resource-field',
        description: elem.display,
        properties: { jsonPath: elem.jsonPath, resourcePath: '/user/{nic}' }
      })))
    });
    if (!createR.ok) {
      console.error('[Consent] Element creation failed:', createR.status, await createR.text());
    }
  }

  // Create a unique purpose per request with only the selected elements
  const purposeName = `kyc_data_access_${Date.now()}`;
  let r = await fetch(`${OPENFGC_BASE}/api/v1/consent-purposes`, {
    method: 'POST', headers,
    body: JSON.stringify({
      name: purposeName,
      description: 'KYC data access for bank account opening',
      clientId: TPP_CLIENT_ID,
      elements: requestedElements.map(e => ({ name: e.name, isMandatory: mandatorySet.has(e.name) }))
    })
  });
  if (!r.ok) {
    console.error('[Consent] Purpose creation failed:', r.status, await r.text());
    return null;
  }

  // Create consent record with the request-specific purpose
  r = await fetch(`${OPENFGC_BASE}/api/v1/consents`, {
    method: 'POST', headers,
    body: JSON.stringify({
      type: 'kyc',
      clientId: TPP_CLIENT_ID,
      recurringIndicator: false,
      validityTime: 0, frequency: 0, dataAccessValidityDuration: 0,
      purposes: [{
        name: purposeName,
        elements: requestedElements.map(e => ({ name: e.name, isUserApproved: false }))
      }],
      authorizations: [], attributes: {}
    })
  });

  if (r.ok) {
    const consent = await r.json();
    return consent.id;
  }
  console.error('[Consent] Failed to create consent:', r.status, await r.text());
  return null;
}

function createCIBARequestJWT(consentId) {
  const now = Math.floor(Date.now() / 1000);
  const payload = {
    iss: CLIENT_ID,
    iat: now,
    exp: now + 1500,
    aud: `${IS_PUBLIC_BASE}/oauth2/token`,
    binding_message: 'KYCAccess',
    login_hint: 'john123',
    scope: 'openid gov',
    nbf: now - 2000,
    jti: `jti-${uuidv4()}`,
    claims: { id_token: { intent_id: { value: consentId, essential: true } } },
    client_id: CLIENT_ID,
    redirect_uri: REDIRECT_URI
  };
  return jwt.sign(payload, PRIVATE_KEY, { algorithm: 'PS256', header: { kid: 'ciba-test-key-1', alg: 'PS256' } });
}

async function saveConsentAttribute(consentId, key, value) {
  const headers = { 'org-id': ORG_ID, 'TPP-client-id': TPP_CLIENT_ID, 'Content-Type': 'application/json' };
  const r = await fetch(`${OPENFGC_BASE}/api/v1/consents/${consentId}`, {
    method: 'PUT', headers,
    body: JSON.stringify({ attributes: { [key]: value } })
  });
  if (!r.ok) {
    console.error(`[Consent] Failed to save attribute ${key}:`, r.status, await r.text());
  }
}

async function initiateCIBA(consentId) {
  const requestJwt = createCIBARequestJWT(consentId);

  const r = await apiFetch(`${IS_BASE}/oauth2/ciba`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ' + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64') },
    body: `request=${encodeURIComponent(requestJwt)}`
  });

  if (r.ok) {
    const data = await r.json();
    return { authReqId: data.auth_req_id, expiresIn: data.expires_in };
  }
  const err = await r.text();
  console.error('[CIBA] Authorize failed:', r.status, err);
  return null;
}

async function getWebAuthLink(consentId, authReqId) {
  // Construct the web auth link from known CIBA parameters
  // nonce must be the auth_req_id so IS can correlate this with the CIBA session
  const params = new URLSearchParams({
    binding_message: 'KYCAccess',
    client_id: CLIENT_ID,
    nonce: authReqId,
    response_type: 'cibaAuthCode',
    scope: 'gov openid',
    intent_id: consentId,
    redirect_uri: REDIRECT_URI,
    ciba_web_auth_link: 'true',
    login_hint: 'john123',
    prompt: 'consent'
  });
  return `${IS_PUBLIC_BASE}/oauth2/authorize?${params.toString()}`;
}

async function pollForToken(authReqId) {
  const r = await apiFetch(`${IS_BASE}/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded',
      Authorization: 'Basic ' + Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64') },
    body: `grant_type=urn%3Aopenid%3Aparams%3Agrant-type%3Aciba&auth_req_id=${encodeURIComponent(authReqId)}`
  });

  if (r.ok) {
    return await r.json();
  }
  const data = await r.json().catch(() => ({}));
  if (data.error === 'authorization_pending' || data.error === 'slow_down') {
    return { pending: true };
  }
  return { error: data.error || 'unknown', description: data.error_description };
}

async function invokeKYCAPI(accessToken, nic) {
  const r = await apiFetch(`${APIM_GW}/kyc/1.0.0/user/${encodeURIComponent(nic)}`, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' }
  });
  if (r.ok) {
    return await r.json();
  }
  const body = await r.text();
  let parsed;
  try { parsed = JSON.parse(body); } catch (e) { parsed = {}; }
  // Detect consent-level rejection from the gateway enforcement policy
  if (parsed.type === 'Consent Validation Failed' || parsed.message === 'invalid_consent_status') {
    return { error: r.status, consentRevoked: true, body };
  }
  return { error: r.status, body };
}

// ===== Background polling =====
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
      // Token received — check consent status in OpenFGC before using token
      const tokenPayload = JSON.parse(Buffer.from(result.access_token.split('.')[1], 'base64').toString());
      console.log('[Poll] Token claims:', JSON.stringify({ scope: tokenPayload.scope, consent_id: tokenPayload.consent_id, sub: tokenPayload.sub }));
      req.accessToken = result.access_token;
      req.updatedAt = new Date().toISOString();

      try {
        const consentR = await fetch(`${OPENFGC_BASE}/api/v1/consents/${req.consentId}`, {
          headers: { 'org-id': ORG_ID }
        });
        if (consentR.ok) {
          const consentData = await consentR.json();
          const authStatus = (consentData.authorizations || []).find(a => a.authorizationStatus);
          if (authStatus && authStatus.authorizationStatus === 'rejected') {
            req.status = 'rejected';
            req.statusMessage = 'Citizen denied the consent request';
            req.updatedAt = new Date().toISOString();
            continue;
          }
        }
      } catch (e) { /* proceed with KYC call if check fails */ }

      req.status = 'approved';
      req.statusMessage = 'Consent approved, fetching KYC data...';
      const kycData = await invokeKYCAPI(result.access_token, req.nin);
      if (kycData.error) {
        req.status = 'error';
        req.statusMessage = `API Error: ${kycData.error}`;
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

// ===== Revocation check — re-validate through the gateway =====
// If consent is revoked, the gateway enforcement policy will reject the call
// with type='Consent Validation Failed' / message='invalid_consent_status'.
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
        console.log(`[Revoke] Request ${req.id} — gateway rejected (consent revoked)`);
      }
    } catch (e) { /* ignore transient errors */ }
  }
}, 10000);

// ===== API Routes =====

app.get('/api/status', (req, res) => {
  res.json({ ready: setupComplete, clientId: CLIENT_ID ? CLIENT_ID.substring(0, 8) + '...' : null });
});

app.get('/api/config', (req, res) => {
  res.json({
    elements: CONSENT_ELEMENTS.map(e => ({ name: e.name, display: e.display, mandatory: e.mandatory, defaultMandatory: e.mandatory }))
  });
});

app.post('/api/kyc-request', async (req, res) => {
  if (!setupComplete) return res.status(503).json({ error: 'Setup not complete' });

  const { nin, customerName, accountType, elements, mandatoryElements } = req.body;
  if (!nin) return res.status(400).json({ error: 'NIN is required' });

  try {
    // 1. Create consent
    const consentId = await createConsentInOpenFGC(elements, mandatoryElements);
    if (!consentId) return res.status(500).json({ error: 'Failed to create consent' });

    // 2. Initiate CIBA
    const ciba = await initiateCIBA(consentId);
    if (!ciba) return res.status(500).json({ error: 'Failed to initiate CIBA authorization' });

    // 3a. Save auth_req_id as consent attribute so IS grant handler can look it up
    await saveConsentAttribute(consentId, 'auth_req_id', ciba.authReqId);

    // 3b. Get web auth link
    const webAuthLink = await getWebAuthLink(consentId, ciba.authReqId);

    // 4. Create request record
    const kycReq = {
      id: uuidv4(),
      nin,
      customerName: customerName || 'N/A',
      accountType: accountType || 'Savings',
      consentId,
      authReqId: ciba.authReqId,
      webAuthLink,
      status: 'pending_approval',
      statusMessage: 'Waiting for citizen consent',
      kycData: null,
      accessToken: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      createdBy: 'Branch Officer'
    };
    kycRequests.unshift(kycReq);

    res.json({
      id: kycReq.id,
      status: kycReq.status,
      webAuthLink: kycReq.webAuthLink,
      consentId: kycReq.consentId
    });
  } catch (e) {
    console.error('[KYC-Request] Error:', e);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/requests', (req, res) => {
  res.json(kycRequests.map(r => ({
    id: r.id, nin: r.nin, customerName: r.customerName,
    accountType: r.accountType, status: r.status, statusMessage: r.statusMessage,
    createdAt: r.createdAt, updatedAt: r.updatedAt, createdBy: r.createdBy,
    hasData: !!r.kycData
  })));
});

app.get('/api/requests/:id', async (req, res) => {
  const kycReq = kycRequests.find(r => r.id === req.params.id);
  if (!kycReq) return res.status(404).json({ error: 'Not found' });

  // For data_available requests, re-validate through the gateway on-demand.
  // If the consent has been revoked the enforcement policy will reject the call.
  if (kycReq.status === 'data_available' && kycReq.accessToken) {
    try {
      const result = await invokeKYCAPI(kycReq.accessToken, kycReq.nin);
      if (result.consentRevoked) {
        kycReq.status = 'revoked';
        kycReq.statusMessage = `Consent revoked — gateway rejected access at ${new Date().toLocaleString()}`;
        kycReq.kycData = null;
        kycReq.updatedAt = new Date().toISOString();
        console.log(`[Revoke] Request ${kycReq.id} — gateway rejected on detail view`);
      }
    } catch (e) { /* gateway unreachable — show cached state */ }
  }

  res.json({
    ...kycReq,
    accessToken: undefined // don't expose token to frontend
  });
});

app.delete('/api/requests/:id', (req, res) => {
  const idx = kycRequests.findIndex(r => r.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Not found' });
  kycRequests.splice(idx, 1);
  res.json({ ok: true });
});

// Serve citizen app notification endpoint — when bank creates a request,
// the citizen app can poll this to find pending approvals
app.get('/api/citizen/pending', (req, res) => {
  const pending = kycRequests
    .filter(r => r.status === 'pending_approval' && r.webAuthLink)
    .map(r => ({
      id: r.id,
      nin: r.nin,
      customerName: r.customerName,
      webAuthLink: r.webAuthLink,
      createdAt: r.createdAt
    }));
  res.json(pending);
});

// Start server
setup().then(() => {
  app.listen(PORT, () => {
    console.log(`\nBank Portal running at http://localhost:${PORT}`);
    console.log(`Citizen App will run at http://localhost:3011`);
  });
}).catch(err => {
  console.error('Setup failed:', err);
  process.exit(1);
});
