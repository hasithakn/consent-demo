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
import java.net.HttpURLConnection;
import java.net.URI;
import java.net.URISyntaxException;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import javax.servlet.RequestDispatcher;
import javax.servlet.ServletException;
import javax.servlet.http.HttpServlet;
import javax.servlet.http.HttpServletRequest;
import javax.servlet.http.HttpServletResponse;
import javax.servlet.http.HttpSession;

import org.apache.commons.io.IOUtils;
import org.apache.commons.lang3.StringUtils;
import org.apache.http.HttpResponse;
import org.apache.http.client.methods.HttpGet;
import org.apache.http.impl.client.CloseableHttpClient;
import org.apache.http.impl.client.HttpClientBuilder;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;
import org.owasp.encoder.Encode;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.wso2.financial.services.accelerator.authentication.endpoint.util.AuthenticationUtils;
import org.wso2.financial.services.accelerator.authentication.endpoint.util.ConsentUtils;
import org.wso2.financial.services.accelerator.authentication.endpoint.util.Constants;
import org.wso2.financial.services.accelerator.authentication.endpoint.util.LocalCacheUtil;

/**
 * The servlet responsible for displaying the consent details in the auth UI
 * flow.
 */
public class FSConsentServlet extends HttpServlet {

    private static final long serialVersionUID = 6106269076132678046L;
    private static Logger log = LoggerFactory.getLogger(FSConsentServlet.class);

    @Override
    public void doGet(HttpServletRequest originalRequest, HttpServletResponse response)
            throws IOException {

        String sessionDataKey = originalRequest.getParameter(Constants.SESSION_DATA_KEY_CONSENT);
        HttpResponse consentDataResponse = getConsentDataWithKey(sessionDataKey);
        log.debug("HTTP response for consent retrieval: " + consentDataResponse.toString());

        // Handle redirect response
        if (shouldRedirect(consentDataResponse)) {
            response.sendRedirect(consentDataResponse.getLastHeader(Constants.LOCATION).getValue());
            return;
        }

        try {
            // Parse session data from response
            JSONObject sessionData = parseSessionData(consentDataResponse);
            String user = sessionData.getString("loggedInUser");
            JSONObject dataSet;
            dataSet = handleStandardConsentFlow(sessionData, consentDataResponse.getStatusLine().getStatusCode(),
                    response);

            // Check for errors
            if (dataSet == null || dataSet.has(Constants.IS_ERROR)) {
                handleError(originalRequest, response, dataSet);
                return;
            }

            // Prepare and forward to JSP
            prepareAndForwardToJSP(originalRequest, response, sessionDataKey, dataSet, user);

        } catch (Exception e) {
            log.error("Exception occurred while processing consent", e);
            handleError(originalRequest, response,
                    new JSONObject().put(Constants.IS_ERROR, "Exception occurred: " + e.getMessage()));
        }
    }

    /**
     * Checks if the response requires a redirect.
     *
     * @param response the HTTP response
     * @return true if redirect is needed
     */
    private boolean shouldRedirect(HttpResponse response) {
        return response.getStatusLine().getStatusCode() == HttpURLConnection.HTTP_MOVED_TEMP &&
                response.getLastHeader(Constants.LOCATION) != null;
    }

    /**
     * Parses session data from the HTTP response.
     *
     * @param consentDataResponse the HTTP response containing session data
     * @return parsed JSONObject
     * @throws IOException if parsing fails
     */
    private JSONObject parseSessionData(HttpResponse consentDataResponse) throws IOException {
        String retrievalResponse = IOUtils.toString(consentDataResponse.getEntity().getContent(),
                String.valueOf(StandardCharsets.UTF_8));
        return new JSONObject(retrievalResponse);
    }

