<%--
 ~ Copyright (c) 2025, WSO2 LLC. (https://www.wso2.com).
 ~
 ~ WSO2 LLC. licenses this file to you under the Apache License,
 ~ Version 2.0 (the "License"); you may not use this file except
 ~ in compliance with the License.
 ~ You may obtain a copy of the License at
 ~
 ~     http://www.apache.org/licenses/LICENSE-2.0
 ~
 ~ Unless required by applicable law or agreed to in writing,
 ~ software distributed under the License is distributed on an
 ~ "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
 ~ KIND, either express or implied. See the License for the
 ~ specific language governing permissions and limitations
 ~ under the License.
 --%>

<%@ page contentType="text/html;charset=UTF-8" language="java" %>
<%@ page import="org.json.JSONArray" %>
<%@ page import="org.json.JSONObject" %>
<%@ page import="org.owasp.encoder.Encode" %>

<%@ page import="java.util.List" %>
<%@ page import="java.util.ArrayList" %>
<%@ page import="org.apache.commons.lang.StringUtils" %>
<%@ page import="org.apache.commons.lang.ArrayUtils" %>
<%@ page import="java.util.stream.Stream" %>

<%@ taglib prefix = "fmt" uri = "http://java.sun.com/jsp/jstl/fmt" %>
<%@ taglib prefix = "c" uri = "http://java.sun.com/jsp/jstl/core" %>

<html>
<head>
    <jsp:include page="includes/head.jsp"/>
    <script src="libs/jquery_3.5.0/jquery-3.5.0.js"></script>
    <script src="js/auth-functions.js"></script>
    <style>
      /* Modern consent page styles */
      .consent-page {
        min-height: 100vh;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 20px;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      }
      .consent-card {
        background: #fff;
        border-radius: 16px;
        box-shadow: 0 20px 60px rgba(0,0,0,.2);
        max-width: 480px;
        width: 100%;
        overflow: hidden;
      }
      .consent-header {
        background: linear-gradient(135deg, #1a237e, #283593);
        color: #fff;
        padding: 28px 32px;
        text-align: center;
      }
      .consent-header .shield-icon {
        width: 56px; height: 56px;
        background: rgba(255,255,255,.15);
        border-radius: 50%;
        display: flex; align-items: center; justify-content: center;
        margin: 0 auto 12px;
        font-size: 28px;
      }
      .consent-header h2 {
        margin: 0; font-size: 20px; font-weight: 600;
      }
      .consent-header .app-name {
        display: inline-block;
        background: rgba(255,255,255,.2);
        padding: 4px 16px;
        border-radius: 20px;
        font-size: 14px;
        margin-top: 10px;
        font-weight: 500;
      }
      .consent-body {
        padding: 24px 32px 32px;
      }
      .consent-description {
        color: #616161;
        font-size: 14px;
        line-height: 1.6;
        margin-bottom: 20px;
        text-align: center;
      }
      .consent-section-title {
        font-size: 13px;
        font-weight: 600;
        color: #212121;
        text-transform: uppercase;
        letter-spacing: .5px;
        margin-bottom: 12px;
        display: flex;
        align-items: center;
        gap: 8px;
      }
      .consent-section-title::before {
        content: '';
        width: 3px; height: 16px;
        background: #3f51b5;
        border-radius: 2px;
      }
      .scope-list {
        list-style: none;
        padding: 0;
        margin: 0 0 20px;
      }
      .scope-list li {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px 14px;
        background: #f8f9ff;
        border-radius: 8px;
        margin-bottom: 6px;
        font-size: 14px;
        color: #212121;
      }
      .scope-list li::before {
        content: '✓';
        color: #3f51b5;
        font-weight: 700;
        font-size: 13px;
      }
      .claim-group {
        margin-bottom: 20px;
      }
      .select-all-row {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px 14px;
        background: #e8eaf6;
        border-radius: 8px;
        margin-bottom: 8px;
        font-size: 13px;
        font-weight: 600;
        color: #283593;
        cursor: pointer;
      }
      .claim-item {
        display: flex;
        align-items: center;
        gap: 10px;
        padding: 10px 14px;
        background: #fafafa;
        border: 1px solid #f0f0f0;
        border-radius: 8px;
        margin-bottom: 4px;
        font-size: 14px;
        transition: background .15s;
        cursor: pointer;
      }
      .claim-item:hover {
        background: #f0f4ff;
        border-color: #c5cae9;
      }
      .claim-item input[type="checkbox"] {
        accent-color: #3f51b5;
        width: 18px; height: 18px;
        flex-shrink: 0;
      }
      .claim-item .claim-name {
        flex: 1;
      }
      .claim-item .mandatory-star {
        color: #c62828;
        font-weight: 700;
        font-size: 16px;
      }
      .mandatory-hint {
        font-size: 12px;
        color: #9e9e9e;
        margin-top: 8px;
        margin-bottom: 16px;
      }
      .mandatory-hint .star {
        color: #c62828;
        font-weight: 700;
      }
      .privacy-notice {
        background: #fff8e1;
        border: 1px solid #ffe082;
        border-radius: 8px;
        padding: 12px 16px;
        font-size: 12px;
        color: #795548;
        line-height: 1.5;
        margin-bottom: 24px;
      }
      .privacy-notice a {
        color: #3f51b5;
        text-decoration: underline;
      }
      .consent-actions {
        display: flex;
        gap: 12px;
      }
      .btn-consent {
        flex: 1;
        padding: 14px 24px;
        border: none;
        border-radius: 10px;
        font-size: 15px;
        font-weight: 600;
        cursor: pointer;
        transition: all .2s;
      }
      .btn-approve-consent {
        background: linear-gradient(135deg, #2e7d32, #388e3c);
        color: #fff;
        box-shadow: 0 4px 12px rgba(46,125,50,.3);
      }
      .btn-approve-consent:hover {
        box-shadow: 0 6px 20px rgba(46,125,50,.4);
        transform: translateY(-1px);
      }
      .btn-deny-consent {
        background: #fff;
        color: #c62828;
        border: 2px solid #ef9a9a;
      }
      .btn-deny-consent:hover {
        background: #c62828;
        color: #fff;
        border-color: #c62828;
      }
    </style>
</head>

<body>

<div class="consent-page">
  <div class="consent-card">
    <div class="consent-header">
      <div class="shield-icon">🛡️</div>
      <h2>Data Sharing Consent</h2>
      <div class="app-name">${app}</div>
    </div>

    <div class="consent-body">
      <p class="consent-description">
        This application is requesting permission to access your personal information.
        Please review the details below and decide whether to approve or deny this request.
      </p>

      <form action="../../oauth2/authorize" method="post" id="profile" name="oauth2_authz">

        <c:if test="${userClaimsConsentOnly eq false}">
          <c:if test="${not empty OIDCScopes}">
            <div class="consent-section-title">Requested Permissions</div>
            <ul class="scope-list">
              <c:forEach items="${OIDCScopes}" var="record">
                <li>${record}</li>
              </c:forEach>
            </ul>
          </c:if>
        </c:if>

        <c:if test="${not empty mandatoryClaims || not empty requestedClaims}">
          <input type="hidden" name="user_claims_consent" id="user_claims_consent" value="true"/>

          <div class="consent-section-title">Personal Data to Share</div>
          <div class="claim-group">
            <label class="select-all-row">
              <input type="checkbox" name="consent_select_all" id="consent_select_all"/>
              Select All
            </label>

            <c:forEach items="${mandatoryClaims}" var="record">
              <label class="claim-item">
                <input class="mandatory-claim" type="checkbox"
                       name="consent_${record['claimId']}"
                       id="consent_${record['claimId']}"
                       required/>
                <span class="claim-name">${record['displayName']}</span>
                <span class="mandatory-star">*</span>
              </label>
            </c:forEach>

            <c:forEach items="${requestedClaims}" var="record">
              <label class="claim-item">
                <input type="checkbox"
                       name="consent_${record['claimId']}"
                       id="consent_${record['claimId']}"/>
                <span class="claim-name">${record['displayName']}</span>
              </label>
            </c:forEach>
          </div>

          <div class="mandatory-hint">
            <span class="star">*</span> Required fields must be selected to proceed.
          </div>
        </c:if>

        <div class="privacy-notice">
          🔒 Your data will only be shared for the stated purpose.
          Review our <a href="privacy_policy.do" target="policy-pane">Privacy Policy</a> for more information.
        </div>

        <input type="hidden" name="sessionDataKeyConsent" value="${sessionDataKeyConsent}"/>
        <input type="hidden" name="consent" id="consent" value="deny"/>

        <div class="consent-actions">
          <input type="button" class="btn-consent btn-approve-consent" id="approve"
                 name="approve"
                 onclick="approvedDefaultClaim(); return false;"
                 value="Approve"/>
          <input type="button" class="btn-consent btn-deny-consent"
                 onclick="denyDefaultClaim(); return false;"
                 value="Deny"/>
        </div>
      </form>
    </div>
  </div>
</div>

<script src="libs/bootstrap_3.4.1/js/bootstrap.min.js"></script>
</body>
</html>

