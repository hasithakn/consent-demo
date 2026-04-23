// ===== National Bank Branch Portal — Frontend Logic =====

const API = '';
let currentPage = 'dashboard';
let pollInterval = null;

// ===== Navigation =====
document.querySelectorAll('.nav-item:not(.disabled)').forEach(item => {
  item.addEventListener('click', e => {
    e.preventDefault();
    navigateTo(item.dataset.page);
  });
});

function navigateTo(page) {
  currentPage = page;
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById('page-' + page).classList.add('active');
  document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
  document.querySelector(`[data-page="${page}"]`).classList.add('active');
  if (page === 'new-kyc') loadElementsChecklist();
}

// ===== Setup check =====
async function checkSetup() {
  try {
    const r = await fetch(`${API}/api/status`);
    const data = await r.json();
    const dot = document.getElementById('setup-indicator');
    if (data.ready) {
      dot.className = 'status-dot dot-ready';
      dot.title = 'Connected';
      document.getElementById('btn-submit-kyc').disabled = false;
    } else {
      dot.className = 'status-dot dot-loading';
      dot.title = 'Initializing...';
      setTimeout(checkSetup, 2000);
    }
  } catch {
    document.getElementById('setup-indicator').className = 'status-dot dot-error';
    document.getElementById('setup-indicator').title = 'Connection failed';
    setTimeout(checkSetup, 5000);
  }
}

// Canonical display names — used when API description is absent
const EL_DISPLAY = {
  first_name: 'First Name', last_name: 'Last Name', date_of_birth: 'Date of Birth',
  gender: 'Gender', nationality: 'Nationality', middle_name: 'Middle Name',
  place_of_birth: 'Place of Birth', marital_status: 'Marital Status',
  tax_id: 'Tax ID', source_of_funds: 'Source of Funds',
  contact: 'Contact Details', identifiers: 'Identity Documents', employment: 'Employment Details'
};
// Canonical order — matches the admin registration order
const EL_ORDER = [
  'first_name', 'last_name', 'date_of_birth', 'gender', 'nationality',
  'middle_name', 'place_of_birth', 'marital_status',
  'tax_id', 'source_of_funds', 'contact', 'identifiers', 'employment'
];
// Elements that default to selected and mandatory
const DEFAULT_SELECTED  = new Set(['first_name', 'last_name', 'date_of_birth', 'nationality']);
const DEFAULT_MANDATORY = new Set(['first_name', 'last_name', 'date_of_birth']);

// ===== Load consent elements checklist (dynamically from Consent Manager) =====
async function loadElementsChecklist() {
  const container = document.getElementById('elements-checklist');
  container.innerHTML = '<p style="font-size:12px;color:#888;padding:8px 0">Loading elements…</p>';
  try {
    const r = await fetch(`${API}/api/elements`);
    const data = await r.json();
    const raw = (data.data || data || []);
    // Sort by canonical order; unknown elements go to the end
    const list = [...raw].sort((a, b) => {
      const ai = EL_ORDER.indexOf(a.name);
      const bi = EL_ORDER.indexOf(b.name);
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    });
    if (list.length === 0) {
      container.innerHTML = '<p style="font-size:12px;color:#c62828;padding:8px 0">No elements registered. Run the Admin Console first.</p>';
      return;
    }
    container.innerHTML = '';
    list.forEach(el => {
      const displayName = el.displayName || el.description || EL_DISPLAY[el.name] || el.name;
      const selected  = DEFAULT_SELECTED.has(el.name);
      const mandatory = DEFAULT_MANDATORY.has(el.name);
      const div = document.createElement('div');
      div.className = 'element-row';
      div.innerHTML = `
        <label class="element-check">
          <input type="checkbox" name="element" value="${el.name}" ${selected ? 'checked' : ''}>
          ${escapeHtml(displayName)}
        </label>
        <select class="element-type" data-element="${el.name}">
          <option value="mandatory" ${mandatory ? 'selected' : ''}>Mandatory</option>
          <option value="optional" ${mandatory ? '' : 'selected'}>Optional</option>
        </select>
      `;
      container.appendChild(div);
    });
  } catch (e) {
    container.innerHTML = '<p style="font-size:12px;color:#c62828;padding:8px 0">Failed to load elements: ' + e.message + '</p>';
    console.error('Failed to load elements:', e);
  }
}

