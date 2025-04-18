// frontend/js/script.js
const API_BASE_URL = 'http://127.0.0.1:5000/api'; // Your Flask backend URL

// --- Utility Functions ---
// ... (apiCall, formatCurrency, formatEquity, getQueryParam - keep these as they are) ...
async function apiCall(endpoint, method = 'GET', body = null, requiresAuth = false) {
    const options = {
        method,
        headers: {
            'Content-Type': 'application/json',
        },
        credentials: 'include', // Important for sending/receiving session cookies
    };

    if (body) {
        options.body = JSON.stringify(body);
    }

    try {
        const response = await fetch(`${API_BASE_URL}${endpoint}`, options);

        // Handle unauthorized or forbidden access specifically for auth-required routes
        if (requiresAuth && (response.status === 401 || response.status === 403)) {
            console.warn(`Auth required or forbidden for ${endpoint}. Status: ${response.status}`);
            // Check if already on login page to prevent redirect loop
            if (window.location.pathname.endsWith('/login.html') === false) {
                 window.location.href = 'login.html'; // Redirect to login
            }
            return null; // Stop further processing
        }

        // Try parsing JSON, otherwise return text or blob depending on content-type
        const contentType = response.headers.get('content-type');
        let data;
        if (contentType && contentType.includes('application/json')) {
            // Handle potential empty JSON response (like on logout maybe)
            const text = await response.text();
            data = text ? JSON.parse(text) : {};
        } else {
            data = await response.text(); // Or handle other types like blob if needed
        }


        if (!response.ok) {
            // Log the error message from the API if available
            const errorMessage = data?.error || (typeof data === 'string' ? data : response.statusText);
            console.error(`API Error (${response.status}) on ${method} ${endpoint}: ${errorMessage}`);
            return { ok: false, status: response.status, error: data?.error || `Request failed with status ${response.status}` };
        }

        return { ok: true, status: response.status, data };

    } catch (error) {
        console.error(`Network or fetch error on ${method} ${endpoint}:`, error);
        return { ok: false, error: 'Network error or server is down.' };
    }
}

function formatCurrency(amount) {
    if (amount == null || isNaN(amount)) {
        return 'N/A';
    }
    return '$' + Number(amount).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 0 });
}

function formatEquity(equity) {
     if (equity == null || isNaN(equity)) {
        return 'N/A';
    }
    return Number(equity).toFixed(1) + '%';
}

function getQueryParam(name) {
    const urlParams = new URLSearchParams(window.location.search);
    return urlParams.get(name);
}


// --- Authentication & Navigation ---
// ... (checkAuthStatus, updateNavigation, handleLogout - keep these as they are, including the previous Welcome message change) ...
let currentUser = null;

async function checkAuthStatus() {
    const result = await apiCall('/auth/status');
    if (result && result.ok && result.data.logged_in) {
        currentUser = result.data.user;
    } else {
        currentUser = null;
    }
    updateNavigation();
}

function updateNavigation() {
    const userLinks = document.getElementById('user-links');
    const publicLinks = document.getElementById('public-links');
    const startupLinks = document.getElementById('startup-links');
    const investorLinks = document.getElementById('investor-links');

    if (!userLinks || !publicLinks) {
        return;
    }

    if (currentUser) {
        userLinks.innerHTML = `
            <span id="user-name">Welcome, ${currentUser.name}!</span>
            <button id="logout-button">Logout</button>
        `;
        userLinks.style.display = 'inline';
        publicLinks.style.display = 'none';
        if (startupLinks) startupLinks.style.display = (currentUser.user_type === 'startup') ? 'inline' : 'none';
        if (investorLinks) investorLinks.style.display = (currentUser.user_type === 'investor') ? 'inline' : 'none';
        const logoutButton = document.getElementById('logout-button');
        if (logoutButton) {
             logoutButton.removeEventListener('click', handleLogout);
             logoutButton.addEventListener('click', handleLogout);
        }
    } else {
        userLinks.style.display = 'none';
        publicLinks.style.display = 'inline';
        if (startupLinks) startupLinks.style.display = 'none';
        if (investorLinks) investorLinks.style.display = 'none';
    }

    const currentPage = window.location.pathname.split('/').pop() || 'index.html';
    document.querySelectorAll('nav a').forEach(link => {
        link.classList.remove('active');
        const linkHref = link.getAttribute('href');
        if (linkHref === currentPage || (currentPage === 'index.html' && linkHref === '/')) {
            link.classList.add('active');
        }
        if (currentPage === 'startup-detail.html' && linkHref === 'index.html') {
            link.classList.add('active');
        }
        if (currentPage === 'my-startup.html' && linkHref === 'my-startup.html') {
            link.classList.add('active');
        }
    });
}

