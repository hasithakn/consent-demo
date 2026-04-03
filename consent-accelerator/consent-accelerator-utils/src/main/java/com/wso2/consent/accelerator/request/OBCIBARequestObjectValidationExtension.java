/*
 * Copyright (c) 2021-2024, WSO2 LLC. (https://www.wso2.com). All Rights Reserved.
 *
 * This software is the property of WSO2 LLC. and its suppliers, if any.
 * Dissemination of any information or reproduction of any material contained
 * herein in any form is strictly forbidden, unless permitted by WSO2 expressly.
 * You may not alter or remove any copyright or other notice from copies of this content.
 */

package com.wso2.consent.accelerator.request;

import net.minidev.json.JSONObject;
import org.apache.commons.lang.StringUtils;
import org.apache.commons.logging.Log;
import org.apache.commons.logging.LogFactory;
import org.wso2.carbon.identity.oauth.common.OAuth2ErrorCodes;
import org.wso2.carbon.identity.oauth2.RequestObjectException;
import org.wso2.carbon.identity.oauth2.model.OAuth2Parameters;
import org.wso2.carbon.identity.openidconnect.CIBARequestObjectValidatorImpl;
import org.wso2.carbon.identity.openidconnect.model.RequestObject;

import java.text.ParseException;

/**
 * The extension of RequestObjectValidatorImpl to enforce Open Banking specific validations of the
 * request object.
 */
public class OBCIBARequestObjectValidationExtension extends CIBARequestObjectValidatorImpl {

    private static final Log log = LogFactory.getLog(OBCIBARequestObjectValidationExtension.class);

    /**
     * Validations related to clientId, response type, exp, redirect URL, mandatory params,
     * issuer, audience are done. Called after signature validation.
     *
     * @param initialRequestObject request object
     * @param oAuth2Parameters     oAuth2Parameters
     * @throws RequestObjectException - RequestObjectException
     */
    @Override
    public boolean validateRequestObject(RequestObject initialRequestObject, OAuth2Parameters oAuth2Parameters)
            throws RequestObjectException {

        JSONObject intent = null;
        try {
            // Request object now places the intent under claims.id_token.intent_id.value
            JSONObject claims = initialRequestObject.getClaimsSet().getJSONObjectClaim("claims");
            if (claims != null) {
                Object idTokenObj = claims.get("id_token");
                if (idTokenObj instanceof JSONObject) {
                    JSONObject idToken = (JSONObject) idTokenObj;
                    Object intentObj = idToken.get("intent_id");
                    if (intentObj instanceof JSONObject) {
                        intent = (JSONObject) intentObj;
                    }
                }
            }
        } catch (ParseException e) {
            throw new RequestObjectException(OAuth2ErrorCodes.INVALID_REQUEST,
                    "Request object invalid: Unable to parse the request object as json", e);
        }

        if (intent == null || StringUtils.isEmpty(intent.getAsString("value"))) {
            throw new RequestObjectException(OAuth2ErrorCodes.INVALID_REQUEST,
                    "Request object invalid: Empty or missing intent value");
        }

        if (!isAuthorizableConsent(intent.getAsString("value"))) {
            throw new RequestObjectException(OAuth2ErrorCodes.INVALID_REQUEST,
                    "Consent is not in authorizable state");
        }

        return super.validateRequestObject(initialRequestObject, oAuth2Parameters);
    }

    private boolean isAuthorizableConsent(String consentId) throws RequestObjectException {
//        try {
//            DetailedConsentResource detailedConsent = IdentityExtensionsDataHolder.getInstance()
//                    .getConsentCoreService().getDetailedConsent(consentId);
//            if (log.isDebugEnabled()) {
//                log.debug(String.format("Consent status for consent_id %s is %s",
//                        detailedConsent.getConsentID(), detailedConsent.getCurrentStatus()));
//            }
//            return OpenBankingConstants.AWAITING_AUTHORISATION_STATUS.equalsIgnoreCase(
//                    detailedConsent.getCurrentStatus()) ||
//                    OpenBankingConstants.AWAITING_FURTHER_AUTHORISATION_STATUS
//                            .equalsIgnoreCase(detailedConsent.getCurrentStatus());
//        } catch (ConsentManagementException e) {
//            log.error("Error occurred while fetching consent_id", e);
//            throw new RequestObjectException(OAuth2ErrorCodes.INVALID_REQUEST,
//                    "Error occurred while fetching consent_id", e);
//        }
        //todo: implement proper consent state check
        return true;
    }

}