// ===== Submit KYC Request =====
document.getElementById('btn-submit-kyc').addEventListener('click', async () => {
  const btn = document.getElementById('btn-submit-kyc');
  const nin = document.getElementById('nin-input').value.trim();
  if (!nin) { alert('Please enter a NIN'); return; }

  btn.disabled = true;
  btn.textContent = 'Submitting...';

  try {
    // Collect selected elements and their mandatory/optional flags
    const selectedElements = Array.from(
      document.querySelectorAll('#elements-checklist input[type="checkbox"]:checked')
    ).map(cb => cb.value);

    const mandatoryElements = Array.from(
      document.querySelectorAll('#elements-checklist select.element-type')
    ).filter(sel => sel.value === 'mandatory' && selectedElements.includes(sel.dataset.element))
     .map(sel => sel.dataset.element);

    const r = await fetch(`${API}/api/kyc-request`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nin,
        customerName: document.getElementById('name-input').value.trim() || 'John Doe',
        accountType: document.getElementById('account-type').value,
        elements: selectedElements,
        mandatoryElements
      })
    });

    const data = await r.json();
    if (r.ok) {
      // Reset form to defaults
      document.getElementById('nin-input').value = 'NIC123456';
      document.getElementById('name-input').value = '';
      // Navigate to dashboard
      navigateTo('dashboard');
      showToast('KYC request submitted — waiting for citizen approval.', 'success');
    } else {
      alert('Error: ' + (data.error || 'Unknown error'));
    }
  } catch (e) {
    alert('Request failed: ' + e.message);
  }

  btn.disabled = false;
  btn.textContent = 'Submit KYC Request';
});

function showToast(message, type) {
  const existing = document.getElementById('portal-toast');
  if (existing) existing.remove();
  const toast = document.createElement('div');
  toast.id = 'portal-toast';
  toast.className = 'portal-toast toast-' + (type || 'info');
  toast.textContent = message;
  document.body.appendChild(toast);
  // Trigger animation
  requestAnimationFrame(() => { requestAnimationFrame(() => { toast.classList.add('toast-visible'); }); });
  setTimeout(() => {
    toast.classList.remove('toast-visible');
    setTimeout(() => toast.remove(), 400);
  }, 3500);
}

// ===== Refresh data =====
async function refreshRequests() {
  try {
    const r = await fetch(`${API}/api/requests`);
    const data = await r.json();
    updateDashboard(data);
    updateRequestsTable(data);
  } catch (e) {
    console.error('Failed to refresh:', e);
  }
}

function statusBadge(status) {
  const map = {
    'pending_approval': ['Pending', 'badge-pending'],
    'approved': ['Approved', 'badge-approved'],
    'data_available': ['Data Ready', 'badge-data'],
    'rejected': ['Rejected', 'badge-rejected'],
    'revoked': ['Revoked', 'badge-revoked'],
    'error': ['Error', 'badge-error'],
  };
  const [text, cls] = map[status] || [status, ''];
  return `<span class="badge ${cls}">${text}</span>`;
}

