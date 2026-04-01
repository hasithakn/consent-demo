<div class="confirm-text">${ifStopDataSharing}</div>
<div class="confirm-text">${doYouConfirm}</div>

<div class="action-bar">
    <button type="button" class="btn-approve" onclick="approvedConsent(); return false;">
        &#x2713; Approve
    </button>
    <button type="button" class="btn-deny" onclick="denyConsent(); return false;">
        &#x2717; Deny
    </button>
    <input type="hidden" id="hasApprovedAlways" name="hasApprovedAlways" value="false"/>
    <input type="hidden" name="sessionDataKeyConsent" value="${sessionDataKeyConsent}"/>
    <input type="hidden" name="consent" id="consent" value="false"/>
    <input type="hidden" name="type" id="type" value="${type}"/>
</div>