async function handleLogout() {
    const result = await apiCall('/logout', 'POST');
    if (result && result.ok) {
        currentUser = null;
        window.location.href = 'index.html';
    } else {
        console.error("Logout failed:", result?.error);
        alert(`Logout failed: ${result?.error || 'Please try again.'}`);
    }
}

// --- Login Page Logic ---
// ... (initLoginPage - keep as is) ...
function initLoginPage() {
    const loginForm = document.getElementById('login-form');
    const messageArea = document.getElementById('message-area');
    if (!loginForm) return;
    loginForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        messageArea.innerHTML = '';
        const email = loginForm.email.value;
        const password = loginForm.password.value;
        if (!email || !password) {
            messageArea.innerHTML = '<p class="message error-message">Please enter both email and password.</p>';
            return;
        }
        const submitButton = loginForm.querySelector('button[type="submit"]');
        const originalButtonText = submitButton.textContent;
        submitButton.textContent = 'Logging in...';
        submitButton.disabled = true;
        const result = await apiCall('/login', 'POST', { email, password });
        submitButton.textContent = originalButtonText;
        submitButton.disabled = false;
        if (result && result.ok) {
            currentUser = result.data.user;
            if (currentUser.user_type === 'startup') {
                 window.location.href = 'my-startup.html';
            } else {
                window.location.href = 'index.html';
            }
        } else {
            messageArea.innerHTML = `<p class="message error-message">${result?.error || 'Login failed. Please check your credentials.'}</p>`;
        }
    });
}