function formatTime(iso) {
  if (!iso) return '-';
  const d = new Date(iso);
  return d.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function updateDashboard(data) {
  document.getElementById('stat-total').textContent = data.length;
  document.getElementById('stat-pending').textContent = data.filter(r => r.status === 'pending_approval').length;
  document.getElementById('stat-approved').textContent = data.filter(r => r.status === 'data_available').length;
  document.getElementById('stat-rejected').textContent = data.filter(r => r.status === 'rejected' || r.status === 'revoked').length;

  const tbody = document.getElementById('dashboard-tbody');
  const empty = document.getElementById('dashboard-empty');

  if (data.length === 0) {
    tbody.innerHTML = '';
    empty.style.display = 'block';
    document.getElementById('dashboard-table').style.display = 'none';
    return;
  }

  empty.style.display = 'none';
  document.getElementById('dashboard-table').style.display = '';

  tbody.innerHTML = data.slice(0, 10).map(r => `
    <tr>
      <td>${formatTime(r.createdAt)}</td>
      <td><strong>${escapeHtml(r.nin)}</strong></td>
      <td>${escapeHtml(r.customerName)}</td>
      <td>${escapeHtml(r.accountType)}</td>
      <td>${statusBadge(r.status)}</td>
      <td><button class="btn-link" onclick="viewDetail('${r.id}')">View</button> <button class="btn-link btn-delete" onclick="deleteRequest('${r.id}')">Delete</button></td>
    </tr>
  `).join('');
}

function updateRequestsTable(data) {
  const tbody = document.getElementById('requests-tbody');
  const empty = document.getElementById('requests-empty');

  if (data.length === 0) {
    tbody.innerHTML = '';
    empty.style.display = 'block';
    document.getElementById('requests-table').style.display = 'none';
    return;
  }

  empty.style.display = 'none';
  document.getElementById('requests-table').style.display = '';

  tbody.innerHTML = data.map(r => `
    <tr>
      <td>${formatTime(r.createdAt)}</td>
      <td><strong>${escapeHtml(r.nin)}</strong></td>
      <td>${escapeHtml(r.customerName)}</td>
      <td>${escapeHtml(r.accountType)}</td>
      <td>${statusBadge(r.status)}</td>
      <td><button class="btn-link" onclick="viewDetail('${r.id}')">View Details</button> <button class="btn-link btn-delete" onclick="deleteRequest('${r.id}')">Delete</button></td>
    </tr>
  `).join('');
}

// ===== Delete request =====
async function deleteRequest(id) {
  if (!confirm('Delete this request?')) return;
  try {
    await fetch(`${API}/api/requests/${encodeURIComponent(id)}`, { method: 'DELETE' });
    refreshRequests();
  } catch (e) {
    alert('Failed to delete request');
  }
}

// ===== Detail view =====
async function viewDetail(id) {
  try {
    const r = await fetch(`${API}/api/requests/${encodeURIComponent(id)}`);
    const data = await r.json();
    renderDetail(data);
    document.getElementById('detail-overlay').style.display = 'flex';
  } catch (e) {
    alert('Failed to load details');
  }
}

function renderDetail(data) {
  const body = document.getElementById('detail-body');
  let html = `
    <div class="detail-section">
      <h3>Request Information</h3>
      <div class="detail-grid">
        <div class="detail-label">Request ID</div><div class="detail-value">${escapeHtml(data.id)}</div>
        <div class="detail-label">NIN</div><div class="detail-value">${escapeHtml(data.nin)}</div>
        <div class="detail-label">Customer Name</div><div class="detail-value">${escapeHtml(data.customerName)}</div>
        <div class="detail-label">Account Type</div><div class="detail-value">${escapeHtml(data.accountType)}</div>
        <div class="detail-label">Status</div><div class="detail-value">${statusBadge(data.status)}</div>
        <div class="detail-label">Created</div><div class="detail-value">${new Date(data.createdAt).toLocaleString()}</div>
        <div class="detail-label">Updated</div><div class="detail-value">${new Date(data.updatedAt).toLocaleString()}</div>
        <div class="detail-label">Created By</div><div class="detail-value">${escapeHtml(data.createdBy)}</div>
        <div class="detail-label">Consent ID</div><div class="detail-value" style="font-size:11px;word-break:break-all">${escapeHtml(data.consentId)}</div>
      </div>
    </div>
  `;

  if (data.webAuthLink && data.status === 'pending_approval') {
    html += `
      <div class="detail-section">
        <h3>Citizen Approval Link</h3>
        <div class="auth-link-display">
          <a href="${escapeHtml(data.webAuthLink)}" target="_blank" class="auth-link">${escapeHtml(data.webAuthLink)}</a>
        </div>
      </div>
    `;
  }

  if (data.statusMessage) {
    html += `
      <div class="detail-section">
        <h3>Status Message</h3>
        <p>${escapeHtml(data.statusMessage)}</p>
      </div>
    `;
  }

  if (data.kycData) {
    html += `
      <div class="detail-section">
        <h3>Verified KYC Data</h3>
        ${renderKYCData(data.kycData)}
      </div>
    `;

    // Post-KYC workflow actions
    html += `
      <div class="detail-section workflow-section">
        <h3>Next Steps</h3>
        <p class="form-hint" style="margin-bottom:12px">KYC verification complete. Select an action to proceed:</p>
        <div class="workflow-actions">
          <button class="btn btn-workflow" onclick="startWorkflow('${escapeHtml(data.id)}','account')">
            <span class="workflow-icon">🏦</span>
            <span class="workflow-text">
              <strong>Open Bank Account</strong>
              <small>Create a new ${escapeHtml(data.accountType || 'savings')} account for this customer</small>
            </span>
          </button>
          <button class="btn btn-workflow" onclick="startWorkflow('${escapeHtml(data.id)}','loan')">
            <span class="workflow-icon">💳</span>
            <span class="workflow-text">
              <strong>Initiate Loan Application</strong>
              <small>Start a loan application using verified KYC data</small>
            </span>
          </button>
          <button class="btn btn-workflow" onclick="startWorkflow('${escapeHtml(data.id)}','card')">
            <span class="workflow-icon">💎</span>
            <span class="workflow-text">
              <strong>Issue Debit Card</strong>
              <small>Issue a new debit card linked to the customer profile</small>
            </span>
          </button>
        </div>
        <div id="workflow-result-${escapeHtml(data.id)}" class="workflow-result" style="display:none"></div>
      </div>
    `;
  }

  body.innerHTML = html;
}

function renderKYCData(kycData) {
  const person = kycData.person || kycData;
  const rows = [];

  const fieldLabels = {
    first_name: 'First Name', last_name: 'Last Name', middle_name: 'Middle Name',
    full_name: 'Full Name', date_of_birth: 'Date of Birth', gender: 'Gender',
    nationality: 'Nationality', place_of_birth: 'Place of Birth',
    marital_status: 'Marital Status', tax_id: 'Tax ID', source_of_funds: 'Source of Funds'
  };

  for (const [key, label] of Object.entries(fieldLabels)) {
    if (person[key] !== undefined) {
      rows.push(`<tr><td><strong>${label}</strong></td><td>${escapeHtml(String(person[key]))}</td></tr>`);
    }
  }

  // Contact Details
  if (person.contact) {
    const c = person.contact;
    if (c.email) rows.push(`<tr><td><strong>Email</strong></td><td>${escapeHtml(c.email)}</td></tr>`);
    if (c.home_phone) rows.push(`<tr><td><strong>Home Phone</strong></td><td>${escapeHtml(c.home_phone)}</td></tr>`);
    if (c.mobile_phone) rows.push(`<tr><td><strong>Mobile Phone</strong></td><td>${escapeHtml(c.mobile_phone)}</td></tr>`);
    if (c.phone) rows.push(`<tr><td><strong>Phone</strong></td><td>${escapeHtml(c.phone)}</td></tr>`);
    if (c.address) {
      const a = c.address;
      if (typeof a === 'object') {
        const parts = [a.line1, a.line2, a.city, a.state, a.postal_code, a.country].filter(Boolean);
        rows.push(`<tr><td><strong>Address</strong></td><td>${escapeHtml(parts.join(', '))}</td></tr>`);
      } else {
        rows.push(`<tr><td><strong>Address</strong></td><td>${escapeHtml(String(a))}</td></tr>`);
      }
    }
  }

  // Identifiers (object with key-value pairs)
  if (person.identifiers) {
    const ids = person.identifiers;
    if (typeof ids === 'object' && !Array.isArray(ids)) {
      const idLabels = { national_id: 'National ID', passport_number: 'Passport', driving_license: 'Driving License' };
      for (const [key, val] of Object.entries(ids)) {
        const label = idLabels[key] || key.replace(/_/g, ' ').replace(/\b\w/g, l => l.toUpperCase());
        rows.push(`<tr><td><strong>${escapeHtml(label)}</strong></td><td>${escapeHtml(String(val))}</td></tr>`);
      }
    } else if (Array.isArray(ids)) {
      ids.forEach(id => {
        rows.push(`<tr><td><strong>${escapeHtml(id.type || 'ID')}</strong></td><td>${escapeHtml(id.number || '')}</td></tr>`);
      });
    }
  }

  // Employment
  if (person.employment) {
    const e = person.employment;
    if (typeof e === 'object') {
      const parts = [e.employer, e.designation || e.position, e.employment_type, e.since ? `since ${e.since}` : ''].filter(Boolean);
      if (parts.length) rows.push(`<tr><td><strong>Employment</strong></td><td>${escapeHtml(parts.join(' — '))}</td></tr>`);
      if (e.annual_income) rows.push(`<tr><td><strong>Annual Income</strong></td><td>LKR ${Number(e.annual_income).toLocaleString()}</td></tr>`);
    }
  }

  if (rows.length === 0) {
    return `<pre style="font-size:12px;background:#f5f5f5;padding:12px;border-radius:4px;overflow:auto">${escapeHtml(JSON.stringify(kycData, null, 2))}</pre>`;
  }

  return `<table class="kyc-data-table"><thead><tr><th>Field</th><th>Value</th></tr></thead><tbody>${rows.join('')}</tbody></table>`;
}

// ===== Post-KYC Workflow =====
function startWorkflow(requestId, type) {
  var labels = { account: 'Bank Account Opening', loan: 'Loan Application', card: 'Debit Card Issuance' };
  var resultDiv = document.getElementById('workflow-result-' + requestId);
  if (!resultDiv) return;

  resultDiv.style.display = 'block';
  resultDiv.className = 'workflow-result workflow-processing';
  resultDiv.innerHTML = '<p><strong>Processing:</strong> ' + escapeHtml(labels[type] || type) + '...</p><div class="workflow-progress"><div class="workflow-progress-bar"></div></div>';

  // Simulate a workflow processing delay (demo)
  setTimeout(function() {
    resultDiv.className = 'workflow-result workflow-success';
    var ref = 'NBK-' + Date.now().toString(36).toUpperCase();
    resultDiv.innerHTML =
      '<p><strong>' + escapeHtml(labels[type] || type) + ' — Complete</strong></p>' +
      '<p>Reference: <code>' + escapeHtml(ref) + '</code></p>' +
      '<p class="form-hint">This is a demo simulation. In a production system, this would trigger the actual banking workflow.</p>';
  }, 2000);
}

function closeDetail() {
  document.getElementById('detail-overlay').style.display = 'none';
}

// Close overlay on backdrop click
document.getElementById('detail-overlay').addEventListener('click', e => {
  if (e.target === e.currentTarget) closeDetail();
});

// ===== XSS protection =====
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

// ===== Credentials Management =====

function toggleCredsBanner() {
  document.getElementById('credentials-banner').classList.toggle('open');
  // icon rotation handled by CSS .creds-banner.open .creds-toggle-icon
}

function updateCredsBadge(clientId) {
  const badge = document.getElementById('creds-status-badge');
  if (clientId) {
    badge.textContent = clientId.substring(0, 8) + '...';
    badge.className = 'creds-badge creds-is-set';
  } else {
    badge.textContent = 'Not configured';
    badge.className = 'creds-badge creds-not-set';
  }
}

async function applyCredentials() {
  const clientId     = document.getElementById('creds-client-id').value.trim();
  const clientSecret = document.getElementById('creds-client-secret').value.trim();
  if (!clientId || !clientSecret) {
    showToast('Enter both Client ID and Client Secret.', 'error');
    return;
  }
  try {
    const r = await fetch(`${API}/api/apply-credentials`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ clientId, clientSecret })
    });
    if (r.ok) {
      localStorage.setItem('bank_client_id',     clientId);
      localStorage.setItem('bank_client_secret', clientSecret);
      updateCredsBadge(clientId);
      document.getElementById('credentials-banner').classList.remove('open');
      showToast('Credentials applied — portal is ready.', 'success');
      checkSetup();
    } else {
      showToast('Failed to apply credentials.', 'error');
    }
  } catch (e) {
    showToast('Error: ' + e.message, 'error');
  }
}

async function loadStoredCredentials() {
  const clientId     = localStorage.getItem('bank_client_id');
  const clientSecret = localStorage.getItem('bank_client_secret');

  if (clientId && clientSecret) {
    document.getElementById('creds-client-id').value     = clientId;
    document.getElementById('creds-client-secret').value = clientSecret;
    updateCredsBadge(clientId);
    // Push to server so it's ready without waiting for user to click Apply
    try {
      await fetch(`${API}/api/apply-credentials`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ clientId, clientSecret })
      });
    } catch (e) { /* server may not be up yet — checkSetup will retry */ }
  } else {
    // Auto-open the banner so the user knows they need to configure
    document.getElementById('credentials-banner').classList.add('open');
  }
}

// ===== Init =====
loadStoredCredentials().then(() => {
  checkSetup();
});
refreshRequests();
pollInterval = setInterval(refreshRequests, 1500);