    /**
     * Handles the standard consent flow
     *
     * @param sessionData the session data
     * @param statusCode  the HTTP status code
     * @param response    the HTTP response
     * @return the processed consent dataset
     * @throws IOException        if processing fails
     * @throws URISyntaxException if URI construction fails
     */
    private JSONObject handleStandardConsentFlow(JSONObject sessionData, int statusCode,
            HttpServletResponse response)
            throws IOException, URISyntaxException {

        String consentId = null;

        // Log session data keys for debugging
        log.info("Session data keys: {}", sessionData.keySet());

        // First, try to extract purposes from request object if present
        if (sessionData.has("spQueryParams")) {
            String spQueryParams = sessionData.getString("spQueryParams");
            log.info("spQueryParams value: {}", spQueryParams);
            consentId = extractConsentIdFromQueryParams(spQueryParams);

            if (consentId != null && consentId.length() > 0) {
                log.info("Extracted {} consentId from request object: {}",
                        consentId.length(), consentId);
            }
        } else {
            log.warn("sessionData does not contain spQueryParams key");
        }

        if (consentId == null || consentId.length() == 0) {
            log.warn("No consentId found in request object");
            return null;
        }

        JSONObject consentDetails = ConsentUtils.getConsentDetails(consentId, getServletContext());

        if (consentDetails != null) {
            sessionData.put("consentId", consentId);
            sessionData.put("consentDetails", consentDetails);
        } else {
            log.warn("No consent details found for consentId: " + consentId);
            return null;
        }

        // Check for error redirects
        String errorResponse = AuthenticationUtils.getErrorResponseForRedirectURL(sessionData);
        if (sessionData.has(Constants.REDIRECT_URI) && StringUtils.isNotEmpty(errorResponse)) {
            URI errorURI = new URI(sessionData.get(Constants.REDIRECT_URI).toString().concat(errorResponse));
            response.sendRedirect(errorURI.toString());
            return null;
        }

        return sessionData;
    }

    /**
     * Handles error scenarios and redirects appropriately.
     *
     * @param request  the HTTP request
     * @param response the HTTP response
     * @param dataSet  the dataset containing error information
     * @throws IOException if redirect fails
     */
    private void handleError(HttpServletRequest request, HttpServletResponse response,
            JSONObject dataSet) throws IOException {
        String errorMessage = "Unknown error";

        if (dataSet != null && dataSet.has(Constants.IS_ERROR)) {
            errorMessage = dataSet.getString(Constants.IS_ERROR);
        }

        request.getSession().invalidate();
        response.sendRedirect("retry.do?status=Error&statusMsg=" + errorMessage);
    }

    /**
     * Prepares request attributes and forwards to JSP.
     *
     * @param request        the HTTP request
     * @param response       the HTTP response
     * @param sessionDataKey the session data key
     * @param dataSet        the consent dataset
     * @param user           the logged-in user
     * @throws ServletException if forwarding fails
     * @throws IOException      if forwarding fails
     */
    private void prepareAndForwardToJSP(HttpServletRequest request, HttpServletResponse response,
            String sessionDataKey, JSONObject dataSet, String user)
            throws ServletException, IOException {

        // Set variables to session
        HttpSession session = request.getSession();
        session.setAttribute(Constants.SESSION_DATA_KEY_CONSENT, Encode.forJava(sessionDataKey));
        session.setAttribute(Constants.DISPLAY_SCOPES,
                Boolean.parseBoolean(getServletContext().getInitParameter(Constants.DISPLAY_SCOPES)));

        // Set strings to request
        request.setAttribute(Constants.PRIVACY_DESCRIPTION, Constants.PRIVACY_DESCRIPTION_KEY);
        request.setAttribute(Constants.PRIVACY_GENERAL, Constants.PRIVACY_GENERAL_KEY);
        request.setAttribute(Constants.OK, Constants.OK);
        request.setAttribute(Constants.REQUESTED_SCOPES, Constants.REQUESTED_SCOPES_KEY);
        request.setAttribute(Constants.APP, dataSet.getString(Constants.APPLICATION));

        // Pass custom values to JSP
        String applicationName = dataSet.getString(Constants.APPLICATION);
        request.setAttribute("basicConsentData", applicationName +
                " application is requesting your consent to access the following data: ");
        request.setAttribute("user", user);
        dataSet.put("user", user);

        // selectable data
        List<Map<String, String>> purposeData = getPurposeList(dataSet);
        request.setAttribute("consumerAccounts", purposeData);

        // Store dataSet in cache with sessionDataKey as the key
        LocalCacheUtil cache = LocalCacheUtil.getInstance();
        cache.put(sessionDataKey, dataSet);
        log.info("Stored dataSet in cache with key: {}", sessionDataKey);

        // Forward to JSP
        RequestDispatcher dispatcher = this.getServletContext().getRequestDispatcher("/fs_default.jsp");
        dispatcher.forward(request, response);
    }

