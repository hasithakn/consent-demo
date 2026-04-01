<%@ page contentType="text/html; charset=UTF-8" pageEncoding="UTF-8" %>
<% response.setCharacterEncoding("UTF-8"); %>
<%@ page import="java.util.List" %>
<%@ page import="java.util.Map" %>
<%@ taglib prefix="fmt" uri="http://java.sun.com/jsp/jstl/fmt" %>
<%@ taglib prefix="c" uri="http://java.sun.com/jsp/jstl/core" %>

<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta http-equiv="X-UA-Compatible" content="IE=edge">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Government Consent Portal</title>
    <link rel="icon" href="images/favicon.png" type="image/x-icon"/>
    <style>
        *, *::before, *::after { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            background: linear-gradient(135deg, #1e3a5f 0%, #2d5986 50%, #1a5276 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
        }
        .consent-wrapper { width: 100%; max-width: 540px; }

        /* Header */
        .consent-header { text-align: center; margin-bottom: 28px; color: #fff; }
        .consent-header .icon { font-size: 44px; margin-bottom: 12px; display: block; }
        .consent-header h1 { font-size: 26px; font-weight: 700; letter-spacing: -0.5px; }
        .consent-header .subtitle { font-size: 14px; color: rgba(255,255,255,0.7); margin-top: 6px; }

        /* Card */
        .consent-card {
            background: #ffffff;
            border-radius: 16px;
            box-shadow: 0 25px 50px rgba(0,0,0,0.25);
            padding: 36px;
        }
        .app-message {
            font-size: 15px; color: #374151; line-height: 1.6;
            padding-bottom: 20px; margin-bottom: 24px;
            border-bottom: 1px solid #e5e7eb;
        }
        .data-label {
            font-size: 12px; font-weight: 700; text-transform: uppercase;
            letter-spacing: 0.8px; color: #6b7280; margin-bottom: 16px;
        }

        /* Consent data sections */
        .data-group {
            background: #f8fafc; border-radius: 12px;
            padding: 16px 20px; margin-bottom: 16px;
        }
        .data-group.required { border-left: 4px solid #2563eb; }
        .data-group.optional { border-left: 4px solid #94a3b8; }
        .data-group-title {
            font-size: 12px; font-weight: 700; text-transform: uppercase;
            letter-spacing: 0.5px; margin-bottom: 12px;
        }
        .data-group.required .data-group-title { color: #2563eb; }
        .data-group.optional .data-group-title { color: #64748b; }

        .cb-row { display: flex; align-items: center; padding: 9px 0; }
        .cb-row + .cb-row { border-top: 1px solid #e2e8f0; }
        .cb-row input[type="checkbox"] {
            width: 18px; height: 18px; margin-right: 12px;
            accent-color: #2563eb; cursor: pointer; flex-shrink: 0;
        }
        .cb-row input[type="checkbox"]:disabled { opacity: 0.6; cursor: default; }
        .cb-row label.cb-label {
            font-size: 14px; color: #1e293b; flex: 1; margin: 0; cursor: pointer;
        }
        .cb-row .req-tag {
            font-size: 10px; font-weight: 700; color: #dc2626;
            background: #fef2f2; padding: 2px 6px; border-radius: 4px;
            margin-left: 8px; text-transform: uppercase;
        }

        /* Basic consent data */
        .consent-info-box {
            background: #eff6ff; border: 1px solid #bfdbfe;
            border-radius: 8px; padding: 12px 16px;
            font-size: 14px; color: #1e40af; margin-bottom: 16px;
        }

        /* Select fields */
        .select-group { margin-bottom: 16px; }
        .select-group label {
            font-size: 13px; font-weight: 600; color: #374151;
            display: block; margin-bottom: 6px;
        }
        .select-group select {
            width: 100%; padding: 10px 12px;
            border: 1px solid #d1d5db; border-radius: 8px;
            font-size: 14px; color: #374151; background: #fff;
            transition: border-color 0.2s, box-shadow 0.2s;
        }
        .select-group select:focus {
            outline: none; border-color: #2563eb;
            box-shadow: 0 0 0 3px rgba(37,99,235,0.1);
        }
        .select-group .hint { font-size: 12px; color: #9ca3af; margin-top: 4px; }

        /* Confirmation text */
        .confirm-text { font-size: 13px; color: #6b7280; margin-bottom: 8px; }
        .confirm-text:empty { display: none; }

        /* Action buttons */
        .action-bar {
            display: flex; gap: 12px;
            margin-top: 28px; padding-top: 24px;
            border-top: 1px solid #e5e7eb;
        }
        .btn-approve, .btn-deny {
            flex: 1; padding: 14px 20px; border-radius: 10px;
            font-size: 15px; font-weight: 600; cursor: pointer;
            transition: all 0.2s ease; border: none;
        }
        .btn-approve {
            background: linear-gradient(135deg, #059669, #10b981);
            color: #fff; box-shadow: 0 4px 14px rgba(5,150,105,0.3);
        }
        .btn-approve:hover { transform: translateY(-1px); box-shadow: 0 6px 20px rgba(5,150,105,0.4); }
        .btn-deny {
            background: #fff; color: #dc2626; border: 2px solid #fecaca;
        }
        .btn-deny:hover { background: #fef2f2; border-color: #f87171; }

        /* Permissions path styles */
        .perm-block {
            border: 1px solid #e2e8f0; border-radius: 10px;
            padding: 16px; margin-bottom: 12px;
        }
        .perm-block b { color: #374151; font-size: 14px; }
        .scopes-list { list-style: disc inside; padding: 8px 0 8px 8px; }
        .scopes-list li { font-size: 14px; color: #374151; padding: 3px 0; }
        .padding { padding: 8px 0; }

        /* Re-auth disclaimer */
        h5.ui.header { font-size: 14px; color: #92400e; margin-bottom: 12px; }

        /* Footer */
        .consent-footer {
            text-align: center; margin-top: 24px;
            font-size: 12px; color: rgba(255,255,255,0.5);
        }
    </style>
</head>
<body>
    <div class="consent-wrapper">
        <div class="consent-header">
            <span class="icon">&#x1F6E1;&#xFE0F;</span>
            <h1>Government Consent Portal</h1>
            <p class="subtitle">Secure Data Authorization</p>
        </div>

        <div class="consent-card">
            <form action="${pageContext.request.contextPath}/oauth2_authz_confirm.do" method="post"
                  id="oauth2_authz_confirm" name="oauth2_authz_confirm">

                <div class="app-message">${appRequestsDetails}</div>

                <c:if test="${not empty permissions or not empty basicConsentData}">
                    <div class="data-label">${dataRequested}</div>
                </c:if>

                <c:if test="${empty permissions}">
                    <jsp:include page="includes/accounts.jsp"/>
                </c:if>

                <jsp:include page="includes/basic-consent-data.jsp"/>

                <c:if test="${not empty permissions}">
                    <jsp:include page="includes/accounts-with-permissions.jsp"/>
                </c:if>

                <jsp:include page="includes/confirmation-dialogue.jsp"/>
            </form>
        </div>

        <div class="consent-footer">
            &copy; Government Consent Portal <script>document.write(new Date().getFullYear());</script>
        </div>
    </div>

    <script src="libs/jquery_3.5.0/jquery-3.5.0.js"></script>
    <script src="libs/bootstrap_3.4.1/js/bootstrap.min.js"></script>
    <script src="js/auth-functions.js"></script>
</body>
</html>
