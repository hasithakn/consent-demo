/*
 * Copyright (c) 2024, WSO2 LLC. (https://www.wso2.com). All Rights Reserved.
 *
 * This software is the property of WSO2 LLC. and its suppliers, if any.
 * Dissemination of any information or reproduction of any material contained
 * herein in any form is strictly forbidden, unless permitted by WSO2 expressly.
 * You may not alter or remove any copyright or other notice from copies of this content.
 */


package com.wso2.consent.accelerator.response.validator;

import org.apache.oltu.oauth2.common.exception.OAuthProblemException;
import org.wso2.carbon.identity.oauth.ciba.handlers.CibaResponseTypeValidator;

import javax.servlet.http.HttpServletRequest;

/**
 * Validates authorize responses with cibaAuthCode as response type.
 */
public class OBCibaResponseTypeValidator extends CibaResponseTypeValidator {

    @Override
    public void validateContentType(HttpServletRequest request) throws OAuthProblemException {
        // Overriding content type validation
        // This is for browser flow with cibaAuthCode response type. (Web-Auth link scenario)
    }

}
