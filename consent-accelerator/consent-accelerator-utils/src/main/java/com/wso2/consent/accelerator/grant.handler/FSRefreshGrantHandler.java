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

package com.wso2.consent.accelerator.grant.handler;

import org.apache.commons.lang3.ArrayUtils;
import org.apache.commons.logging.Log;
import org.apache.commons.logging.LogFactory;
import org.wso2.carbon.identity.oauth2.IdentityOAuth2Exception;
import org.wso2.carbon.identity.oauth2.dto.OAuth2AccessTokenRespDTO;
import org.wso2.carbon.identity.oauth2.token.OAuthTokenReqMessageContext;
import org.wso2.carbon.identity.oauth2.token.handlers.grant.RefreshGrantHandler;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.stream.Collectors;

/**
 * FS specific refresh grant handler.
 */
public class FSRefreshGrantHandler extends RefreshGrantHandler {

    private static final Log log = LogFactory.getLog(FSRefreshGrantHandler.class);

    @Override
    public OAuth2AccessTokenRespDTO issue(OAuthTokenReqMessageContext tokReqMsgCtx) throws IdentityOAuth2Exception {

        try {
            OAuth2AccessTokenRespDTO oAuth2AccessTokenRespDTO = super.issue(tokReqMsgCtx);
            addConsentIdToTokenResponse(oAuth2AccessTokenRespDTO);
            return oAuth2AccessTokenRespDTO;
        } catch (Exception e) {
            log.error(e.getMessage().replaceAll("[\r\n]", ""), e);
            throw new IdentityOAuth2Exception(e.getMessage());
        }
    }

    /**
     * Override the default behaviour to set the consent ID scope to the token context
     * before issuing the token since in the default implementation the consent ID scope
     * bound to the token is removed, and it affects the FS custom token flow.
     *
     * @param tokReqMsgCtx
     * @return
     * @throws IdentityOAuth2Exception
     */
    @Override
    public boolean validateScope(OAuthTokenReqMessageContext tokReqMsgCtx) throws IdentityOAuth2Exception {

        String[] grantedScopes = tokReqMsgCtx.getScope();
        if (!super.validateScope(tokReqMsgCtx)) {
            return false;
        }

        String[] requestedScopes = tokReqMsgCtx.getOauth2AccessTokenReqDTO().getScope();
        if (ArrayUtils.isNotEmpty(requestedScopes)) {
            //Adding internal scopes.
            ArrayList<String> requestedScopeList = new ArrayList<>(Arrays.asList(requestedScopes));
            String consentIdClaim = "consent_id";
            for (String scope : grantedScopes) {
                if (scope.startsWith(consentIdClaim)) {
                    if (log.isDebugEnabled()) {
                        log.debug(String.format("Adding custom scope %s to the requested scopes",
                                scope.replaceAll("[\r\n]", "")));
                    }
                    requestedScopeList.add(scope);
                }
            }

            // remove duplicates in requestedScopeList
            requestedScopeList = new ArrayList<>(new HashSet<>(requestedScopeList));

            String[] modifiedScopes = requestedScopeList.toArray(new String[0]);
            if (modifiedScopes.length != 0) {
                tokReqMsgCtx.setScope(modifiedScopes);
            }
        }
        return true;
    }

    /**
     * Add consent ID to the token response.
     *
     * @param oAuth2AccessTokenRespDTO OAuth2 access token response DTO
     */
    public static void addConsentIdToTokenResponse(OAuth2AccessTokenRespDTO oAuth2AccessTokenRespDTO) {


        String consentId = getConsentIdFromScopesArray(oAuth2AccessTokenRespDTO.getAuthorizedScopes()
                .split(" "));
        String consentIdClaimName = "consent_id";
        oAuth2AccessTokenRespDTO.addParameterObject(consentIdClaimName, consentId);
        List<String> collect = Arrays.stream(oAuth2AccessTokenRespDTO.getAuthorizedScopes().split(" "))
                .collect(Collectors.toList());
        collect.removeIf(e->e.startsWith("consent_id"));
        oAuth2AccessTokenRespDTO.setAuthorizedScopes(String.join(" ", collect));
        oAuth2AccessTokenRespDTO.addParameterObject("scope", String.join(" ", collect));

    }

    /**
     * Get consent id from the scopes.
     *
     * @param scopes Scopes
     * @return Consent ID
     */
    public static String getConsentIdFromScopesArray(String[] scopes) {

        String consentIdClaim = "consent_id_";

        for (String scope : scopes) {
            if (scope.startsWith(consentIdClaim)) {
                return scope.substring(consentIdClaim.length());
            }
        }

        return null;
    }
}