    private List<Map<String, String>> getPurposeList(JSONObject dataSet) {
        List<Map<String, String>> purposeDataMap = new ArrayList<>();

        // Extract valid purposes from validPurposes array
        if (dataSet.has("consentDetails")) {
            JSONObject consentDetailsObject = dataSet.getJSONObject("consentDetails");
            String consentClientId = consentDetailsObject.optString("clientId", null);
            if (consentDetailsObject.has("purposes")) {
                JSONArray purposes = consentDetailsObject.getJSONArray("purposes");
                for (int i = 0; i < purposes.length(); i++) {
                    JSONObject purpose = purposes.getJSONObject(i);
                    String purposeName = purpose.optString("name", "default");
                    JSONArray elements = purpose.optJSONArray("elements");
                    if (elements != null) {
                        for (int j = 0; j < elements.length(); j++) {
                            JSONObject element = elements.getJSONObject(j);
                            Map<String, String> purposeMap = new HashMap<>();
                            purposeMap.put("value", element.getString("name"));
                            purposeMap.put("label", getPermissionDisplayName(element.getString("name")));
                            purposeMap.put("isUserApproved",
                                    element.optBoolean("isUserApproved", false) ? "true" : "false");
                            Boolean isMandatory = ConsentUtils.resolvePurposeMandatory(purposeName, element.getString("name"),
                                    consentClientId, getServletContext());
                            purposeMap.put("isMandatory", String.valueOf(isMandatory));
                            purposeDataMap.add(purposeMap);
                        }
                    }
                }
            }
        } else {
            log.warn("No validPurposes found in dataSet, returning empty purpose list.");
        }

        return purposeDataMap;
    }

    /**
     * Retrieve consent data with the session data key from Asgardeo API.
     *
     * @param sessionDataKeyConsent session data key
     * @return HTTP response
     * @throws IOException if an error occurs while retrieving consent data
     */
    HttpResponse getConsentDataWithKey(String sessionDataKeyConsent) throws IOException {

        // Construct IS API URL (configurable via environment variables)
        String isBaseURL = System.getenv().getOrDefault("IS_BASE_URL", "https://localhost:9446")
                + "/api/identity/auth/v1.1/data/OauthConsentKey/";
        String retrieveUrl = isBaseURL + sessionDataKeyConsent;
        CloseableHttpClient client = HttpClientBuilder.create().build();
        HttpGet dataRequest = new HttpGet(retrieveUrl);
        dataRequest.addHeader("accept", Constants.JSON);
        dataRequest.addHeader(Constants.AUTHORIZATION,
                System.getenv().getOrDefault("IS_ADMIN_AUTH", "Basic YWRtaW46YWRtaW4="));
        return client.execute(dataRequest);

    }

