const express = require('express');
const fetch = require('node-fetch');
const path = require('path');
const config = require('./config.json');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

const OPENFGC_BASE = process.env.OPENFGC_BASE || config.openfgcUrl || 'http://localhost:3000';
const ORG_ID      = process.env.ORG_ID        || config.orgId      || 'DEMO-ORG-002';
const PORT        = process.env.PORT           || config.port       || 3020;

// ─── Element definitions ──────────────────────────────────────────────────────
const ELEMENT_DEFINITIONS = [
  {
    name: 'name',
    displayName: 'Full Name',
    description: 'The full name of the insurance applicant',
    type: 'resource-field',
    properties: { jsonPath: '$.applicant.name', resourcePath: '/applicant/{id}' }
  },
  {
    name: 'email',
    displayName: 'Email Address',
    description: 'Email address used to send your quote and policy documents',
    type: 'resource-field',
    properties: { jsonPath: '$.applicant.email', resourcePath: '/applicant/{id}' }
  },
  {
    name: 'age',
    displayName: 'Age',
    description: 'Age used to calculate your insurance premium',
    type: 'resource-field',
    properties: { jsonPath: '$.applicant.age', resourcePath: '/applicant/{id}' }
  },
  {
    name: 'marketing_via_email',
    displayName: 'Agree to send marketing materials via email',
    description: 'Consent to receive marketing materials and promotional offers via email',
    type: 'resource-field',
    properties: { jsonPath: '$.consent.marketing_email', resourcePath: '/applicant/{id}' }
  }
];

// ─── Purpose definitions ──────────────────────────────────────────────────────
const PURPOSE_DEFINITIONS = [
  {
    name: 'marketing_via_email',
    description: 'We will send you personalised insurance offers, policy renewal reminders, and helpful tips on protecting your family — delivered directly to your inbox. You can unsubscribe at any time.',
    elements: [{ name: 'marketing_via_email', isMandatory: false }]
  },
  {
    name: 'create_custom_insurance_policy',
    description: 'We collect your full name, email address, and age to design a personalised life insurance plan tailored to your specific needs. Your age enables us to calculate an accurate premium based on your risk profile. Your contact details ensure we can deliver your policy documents, send renewal notices, and reach you if we need to discuss your coverage. Your name is used to personalise your policy agreement.',
    elements: [
      { name: 'name',  isMandatory: true },
      { name: 'email', isMandatory: true },
      { name: 'age',   isMandatory: true }
    ]
  }
];

// ─── API Request Logger ───────────────────────────────────────────────────────
const apiLogs = [];

function logCall(method, url, reqBody, status, resBody) {
  apiLogs.unshift({
    id: Date.now() + '_' + Math.random().toString(36).slice(2, 6),
    ts: new Date().toISOString(),
    method,
    url,
    reqBody: reqBody || null,
    status,
    resBody
  });
  if (apiLogs.length > 40) apiLogs.pop();
}

async function fgcFetch(method, urlPath, body) {
  const url = `${OPENFGC_BASE}${urlPath}`;
  const opts = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'org-id': ORG_ID,
      'TPP-client-id': ORG_ID
    }
  };
  if (body !== undefined) opts.body = JSON.stringify(body);
  const r = await fetch(url, opts);
  const text = await r.text();
  let data;
  try { data = JSON.parse(text); } catch (e) { data = { raw: text }; }
  logCall(method, url, body !== undefined ? body : null, r.status, data);
  return { ok: r.ok, status: r.status, data };
}

// ─── Routes ───────────────────────────────────────────────────────────────────

app.get('/api/logs', (_, res) => {
  res.json(apiLogs.slice(0, 20));
});

app.get('/api/config', (_, res) => {
  res.json({ companyName: config.companyName, orgId: ORG_ID });
});

