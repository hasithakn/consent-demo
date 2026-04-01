/*
 * Copyright (c) 2024, WSO2 LLC. (https://www.wso2.com). All Rights Reserved.
 *
 * This software is the property of WSO2 LLC. and its suppliers, if any.
 * Dissemination of any information or reproduction of any material contained
 * herein in any form is strictly forbidden, unless permitted by WSO2 expressly.
 * You may not alter or remove any copyright or other notice from copies of this content.
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
import org.wso2.carbon.identity.application.authentication.framework.model.AuthenticatedUser;
import org.wso2.carbon.identity.core.util.IdentityUtil;
import org.wso2.carbon.identity.oauth.ciba.dao.CibaDAOFactory;
import org.wso2.carbon.identity.oauth.ciba.exceptions.CibaCoreException;
import org.wso2.carbon.identity.oauth.ciba.handlers.CibaResponseTypeHandler;
import org.wso2.carbon.identity.oauth2.IdentityOAuth2Exception;
import org.wso2.carbon.identity.oauth2.authz.OAuthAuthzReqMessageContext;
import org.wso2.carbon.identity.oauth2.dto.OAuth2AuthorizeReqDTO;
import org.wso2.carbon.identity.oauth2.dto.OAuth2AuthorizeRespDTO;

import javax.servlet.http.Cookie;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;

/**
 * Handles authorize requests with CibaAuthCode as response type.
 */
public class OBCibaResponseTypeHandler extends CibaResponseTypeHandler {

    private static final Log log = LogFactory.getLog(OBCibaResponseTypeHandler.class);
    private static final String COMMON_AUTH_ID = "commonAuthId";


    @Override
    public OAuth2AuthorizeRespDTO issue(OAuthAuthzReqMessageContext oauthAuthzMsgCtx) throws IdentityOAuth2Exception {

        OAuth2AuthorizeReqDTO authorizationReqDTO = oauthAuthzMsgCtx.getAuthorizationReqDTO();
        try {
            AuthenticatedUser cibaAuthenticatedUser = authorizationReqDTO.getUser();
//            String consentId = extractConsentIdFromCommonAuthId(oauthAuthzMsgCtx);
            // todo check the consent status is active

            // Update successful authentication.
            String authCodeKey = CibaDAOFactory.getInstance().getCibaAuthMgtDAO()
                    .getCibaAuthCodeKey(authorizationReqDTO.getNonce());
            CibaDAOFactory.getInstance().getCibaAuthMgtDAO()
                    .persistAuthenticationSuccess(authCodeKey, cibaAuthenticatedUser);

            String callbackURL = IdentityUtil.getServerURL("/authenticationendpoint/ciba.jsp", false, true);
            if (StringUtils.isNotEmpty(callbackURL)) {
                OAuth2AuthorizeRespDTO respDTO = new OAuth2AuthorizeRespDTO();
                respDTO.setCallbackURI(callbackURL);
                return respDTO;
            } else {
                throw new IdentityOAuth2Exception("Error occurred while retrieving CIBA redirect endpoint.");
            }
        } catch (CibaCoreException e) {
            throw new IdentityOAuth2Exception("Error occurred in persisting authenticated user and authentication " +
                    "status for the request made by client: " + authorizationReqDTO.getConsumerKey(), e);
        }
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
            getRequest.addHeader("client-id", System.getenv().getOrDefault("CONSENT_CLIENT_ID", ""));
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
