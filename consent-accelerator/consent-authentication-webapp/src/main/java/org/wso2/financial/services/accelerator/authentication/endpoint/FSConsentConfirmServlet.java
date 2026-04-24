/**
 * Copyright (c) 2024, WSO2 LLC. (https://www.wso2.com).
 * <p>
 * WSO2 LLC. licenses this file to you under the Apache License,
 * Version 2.0 (the "License"); you may not use this file except
 * in compliance with the License.
 * You may obtain a copy of the License at
 * <p>
 * http://www.apache.org/licenses/LICENSE-2.0
 * <p>
 * Unless required by applicable law or agreed to in writing,
 * software distributed under the License is distributed on an
 * "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 * KIND, either express or implied. See the License for the
 * specific language governing permissions and limitations
 * under the License.
 */

package org.wso2.financial.services.accelerator.authentication.endpoint;

import java.io.IOException;
import java.net.URI;
import java.net.URISyntaxException;
import java.net.URLDecoder;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import javax.servlet.ServletContext;
import javax.servlet.http.Cookie;
import javax.servlet.http.HttpServlet;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import javax.servlet.http.HttpSession;

import org.apache.http.HttpResponse;
import org.apache.http.NameValuePair;
import org.apache.http.client.entity.UrlEncodedFormEntity;
import org.apache.http.client.methods.HttpPost;
import org.apache.http.impl.client.BasicCookieStore;
import org.apache.http.impl.client.CloseableHttpClient;
import org.apache.http.impl.client.HttpClientBuilder;
import org.apache.http.impl.cookie.BasicClientCookie;
import org.apache.http.message.BasicNameValuePair;
import org.apache.http.protocol.BasicHttpContext;
import org.apache.http.protocol.HttpContext;
import org.json.JSONArray;
import org.json.JSONObject;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.wso2.financial.services.accelerator.authentication.endpoint.util.ConsentUtils;
import org.wso2.financial.services.accelerator.authentication.endpoint.util.Constants;
import org.wso2.financial.services.accelerator.authentication.endpoint.util.LocalCacheUtil;

/**
 * The servlet responsible for the confirm page in auth web flow.
 */
public class FSConsentConfirmServlet extends HttpServlet {

    private static final long serialVersionUID = 6106269597832678046L;
    private static Logger log = LoggerFactory.getLogger(FSConsentConfirmServlet.class);

