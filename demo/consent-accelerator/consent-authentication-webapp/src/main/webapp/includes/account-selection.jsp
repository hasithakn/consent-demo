<%@ page contentType="text/html; charset=UTF-8" pageEncoding="UTF-8" %>
<%@ taglib prefix="c" uri="http://java.sun.com/jsp/jstl/core" %>

<c:set var="accountSelectorClass" value="${param.accountSelectorClass}" />
<c:set var="idSuffix" value="${param.idSuffix}" />
<c:set var="ignorePreSelect" value="${param.ignorePreSelect}" />

<%-- Application consent info message --%>
<c:if test="${not empty basicConsentData}">
    <div class="consent-info-box">${basicConsentData}</div>
</c:if>

<%-- Determine mandatory vs optional --%>
<c:set var="hasMandatory" value="false" />
<c:forEach items="${consumerAccounts}" var="account">
    <c:if test='${account.isMandatory eq true || account.isUserApproved eq true}'>
        <c:set var="hasMandatory" value="true" />
    </c:if>
</c:forEach>

<c:set var="hasOptional" value="false" />
<c:forEach items="${consumerAccounts}" var="account">
    <c:if test='${account.isMandatory eq false && account.isUserApproved eq false}'>
        <c:set var="hasOptional" value="true" />
    </c:if>
</c:forEach>

<%-- Required data group --%>
<c:if test="${hasMandatory == 'true'}">
    <div class="data-group required">
        <div class="data-group-title">Required Information</div>
        <c:forEach items="${consumerAccounts}" var="account">
            <c:if test='${account.isMandatory eq true || account.isUserApproved eq true}'>
                <div class="cb-row">
                    <input type="checkbox"
                        id="<c:choose><c:when test='${not empty idSuffix}'>${account.value}-${idSuffix}</c:when><c:otherwise>${account.value}</c:otherwise></c:choose>"
                        name="<c:choose><c:when test='${not empty idSuffix}'>accounts-${idSuffix}</c:when><c:otherwise>accounts</c:otherwise></c:choose>"
                        value="${account.value}"
                        checked="checked"
                        disabled="disabled" />
                    <label class="cb-label"
                        for="<c:choose><c:when test='${not empty idSuffix}'>${account.value}-${idSuffix}</c:when><c:otherwise>${account.value}</c:otherwise></c:choose>">
                        ${account.label}
                    </label>
                    <span class="req-tag">Required</span>
                </div>
                <input type="hidden"
                    name="<c:choose><c:when test='${not empty idSuffix}'>accounts-${idSuffix}</c:when><c:otherwise>accounts</c:otherwise></c:choose>"
                    value="${account.value}" />
            </c:if>
        </c:forEach>
    </div>
</c:if>

<%-- Optional data group --%>
<c:if test="${hasOptional == 'true'}">
    <div class="data-group optional">
        <div class="data-group-title">Optional Information</div>
        <c:forEach items="${consumerAccounts}" var="account">
            <c:if test='${account.isMandatory eq false && account.isUserApproved eq false}'>
                <div class="cb-row">
                    <input type="checkbox"
                        id="<c:choose><c:when test='${not empty idSuffix}'>${account.value}-${idSuffix}</c:when><c:otherwise>${account.value}</c:otherwise></c:choose>"
                        name="<c:choose><c:when test='${not empty idSuffix}'>accounts-${idSuffix}</c:when><c:otherwise>accounts</c:otherwise></c:choose>"
                        value="${account.value}" />
                    <label class="cb-label"
                        for="<c:choose><c:when test='${not empty idSuffix}'>${account.value}-${idSuffix}</c:when><c:otherwise>${account.value}</c:otherwise></c:choose>">
                        ${account.label}
                    </label>
                </div>
            </c:if>
        </c:forEach>
    </div>
</c:if>
