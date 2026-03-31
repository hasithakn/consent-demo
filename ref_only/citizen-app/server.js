const express = require('express');
const fetch = require('node-fetch');
const path = require('path');

const app = express();
const PORT = 3011;
const BANK_PORTAL = process.env.BANK_PORTAL_URL || 'http://localhost:3010';
const OPENFGC_BASE = process.env.OPENFGC_BASE || 'http://localhost:3000';
const ORG_ID = 'DEMO-ORG-001';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// Proxy pending requests from bank portal
app.get('/api/pending', async (req, res) => {
  try {
    const r = await fetch(`${BANK_PORTAL}/api/citizen/pending`);
    const data = await r.json();
    res.json(data);
  } catch (e) {
    res.json([]);
  }
});

// Consent history — list all consents from OpenFGC
app.get('/api/consents', async (req, res) => {
  try {
    const params = new URLSearchParams();
    if (req.query.status) params.set('consentStatuses', req.query.status);
    params.set('limit', req.query.limit || '50');
    params.set('offset', req.query.offset || '0');
    const url = `${OPENFGC_BASE}/api/v1/consents?${params}`;
    const r = await fetch(url, { headers: { 'org-id': ORG_ID } });
    const data = await r.json();
    res.json(data);
  } catch (e) {
    console.error('Consent list error:', e.message);
    res.json({ data: [], metadata: {} });
  }
});

// Get single consent details — enriched with isMandatory from purpose definitions
app.get('/api/consents/:id', async (req, res) => {
  try {
    const r = await fetch(`${OPENFGC_BASE}/api/v1/consents/${encodeURIComponent(req.params.id)}`, {
      headers: { 'org-id': ORG_ID }
    });
    const data = await r.json();

    // Merge isMandatory from purpose definitions into consent elements
    if (data.purposes && data.purposes.length > 0) {
      await Promise.all(data.purposes.map(async (purpose) => {
        if (!purpose.name) return;
        try {
          const pr = await fetch(
            `${OPENFGC_BASE}/api/v1/consent-purposes?name=${encodeURIComponent(purpose.name)}`,
            { headers: { 'org-id': ORG_ID } }
          );
          if (!pr.ok) return;
          const pd = await pr.json();
          const purposeDef = (pd.data || [])[0];
          if (!purposeDef || !purposeDef.elements) return;
          const mandatoryMap = {};
          purposeDef.elements.forEach(e => { mandatoryMap[e.name] = e.isMandatory === true; });
          (purpose.elements || []).forEach(el => {
            el.isMandatory = mandatoryMap[el.name] || false;
          });
        } catch (e) { /* ignore enrichment error */ }
      }));
    }

    res.json(data);
  } catch (e) {
    console.error('Consent detail error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

// Revoke a consent
app.put('/api/consents/:id/revoke', async (req, res) => {
  try {
    const r = await fetch(`${OPENFGC_BASE}/api/v1/consents/${encodeURIComponent(req.params.id)}/revoke`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', 'org-id': ORG_ID },
      body: JSON.stringify({
        actionBy: req.body.actionBy || 'citizen',
        revocationReason: req.body.reason || 'Revoked by citizen'
      })
    });
    if (r.ok) {
      const data = await r.json();
      res.json(data);
    } else {
      const err = await r.text();
      res.status(r.status).json({ error: err });
    }
  } catch (e) {
    console.error('Revoke error:', e.message);
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, () => {
  console.log(`Citizen App running at http://localhost:${PORT}`);
});