    public void doPost(HttpServletRequest request, HttpServletResponse response) throws IOException {

        String sessionDataKey = request.getParameter(Constants.SESSION_DATA_KEY_CONSENT);
        HttpSession session = request.getSession();
        LocalCacheUtil cache = LocalCacheUtil.getInstance();
        JSONObject cachedDataSet = cache.get(sessionDataKey, JSONObject.class);
        Map<String, String> browserCookies = new HashMap<>();
        Cookie[] cookies = request.getCookies();
        for (Cookie cookie : cookies) {
            browserCookies.put(cookie.getName(), cookie.getValue());
        }
        String dataAccessDuration = request.getParameter("dataAccessDuration");
        String consentExpiry = request.getParameter("consentExpiry");
        String[] approvedPurposes = request.getParameterValues("accounts");
        String user = cachedDataSet.getString("user");
        boolean approval = request.getParameter("consent") != null &&
                request.getParameter("consent").equals("true");

        String purposeId = cachedDataSet.optString("purposeId", null);
        String consentId = null;
        try {
            // Get commonAuthId from cookies
            String commonAuthId = null;
            for (Cookie cookie : cookies) {
                if ("commonAuthId".equals(cookie.getName())) {
                    commonAuthId = cookie.getValue();
                    log.info("Found commonAuthId cookie: {}", commonAuthId);
                    break;
                }
            }

            // Calculate validityTime and dataAccessValidityDuration
            Long validityTime = null;
            if (consentExpiry != null && !consentExpiry.isEmpty()) {
                try {
                    int expiryDays = Integer.parseInt(consentExpiry);
                    long currentTimestamp = System.currentTimeMillis();
                    long expirySeconds = (long) expiryDays * 24 * 60 * 60 * 1000;
                    validityTime = currentTimestamp + expirySeconds;
                    log.info("Set consent validity time to timestamp: {} (expires in {} days)",
                            validityTime, expiryDays);
                } catch (NumberFormatException e) {
                    log.warn("Invalid consentExpiry value: {}", consentExpiry);
                }
            }

            Integer dataAccessValidityDuration = null;
            if (dataAccessDuration != null && !dataAccessDuration.isEmpty()) {
                if (!"all".equals(dataAccessDuration)) {
                    try {
                        int durationDays = Integer.parseInt(dataAccessDuration);
                        dataAccessValidityDuration = durationDays * 24 * 60 * 60;
                        log.info("Set data access validity duration to: {} seconds ({} days)",
                                dataAccessValidityDuration, durationDays);
                    } catch (NumberFormatException e) {
                        log.warn("Invalid dataAccessDuration value: {}", dataAccessDuration);
                    }
                } else {
                    dataAccessValidityDuration = 365 * 10 * 24 * 60 * 60; // 10 years
                    log.info("Set data access validity duration to maximum: {} seconds (all data)",
                            dataAccessValidityDuration);
                }
            }

            // Create consent on citizen action (approve or reject)
            JSONObject createdConsent = createConsentFromPurpose(purposeId, approvedPurposes, user, commonAuthId,
                    validityTime, dataAccessValidityDuration, cachedDataSet, approval,
                    getServletContext());

            if (createdConsent != null) {
                consentId = createdConsent.optString("id", null);
                if (consentId == null || consentId.isEmpty()) {
                    consentId = createdConsent.optString("_id",
                            createdConsent.optString("consentId", null));
                }
                log.info("Successfully created consent with ID: {}", consentId);
            } else {
                log.error("Failed to create consent");
                response.sendRedirect("retry.do?status=Error&statusMsg=consent_creation_failed");
                return;
            }
        } catch (Exception e) {
            log.error("Error creating consent", e);
            response.sendRedirect("retry.do?status=Error&statusMsg=consent_creation_error");
            return;
        }

        URI authorizeRequestRedirect = null;
        try {
            authorizeRequestRedirect = authorizeRequest(approval ? "approve" : "deny", browserCookies, user, sessionDataKey);
        } catch (Exception e) {
            throw new RuntimeException(e);
        }

        String redirectURL = authorizeRequestRedirect.toString();

        // Invoke authorize flow
        if (redirectURL != null) {
            response.sendRedirect(redirectURL);

        } else {
            session.invalidate();
            response.sendRedirect("retry.do?status=Error&statusMsg=Error while persisting consent");
        }

    }

    /**
     * Create a new consent record based on the purpose, triggered by citizen action (approve or reject).
     * The auth_req_id is bound to the consent via attributes so OBCibaGrantHandler can resolve the consent ID.
     *
     * @param purposeId                  the purpose ID (passed as intent_id in the CIBA request)
     * @param approvedPurposes           element names checked by the user
     * @param userId                     the logged-in user ID
     * @param commonAuthId               the commonAuthId cookie value
     * @param validityTime               consent expiry timestamp (can be null)
     * @param dataAccessValidityDuration data access duration in seconds (can be null)
     * @param sessionData                full session data from cache
     * @param approval                   true if citizen approved, false if rejected
     * @param servletContext             servlet context
     * @return the created consent JSON object, or null on failure
     */
    private JSONObject createConsentFromPurpose(String purposeId, String[] approvedPurposes, String userId,
            String commonAuthId, Long validityTime,
            Integer dataAccessValidityDuration,
            JSONObject sessionData, Boolean approval, ServletContext servletContext) {

        // consentDetails was built from the purpose in FSConsentServlet (clientId + purposes[].elements[])
        JSONObject consentView = sessionData.optJSONObject("consentDetails");
        if (consentView == null) {
            log.error("No consentDetails found in session data for purposeId: {}", purposeId);
            return null;
        }

        String clientId = consentView.optString("clientId", null);
        JSONArray purposesArray = consentView.optJSONArray("purposes");

        // Set isUserApproved on each element based on what the citizen checked
        List<String> approvedList = Arrays.asList(approvedPurposes != null ? approvedPurposes : new String[0]);
        if (purposesArray != null) {
            for (int i = 0; i < purposesArray.length(); i++) {
                JSONObject purpose = purposesArray.getJSONObject(i);
                JSONArray elements = purpose.optJSONArray("elements");
                if (elements != null) {
                    for (int j = 0; j < elements.length(); j++) {
                        JSONObject element = elements.getJSONObject(j);
                        element.put("isUserApproved", approvedList.contains(element.getString("name")));
                    }
                }
            }
        }

        // Build attributes — must include auth_req_id so OBCibaGrantHandler can look up this consent
        JSONObject attributes = new JSONObject();
        if (commonAuthId != null) {
            attributes.put("commonAuthId", commonAuthId);
        }
        try {
            String spQueryParams = sessionData.optString("spQueryParams", null);
            if (spQueryParams != null && !spQueryParams.isEmpty()) {
                Map<String, String> params = new HashMap<>();
                for (String pair : spQueryParams.split("&")) {
                    int idx = pair.indexOf('=');
                    if (idx > 0) {
                        String key = URLDecoder.decode(pair.substring(0, idx), "UTF-8");
                        String value = URLDecoder.decode(pair.substring(idx + 1), "UTF-8");
                        params.put(key, value);
                    }
                }
                String responseType = params.get("response_type");
                String nonce = params.get("nonce");
                if ("cibaAuthCode".equals(responseType) && nonce != null && !nonce.isEmpty()) {
                    attributes.put("auth_req_id", nonce);
                    log.info("Bound auth_req_id from nonce: {}", nonce);
                }
            }
        } catch (Exception e) {
            log.warn("Failed to parse spQueryParams for auth_req_id", e);
        }

        // Build authorization entry
        JSONArray authorizationsArray = new JSONArray();
        JSONObject authorization = new JSONObject();
        authorization.put("userId", userId);
        authorization.put("type", "authorisation");
        authorization.put("status", approval ? "approved" : "rejected");
        authorizationsArray.put(authorization);

        // Assemble full consent creation payload
        JSONObject consentPayload = new JSONObject();
        consentPayload.put("type", "kyc");
        consentPayload.put("clientId", clientId != null ? clientId : "");
        consentPayload.put("recurringIndicator", false);
        consentPayload.put("frequency", 0);
        consentPayload.put("validityTime", validityTime != null ? validityTime : 0);
        consentPayload.put("dataAccessValidityDuration",
                dataAccessValidityDuration != null ? dataAccessValidityDuration : 86400);
        consentPayload.put("purposes", purposesArray != null ? purposesArray : new JSONArray());
        consentPayload.put("authorizations", authorizationsArray);
        consentPayload.put("attributes", attributes);

        log.info("Creating consent for purposeId={}, approval={}, clientId={}", purposeId, approval, clientId);

        JSONObject created = ConsentUtils.createConsent(consentPayload, clientId);
        if (created != null) {
            log.info("Consent created successfully.");
            return created;
        } else {
            log.error("Failed to create consent for purposeId: {}", purposeId);
            return null;
        }
    }

