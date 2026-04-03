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

package com.wso2.consent.accelerator.response.handler;

import org.apache.commons.io.IOUtils;
import org.apache.commons.lang3.ArrayUtils;
import org.apache.commons.lang3.StringUtils;
import org.apache.commons.logging.Log;
import org.apache.commons.logging.LogFactory;
import org.apache.http.HttpResponse;
import org.apache.http.client.methods.HttpGet;
import org.apache.http.impl.client.CloseableHttpClient;
import org.apache.http.impl.client.HttpClientBuilder;
import org.json.JSONArray;
import org.json.JSONObject;
import org.wso2.carbon.identity.oauth2.IdentityOAuth2Exception;
import org.wso2.carbon.identity.oauth2.authz.OAuthAuthzReqMessageContext;
import org.wso2.carbon.identity.oauth2.authz.handlers.HybridResponseTypeHandler;
import org.wso2.carbon.identity.oauth2.dto.OAuth2AuthorizeRespDTO;

import javax.servlet.http.Cookie;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;

/**
 * Custom extension of HybridResponseTypeHandler.
 */
public class ConsentHybridResponseTypeHandler extends HybridResponseTypeHandler {

    private static final Log log = LogFactory.getLog(ConsentHybridResponseTypeHandler.class);
    private static final String COMMON_AUTH_ID = "commonAuthId";


    @Override
    public OAuth2AuthorizeRespDTO issue(OAuthAuthzReqMessageContext oauthAuthzMsgCtx)
            throws IdentityOAuth2Exception {

        if (log.isDebugEnabled()) {
            log.debug("Custom HybridResponseTypeHandler invoked for client: "
                    + oauthAuthzMsgCtx.getAuthorizationReqDTO().getConsumerKey());
        }
        // Perform FS default behaviour
        String[] updatedApprovedScopes = updateApprovedScopes(oauthAuthzMsgCtx);
        if (updatedApprovedScopes != null) {
            oauthAuthzMsgCtx.setApprovedScope(updatedApprovedScopes);
        }
        OAuth2AuthorizeRespDTO respDTO = super.issue(oauthAuthzMsgCtx);
        return respDTO;
    }

    public static String[] updateApprovedScopes(OAuthAuthzReqMessageContext oAuthAuthzReqMessageContext) {

        if (oAuthAuthzReqMessageContext != null && oAuthAuthzReqMessageContext.getAuthorizationReqDTO() != null) {

            String[] scopes = oAuthAuthzReqMessageContext.getApprovedScope();
            if (scopes != null && !Arrays.asList(scopes).contains("api_store")) {


                String consentId = extractConsentIdFromCommonAuthId(oAuthAuthzReqMessageContext);

                String consentIdClaim = "consent_id_";
                String consentScope = consentIdClaim + consentId;
                if (!Arrays.asList(scopes).contains(consentScope)) {
                    String[] updatedScopes = ArrayUtils.addAll(scopes, consentScope);
                    if (log.isDebugEnabled()) {
                        log.debug(String.format("Updated scopes: %s", Arrays.toString(updatedScopes)
                                .replaceAll("[\r\n]", "")));
                    }
                    return updatedScopes;
                }
            }

        } else {
            return new String[0];
        }

        return oAuthAuthzReqMessageContext.getApprovedScope();
    }


    private static String getCommonAuthId(OAuthAuthzReqMessageContext oAuthAuthzReqMessageContext) {

        Cookie[] cookies = oAuthAuthzReqMessageContext.getAuthorizationReqDTO().getCookie();
        String commonAuthId = StringUtils.EMPTY;
        ArrayList<Cookie> cookieList = new ArrayList<>(Arrays.asList(cookies));
        for (Cookie cookie : cookieList) {
            if (COMMON_AUTH_ID.equals(cookie.getName())) {
                commonAuthId = cookie.getValue();
                break;
            }
        }
        return commonAuthId;
    }

    /**
     * Extract consent ID from commonAuthId by querying the consent API.
     *
     * @param oAuthAuthzReqMessageContext OAuth authorization context
     * @return consent ID if found, empty string otherwise
     */
    private static String extractConsentIdFromCommonAuthId(OAuthAuthzReqMessageContext oAuthAuthzReqMessageContext) {

        String commonAuthId = getCommonAuthId(oAuthAuthzReqMessageContext);

        if (StringUtils.isEmpty(commonAuthId)) {
            log.warn("commonAuthId is empty, cannot extract consent ID");
            return StringUtils.EMPTY;
        }

        try {
            // Build the API URL with query parameters (configurable via environment variables)
            String consentApiBaseURL = System.getenv().getOrDefault("OPENFGC_BASE_URL", "http://openfgc:3000")
                    + "/api/v1/consents/attributes";
            String queryParams = String.format("?key=commonAuthId&value=%s",
                    URLEncoder.encode(commonAuthId, "UTF-8"));
            String apiUrl = consentApiBaseURL + queryParams;

            // Create HTTP client
            CloseableHttpClient client = HttpClientBuilder.create().build();
            HttpGet getRequest = new HttpGet(apiUrl);

            // Add required headers
            getRequest.addHeader("org-id", System.getenv().getOrDefault("CONSENT_ORG_ID", "DEMO-ORG-001"));
            getRequest.addHeader("Accept", "application/json");

            if (log.isDebugEnabled()) {
                log.debug("Fetching consent ID from API: " + apiUrl);
            }

            // Execute request
            HttpResponse response = client.execute(getRequest);
            int statusCode = response.getStatusLine().getStatusCode();

            if (statusCode == 200) {
                // Read response body
                String responseBody = IOUtils.toString(
                        response.getEntity().getContent(),
                        StandardCharsets.UTF_8);

                if (log.isDebugEnabled()) {
                    log.debug("API response: " + responseBody);
                }

                // Parse JSON response - expecting format: {"consentIds": ["CONSENT-xxx"], "count": 1}
                JSONObject responseJson = new JSONObject(responseBody);

                if (responseJson.has("consentIds")) {
                    JSONArray consentIds = responseJson.getJSONArray("consentIds");

                    if (consentIds.length() > 0) {
                        String consentId = consentIds.getString(0);

                        if (consentId != null && !consentId.isEmpty()) {
                            if (log.isDebugEnabled()) {
                                log.debug("Successfully extracted consent ID: " + consentId +
                                        " for commonAuthId: " + commonAuthId);
                            }
                            return consentId;
                        }
                    } else {
                        log.warn("No consent IDs found in response for commonAuthId: " + commonAuthId);
                    }
                } else {
                    log.warn("Response does not contain 'consentIds' field");
                }
            } else {
                log.error("Failed to fetch consent by commonAuthId. Status: " + statusCode +
                        ", Reason: " + response.getStatusLine().getReasonPhrase());
            }

            client.close();

        } catch (Exception e) {
            log.error("Error extracting consent ID from commonAuthId: " + commonAuthId, e);
        }

        return StringUtils.EMPTY;
    }
}