// --- Registration Page Logic ---
// ... (initRegisterPage - keep as is, with previous financial history mods) ...
function initRegisterPage() {
    const registerForm = document.getElementById('register-form');
    const messageArea = document.getElementById('message-area');
    const startupFields = document.getElementById('startup-specific-fields');
    const userTypeRadios = document.querySelectorAll('input[name="user_type"]');
    const financialHistoryContainer = document.getElementById('financial-history-inputs');
    const yearsOperatingInput = document.getElementById('years_operating');
    if (!registerForm || !startupFields || !userTypeRadios || !financialHistoryContainer || !yearsOperatingInput) {
         console.error("One or more required elements for registration page not found.");
         return;
    }
    const toggleStartupFields = () => {
        const selectedType = document.querySelector('input[name="user_type"]:checked')?.value;
        if (selectedType === 'startup') {
            startupFields.style.display = 'block';
            if(yearsOperatingInput) {
                const event = new Event('input', { bubbles: true, cancelable: true });
                yearsOperatingInput.dispatchEvent(event);
            }
        } else {
            startupFields.style.display = 'none';
            if (financialHistoryContainer) {
                 financialHistoryContainer.innerHTML = '';
            }
        }
    };
    userTypeRadios.forEach(radio => {
        radio.addEventListener('change', toggleStartupFields);
    });
    toggleStartupFields();
    let financialYearCounter = 0;
    const addFinancialYearInput = (suggestedYear = '') => {
        financialYearCounter++;
        const yearGroup = document.createElement('div');
        yearGroup.classList.add('financial-year-group');
        const groupId = `fin-group-${financialYearCounter}`;
        yearGroup.id = groupId;
        yearGroup.dataset.year = suggestedYear;
        yearGroup.innerHTML = `
            <strong>Financial Year ${suggestedYear || 'N/A'}</strong>
            <div class="financial-year-inputs">
                <div class="form-group">
                    <label for="fin-revenue-${financialYearCounter}">Revenue ($)</label>
                    <input type="number" step="any" id="fin-revenue-${financialYearCounter}" name="fin_revenue">
                </div>
                 <div class="form-group">
                    <label for="fin-profit-${financialYearCounter}">Profit/Loss ($)</label>
                    <input type="number" step="any" id="fin-profit-${financialYearCounter}" name="fin_profit">
                </div>
            </div>
        `;
        financialHistoryContainer.appendChild(yearGroup);
    };
    yearsOperatingInput.addEventListener('input', (e) => {
        const numYears = Math.max(0, parseInt(e.target.value) || 0);
        financialHistoryContainer.innerHTML = '';
        financialYearCounter = 0;
        if (numYears > 0) {
            const currentCalendarYear = new Date().getFullYear();
            for (let i = 0; i < numYears; i++) {
                const yearToSuggest = currentCalendarYear - 1 - i;
                addFinancialYearInput(yearToSuggest);
            }
        }
    });
    registerForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        messageArea.innerHTML = '';
        const submitButton = registerForm.querySelector('button[type="submit"]');
        const originalButtonText = submitButton.textContent;
        submitButton.textContent = 'Registering...';
        submitButton.disabled = true;
        const formData = new FormData(registerForm);
        const data = Object.fromEntries(formData.entries());
        if (data.password !== data.confirm_password) {
            messageArea.innerHTML = '<p class="message error-message">Passwords do not match.</p>';
            submitButton.textContent = originalButtonText;
            submitButton.disabled = false;
            return;
        }
        if (!data.user_type) {
             messageArea.innerHTML = '<p class="message error-message">Please select user type (Startup or Investor).</p>';
             submitButton.textContent = originalButtonText;
             submitButton.disabled = false;
             return;
        }
        const payload = {
            email: data.email, password: data.password, name: data.name, user_type: data.user_type,
        };
        if (payload.user_type === 'startup') {
            payload.company_name = data.company_name || data.name;
            payload.description = data.description;
            payload.industry = data.industry;
            payload.funding_goal = parseFloat(data.funding_goal) || 0;
            payload.funding_acquired = parseFloat(data.funding_acquired) || 0;
            payload.years_operating = parseInt(data.years_operating) || 0;
            payload.website = data.website;
            payload.logo_url = data.logo_url;
            payload.contact_phone = data.contact_phone;
            payload.equity_offered = parseFloat(data.equity_offered) || 0;
            const financials = [];
            const seenYears = new Set();
            document.querySelectorAll('#financial-history-inputs .financial-year-group').forEach(group => {
                 const yearString = group.dataset.year;
                 const revenueInput = group.querySelector('input[name="fin_revenue"]');
                 const profitInput = group.querySelector('input[name="fin_profit"]');
                 if (yearString && !isNaN(parseInt(yearString)) && revenueInput && profitInput) {
                     const year = parseInt(yearString);
                     const revenue = revenueInput.value !== '' ? parseFloat(revenueInput.value) : null;
                     const profit = profitInput.value !== '' ? parseFloat(profitInput.value) : null;
                     if (!seenYears.has(year)) {
                          financials.push({ year, revenue, profit });
                          seenYears.add(year);
                     } else {
                        console.warn(`Duplicate year ${year} detected during collection, skipping.`);
                        if (!messageArea.innerHTML.includes('Duplicate year')) {
                             messageArea.innerHTML += '<p class="message warning-message">Internal error: Duplicate financial years detected.</p>';
                        }
                     }
                 }
            });
            financials.sort((a, b) => a.year - b.year);
            payload.financials = financials;
        }
        console.log("Sending registration data:", payload);
        const result = await apiCall('/register', 'POST', payload);
        submitButton.textContent = originalButtonText;
        submitButton.disabled = false;
        if (result && result.ok) {
            messageArea.innerHTML = '<p class="message success-message">Registration successful! Redirecting to login...</p>';
            setTimeout(() => { window.location.href = 'login.html'; }, 2000);
        } else {
            messageArea.innerHTML = `<p class="message error-message">${result?.error || 'Registration failed. Please try again.'}</p>`;
        }
    });
}