    public static URI authorizeRequest(String consent, Map<String, String> cookies, String user, String sessionDataKey)
            throws Exception {

        String isBaseUrl = System.getenv().getOrDefault("IS_BASE_URL", "https://localhost:9446");
        try (CloseableHttpClient client = HttpClientBuilder.create().build()) {

            BasicCookieStore cookieStore = new BasicCookieStore();
            String cookieDomain = new URI(isBaseUrl + "/oauth2/authorize").getHost();
            for (Map.Entry<String, String> cookieValue : cookies.entrySet()) {
                BasicClientCookie cookie = new BasicClientCookie(cookieValue.getKey(), cookieValue.getValue());
                cookie.setDomain(cookieDomain);
                cookie.setPath("/");
                cookie.setSecure(true);
                cookieStore.addCookie(cookie);
            }
            HttpPost authorizeRequest = new HttpPost(isBaseUrl + "/oauth2/authorize");
            List<NameValuePair> params = new ArrayList<>();
            params.add(new BasicNameValuePair("hasApprovedAlways", "false"));
            params.add(new BasicNameValuePair("sessionDataKeyConsent",
                    sessionDataKey));
            params.add(new BasicNameValuePair("consent", consent));
            params.add(new BasicNameValuePair("user", user));
            HttpContext localContext = new BasicHttpContext();
            localContext.setAttribute("http.cookie-store", cookieStore);
            UrlEncodedFormEntity entity = new UrlEncodedFormEntity(params);
            authorizeRequest.setEntity(entity);
            HttpResponse authorizeResponse = client.execute(authorizeRequest, localContext);

            if (authorizeResponse.getStatusLine().getStatusCode() != 302) {
                throw new Exception("Error while sending authorize request to complete the authorize flow");
            } else {
                // Extract the location header from the authorization redirect
                return new URI(authorizeResponse.getLastHeader("Location").getValue());
            }
        } catch (IOException e) {
            log.error("Error while sending authorize request to complete the authorize flow", e);
            throw new Exception("Error while sending authorize request to complete the authorize flow");
        } catch (URISyntaxException e) {
            log.error("Authorize response URI syntax error", e);
            throw new Exception("Authorize response URI syntax error");
        }
    }

}