app.get('/api/elements', async (_, res) => {
  try {
    const { status, data } = await fgcFetch('GET', '/api/v1/consent-elements?limit=100');
    res.status(status).json(data);
  } catch (e) {
    console.error('[Elements] GET error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/purposes', async (req, res) => {
  try {
    const qs = req.query.name
      ? `?name=${encodeURIComponent(req.query.name)}`
      : '?limit=50';
    const { status, data } = await fgcFetch('GET', `/api/v1/consent-purposes${qs}`);
    res.status(status).json(data);
  } catch (e) {
    console.error('[Purposes] GET error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// List consents for a specific user
app.get('/api/user-consents', async (req, res) => {
  try {
    const userId = req.query.userId;
    if (!userId) return res.status(400).json({ error: 'userId is required' });
    let qs = `?userIds=${encodeURIComponent(userId)}&limit=50`;
    if (req.query.purposeName) qs += `&purposeName=${encodeURIComponent(req.query.purposeName)}`;
    const { status, data } = await fgcFetch('GET', `/api/v1/consents${qs}`);
    res.status(status).json(data);
  } catch (e) {
    console.error('[UserConsents] GET error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Get a single consent by ID
app.get('/api/consents/:id', async (req, res) => {
  try {
    const { status, data } = await fgcFetch('GET', `/api/v1/consents/${req.params.id}`);
    res.status(status).json(data);
  } catch (e) {
    console.error('[Consent] GET error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Revoke a consent
app.post('/api/consents/:id/revoke', async (req, res) => {
  try {
    const body = {
      actionBy: req.body.actionBy || 'user',
      revocationReason: req.body.revocationReason || 'User request'
    };
    const { status, data } = await fgcFetch('PUT', `/api/v1/consents/${req.params.id}/revoke`, body);
    res.status(status).json(data);
  } catch (e) {
    console.error('[Consent] Revoke error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Anonymize a consent — replace userId with anon token, update via PUT
app.post('/api/consents/:id/anonymize', async (req, res) => {
  try {
    const { id } = req.params;
    const anonId = 'anon_' + id.replace(/-/g, '').substring(0, 8);

    const getResult = await fgcFetch('GET', `/api/v1/consents/${id}`);
    if (!getResult.ok) return res.status(getResult.status).json(getResult.data);

    const c = getResult.data;
    const putPayload = {
      type: c.type,
      validityTime: c.validityTime,
      recurringIndicator: c.recurringIndicator || false,
      dataAccessValidityDuration: c.dataAccessValidityDuration || 0,
      frequency: c.frequency || 0,
      purposes: c.purposes,
      attributes: Object.assign({}, c.attributes, { userId: anonId }),
      authorizations: (c.authorizations || []).map(a => {
        const s = (a.status || '').toUpperCase();
        const safeStatus = s.startsWith('SYS_') ? 'REJECTED' : a.status;
        return Object.assign({}, a, { userId: anonId, status: safeStatus });
      })
    };

    const putResult = await fgcFetch('PUT', `/api/v1/consents/${id}`, putPayload);
    res.status(putResult.status).json(putResult.data);
  } catch (e) {
    console.error('[Consent] Anonymize error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Clear API logs
app.delete('/api/logs', (_, res) => {
  apiLogs.length = 0;
  res.json({ cleared: true });
});

// One-time setup: create all elements and purposes (idempotent)
app.post('/api/setup/create', async (_, res) => {
  const results = { elements: [], purposes: [] };

  // ── Elements ──
  let existing = [];
  try {
    const { ok, data } = await fgcFetch('GET', '/api/v1/consent-elements?limit=100');
    if (ok) existing = data.data || data || [];
  } catch (e) { /* proceed without existing list */ }

  const existingByName = {};
  existing.forEach(el => { existingByName[el.name] = el; });

  const toCreate   = ELEMENT_DEFINITIONS.filter(d => !existingByName[d.name]);
  const alreadyHas = ELEMENT_DEFINITIONS.filter(d =>  existingByName[d.name]);
  alreadyHas.forEach(d => {
    results.elements.push({ name: d.name, status: 'existing', id: existingByName[d.name].id });
  });

  if (toCreate.length > 0) {
    try {
      const payload = toCreate.map(d => ({
        name:        d.name,
        displayName: d.displayName,
        type:        d.type,
        description: d.description,
        properties:  d.properties
      }));
      console.log(`[Setup] Creating ${toCreate.length} element(s):`, toCreate.map(d => d.name).join(', '));
      const { ok, status, data } = await fgcFetch('POST', '/api/v1/consent-elements', payload);
      if (ok) {
        const list = Array.isArray(data) ? data : [data];
        const idByName = {};
        list.forEach(el => { if (el.name) idByName[el.name] = el.id; });
        toCreate.forEach(d => {
          results.elements.push({ name: d.name, status: 'created', id: idByName[d.name] || null });
        });
      } else {
        console.error(`[Setup] Element batch create failed (HTTP ${status}):`, data);
        toCreate.forEach(d => results.elements.push({ name: d.name, status: 'error', error: JSON.stringify(data) }));
      }
    } catch (e) {
      toCreate.forEach(d => results.elements.push({ name: d.name, status: 'error', error: e.message }));
    }
  }

  // ── Purposes ──
  let existingPurposes = [];
  try {
    const { ok, data } = await fgcFetch('GET', '/api/v1/consent-purposes?limit=50');
    if (ok) existingPurposes = data.data || data || [];
  } catch (e) { /* proceed */ }

  const existingPurposeByName = {};
  existingPurposes.forEach(p => { existingPurposeByName[p.name] = p; });

  for (const def of PURPOSE_DEFINITIONS) {
    if (existingPurposeByName[def.name]) {
      results.purposes.push({ name: def.name, status: 'existing', id: existingPurposeByName[def.name].id });
      continue;
    }
    try {
      console.log(`[Setup] Creating purpose: ${def.name}`);
      const { ok, status, data } = await fgcFetch('POST', '/api/v1/consent-purposes', {
        name: def.name, description: def.description, elements: def.elements
      });
      if (ok) {
        results.purposes.push({ name: def.name, status: 'created', id: data.id });
      } else {
        console.error(`[Setup] Purpose create failed (HTTP ${status}):`, data);
        results.purposes.push({ name: def.name, status: 'error', error: JSON.stringify(data) });
      }
    } catch (e) {
      results.purposes.push({ name: def.name, status: 'error', error: e.message });
    }
  }

  res.json(results);
});

// Create consent record after quotation form submission
app.post('/api/consents', async (req, res) => {
  try {
    const { userId, purposes, userData } = req.body;
    const payload = {
      type: 'insurance_quotation',
      validityTime: Date.now() + (90 * 24 * 60 * 60 * 1000), // 3 months in ms
      recurringIndicator: false,
      dataAccessValidityDuration: 0,
      frequency: 0,
      purposes,
      attributes: { userId: userId || 'anonymous' },
      authorizations: [
        {
          userId: userId || 'anonymous',
          type: 'authorisation',
          status: 'APPROVED',
          resources: userData || {}
        }
      ]
    };
    console.log(`[Consent] Creating for userId=${userId}, purposes=${purposes.map(p => p.name).join(', ')}`);
    const { ok, status, data } = await fgcFetch('POST', '/api/v1/consents', payload);
    if (ok) {
      console.log(`[Consent] Created — id=${data.id}`);
    } else {
      console.error(`[Consent] Create failed (HTTP ${status}):`, data);
    }
    res.status(status).json(data);
  } catch (e) {
    console.error('[Consent] Error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`\nLife Insurance Consent Demo`);
  console.log(`  Entry      → http://localhost:${PORT}/`);
  console.log(`  Home       → http://localhost:${PORT}/home.html`);
  console.log(`  Quotation  → http://localhost:${PORT}/quotation.html`);
  console.log(`  Account    → http://localhost:${PORT}/account.html`);
  console.log(`  Setup      → http://localhost:${PORT}/setup/`);
  console.log(`\n  Org ID     : ${ORG_ID}`);
  console.log(`  OpenFGC    : ${OPENFGC_BASE}\n`);
});