    /**
     * Map permission codes to user-friendly display names.
     * Handles both colon-separated (utility:read) and underscore-separated
     * (utility_read) formats.
     *
     * @param permission the permission code
     * @return user-friendly display name
     */
    private String getPermissionDisplayName(String permission) {
        if (permission == null || permission.trim().isEmpty()) {
            return permission;
        }

        // Normalize the permission string to lowercase for comparison
        String normalizedPermission = permission.toLowerCase();

        // Map known permissions to display names (supporting both : and _ separators)
        switch (normalizedPermission) {
            // Personal identity fields
            case "first_name":
            case "first:name":
                return "First Name";
            case "middle_name":
            case "middle:name":
                return "Middle Name";
            case "last_name":
            case "last:name":
                return "Last Name";
            case "full_name":
            case "full:name":
                return "Full Name";
            case "date_of_birth":
            case "date:of:birth":
            case "dob":
                return "Date of Birth";
            case "place_of_birth":
            case "place:of:birth":
                return "Place of Birth";
            case "gender":
                return "Gender";
            case "nationality":
                return "Nationality";
            case "marital_status":
            case "marital:status":
                return "Marital Status";
            case "tax_id":
            case "tax:id":
                return "Tax Identification Number";
            case "source_of_funds":
            case "source:of:funds":
                return "Source of Funds";

            // Other categories
            case "identifiers":
                return "Identifiers";
            case "contact":
                return "Contact Details";
            case "employment":
                return "Employment Details";
            case "email":
                return "Email Address";
            case "home_phone":
                return "Home Phone";
            case "mobile_phone":
                return "Mobile Phone";
            case "address":
                return "Address";
            default:
                return permission;
        }
    }

    /**
     * Extract purpose strings from request object in spQueryParams.
     * The request object is a JWT that contains consent_purposes array.
     *
     * @param spQueryParams the query parameters string
     * @return array of purpose strings from request object, or empty array if not
     *         found
     */
    String extractConsentIdFromQueryParams(String spQueryParams) {
        if (spQueryParams == null || spQueryParams.trim().isEmpty()) {
            return null;
        }

        // First, check for a direct intent_id= query param (set by CIBAWebLinkAuthenticator)
        for (String param : spQueryParams.split("&")) {
            if (param.startsWith("intent_id=")) {
                String intentId = param.substring("intent_id=".length());
                try {
                    intentId = java.net.URLDecoder.decode(intentId, "UTF-8");
                } catch (java.io.UnsupportedEncodingException e) { /* UTF-8 always supported */ }
                if (intentId != null && !intentId.trim().isEmpty()) {
                    log.info("Extracted consent id from intent_id query param: {}", intentId);
                    return intentId;
                }
            }
        }

        try {
            // Parse query params to find 'request' parameter
            String[] params = spQueryParams.split("&");
            String requestObjectJwt = null;

            for (String param : params) {
                if (param.startsWith("request=")) {
                    requestObjectJwt = java.net.URLDecoder.decode(param.substring(8), "UTF-8");
                    log.debug("Found request object parameter");
                    break;
                }
            }

            if (requestObjectJwt == null || requestObjectJwt.isEmpty()) {
                log.debug("No request object found in spQueryParams");
                return null;
            }

            // Decode JWT (assuming it's a simple JWT without signature verification for
            // now)
            // JWT format: header.payload.signature
            String[] jwtParts = requestObjectJwt.split("\\.");

            if (jwtParts.length < 2) {
                log.warn("Invalid JWT format in request object");
                return null;
            }

            // Decode the payload (second part)
            String payloadEncoded = jwtParts[1];
            byte[] decodedBytes = java.util.Base64.getUrlDecoder().decode(payloadEncoded);
            String payloadJson = new String(decodedBytes, StandardCharsets.UTF_8);

            log.debug("Decoded request object payload: " + payloadJson);

            // Parse JSON payload
            JSONObject requestObject = new JSONObject(payloadJson);

            // First try to extract consent ID from claims.id_token.intent_id.value
            try {
                if (requestObject.has("claims")) {
                    JSONObject claims = requestObject.getJSONObject("claims");
                    if (claims.has("id_token")) {
                        JSONObject idToken = claims.getJSONObject("id_token");
                        if (idToken.has("intent_id")) {
                            JSONObject intent = idToken.getJSONObject("intent_id");
                            String consentId = intent.optString("value", "");
                            if (consentId != null && !consentId.trim().isEmpty()) {
                                log.info("Extracted consent id from request object's intent_id: {}", consentId);
                                return consentId;
                            }
                        }
                    }
                }
            } catch (JSONException e) {
                log.debug("Error while extracting intent_id from request object, falling back to consent_purposes", e);
            }

        } catch (Exception e) {
            log.error("Error extracting purposes from request object", e);
        }

        return null;
    }
}
