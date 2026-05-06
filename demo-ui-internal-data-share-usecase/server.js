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
    description: 'We collect your full name, email address, mobile number, and age to design a personalised life insurance plan tailored to your specific needs. Your age enables us to calculate an accurate premium based on your risk profile. Your contact details ensure we can deliver your policy documents, send renewal notices, and reach you if we need to discuss your coverage. Your name is used to personalise your policy agreement.',
    elements: [
      { name: 'name',  isMandatory: true },
      { name: 'email', isMandatory: true },
      { name: 'age',   isMandatory: true }
    ]
  }
];

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fgcHeaders = () => ({
  'Content-Type': 'application/json',
  'org-id': ORG_ID,
  'TPP-client-id': ORG_ID
});

// ─── Routes ───────────────────────────────────────────────────────────────────

app.get('/api/config', (_, res) => {
  res.json({ companyName: config.companyName, orgId: ORG_ID });
});

app.get('/api/elements', async (_, res) => {
  try {
    const r = await fetch(`${OPENFGC_BASE}/api/v1/consent-elements?limit=100`, { headers: fgcHeaders() });
    const data = await r.json();
    res.status(r.status).json(data);
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
    const r = await fetch(`${OPENFGC_BASE}/api/v1/consent-purposes${qs}`, { headers: fgcHeaders() });
    const data = await r.json();
    res.status(r.status).json(data);
  } catch (e) {
    console.error('[Purposes] GET error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// One-time setup: create all elements and purposes (idempotent)
app.post('/api/setup/create', async (_, res) => {
  const results = { elements: [], purposes: [] };

  // ── Elements ──
  let existing = [];
  try {
    const r = await fetch(`${OPENFGC_BASE}/api/v1/consent-elements?limit=100`, { headers: fgcHeaders() });
    if (r.ok) { const d = await r.json(); existing = d.data || d || []; }
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
      const r = await fetch(`${OPENFGC_BASE}/api/v1/consent-elements`, {
        method: 'POST', headers: fgcHeaders(), body: JSON.stringify(payload)
      });
      const text = await r.text();
      if (r.ok) {
        let created; try { created = JSON.parse(text); } catch (e) { created = []; }
        const list = Array.isArray(created) ? created : [created];
        const idByName = {};
        list.forEach(el => { if (el.name) idByName[el.name] = el.id; });
        toCreate.forEach(d => {
          results.elements.push({ name: d.name, status: 'created', id: idByName[d.name] || null });
        });
      } else {
        console.error(`[Setup] Element batch create failed (HTTP ${r.status}):`, text);
        toCreate.forEach(d => results.elements.push({ name: d.name, status: 'error', error: text }));
      }
    } catch (e) {
      toCreate.forEach(d => results.elements.push({ name: d.name, status: 'error', error: e.message }));
    }
  }

  // ── Purposes ──
  let existingPurposes = [];
  try {
    const r = await fetch(`${OPENFGC_BASE}/api/v1/consent-purposes?limit=50`, { headers: fgcHeaders() });
    if (r.ok) { const d = await r.json(); existingPurposes = d.data || d || []; }
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
      const r = await fetch(`${OPENFGC_BASE}/api/v1/consent-purposes`, {
        method: 'POST',
        headers: fgcHeaders(),
        body: JSON.stringify({ name: def.name, description: def.description, elements: def.elements })
      });
      const text = await r.text();
      if (r.ok) {
        let p; try { p = JSON.parse(text); } catch (e) { p = {}; }
        results.purposes.push({ name: def.name, status: 'created', id: p.id });
      } else {
        console.error(`[Setup] Purpose create failed (HTTP ${r.status}):`, text);
        results.purposes.push({ name: def.name, status: 'error', error: text });
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
      validityTime: Math.floor(Date.now() / 1000) + (7 * 24 * 60 * 60),
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
    const r = await fetch(`${OPENFGC_BASE}/api/v1/consents`, {
      method: 'POST', headers: fgcHeaders(), body: JSON.stringify(payload)
    });
    const text = await r.text();
    let data; try { data = JSON.parse(text); } catch (e) { data = { raw: text }; }
    if (r.ok) {
      console.log(`[Consent] Created — id=${data.id}`);
    } else {
      console.error(`[Consent] Create failed (HTTP ${r.status}):`, text);
    }
    res.status(r.status).json(data);
  } catch (e) {
    console.error('[Consent] Error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`\nLife Insurance Consent Demo`);
  console.log(`  Home       → http://localhost:${PORT}/`);
  console.log(`  Quotation  → http://localhost:${PORT}/quotation.html`);
  console.log(`  Setup      → http://localhost:${PORT}/setup/`);
  console.log(`  Thank you  → http://localhost:${PORT}/thank-you.html`);
  console.log(`\n  Org ID     : ${ORG_ID}`);
  console.log(`  OpenFGC    : ${OPENFGC_BASE}\n`);
});