// --- Index Page Logic ---
// ... (initIndexPage - keep as is) ...
function initIndexPage() {
    const startupListContainer = document.getElementById('startup-list');
    const loadingIndicator = document.getElementById('loading-indicator');
    const filterContainer = document.querySelector('.filter-container');
    if (!startupListContainer || !loadingIndicator) {
        console.error("Missing required elements for index page (startup list or loading indicator).");
        return;
    }
    async function loadStartups(filter = 'all') {
        loadingIndicator.style.display = 'block';
        startupListContainer.innerHTML = '';
        const result = await apiCall('/startups');
        loadingIndicator.style.display = 'none';
        if (result && result.ok) {
            let startups = result.data;
            if (filter !== 'all') {
                 const filterCategory = filter.split('-').map(word => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
                 startups = startups.filter(s => s.risk_category === filterCategory);
            }
            if (!startups || startups.length === 0) {
                 startupListContainer.innerHTML = '<li class="text-center" style="grid-column: 1 / -1;">No startups found matching the criteria.</li>';
                 return;
            }
            startups.forEach(startup => {
                const card = document.createElement('li');
                card.classList.add('startup-card');
                const fundingGoal = startup.funding_goal || 0;
                const fundingAcquired = startup.funding_acquired || 0;
                const progress = (fundingGoal > 0) ? Math.min((fundingAcquired / fundingGoal) * 100, 100) : 0;
                let riskClass = 'unknown';
                if (startup.risk_category) {
                    riskClass = startup.risk_category.toLowerCase().replace(/\s+/g, '-');
                }
                 const logoUrl = startup.logo_url && startup.logo_url.startsWith('http')
                    ? startup.logo_url
                    : `https://via.placeholder.com/55/E1E8ED/888888?text=${startup.company_name?.[0]?.toUpperCase() || '?'}`;
                card.innerHTML = `
                    <div class="card-header">
                        <img src="${logoUrl}" alt="${startup.company_name || 'Startup'} Logo" class="logo" onerror="this.onerror=null;this.src='https://via.placeholder.com/55/E1E8ED/888888?text=?';">
                        <div class="card-header-info">
                            <h3>${startup.company_name || 'Unnamed Startup'}</h3>
                            ${startup.industry ? `<span class="industry">${startup.industry}</span>` : ''}
                        </div>
                    </div>
                    <p class="card-description">${startup.description || 'No description available.'}</p>
                    <div class="funding-info">
                        <span>Funding Goal: <strong>${formatCurrency(fundingGoal)}</strong></span>
                        <span>Funding Acquired: <strong>${formatCurrency(fundingAcquired)}</strong></span>
                         ${fundingGoal > 0 ? `
                         <div class="progress-bar-container" title="${progress.toFixed(1)}% Funded">
                             <div class="progress-bar" style="width: ${progress.toFixed(1)}%;"></div>
                         </div>
                         ` : ''}
                    </div>
                    <div class="risk-indicator">
                        <span class="risk-badge risk-${riskClass}">
                            ${startup.risk_category || 'Risk N/A'}
                        </span>
                    </div>
                    <a href="startup-detail.html?id=${startup.id}" class="details-button button-style">View Details</a>
                `;
                startupListContainer.appendChild(card);
            });
        } else {
            startupListContainer.innerHTML = `<li class="message error-message" style="grid-column: 1 / -1;">Failed to load startups: ${result?.error || 'Server error'}</li>`;
        }
    }
     if (filterContainer) {
        const filterButtons = filterContainer.querySelectorAll('.filter-button');
        filterButtons.forEach(button => {
             button.addEventListener('click', () => {
                 filterButtons.forEach(btn => btn.classList.remove('active'));
                 button.classList.add('active');
                 const filterValue = button.dataset.filter || 'all';
                 loadStartups(filterValue);
             });
         });
          const allButton = filterContainer.querySelector('.filter-button[data-filter="all"]');
          if(allButton && !filterContainer.querySelector('.filter-button.active')) {
              allButton.classList.add('active');
          }
     }
    loadStartups();
}

// --- Startup Detail Page Logic ---
// ... (initStartupDetailPage - keep as is) ...
function initStartupDetailPage() {
    const startupId = getQueryParam('id');
    const detailContainer = document.getElementById('startup-detail-content');
    const loadingIndicator = document.getElementById('loading-indicator');
    const messageArea = document.getElementById('detail-message-area');
    if (!startupId) {
        console.error("No startup ID found in URL query parameters.");
        if (loadingIndicator) loadingIndicator.textContent = 'Error: Startup ID is missing.';
        return;
    }
    if (!detailContainer || !loadingIndicator || !messageArea) {
         console.error("Missing required elements for startup detail page.");
         if(loadingIndicator) loadingIndicator.textContent = 'Error: Page structure incomplete.';
         return;
    }
    async function loadStartupDetails() {
        loadingIndicator.style.display = 'block';
        detailContainer.style.display = 'none';
        messageArea.innerHTML = '';
        const result = await apiCall(`/startups/${startupId}`);
        loadingIndicator.style.display = 'none';
        if (result && result.ok) {
            const startup = result.data;
            detailContainer.style.display = 'block';
             const logoUrl = startup.logo_url && startup.logo_url.startsWith('http')
                    ? startup.logo_url
                    : `https://via.placeholder.com/130/E1E8ED/888888?text=${startup.company_name?.[0]?.toUpperCase() || '?'}`;
            document.getElementById('detail-logo').src = logoUrl;
            document.getElementById('detail-logo').onerror = function() { this.onerror=null; this.src='https://via.placeholder.com/130/E1E8ED/888888?text=?'; };
            document.getElementById('detail-logo').alt = `${startup.company_name || 'Startup'} Logo`;
            document.getElementById('detail-company-name').textContent = startup.company_name || 'N/A';
            const industryTag = document.getElementById('detail-industry');
            industryTag.textContent = startup.industry || '';
            industryTag.style.display = startup.industry ? 'inline-block' : 'none';
            document.getElementById('detail-years-operating').textContent = `${startup.years_operating ?? 'N/A'} years`;
            const websiteSpan = document.getElementById('detail-website');
             if (startup.website) {
                 let url = startup.website;
                 if (!url.match(/^https?:\/\//i)) { url = 'https://' + url; }
                 websiteSpan.innerHTML = `<a href="${url}" target="_blank" rel="noopener noreferrer">${startup.website}</a>`;
             } else { websiteSpan.textContent = 'N/A'; }
            document.getElementById('detail-founder-name').textContent = startup.founder_name || 'N/A';
            document.getElementById('detail-founder-email').innerHTML = startup.founder_email ? `<a href="mailto:${startup.founder_email}">${startup.founder_email}</a>` : 'N/A';
            document.getElementById('detail-contact-phone').innerHTML = startup.contact_phone ? `<a href="tel:${startup.contact_phone}">${startup.contact_phone}</a>` : 'N/A';
            document.getElementById('detail-description').textContent = startup.description || 'No description provided.';
            document.getElementById('detail-funding-goal').textContent = formatCurrency(startup.funding_goal);
            document.getElementById('detail-funding-acquired').textContent = formatCurrency(startup.funding_acquired);
            document.getElementById('detail-equity-offered').textContent = formatEquity(startup.equity_offered);
            document.getElementById('detail-calculated-valuation').textContent = formatCurrency(startup.calculated_valuation) || 'N/A (Cannot calculate)';
            const financialTableBody = document.getElementById('financial-history-body');
            financialTableBody.innerHTML = '';
            if (startup.financial_history && Array.isArray(startup.financial_history) && startup.financial_history.length > 0) {
                 let previousRevenue = null;
                 startup.financial_history.sort((a, b) => a.year - b.year);
                startup.financial_history.forEach((item, index) => {
                    const row = financialTableBody.insertRow();
                     let growthText = 'N/A', growthClass = '';
                     if (previousRevenue !== null && typeof previousRevenue === 'number' && Math.abs(previousRevenue) > 0 && item.revenue !== null && typeof item.revenue === 'number') {
                         const growth = ((item.revenue - previousRevenue) / Math.abs(previousRevenue)) * 100;
                         growthText = growth.toFixed(1) + '%';
                         growthClass = growth >= 0 ? 'growth-positive' : 'growth-negative';
                     } else if (index > 0 && previousRevenue !== null) { growthText = 'N/A'; }
                       else if (index === 0) { growthText = 'N/A'; }
                     previousRevenue = item.revenue;
                    let profitClass = '';
                    if(item.profit !== null && typeof item.profit === 'number') {
                        profitClass = item.profit >= 0 ? 'profit-positive' : 'profit-negative';
                    }
                    row.insertCell().outerHTML = `<td data-label="Year">${item.year}</td>`;
                    row.insertCell().outerHTML = `<td data-label="Revenue" class="text-right">${formatCurrency(item.revenue)}</td>`;
                    row.insertCell().outerHTML = `<td data-label="Profit/Loss" class="text-right ${profitClass}">${formatCurrency(item.profit)}</td>`;
                    row.insertCell().outerHTML = `<td data-label="Growth" class="text-right ${growthClass}">${growthText}</td>`;
                });
            } else {
                 const row = financialTableBody.insertRow();
                 row.insertCell().outerHTML = `<td colspan="4" class="text-center">No financial history provided.</td>`;
            }
            const riskSection = document.getElementById('risk-analysis-section');
            const riskSummary = document.getElementById('risk-summary');
            const riskReasonsList = document.getElementById('risk-reasons');
            riskReasonsList.innerHTML = '';
            riskSection.className = 'detail-section risk-analysis-section';
            if (startup.risk_analysis && startup.risk_analysis.category) {
                const risk = startup.risk_analysis;
                const riskClass = risk.category.toLowerCase().replace(/\s+/g, '-');
                riskSection.classList.add(riskClass);
                document.getElementById('risk-category-title').textContent = risk.category || 'Risk Analysis';
                riskSummary.textContent = `Calculated Risk Score: ${risk.score !== undefined ? risk.score.toFixed(1) : 'N/A'}`;
                if (risk.reasons && Array.isArray(risk.reasons) && risk.reasons.length > 0) {
                    risk.reasons.forEach(reason => {
                        const li = document.createElement('li'); li.textContent = reason; riskReasonsList.appendChild(li);
                    });
                } else { riskReasonsList.innerHTML = '<li>No specific contributing factors identified.</li>'; }
                riskSection.style.display = 'block';
            } else { riskSection.style.display = 'none'; }
            const interestButtonContainer = document.getElementById('investor-interest-action');
            interestButtonContainer.innerHTML = '';
             if (currentUser && currentUser.user_type === 'investor') {
                const button = document.createElement('button');
                button.classList.add('button-style', 'mt-2');
                if (startup.investor_has_expressed_interest) {
                    button.textContent = 'Withdraw Interest';
                    button.classList.add('secondary');
                    button.addEventListener('click', () => handleInterest(startupId, 'DELETE', button));
                } else {
                    button.textContent = 'Express Interest';
                    button.addEventListener('click', () => handleInterest(startupId, 'POST', button));
                }
                interestButtonContainer.appendChild(button);
            }
        } else {
            detailContainer.innerHTML = `<p class="message error-message">Failed to load startup details: ${result?.error || 'Startup not found or server error'}</p>`;
             detailContainer.style.display = 'block';
        }
    }
    async function handleInterest(id, method, buttonElement) {
        messageArea.innerHTML = '';
        buttonElement.disabled = true;
        const originalButtonText = buttonElement.textContent;
        buttonElement.textContent = 'Processing...';
        const result = await apiCall(`/startups/${id}/interest`, method, null, true);
        buttonElement.disabled = false;
        buttonElement.textContent = originalButtonText;
        if (result === null) return;
        if (result.ok) {
            messageArea.innerHTML = `<p class="message success-message">${result.data.message}</p>`;
            loadStartupDetails();
        } else {
            messageArea.innerHTML = `<p class="message error-message">${result.error || 'Action failed.'}</p>`;
        }
         setTimeout(() => { messageArea.innerHTML = ''; }, 4000);
    }
    loadStartupDetails();
}

// --- My Startup Page Logic (Dashboard/Edit for Startups) ---
// **** THIS FUNCTION WAS UPDATED ****
function initMyStartupPage() {
    // Keep references to profile and financials forms
    const profileForm = document.getElementById('startup-profile-form');
    const financialsForm = document.getElementById('startup-financials-form');
    const profileMessageArea = document.getElementById('profile-message-area');
    const financialsMessageArea = document.getElementById('financials-message-area');
    const financialHistoryContainer = document.getElementById('financial-history-edit-inputs');
    const addYearButton = document.getElementById('add-financial-year-edit');
    const yearsOperatingInput = document.getElementById('edit-years_operating'); // Get the target input

    // **** REMOVED analytics element references ****
    // const analyticsContainer = document.getElementById('startup-analytics');
    // const interestedInvestorsList = document.getElementById('interested-investors-list');

    // Simplified check for essential elements
    if (!profileForm || !financialsForm || !financialHistoryContainer || !addYearButton || !yearsOperatingInput || !profileMessageArea || !financialsMessageArea) {
         console.error("One or more required elements for 'My Startup' page not found.");
         const mainArea = document.querySelector('main');
         if (mainArea) {
             mainArea.innerHTML = '<p class="message error-message">Error initializing dashboard page. Please try again later.</p>';
         }
         return;
    }

    let currentFinancialData = [];
    let financialYearEditCounter = 0;

    // **** NEW FUNCTION: Update Years Operating Input ****
    function updateYearsOperatingBasedOnFinancialRecords() {
        if (financialHistoryContainer && yearsOperatingInput) {
            const recordCount = financialHistoryContainer.querySelectorAll('.financial-year-group').length;
            yearsOperatingInput.value = recordCount;
        }
    }

     // Financial History Input Handling (Edit Page)
     const addFinancialYearEditInput = (yearData = null) => {
        financialYearEditCounter++;
        const yearGroup = document.createElement('div');
        yearGroup.classList.add('financial-year-group');
        const groupId = `edit-fin-group-${financialYearEditCounter}`;
        yearGroup.id = groupId;

        const currentYear = yearData ? yearData.year : '';
        const currentRevenue = yearData ? yearData.revenue : '';
        const currentProfit = yearData ? yearData.profit : '';

        yearGroup.innerHTML = `
            <strong>Financial Record</strong>
            <div class="financial-year-inputs">
                <div class="form-group">
                    <label for="edit-fin-year-${financialYearEditCounter}">Year</label>
                    <input type="number" id="edit-fin-year-${financialYearEditCounter}" name="fin_year" placeholder="e.g., 2023" value="${currentYear}" required>
                </div>
                <div class="form-group">
                    <label for="edit-fin-revenue-${financialYearEditCounter}">Revenue ($)</label>
                    <input type="number" step="any" id="edit-fin-revenue-${financialYearEditCounter}" name="fin_revenue" placeholder="Leave blank if N/A" value="${currentRevenue ?? ''}">
                </div>
                 <div class="form-group">
                    <label for="edit-fin-profit-${financialYearEditCounter}">Profit/Loss ($)</label>
                    <input type="number" step="any" id="edit-fin-profit-${financialYearEditCounter}" name="fin_profit" placeholder="Leave blank if N/A" value="${currentProfit ?? ''}">
                </div>
            </div>
            <button type="button" class="remove-financial-year secondary" data-target-group-id="${groupId}">Remove Record</button>
        `;
        financialHistoryContainer.appendChild(yearGroup);

        // Add listener to the new remove button
        const removeButton = yearGroup.querySelector('.remove-financial-year');
        if(removeButton) {
             removeButton.addEventListener('click', (e) => {
                 const targetGroupId = e.target.dataset.targetGroupId;
                 const groupToRemove = document.getElementById(targetGroupId);
                 if(groupToRemove) {
                     groupToRemove.remove();
                     // **** Call update function after removing ****
                     updateYearsOperatingBasedOnFinancialRecords();
                 }
             });
        }
    };

    // Add button listener
    addYearButton.addEventListener('click', () => {
        addFinancialYearEditInput();
        // **** Call update function after adding ****
        updateYearsOperatingBasedOnFinancialRecords();
    });


    // --- Load Startup Data ---
    async function loadMyStartupData() {
        profileMessageArea.innerHTML = '';
        financialsMessageArea.innerHTML = '';
        // **** REMOVED analytics list clearing ****
        // interestedInvestorsList.innerHTML = '<li>Loading...</li>';
        financialHistoryContainer.innerHTML = '';
        financialYearEditCounter = 0;

        profileForm.style.opacity = '0.5';
        financialsForm.style.opacity = '0.5';

        const profileResult = await apiCall('/my-startup', 'GET', null, true);

        profileForm.style.opacity = '1';

        if (profileResult === null) return;

        if (profileResult.ok && profileResult.data) {
            const startup = profileResult.data;

            // Populate Profile Form
            profileForm.company_name.value = startup.company_name || '';
            profileForm.description.value = startup.description || '';
            profileForm.industry.value = startup.industry || '';
            profileForm.funding_goal.value = startup.funding_goal ?? '';
            profileForm.funding_acquired.value = startup.funding_acquired ?? '';
            profileForm.years_operating.value = startup.years_operating ?? ''; // Initially load value from DB
            profileForm.website.value = startup.website || '';
            profileForm.logo_url.value = startup.logo_url || '';
            profileForm.contact_phone.value = startup.contact_phone || '';
            profileForm.equity_offered.value = startup.equity_offered ?? '';

            // Populate Financials Form Area
            financialsForm.style.opacity = '1';
            currentFinancialData = startup.financial_history || [];
             if (Array.isArray(currentFinancialData) && currentFinancialData.length > 0) {
                  currentFinancialData.sort((a, b) => a.year - b.year);
                  currentFinancialData.forEach(yearData => {
                      addFinancialYearEditInput(yearData);
                  });
             } else {
                 addFinancialYearEditInput(); // Add one empty block if none exist
                 financialsMessageArea.innerHTML = '<p><small>No financial history saved yet. Add records below.</small></p>';
             }
            // **** Call update function after initial population ****
            updateYearsOperatingBasedOnFinancialRecords();

        } else {
            profileMessageArea.innerHTML = `<p class="message error-message">Failed to load profile data: ${profileResult.error || 'Error loading profile.'}</p>`;
            financialsForm.style.opacity = '1';
            financialHistoryContainer.innerHTML = '<p class="message error-message">Could not load financial data.</p>';
            addFinancialYearEditInput();
            // **** Call update function even on error (will set years to 1) ****
            updateYearsOperatingBasedOnFinancialRecords();
        }

        // **** REMOVED analytics API call and population ****
        // const analyticsResult = await apiCall('/my-startup/analytics', 'GET', null, true);
        // ... (removed result handling for analytics) ...
    }

    // --- Handle Profile Form Update (Keep as is, Years Operating is readOnly but value will be submitted) ---
    profileForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        profileMessageArea.innerHTML = '<p>Updating profile...</p>';
        const submitButton = profileForm.querySelector('button[type="submit"]');
        submitButton.disabled = true;
        const formData = new FormData(profileForm);
        const data = {};
        for (const [key, value] of formData.entries()) {
            const numericFields = ['funding_goal', 'funding_acquired', 'equity_offered', 'years_operating'];
            const optionalTextFields = ['website', 'logo_url', 'description', 'industry', 'contact_phone'];
             if (value !== null && value !== '') {
                if (numericFields.includes(key)) {
                     const num = key === 'years_operating' ? parseInt(value) : parseFloat(value);
                     data[key] = isNaN(num) ? null : num;
                 } else { data[key] = value; }
            } else {
                if (optionalTextFields.includes(key)) { data[key] = null; }
                else if (numericFields.includes(key)){ data[key] = null; }
            }
        }
        data.company_name = data.company_name || '';
        const result = await apiCall('/my-startup', 'PUT', data, true);
        submitButton.disabled = false;
        if (result === null) return;
        if (result.ok) {
            profileMessageArea.innerHTML = `<p class="message success-message">${result.data.message}</p>`;
        } else {
            profileMessageArea.innerHTML = `<p class="message error-message">Profile update failed: ${result.error || 'Please check your input.'}</p>`;
        }
         setTimeout(() => { profileMessageArea.innerHTML = ''; }, 4000);
    });

     // --- Handle Financials Form Update (Keep as is) ---
    financialsForm.addEventListener('submit', async (e) => {
         e.preventDefault();
         financialsMessageArea.innerHTML = '<p>Updating financials...</p>';
         const submitButton = financialsForm.querySelector('button[type="submit"]');
         submitButton.disabled = true;
         const updatedFinancials = [];
         const seenYears = new Set();
         document.querySelectorAll('#financial-history-edit-inputs .financial-year-group').forEach(group => {
             const yearInput = group.querySelector('input[name="fin_year"]');
             const revenueInput = group.querySelector('input[name="fin_revenue"]');
             const profitInput = group.querySelector('input[name="fin_profit"]');
             if (yearInput && yearInput.value && !isNaN(parseInt(yearInput.value))) {
                 const year = parseInt(yearInput.value);
                 const revenue = revenueInput && revenueInput.value !== '' ? parseFloat(revenueInput.value) : null;
                 const profit = profitInput && profitInput.value !== '' ? parseFloat(profitInput.value) : null;
                 if (!seenYears.has(year)) {
                    updatedFinancials.push({'year': year, 'revenue': revenue, 'profit': profit});
                    seenYears.add(year);
                 } else {
                     console.warn(`Duplicate year skipped: ${year}`);
                     if (!financialsMessageArea.innerHTML.includes('Duplicate year')) {
                         financialsMessageArea.innerHTML += `<p class="message warning-message">Duplicate year ${year} was ignored.</p>`;
                     }
                 }
             } else if (yearInput && !yearInput.value) {
                  if (!financialsMessageArea.innerHTML.includes('Missing year')) {
                         financialsMessageArea.innerHTML += `<p class="message warning-message">Record skipped because year was missing.</p>`;
                     }
             }
         });
         updatedFinancials.sort((a, b) => a.year - b.year);
         const result = await apiCall('/my-startup/financials', 'PUT', updatedFinancials, true);
          submitButton.disabled = false;
         if (result === null) return;
         if (result.ok) {
             financialsMessageArea.innerHTML = `<p class="message success-message">${result.data.message}</p>`;
             currentFinancialData = result.data.updated_financials || updatedFinancials;
             // Update years operating value *after* successful save too, though it should match UI count
             updateYearsOperatingBasedOnFinancialRecords();
         } else {
             financialsMessageArea.innerHTML = `<p class="message error-message">Financials update failed: ${result.error || 'Error occurred.'}</p>`;
         }
          setTimeout(() => { financialsMessageArea.innerHTML = ''; }, 4000);
     });

    // Load data when page initializes
    loadMyStartupData();
}


// --- Page Initialization ---
// ... (DOMContentLoaded - keep as is) ...
document.addEventListener('DOMContentLoaded', () => {
    checkAuthStatus().then(() => {
        const bodyId = document.body.id;
        if (bodyId === 'page-login') { initLoginPage(); }
        else if (bodyId === 'page-register') { initRegisterPage(); }
        else if (bodyId === 'page-index') { initIndexPage(); }
        else if (bodyId === 'page-startup-detail') { initStartupDetailPage(); }
        else if (bodyId === 'page-my-startup') {
             if (!currentUser || currentUser.user_type !== 'startup') {
                  console.log("User not logged in as startup, redirecting...");
                  window.location.href = 'login.html';
                 return;
             }
            initMyStartupPage();
        } else { console.log("No specific initialization logic for this page body ID:", bodyId); }
         updateNavigation();
        document.querySelectorAll('.initially-hidden').forEach(el => {
            el.style.visibility = 'visible';
        });
    }).catch(error => {
         console.error("Error during initial auth status check:", error);
         document.querySelectorAll('.initially-hidden').forEach(el => {
             el.style.visibility = 'visible';
         });
         updateNavigation();
    });
});