// AssetFlow ERP Frontend Application Logic

// Global State
let currentUser = null;
let departments = [];
let categories = [];
let employees = [];
let assets = [];
let transfers = [];
let currentAuditCycle = null;
let charts = {};

// API Headers Helper
function getHeaders() {
    return {
        "Content-Type": "application/json",
        "X-User-Email": currentUser ? currentUser.email : ""
    };
}

// Format Date string to readable local time
function formatDateString(isoStr) {
    if (!isoStr) return "";
    try {
        const d = new Date(isoStr);
        return d.toLocaleString();
    } catch (e) {
        return isoStr;
    }
}

// --- SYNTHESIZED BROWSER AUDIO FEEDBACK (Web Audio API) ---

function getAudioContext() {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    return AudioContext ? new AudioContext() : null;
}

// Standard QR Scanner Beep
function playScanBeep() {
    try {
        const ctx = getAudioContext();
        if (!ctx) return;
        
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        
        osc.type = "sine";
        osc.frequency.setValueAtTime(1400, ctx.currentTime);
        
        gain.gain.setValueAtTime(0.08, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
        
        osc.connect(gain);
        gain.connect(ctx.destination);
        
        osc.start();
        osc.stop(ctx.currentTime + 0.12);
    } catch (e) {
        console.warn("Audio Context blocked by browser policy.", e);
    }
}

// Double Pitch Success Beep
function playSuccessSound() {
    try {
        const ctx = getAudioContext();
        if (!ctx) return;
        
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        
        osc.type = "sine";
        osc.frequency.setValueAtTime(900, ctx.currentTime);
        osc.frequency.setValueAtTime(1300, ctx.currentTime + 0.08); // Steps up
        
        gain.gain.setValueAtTime(0.06, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.25);
        
        osc.connect(gain);
        gain.connect(ctx.destination);
        
        osc.start();
        osc.stop(ctx.currentTime + 0.25);
    } catch (e) {
        console.warn(e);
    }
}

// Low Buzz Error Sound
function playErrorSound() {
    try {
        const ctx = getAudioContext();
        if (!ctx) return;
        
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(150, ctx.currentTime); // Low buzz frequency
        
        gain.gain.setValueAtTime(0.12, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
        
        osc.connect(gain);
        gain.connect(ctx.destination);
        
        osc.start();
        osc.stop(ctx.currentTime + 0.3);
    } catch (e) {
        console.warn(e);
    }
}

// Toast Notifications Helper
function showToast(message, type = "success") {
    const container = document.getElementById("toast-container");
    if (!container) return;
    
    const toast = document.createElement("div");
    toast.className = `toast toast-${type}`;
    
    let icon = "check-circle";
    if (type === "error") icon = "alert-octagon";
    else if (type === "warning") icon = "alert-triangle";
    else if (type === "info") icon = "info";
    
    toast.innerHTML = `
        <i data-lucide="${icon}"></i>
        <span>${message}</span>
    `;
    
    container.appendChild(toast);
    lucide.createIcons();
    
    // Slide in
    setTimeout(() => {
        toast.style.opacity = "1";
    }, 10);
    
    // Auto-remove after 4s
    setTimeout(() => {
        toast.style.transform = "translateX(120%)";
        toast.style.opacity = "0";
        setTimeout(() => {
            if (toast.parentNode === container) {
                container.removeChild(toast);
            }
        }, 350);
    }, 4000);
}

// Initialize Application
document.addEventListener("DOMContentLoaded", () => {
    setupEventListeners();
    checkAuthSession();
});

// Check if user is logged in
async function checkAuthSession() {
    const savedEmail = localStorage.getItem("assetflow_email");
    if (savedEmail) {
        try {
            const res = await fetch("/api/auth/me", {
                headers: { "X-User-Email": savedEmail }
            });
            if (res.ok) {
                currentUser = await res.json();
                showAppScreen();
                return;
            }
        } catch (e) {
            console.error("Session verification failed", e);
        }
    }
    showAuthScreen();
}

// Show/Hide Auth & App Screens
function showAuthScreen() {
    document.getElementById("auth-screen").classList.remove("hidden");
    document.getElementById("app-screen").classList.add("hidden");
    loadSignupDepartments();
}

async function showAppScreen() {
    document.getElementById("auth-screen").classList.add("hidden");
    document.getElementById("app-screen").classList.remove("hidden");
    
    // Update profile display
    document.getElementById("user-display-name").innerText = currentUser.name;
    document.getElementById("user-display-role").innerText = currentUser.role;
    
    // Initials avatar
    const initials = currentUser.name.split(" ").map(n => n[0]).join("").substring(0, 2).toUpperCase();
    document.getElementById("user-avatar-initials").innerText = initials;
    
    await loadGlobalMetadata();
    populateDemoRoleSwitcher();
    applyRolePermissions();
    
    switchTab("dashboard");
    lucide.createIcons();
    showToast(`Workspace initialized. Role: ${currentUser.role}`, "info");
}

// Load Departments, Categories, Employees globally
async function loadGlobalMetadata() {
    try {
        const [dRes, cRes, eRes, aRes] = await Promise.all([
            fetch("/api/departments"),
            fetch("/api/categories"),
            fetch("/api/employees", { headers: getHeaders() }),
            fetch("/api/assets")
        ]);
        
        if (dRes.ok) departments = await dRes.json();
        if (cRes.ok) categories = await cRes.json();
        if (eRes.ok) employees = await eRes.json();
        if (aRes.ok) assets = await aRes.json();
        
    } catch (e) {
        console.error("Failed to load metadata", e);
        showToast("Error loading catalog metadata from server.", "error");
    }
}

// Unified state refreshing synchronization routine
async function refreshAppState() {
    await loadGlobalMetadata();
    
    // Refresh dashboard stats in the background
    await loadDashboardData();
    
    // Redraw currently active screen
    const activeTab = document.querySelector(".sidebar-nav .nav-item.active");
    if (activeTab) {
        const tabId = activeTab.getAttribute("data-screen");
        switchTab(tabId);
    }
}

// Populate Signup Department Dropdown
async function loadSignupDepartments() {
    try {
        const res = await fetch("/api/departments");
        if (res.ok) {
            const depts = await res.json();
            const select = document.getElementById("signup-dept");
            select.innerHTML = '<option value="">Select Department (Optional)</option>';
            depts.forEach(d => {
                select.innerHTML += `<option value="${d.id}">${d.name} (${d.code})</option>`;
            });
        }
    } catch (e) {
        console.error(e);
    }
}

// Setup Event Listeners
function setupEventListeners() {
    // Auth Forms Toggles
    document.getElementById("link-show-signup").addEventListener("click", (e) => {
        e.preventDefault();
        document.getElementById("login-form").classList.add("hidden");
        document.getElementById("signup-form").classList.remove("hidden");
    });
    
    document.getElementById("link-show-login").addEventListener("click", (e) => {
        e.preventDefault();
        document.getElementById("signup-form").classList.add("hidden");
        document.getElementById("login-form").classList.remove("hidden");
    });
    
    document.getElementById("btn-forgot-password").addEventListener("click", (e) => {
        e.preventDefault();
        document.getElementById("login-form").classList.add("hidden");
        document.getElementById("forgot-password-panel").classList.remove("hidden");
    });
    
    document.getElementById("link-back-login").addEventListener("click", (e) => {
        e.preventDefault();
        document.getElementById("forgot-password-panel").classList.add("hidden");
        document.getElementById("login-form").classList.remove("hidden");
    });

    // Forgot Password Simulation
    document.getElementById("btn-submit-forgot").addEventListener("click", () => {
        const email = document.getElementById("forgot-email").value;
        if (!email) {
            showToast("Please enter your email address.", "warning");
            playErrorSound();
            return;
        }
        showToast(`Reset code generated for ${email}.`, "success");
        playSuccessSound();
        document.getElementById("forgot-password-panel").classList.add("hidden");
        document.getElementById("login-form").classList.remove("hidden");
    });

    // Auth Form Submits
    document.getElementById("login-form").addEventListener("submit", handleLogin);
    document.getElementById("signup-form").addEventListener("submit", handleSignup);
    document.getElementById("btn-logout").addEventListener("click", handleLogout);
    
    // Sidebar Tabs Router
    document.querySelectorAll(".sidebar-nav .nav-item").forEach(item => {
        item.addEventListener("click", (e) => {
            e.preventDefault();
            const tabId = item.getAttribute("data-screen");
            switchTab(tabId);
        });
    });

    // Org Subtabs switching
    document.querySelectorAll(".inner-tab-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            const subtabId = btn.getAttribute("data-subtab");
            document.querySelectorAll(".inner-tab-btn").forEach(b => b.classList.remove("active"));
            document.querySelectorAll(".inner-tab-content").forEach(c => c.classList.remove("active"));
            btn.classList.add("active");
            document.getElementById(subtabId).classList.add("active");
            loadOrgSubtabData(subtabId);
        });
    });

    // Demo Role Switcher Dropdown Listener
    document.getElementById("demo-role-select").addEventListener("change", handleDemoRoleSwitch);

    // Notifications bell header link
    document.getElementById("btn-header-notif").addEventListener("click", () => {
        switchTab("notifications");
    });

    // Search and Filters Assets
    document.getElementById("asset-search").addEventListener("input", filterAssetsTable);
    document.getElementById("asset-filter-category").addEventListener("change", filterAssetsTable);
    document.getElementById("asset-filter-status").addEventListener("change", filterAssetsTable);
    document.getElementById("asset-filter-bookable").addEventListener("change", filterAssetsTable);

    // Bookings Resource Picker & Date Selector
    document.getElementById("booking-resource-select").addEventListener("change", loadResourceTimelineCalendar);
    document.getElementById("booking-date-select").addEventListener("change", loadResourceTimelineCalendar);
    
    // Form submits
    document.getElementById("form-register-asset").addEventListener("submit", submitRegisterAsset);
    document.getElementById("form-allocate-asset").addEventListener("submit", submitAllocateAsset);
    document.getElementById("form-return-asset").addEventListener("submit", submitReturnAsset);
    document.getElementById("form-add-dept").addEventListener("submit", submitAddDept);
    document.getElementById("form-add-category").addEventListener("submit", submitAddCategory);
    document.getElementById("booking-form").addEventListener("submit", submitBooking);
    document.getElementById("form-raise-maint").addEventListener("submit", submitRaiseMaintenance);
    document.getElementById("form-create-audit").addEventListener("submit", submitCreateAuditCycle);

    // Quick Action button triggers
    document.getElementById("header-btn-register-asset").addEventListener("click", () => openModal("modal-register-asset"));
    document.getElementById("header-btn-book-resource").addEventListener("click", () => switchTab("bookings"));
    document.getElementById("btn-register-asset").addEventListener("click", () => openModal("modal-register-asset"));
    document.getElementById("btn-open-allocate-modal").addEventListener("click", () => openModal("modal-allocate-asset"));
    document.getElementById("btn-raise-repair").addEventListener("click", () => openModal("modal-raise-maint"));
    
    // Org button builders
    document.getElementById("btn-add-dept").addEventListener("click", () => {
        document.getElementById("dept-edit-id").value = "";
        document.getElementById("modal-dept-title").innerText = "Create Department";
        document.getElementById("form-add-dept").reset();
        
        populateEmployeeSelector("dept-head");
        populateParentDeptSelector("dept-parent", "");
        
        openModal("modal-add-dept");
    });
    document.getElementById("btn-add-category").addEventListener("click", () => openModal("modal-add-category"));

    // Modal Close overlays
    document.querySelectorAll(".modal-overlay").forEach(overlay => {
        overlay.addEventListener("click", (e) => {
            if (e.target === overlay) {
                closeModal(overlay.id);
            }
        });
    });

    // Return holder type check
    document.getElementById("alloc-holder-type").addEventListener("change", (e) => {
        populateAllocationHolderOptions(e.target.value);
    });

    // Close audit cycle button
    document.getElementById("btn-close-audit-cycle").addEventListener("click", triggerCloseAuditCycle);

    // Export CSV
    document.getElementById("btn-export-assets-csv").addEventListener("click", triggerExportCSV);

    // QR Code scanner simulation triggers
    document.getElementById("btn-scan-qr").addEventListener("click", openQRScannerModal);
    document.getElementById("btn-qr-target-simulate").addEventListener("click", runQRScannerSimulation);
}

// Tab view router
function switchTab(tabId) {
    document.querySelectorAll(".sidebar-nav .nav-item").forEach(item => item.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach(panel => panel.classList.remove("active"));
    
    const navItem = document.querySelector(`.sidebar-nav .nav-item[data-screen="${tabId}"]`);
    if (navItem) navItem.classList.add("active");
    
    const panel = document.getElementById(`screen-${tabId}`);
    if (panel) panel.classList.add("active");

    const title = document.getElementById("screen-title");
    const sub = document.getElementById("screen-subtitle");
    
    switch (tabId) {
        case "dashboard":
            title.innerText = "Operational Snapshot";
            sub.innerText = "Real-time snapshot of assets, active rentals, and pending tickets.";
            loadDashboardData();
            break;
        case "org-setup":
            title.innerText = "Organization Setup";
            sub.innerText = "Admin Console for structuring organizational master data.";
            document.querySelector(".inner-tab-btn[data-subtab='org-depts']").click();
            break;
        case "assets":
            title.innerText = "Asset Registry & Directory";
            sub.innerText = "Search, track lifecycles, and audit organizational holdings.";
            loadAssetsData();
            break;
        case "allocations":
            title.innerText = "Asset Allocations & Transfers";
            sub.innerText = "Manage custody of assets and route peer transfer requests.";
            loadAllocationsAndTransfersData();
            break;
        case "bookings":
            title.innerText = "Shared Resource Scheduling";
            sub.innerText = "Check calendars and book shared meeting rooms or company vehicles.";
            loadBookingsData();
            break;
        case "maintenance":
            title.innerText = "Maintenance & Repairs Queue";
            sub.innerText = "Route technician repair requests through formal approval loops.";
            loadMaintenanceData();
            break;
        case "audits":
            title.innerText = "Physical Asset Audit Cycles";
            sub.innerText = "Schedule compliance inventories and generate discrepancy sheets.";
            loadAuditsData();
            break;
        case "reports":
            title.innerText = "Analytics & Optimization Metrics";
            sub.innerText = "Review trends, utilization rates, and download data exports.";
            loadReportsData();
            break;
        case "notifications":
            title.innerText = "Activity Trail & Security Logs";
            sub.innerText = "Full log of employee notifications and global admin transactions.";
            loadNotificationsAndLogsData();
            break;
    }
    
    lucide.createIcons();
}

// Role-based navigation permissions visibility
function applyRolePermissions() {
    const role = currentUser.role;
    
    document.querySelectorAll(".admin-only").forEach(el => {
        if (role === "Admin") {
            el.classList.remove("hidden");
        } else {
            el.classList.add("hidden");
        }
    });

    document.querySelectorAll(".asset-manager-only").forEach(el => {
        if (role === "Admin" || role === "Asset Manager") {
            el.classList.remove("hidden");
        } else {
            el.classList.add("hidden");
        }
    });
}

// Sandbox Switcher Logic
function populateDemoRoleSwitcher() {
    const select = document.getElementById("demo-role-select");
    select.innerHTML = "";
    const roles = ["Admin", "Asset Manager", "Department Head", "Employee"];
    
    roles.forEach(r => {
        const selected = r === currentUser.role ? "selected" : "";
        select.innerHTML += `<option value="${r}" ${selected}>${r}</option>`;
    });
}

async function handleDemoRoleSwitch(e) {
    const targetRole = e.target.value;
    try {
        const res = await fetch(`/api/employees/${currentUser.email}/role`, {
            method: "PUT",
            headers: getHeaders(),
            body: JSON.stringify({ role: targetRole })
        });
        
        if (res.ok) {
            const meRes = await fetch("/api/auth/me", { headers: getHeaders() });
            if (meRes.ok) {
                currentUser = await meRes.json();
                playSuccessSound();
                await showAppScreen();
            }
        } else {
            const err = await res.json();
            showToast(`Role switch failed: ${err.detail}`, "error");
            playErrorSound();
        }
    } catch (err) {
        console.error(err);
        showToast("Failed to switch demo role.", "error");
        playErrorSound();
    }
}

// Modal helper
function openModal(modalId) {
    document.getElementById(modalId).classList.remove("hidden");
    
    if (modalId === "modal-register-asset") {
        populateCategorySelector("reg-category");
    } else if (modalId === "modal-allocate-asset") {
        populateAvailableAssetsSelector("alloc-asset-select");
        populateAllocationHolderOptions("Employee");
        document.getElementById("alloc-holder-type").value = "Employee";
    } else if (modalId === "modal-raise-maint") {
        populateAllAssetsSelector("maint-asset-select");
    } else if (modalId === "modal-create-audit") {
        populateDepartmentSelector("audit-dept");
        populateAuditorsSelector("audit-auditors");
    }
    
    lucide.createIcons();
}

function closeModal(modalId) {
    document.getElementById(modalId).classList.add("hidden");
}


// --- QR SCANNER SIMULATION WORKFLOW ---

function openQRScannerModal() {
    openModal("modal-qr-scanner");
    document.getElementById("qr-scan-status-text").innerText = "Camera active. Awaiting code scanner targeting...";
}

function runQRScannerSimulation() {
    const statusText = document.getElementById("qr-scan-status-text");
    statusText.innerHTML = `<span class="gold-text animate-pulse"><i data-lucide="scan" style="width:12px; height:12px; display:inline-block"></i> Analyzing QR Code dimensions...</span>`;
    lucide.createIcons();
    
    setTimeout(() => {
        playScanBeep();
        showToast("QR Code tag 'AF-0001' read successfully!", "success");
        closeModal("modal-qr-scanner");
        openAssetDetailModal("AF-0001");
    }, 1200);
}


// --- 1. AUTH FUNCTIONS ---

async function handleLogin(e) {
    e.preventDefault();
    const email = document.getElementById("login-email").value;
    const password = document.getElementById("login-password").value;
    
    try {
        const res = await fetch("/api/auth/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, password })
        });
        
        if (res.ok) {
            currentUser = await res.json();
            localStorage.setItem("assetflow_email", currentUser.email);
            playSuccessSound();
            showAppScreen();
        } else {
            const err = await res.json();
            showToast(`Authentication Failed: ${err.detail}`, "error");
            playErrorSound();
        }
    } catch (err) {
        console.error(err);
        showToast("Server error during authorization.", "error");
        playErrorSound();
    }
}

async function handleSignup(e) {
    e.preventDefault();
    const email = document.getElementById("signup-email").value;
    const name = document.getElementById("signup-name").value;
    const password = document.getElementById("signup-password").value;
    const department_id = document.getElementById("signup-dept").value || null;
    
    try {
        const res = await fetch("/api/auth/signup", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ email, name, password, department_id })
        });
        
        if (res.ok) {
            showToast("Registration successful! Sign in to verify session.", "success");
            playSuccessSound();
            document.getElementById("signup-form").reset();
            document.getElementById("link-show-login").click();
        } else {
            const err = await res.json();
            showToast(`Registration failed: ${err.detail}`, "error");
            playErrorSound();
        }
    } catch (err) {
        console.error(err);
        showToast("Server error during registration.", "error");
        playErrorSound();
    }
}

function handleLogout() {
    currentUser = null;
    localStorage.removeItem("assetflow_email");
    showAuthScreen();
    showToast("Session terminated.", "info");
}


// --- 2. DASHBOARD DATA LOADING ---

async function loadDashboardData() {
    try {
        const res = await fetch("/api/reports/dashboard", { headers: getHeaders() });
        if (res.ok) {
            const data = await res.json();
            
            // KPI metrics
            document.getElementById("kpi-available").innerText = data.kpis.available_assets;
            document.getElementById("kpi-allocated").innerText = data.kpis.allocated_assets;
            document.getElementById("kpi-maintenance").innerText = data.kpis.maintenance_today;
            document.getElementById("kpi-bookings").innerText = data.kpis.active_bookings;
            document.getElementById("kpi-transfers").innerText = data.kpis.pending_transfers;
            document.getElementById("kpi-overdue").innerText = data.kpis.overdue_returns;
            
            // Overdue alerts
            document.getElementById("lbl-overdue-count").innerText = `${data.kpis.overdue_returns} Alerts`;
            
            const overdueList = document.getElementById("dashboard-overdue-list");
            overdueList.innerHTML = "";
            if (data.overdue_returns.length === 0) {
                overdueList.innerHTML = '<div class="empty-state text-sm"><i data-lucide="check-square" class="success-text"></i> All active holdings are in compliance</div>';
            } else {
                data.overdue_returns.forEach(item => {
                    const checkInBtn = (currentUser.role === "Admin" || currentUser.role === "Asset Manager") ?
                        `<button class="btn btn-secondary btn-xs mt-2" onclick="openReturnModal('${item.asset_id}')"><i data-lucide="arrow-left-circle"></i> Check In</button>` : "";
                        
                    overdueList.innerHTML += `
                        <div class="overdue-item">
                            <div class="item-left">
                                <span class="item-title">${item.asset_name}</span>
                                <span class="item-meta">Held by: <strong>${item.holder_name}</strong></span>
                                ${checkInBtn}
                            </div>
                            <div class="item-right">
                                <span class="badge badge-danger">Overdue</span>
                                <span class="item-date alert-text">${item.expected_return_date}</span>
                            </div>
                        </div>
                    `;
                });
            }
            
            const personalList = document.getElementById("dashboard-personal-assets");
            personalList.innerHTML = "";
            
            const personalAssets = data.personal_assets || [];
            if (personalAssets.length === 0) {
                personalList.innerHTML = '<div class="empty-state text-sm"><i data-lucide="info" class="text-secondary"></i> No holdings assigned directly to you</div>';
            } else {
                personalAssets.forEach(a => {
                    personalList.innerHTML += `
                        <div class="personal-asset-item">
                            <div class="item-left">
                                <span class="item-title">${a.name}</span>
                                <span class="item-meta">Tag: <strong>${a.id}</strong> | Loc: ${a.location}</span>
                            </div>
                            <div class="item-right">
                                <span class="badge badge-info">In Custody</span>
                                <span class="item-date text-sm">${a.expected_return_date ? 'Exp: ' + a.expected_return_date : 'Continuous'}</span>
                            </div>
                        </div>
                    `;
                });
            }

            const notifList = document.getElementById("dashboard-notif-list");
            notifList.innerHTML = "";
            const notifs = data.notifications || [];
            
            const unreadCount = notifs.filter(n => !n.read).length;
            const bellBadge = document.getElementById("header-notif-badge");
            if (unreadCount > 0) {
                bellBadge.innerText = unreadCount;
                bellBadge.classList.remove("hidden");
            } else {
                bellBadge.classList.add("hidden");
            }

            if (notifs.length === 0) {
                notifList.innerHTML = '<div class="empty-state text-sm">No new alert logs.</div>';
            } else {
                notifs.forEach(n => {
                    let icon = "bell";
                    let color = "text-secondary";
                    if (n.type.includes("Assigned")) { icon = "user-plus"; color = "cyan-text"; }
                    else if (n.type.includes("Overdue")) { icon = "clock"; color = "alert-text animate-pulse"; }
                    else if (n.type.includes("Approved")) { icon = "check-circle"; color = "success-text"; }
                    else if (n.type.includes("Discrepancy")) { icon = "alert-triangle"; color = "warning-text"; }

                    notifList.innerHTML += `
                        <div class="dashboard-notif-item">
                            <div class="notif-icon-box ${color}">
                                <i data-lucide="${icon}" style="width: 14px; height: 14px;"></i>
                            </div>
                            <div class="notif-details">
                                <div class="notif-msg">${n.message}</div>
                                <div class="notif-time">${formatDateString(n.timestamp)}</div>
                            </div>
                        </div>
                    `;
                });
            }
            
            lucide.createIcons();
        }
    } catch (e) {
        console.error(e);
    }
}


// --- 3. ORG SETUP ACTIONS & DATA ---

async function loadOrgSubtabData(subtabId) {
    await loadGlobalMetadata();
    
    if (subtabId === "org-depts") {
        renderDepartmentsTable();
    } else if (subtabId === "org-categories") {
        renderCategoriesTable();
    } else if (subtabId === "org-employees") {
        renderEmployeesTable();
    }
}

function renderDepartmentsTable() {
    const tbody = document.getElementById("depts-table-body");
    tbody.innerHTML = "";
    
    departments.forEach(d => {
        const parent = departments.find(p => p.id === d.parent_department_id);
        const parentName = parent ? `${parent.name} (${parent.code})` : '<span class="text-muted">Root Level</span>';
        
        tbody.innerHTML += `
            <tr>
                <td class="font-bold">${d.code}</td>
                <td>${d.name}</td>
                <td>${d.department_head_id || '<span class="text-muted">Unassigned</span>'}</td>
                <td>${parentName}</td>
                <td><span class="badge ${d.status === 'Active' ? 'badge-success' : 'badge-danger'}">${d.status}</span></td>
                <td>
                    <button class="btn btn-secondary btn-xs" onclick="openEditDeptModal('${d.id}')">
                        <i data-lucide="edit-2"></i> Edit
                    </button>
                </td>
            </tr>
        `;
    });
    
    lucide.createIcons();
}

function renderCategoriesTable() {
    const tbody = document.getElementById("categories-table-body");
    tbody.innerHTML = "";
    
    categories.forEach(c => {
        const fieldsStr = Object.entries(c.specific_fields).map(([k, v]) => `<code>${k}: ${v}</code>`).join(", ") || '<span class="text-muted">None</span>';
        
        tbody.innerHTML += `
            <tr>
                <td class="font-bold">${c.code}</td>
                <td>${c.name}</td>
                <td>${fieldsStr}</td>
                <td>
                    <span class="text-muted">Managed by Schema</span>
                </td>
            </tr>
        `;
    });
    
    lucide.createIcons();
}

function renderEmployeesTable() {
    const tbody = document.getElementById("employees-table-body");
    tbody.innerHTML = "";
    
    employees.forEach(e => {
        const dept = departments.find(d => d.id === e.department_id);
        const deptName = dept ? dept.name : '<span class="text-muted">Unassigned</span>';
        
        const isSelf = e.email.toLowerCase() === currentUser.email.toLowerCase();
        const disabledAttr = isSelf ? "disabled title='Cannot change your own role'" : "";
        
        tbody.innerHTML += `
            <tr>
                <td class="font-bold">${e.name} ${isSelf ? '<span class="badge badge-info text-xs">You</span>' : ''}</td>
                <td>${e.email}</td>
                <td>${deptName}</td>
                <td>
                    <select class="premium-select select-sm" style="width: 150px" onchange="changeEmployeeRole('${e.email}', this.value)" ${disabledAttr}>
                        <option value="Employee" ${e.role === 'Employee' ? 'selected' : ''}>Employee</option>
                        <option value="Department Head" ${e.role === 'Department Head' ? 'selected' : ''}>Department Head</option>
                        <option value="Asset Manager" ${e.role === 'Asset Manager' ? 'selected' : ''}>Asset Manager</option>
                        <option value="Admin" ${e.role === 'Admin' ? 'selected' : ''}>Admin</option>
                    </select>
                </td>
                <td>
                    <select class="premium-select select-sm" style="width: 120px" onchange="changeEmployeeStatus('${e.email}', this.value)" ${disabledAttr}>
                        <option value="Active" ${e.status === 'Active' ? 'selected' : ''}>Active</option>
                        <option value="Inactive" ${e.status === 'Inactive' ? 'selected' : ''}>Inactive</option>
                    </select>
                </td>
                <td>
                    <span class="text-muted">Logs active</span>
                </td>
            </tr>
        `;
    });
}

function openEditDeptModal(deptId) {
    const dept = departments.find(d => d.id === deptId);
    if (!dept) return;
    
    document.getElementById("dept-edit-id").value = dept.id;
    document.getElementById("modal-dept-title").innerText = "Edit Department";
    document.getElementById("dept-name").value = dept.name;
    document.getElementById("dept-code").value = dept.code;
    
    populateEmployeeSelector("dept-head");
    document.getElementById("dept-head").value = dept.department_head_id || "";
    
    populateParentDeptSelector("dept-parent", dept.id);
    document.getElementById("dept-parent").value = dept.parent_department_id || "";
    
    document.getElementById("dept-status").value = dept.status;
    
    openModal("modal-add-dept");
}

async function submitAddDept(e) {
    e.preventDefault();
    const id = document.getElementById("dept-edit-id").value;
    const name = document.getElementById("dept-name").value;
    const code = document.getElementById("dept-code").value;
    const department_head_id = document.getElementById("dept-head").value || null;
    const parent_department_id = document.getElementById("dept-parent").value || null;
    const status = document.getElementById("dept-status").value;
    
    const url = id ? `/api/departments/${id}` : "/api/departments";
    const method = id ? "PUT" : "POST";
    
    try {
        const res = await fetch(url, {
            method: method,
            headers: getHeaders(),
            body: JSON.stringify({ name, code, department_head_id, parent_department_id, status })
        });
        
        if (res.ok) {
            closeModal("modal-add-dept");
            showToast("Department hierarchy registered.", "success");
            playSuccessSound();
            await refreshAppState();
        } else {
            const err = await res.json();
            showToast(`Failed: ${err.detail}`, "error");
            playErrorSound();
        }
    } catch (err) {
        console.error(err);
        playErrorSound();
    }
}

async function submitAddCategory(e) {
    e.preventDefault();
    const name = document.getElementById("cat-name").value;
    const code = document.getElementById("cat-code").value;
    const fieldsText = document.getElementById("cat-fields").value;
    
    let specific_fields = {};
    if (fieldsText.trim()) {
        try {
            specific_fields = JSON.parse(fieldsText);
        } catch (err) {
            showToast("Metadata fields schema must be valid JSON object.", "warning");
            playErrorSound();
            return;
        }
    }
    
    try {
        const res = await fetch("/api/categories", {
            method: "POST",
            headers: getHeaders(),
            body: JSON.stringify({ name, code, specific_fields })
        });
        
        if (res.ok) {
            closeModal("modal-add-category");
            document.getElementById("form-add-category").reset();
            showToast("Asset Category category and fields registered.", "success");
            playSuccessSound();
            await refreshAppState();
        } else {
            const err = await res.json();
            showToast(`Failed: ${err.detail}`, "error");
            playErrorSound();
        }
    } catch (err) {
        console.error(err);
        playErrorSound();
    }
}

async function changeEmployeeRole(email, newRole) {
    try {
        const res = await fetch(`/api/employees/${email}/role`, {
            method: "PUT",
            headers: getHeaders(),
            body: JSON.stringify({ role: newRole })
        });
        if (res.ok) {
            showToast(`Updated role of ${email} to ${newRole}`, "success");
            playSuccessSound();
            await refreshAppState();
        } else {
            const err = await res.json();
            showToast(`Failed: ${err.detail}`, "error");
            playErrorSound();
        }
    } catch (e) {
        console.error(e);
        playErrorSound();
    }
}

async function changeEmployeeStatus(email, newStatus) {
    try {
        const res = await fetch(`/api/employees/${email}/status`, {
            method: "PUT",
            headers: getHeaders(),
            body: JSON.stringify({ status: newStatus })
        });
        if (res.ok) {
            showToast(`Updated status of ${email} to ${newStatus}`, "success");
            playSuccessSound();
            await refreshAppState();
        } else {
            const err = await res.json();
            showToast(`Failed: ${err.detail}`, "error");
            playErrorSound();
        }
    } catch (e) {
        console.error(e);
        playErrorSound();
    }
}


// --- 4. ASSET DIRECTORY FUNCTIONS ---

async function loadAssetsData() {
    try {
        const res = await fetch("/api/assets");
        if (res.ok) {
            assets = await res.json();
            renderAssetsTable(assets);
            populateCategorySelector("asset-filter-category");
        }
    } catch (e) {
        console.error(e);
    }
}

function renderAssetsTable(items) {
    const tbody = document.getElementById("assets-table-body");
    tbody.innerHTML = "";
    
    if (items.length === 0) {
        tbody.innerHTML = '<tr><td colspan="9" class="text-center text-muted">No assets match search criteria.</td></tr>';
        return;
    }
    
    items.forEach(a => {
        const cat = categories.find(c => c.id === a.category_id);
        const catName = cat ? cat.name : "Unknown";
        
        let holderStr = '<span class="text-muted">None</span>';
        if (a.current_holder_id) {
            holderStr = a.current_holder_type === "Employee" ? 
                `Employee: <strong>${a.current_holder_id}</strong>` : 
                `Dept ID: <strong>${a.current_holder_id}</strong>`;
        }
        
        const statusClass = a.status.toLowerCase().replace(" ", "-");
        
        tbody.innerHTML += `
            <tr>
                <td class="font-bold"><a href="#" class="text-link-sm" onclick="openAssetDetailModal('${a.id}')">${a.id}</a></td>
                <td>${a.name}</td>
                <td>${catName}</td>
                <td>${a.location}</td>
                <td>${a.shared_bookable ? '<span class="badge badge-info">Bookable</span>' : '<span class="text-muted">Custody</span>'}</td>
                <td>${a.condition}</td>
                <td>
                    <div class="status-badge-container status-${statusClass}">
                        <div class="status-dot"></div>
                        <span>${a.status}</span>
                    </div>
                </td>
                <td>${holderStr}</td>
                <td>
                    <button class="btn btn-secondary btn-xs" onclick="openAssetDetailModal('${a.id}')">
                        <i data-lucide="eye"></i> Details
                    </button>
                </td>
            </tr>
        `;
    });
    
    lucide.createIcons();
}

function filterAssetsTable() {
    const searchVal = document.getElementById("asset-search").value.toLowerCase();
    const catVal = document.getElementById("asset-filter-category").value;
    const statusVal = document.getElementById("asset-filter-status").value;
    const typeVal = document.getElementById("asset-filter-bookable").value;
    
    const filtered = assets.filter(a => {
        if (searchVal) {
            const matchesTag = a.id.toLowerCase().includes(searchVal);
            const matchesName = a.name.toLowerCase().includes(searchVal);
            const matchesSN = a.serial_number && a.serial_number.toLowerCase().includes(searchVal);
            const matchesLoc = a.location.toLowerCase().includes(searchVal);
            if (!matchesTag && !matchesName && !matchesSN && !matchesLoc) return false;
        }
        if (catVal && a.category_id !== catVal) return false;
        if (statusVal && a.status !== statusVal) return false;
        
        if (typeVal) {
            if (typeVal === "bookable" && !a.shared_bookable) return false;
            if (typeVal === "non-bookable" && a.shared_bookable) return false;
        }
        return true;
    });
    
    renderAssetsTable(filtered);
}

async function submitRegisterAsset(e) {
    e.preventDefault();
    const name = document.getElementById("reg-name").value;
    const category_id = document.getElementById("reg-category").value;
    const serial_number = document.getElementById("reg-serial").value;
    const acquisition_date = document.getElementById("reg-acq-date").value;
    const acquisition_cost = parseFloat(document.getElementById("reg-acq-cost").value);
    const condition = document.getElementById("reg-condition").value;
    const location = document.getElementById("reg-location").value;
    const shared_bookable = document.getElementById("reg-shared-bookable").checked;
    
    try {
        const res = await fetch("/api/assets", {
            method: "POST",
            headers: getHeaders(),
            body: JSON.stringify({ name, category_id, serial_number, acquisition_date, acquisition_cost, condition, location, shared_bookable })
        });
        
        if (res.ok) {
            closeModal("modal-register-asset");
            document.getElementById("form-register-asset").reset();
            showToast(`Asset registered successfully.`, "success");
            playSuccessSound();
            await refreshAppState();
        } else {
            const err = await res.json();
            showToast(`Failed: ${err.detail}`, "error");
            playErrorSound();
        }
    } catch (err) {
        console.error(err);
        playErrorSound();
    }
}

// Detailed asset catalog popup
async function openAssetDetailModal(assetId) {
    try {
        const res = await fetch(`/api/assets/${assetId}`);
        if (res.ok) {
            const data = await res.json();
            const a = data.asset;
            
            document.getElementById("det-tag").innerText = a.id;
            document.getElementById("det-name").innerText = a.name;
            
            const cat = categories.find(c => c.id === a.category_id);
            document.getElementById("det-category-location").innerText = `${cat ? cat.name : "Category"} | Storage Location: ${a.location}`;
            
            document.getElementById("det-serial").innerText = a.serial_number || "N/A";
            document.getElementById("det-condition").innerText = a.condition;
            document.getElementById("det-status").innerText = a.status;
            document.getElementById("det-cost").innerText = `$${a.acquisition_cost.toFixed(2)}`;
            document.getElementById("det-date").innerText = a.acquisition_date;
            
            const customFieldsBox = document.getElementById("det-custom-fields");
            customFieldsBox.innerHTML = "";
            if (cat && cat.specific_fields) {
                customFieldsBox.innerHTML = '<h4 class="text-sm mt-3 mb-2 text-muted">Category Specific Fields</h4>';
                Object.entries(cat.specific_fields).forEach(([k, v]) => {
                    customFieldsBox.innerHTML += `
                        <div class="metric-row">
                            <span class="label">${k}</span>
                            <span class="value">${v}</span>
                        </div>
                    `;
                });
            }

            const allocTimeline = document.getElementById("det-alloc-timeline");
            allocTimeline.innerHTML = "";
            const allocs = data.allocation_history || [];
            if (allocs.length === 0) {
                allocTimeline.innerHTML = '<div class="empty-state">No allocation logs found.</div>';
            } else {
                const reversed = [...allocs].reverse();
                reversed.forEach(h => {
                    const statusClass = h.status === 'Active' ? 'success-text' : 'text-secondary';
                    allocTimeline.innerHTML += `
                        <div class="timeline-entry">
                            <span class="timeline-time">${h.allocated_date} ${h.expected_return_date ? ' &rarr; exp ' + h.expected_return_date : ''}</span>
                            <div class="timeline-desc">Custody assigned to <strong>${h.holder_id}</strong> (${h.holder_type})</div>
                            ${h.actual_return_date ? '<div class="timeline-time">Returned: ' + h.actual_return_date + '</div>' : ''}
                            ${h.check_in_notes ? '<div class="timeline-notes">Notes: ' + h.check_in_notes + '</div>' : ''}
                            <span class="badge ${statusClass} text-xs mt-2" style="display: inline-block">${h.status}</span>
                        </div>
                    `;
                });
            }

            const maintTimeline = document.getElementById("det-maint-timeline");
            maintTimeline.innerHTML = "";
            const maints = data.maintenance_history || [];
            if (maints.length === 0) {
                maintTimeline.innerHTML = '<div class="empty-state">No maintenance tickets created.</div>';
            } else {
                const reversed = [...maints].reverse();
                reversed.forEach(m => {
                    maintTimeline.innerHTML += `
                        <div class="timeline-entry">
                            <span class="timeline-time">${formatDateString(m.created_at)}</span>
                            <div class="timeline-desc"><strong>${m.status}</strong>: ${m.description}</div>
                            <span class="timeline-time">Priority: ${m.priority} | Tech: ${m.technician_name || 'Unassigned'}</span>
                        </div>
                    `;
                });
            }

            const actionsBox = document.getElementById("det-action-buttons-container");
            actionsBox.innerHTML = "";
            const isManager = currentUser.role === "Admin" || currentUser.role === "Asset Manager";
            
            if (a.status === "Available" && isManager) {
                actionsBox.innerHTML += `
                    <button class="btn btn-primary btn-sm w-100" onclick="closeModal('modal-asset-detail'); openAllocateModalForAsset('${a.id}')">
                        <i data-lucide="user-plus"></i> Allocate Custody
                    </button>
                `;
            } else if (a.status === "Allocated") {
                if (isManager) {
                    actionsBox.innerHTML += `
                        <button class="btn btn-emerald btn-sm w-100" onclick="closeModal('modal-asset-detail'); openReturnModal('${a.id}')">
                            <i data-lucide="arrow-left-circle"></i> Check In (Process Return)
                        </button>
                    `;
                }
                
                if (a.current_holder_id.toLowerCase() !== currentUser.email.toLowerCase()) {
                    actionsBox.innerHTML += `
                        <button class="btn btn-secondary btn-sm w-100 mt-2" onclick="closeModal('modal-asset-detail'); triggerRequestTransfer('${a.id}')">
                            <i data-lucide="arrow-left-right"></i> Request Direct Transfer
                        </button>
                    `;
                }
            }
            
            if (["Available", "Allocated"].includes(a.status)) {
                actionsBox.innerHTML += `
                    <button class="btn btn-secondary btn-sm w-100 mt-2" onclick="closeModal('modal-asset-detail'); openRaiseRepairForAsset('${a.id}')">
                        <i data-lucide="wrench"></i> File Damage (Repair request)
                    </button>
                `;
            }

            openModal("modal-asset-detail");
        }
    } catch (e) {
        console.error(e);
    }
}

function openAllocateModalForAsset(assetId) {
    openModal("modal-allocate-asset");
    document.getElementById("alloc-asset-select").value = assetId;
}

function openReturnModal(assetId) {
    openModal("modal-return-asset");
    document.getElementById("return-asset-id").value = assetId;
    const targetAsset = assets.find(a => a.id === assetId);
    if (targetAsset) {
        document.getElementById("return-condition").value = targetAsset.condition;
    }
}

function openRaiseRepairForAsset(assetId) {
    openModal("modal-raise-maint");
    document.getElementById("maint-asset-select").value = assetId;
}


// --- 5. ALLOCATIONS & TRANSFERS ACTIONS & DATA ---

async function loadAllocationsAndTransfersData() {
    try {
        await loadGlobalMetadata();
        
        const res = await fetch("/api/reports/dashboard", { headers: getHeaders() });
        if (res.ok) {
            const data = await res.json();
            
            const tbody = document.getElementById("allocations-table-body");
            tbody.innerHTML = "";
            
            const activeAllocs = data.upcoming_returns.concat(data.overdue_returns);
            
            if (activeAllocs.length === 0) {
                tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">No active custody allocations.</td></tr>';
            } else {
                activeAllocs.forEach(alloc => {
                    const isOverdue = alloc.expected_return_date && alloc.expected_return_date < new Date().toISOString().split("T")[0];
                    const dateColor = isOverdue ? "alert-text font-bold" : "";
                    
                    const actionBtn = (currentUser.role === "Admin" || currentUser.role === "Asset Manager") ?
                        `<button class="btn btn-secondary btn-xs" onclick="openReturnModal('${alloc.asset_id}')"><i data-lucide="arrow-left-circle"></i> Check In</button>` : 
                        `<span class="text-muted">Authorized users only</span>`;
                        
                    tbody.innerHTML += `
                        <tr>
                            <td class="font-bold">${alloc.asset_name}</td>
                            <td>${alloc.asset_id}</td>
                            <td><strong>${alloc.holder_name}</strong></td>
                            <td>${alloc.allocated_date || 'N/A'}</td>
                            <td class="${dateColor}">${alloc.expected_return_date || 'Continuous'}</td>
                            <td>${actionBtn}</td>
                        </tr>
                    `;
                });
            }
        }
        
        loadTransferRequestsList();
        lucide.createIcons();
    } catch (e) {
        console.error(e);
    }
}

async function loadTransferRequestsList() {
    const list = document.getElementById("transfers-list-container");
    list.innerHTML = "";
    
    try {
        const res = await fetch("/api/transfers", { headers: getHeaders() });
        if (res.ok) {
            transfers = await res.json();
            const pendingTrans = transfers.filter(t => t.status === "Requested");
            
            if (pendingTrans.length === 0) {
                list.innerHTML = '<div class="empty-state text-sm">No transfer requests pending.</div>';
                return;
            }
            
            pendingTrans.forEach(t => {
                const asset = assets.find(a => a.id === t.asset_id);
                const assetName = asset ? asset.name : "Unknown Asset";
                
                const fromUser = employees.find(e => e.email.toLowerCase() === t.from_user_id.toLowerCase());
                const fromName = fromUser ? fromUser.name : t.from_user_id;
                
                const toUser = employees.find(e => e.email.toLowerCase() === t.to_user_id.toLowerCase());
                const toName = toUser ? toUser.name : t.to_user_id;
                
                let canApprove = currentUser.role === "Admin" || currentUser.role === "Asset Manager";
                if (currentUser.role === "Department Head") {
                    const deptId = currentUser.department_id;
                    const fromEmp = employees.find(e => e.email.toLowerCase() === t.from_user_id.toLowerCase());
                    if (fromEmp && fromEmp.department_id === deptId) {
                        canApprove = true;
                    }
                }
                
                const actionButtons = canApprove ? `
                    <div class="transfer-actions">
                        <button class="btn btn-emerald btn-xs" onclick="processTransfer('${t.id}', 'approve')"><i data-lucide="check"></i> Approve</button>
                        <button class="btn btn-danger btn-xs" onclick="processTransfer('${t.id}', 'reject')"><i data-lucide="x"></i> Reject</button>
                    </div>
                ` : `<span class="text-muted text-sm">Awaiting Auth approval</span>`;

                list.innerHTML += `
                    <div class="transfer-card">
                        <h4>${assetName} (${t.asset_id})</h4>
                        <p>Transfer from <strong>${fromName}</strong> to <strong>${toName}</strong> requested on ${t.date_requested}.</p>
                        ${actionButtons}
                    </div>
                `;
            });
            
            lucide.createIcons();
        }
    } catch (e) {
        console.error(e);
    }
}

async function triggerRequestTransfer(assetId) {
    const email = prompt("Enter target Employee email address to request direct custody transfer:");
    if (!email) return;
    
    const empExists = employees.some(e => e.email.toLowerCase() === email.toLowerCase());
    if (!empExists) {
        showToast("Employee email address not found in catalog.", "warning");
        playErrorSound();
        return;
    }
    
    try {
        const res = await fetch("/api/transfers/request", {
            method: "POST",
            headers: getHeaders(),
            body: JSON.stringify({ asset_id: assetId, to_user_id: email })
        });
        
        if (res.ok) {
            showToast("Transfer request filed. Awaiting verification approvals.", "success");
            playSuccessSound();
            await refreshAppState();
        } else {
            const err = await res.json();
            showToast(`Transfer failed: ${err.detail}`, "error");
            playErrorSound();
        }
    } catch (e) {
        console.error(e);
        playErrorSound();
    }
}

async function processTransfer(transferId, action) {
    const url = `/api/transfers/${transferId}/${action}`;
    try {
        const res = await fetch(url, {
            method: "POST",
            headers: getHeaders()
        });
        if (res.ok) {
            showToast(`Transfer request successfully ${action}ed!`, "success");
            playSuccessSound();
            await refreshAppState();
        } else {
            const err = await res.json();
            showToast(`Operation failed: ${err.detail}`, "error");
            playErrorSound();
        }
    } catch (e) {
        console.error(e);
        playErrorSound();
    }
}

async function submitAllocateAsset(e) {
    e.preventDefault();
    const asset_id = document.getElementById("alloc-asset-select").value;
    const holder_type = document.getElementById("alloc-holder-type").value;
    const holder_id = document.getElementById("alloc-holder-select").value;
    const expected_return_date = document.getElementById("alloc-return-date").value || null;
    
    try {
        const res = await fetch("/api/allocations", {
            method: "POST",
            headers: getHeaders(),
            body: JSON.stringify({ asset_id, holder_type, holder_id, expected_return_date })
        });
        
        if (res.ok) {
            closeModal("modal-allocate-asset");
            document.getElementById("form-allocate-asset").reset();
            showToast("Asset custody successfully allocated.", "success");
            playSuccessSound();
            await refreshAppState();
        } else {
            const err = await res.json();
            if (err.detail && err.detail.holder_id) {
                const conflict = err.detail;
                playErrorSound();
                if (confirm(`${conflict.message}\nWould you like to file a direct custody Transfer Request instead?`)) {
                    closeModal("modal-allocate-asset");
                    triggerRequestTransfer(asset_id);
                }
            } else {
                showToast(`Allocation failed: ${err.detail}`, "error");
                playErrorSound();
            }
        }
    } catch (err) {
        console.error(err);
        playErrorSound();
    }
}

async function submitReturnAsset(e) {
    e.preventDefault();
    const assetId = document.getElementById("return-asset-id").value;
    const condition = document.getElementById("return-condition").value;
    const check_in_notes = document.getElementById("return-notes").value;
    
    try {
        const res = await fetch(`/api/allocations/${assetId}/return`, {
            method: "POST",
            headers: getHeaders(),
            body: JSON.stringify({ condition, check_in_notes })
        });
        
        if (res.ok) {
            closeModal("modal-return-asset");
            document.getElementById("form-return-asset").reset();
            showToast("Asset returned and checked back into pool.", "success");
            playSuccessSound();
            await refreshAppState();
        } else {
            const err = await res.json();
            showToast(`Return failed: ${err.detail}`, "error");
            playErrorSound();
        }
    } catch (err) {
        console.error(err);
        playErrorSound();
    }
}


// --- 6. RESOURCE BOOKINGS FUNCTIONS ---

async function loadBookingsData() {
    try {
        await loadGlobalMetadata();
        const bookables = assets.filter(a => a.shared_bookable);
        
        const selectors = ["booking-resource-select", "book-asset-id"];
        selectors.forEach(sid => {
            const el = document.getElementById(sid);
            el.innerHTML = sid === "book-asset-id" ? '<option value="">Select Resource...</option>' : '';
            bookables.forEach(b => {
                const cat = categories.find(c => c.id === b.category_id);
                const catName = cat ? cat.name : "Resource";
                el.innerHTML += `<option value="${b.id}">${b.name} (${catName} - ${b.id})</option>`;
            });
        });
        
        if (bookables.length > 0 && !document.getElementById("booking-resource-select").value) {
            document.getElementById("booking-resource-select").value = bookables[0].id;
        }

        const dateInput = document.getElementById("booking-date-select");
        if (!dateInput.value) {
            dateInput.value = new Date().toISOString().split("T")[0];
        }
        
        loadResourceTimelineCalendar();
        loadBookingsList();
        
    } catch (e) {
        console.error(e);
    }
}

async function loadResourceTimelineCalendar() {
    const resourceId = document.getElementById("booking-resource-select").value;
    const selectedDate = document.getElementById("booking-date-select").value;
    const timelineGrid = document.getElementById("timeline-hours-grid");
    timelineGrid.innerHTML = "";
    
    const titleEl = document.getElementById("timeline-resource-title");
    const targetAsset = assets.find(a => a.id === resourceId);
    titleEl.innerText = targetAsset ? `${targetAsset.name} (${targetAsset.location})` : "Schedule";

    const labelDate = selectedDate ? new Date(selectedDate).toLocaleDateString(undefined, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' }) : "Today";
    document.getElementById("timeline-date-label").innerText = `Timeline for ${labelDate} (09:00 - 18:00)`;

    if (!resourceId) {
        timelineGrid.innerHTML = '<div class="empty-state text-sm">Please select a resource.</div>';
        return;
    }
    
    try {
        const res = await fetch(`/api/bookings?resource_id=${resourceId}`);
        if (res.ok) {
            const bookings = await res.json();
            
            for (let hour = 9; hour < 18; hour++) {
                const hourStr = `${hour.toString().padStart(2, '0')}:00`;
                
                const activeHourBooking = bookings.find(b => {
                    if (b.status === "Cancelled") return false;
                    const startDt = b.start_time.split("T");
                    if (startDt[0] !== selectedDate) return false;
                    
                    const bStartHour = parseInt(startDt[1].split(":")[0]);
                    const bEndHour = parseInt(b.end_time.split("T")[1].split(":")[0]);
                    return hour >= bStartHour && hour < bEndHour;
                });
                
                let bookingBlockHtml = "";
                if (activeHourBooking) {
                    const bookUser = employees.find(e => e.email.toLowerCase() === activeHourBooking.user_id.toLowerCase());
                    const bookName = bookUser ? bookUser.name : activeHourBooking.user_id;
                    const startLabel = activeHourBooking.start_time.split("T")[1].substring(0, 5);
                    const endLabel = activeHourBooking.end_time.split("T")[1].substring(0, 5);
                    
                    bookingBlockHtml = `
                        <div class="booked-slot-block w-100">
                            <span><strong>Reserved:</strong> ${bookName}</span>
                            <span>Time: ${startLabel} - ${endLabel}</span>
                        </div>
                    `;
                }
                
                timelineGrid.innerHTML += `
                    <div class="timeline-row">
                        <div class="timeline-time-label">${hourStr}</div>
                        <div class="timeline-slots-area">
                            ${bookingBlockHtml}
                        </div>
                    </div>
                `;
            }
        }
    } catch (e) {
        console.error(e);
    }
}

async function loadBookingsList() {
    const list = document.getElementById("active-bookings-list-container");
    list.innerHTML = "";
    
    try {
        const res = await fetch("/api/bookings");
        if (res.ok) {
            const bookings = await res.json();
            const activeBookings = bookings.filter(b => ["Upcoming", "Ongoing"].includes(b.status));
            
            if (activeBookings.length === 0) {
                list.innerHTML = '<div class="empty-state text-sm">No bookings active.</div>';
                return;
            }
            
            activeBookings.forEach(b => {
                const resAsset = assets.find(a => a.id === b.resource_id);
                const resName = resAsset ? resAsset.name : b.resource_id;
                
                const isOwner = b.user_id.toLowerCase() === currentUser.email.toLowerCase();
                const canCancel = isOwner || currentUser.role === "Admin" || currentUser.role === "Asset Manager";
                
                const cancelBtn = canCancel ? 
                    `<button class="btn btn-danger btn-xs mt-2 w-100" onclick="cancelBooking('${b.id}')"><i data-lucide="x"></i> Cancel Booking</button>` : "";
                
                const datePart = b.start_time.split("T")[0];
                const startTimePart = b.start_time.split("T")[1].substring(0, 5);
                const endTimePart = b.end_time.split("T")[1].substring(0, 5);
                
                list.innerHTML += `
                    <div class="personal-asset-item mb-2 flex-direction-column align-items-start" style="flex-direction: column; align-items: stretch">
                        <div class="panel-header-row">
                            <span class="item-title">${resName}</span>
                            <span class="badge badge-info">${b.status}</span>
                        </div>
                        <div class="item-meta mt-1">Booked by: <strong>${b.user_id}</strong></div>
                        <div class="item-date mt-1 text-sm"><i data-lucide="calendar" style="width: 12px; height:12px; display:inline-block"></i> ${datePart} | ${startTimePart} - ${endTimePart}</div>
                        ${cancelBtn}
                    </div>
                `;
            });
            
            lucide.createIcons();
        }
    } catch (e) {
        console.error(e);
    }
}

async function submitBooking(e) {
    e.preventDefault();
    const resource_id = document.getElementById("book-asset-id").value;
    const start_time = document.getElementById("book-start-time").value;
    const end_time = document.getElementById("book-end-time").value;
    
    try {
        const res = await fetch("/api/bookings", {
            method: "POST",
            headers: getHeaders(),
            body: JSON.stringify({ resource_id, start_time, end_time })
        });
        
        if (res.ok) {
            document.getElementById("booking-form").reset();
            showToast("Resource reservation slot confirmed!", "success");
            playSuccessSound();
            await refreshAppState();
        } else {
            const err = await res.json();
            showToast(`Overlap Conflict: ${err.detail}`, "error");
            playErrorSound();
        }
    } catch (err) {
        console.error(err);
        playErrorSound();
    }
}

async function cancelBooking(bookingId) {
    if (!confirm("Are you sure you want to cancel this booking?")) return;
    try {
        const res = await fetch(`/api/bookings/${bookingId}/cancel`, {
            method: "POST",
            headers: getHeaders()
        });
        if (res.ok) {
            showToast("Booking cancelled successfully.", "success");
            playSuccessSound();
            await refreshAppState();
        } else {
            const err = await res.json();
            showToast(`Cancellation failed: ${err.detail}`, "error");
            playErrorSound();
        }
    } catch (e) {
        console.error(e);
        playErrorSound();
    }
}


// --- 7. MAINTENANCE TICKET MANAGEMENT ---

async function loadMaintenanceData() {
    try {
        await loadGlobalMetadata();
        const res = await fetch("/api/maintenance");
        if (res.ok) {
            const requests = await res.json();
            const tbody = document.getElementById("maintenance-table-body");
            tbody.innerHTML = "";
            
            if (requests.length === 0) {
                tbody.innerHTML = '<tr><td colspan="9" class="text-center text-muted">No repair tickets active.</td></tr>';
                return;
            }
            
            const sorted = [...requests].sort((a,b) => {
                if (a.status === "Pending" && b.status !== "Pending") return -1;
                if (a.status !== "Pending" && b.status === "Pending") return 1;
                return 0;
            });
            
            sorted.forEach(m => {
                const asset = assets.find(a => a.id === m.asset_id);
                const assetName = asset ? asset.name : "Unknown Asset";
                
                let priorityClass = "badge-info";
                if (m.priority === "High") priorityClass = "badge-danger";
                else if (m.priority === "Medium") priorityClass = "badge-warning";
                
                let statusClass = "badge-warning";
                if (m.status === "Resolved") statusClass = "badge-success";
                else if (m.status === "Rejected") statusClass = "badge-danger";
                else if (m.status === "In Progress") statusClass = "badge-info";
                
                let actionsHtml = "";
                const isManager = currentUser.role === "Admin" || currentUser.role === "Asset Manager";
                
                if (isManager) {
                    if (m.status === "Pending") {
                        actionsHtml = `
                            <div class="flex-direction-row" style="display:flex; gap:4px">
                                <button class="btn btn-emerald btn-xs" onclick="processMaintenance('${m.id}', 'approve')"><i data-lucide="check"></i> Approve</button>
                                <button class="btn btn-danger btn-xs" onclick="processMaintenance('${m.id}', 'reject')"><i data-lucide="x"></i> Reject</button>
                            </div>
                        `;
                    } else if (m.status === "Approved") {
                        actionsHtml = `
                            <button class="btn btn-primary btn-xs" onclick="assignTechnicianPrompt('${m.id}')"><i data-lucide="user-check"></i> Assign Tech</button>
                        `;
                    } else if (m.status === "Technician Assigned") {
                        actionsHtml = `
                            <button class="btn btn-info btn-xs" style="background-color: var(--cyan); color: white;" onclick="startMaintenanceWork('${m.id}')"><i data-lucide="play"></i> Start Work</button>
                        `;
                    } else if (m.status === "In Progress") {
                        actionsHtml = `
                            <button class="btn btn-emerald btn-xs" onclick="resolveMaintenanceWork('${m.id}')"><i data-lucide="check-square"></i> Resolve</button>
                        `;
                    } else {
                        actionsHtml = `<span class="text-muted text-sm">Ticket Completed</span>`;
                    }
                } else {
                    actionsHtml = `<span class="text-muted text-sm">Read Only Queue</span>`;
                }

                tbody.innerHTML += `
                    <tr>
                        <td class="font-bold">${m.id}</td>
                        <td>${m.asset_id}</td>
                        <td>${assetName}</td>
                        <td><span class="badge ${priorityClass}">${m.priority}</span></td>
                        <td>${m.description}</td>
                        <td>${m.raised_by}</td>
                        <td>${m.technician_name || '<span class="text-muted">Unassigned</span>'}</td>
                        <td><span class="badge ${statusClass}">${m.status}</span></td>
                        <td>${actionsHtml}</td>
                    </tr>
                `;
            });
            
            lucide.createIcons();
        }
    } catch (e) {
        console.error(e);
    }
}

async function submitRaiseMaintenance(e) {
    e.preventDefault();
    const asset_id = document.getElementById("maint-asset-select").value;
    const priority = document.getElementById("maint-priority").value;
    const description = document.getElementById("maint-desc").value;
    
    try {
        const res = await fetch("/api/maintenance", {
            method: "POST",
            headers: getHeaders(),
            body: JSON.stringify({ asset_id, priority, description })
        });
        
        if (res.ok) {
            closeModal("modal-raise-maint");
            document.getElementById("form-raise-maint").reset();
            showToast("Repair ticket filed successfully.", "success");
            playSuccessSound();
            await refreshAppState();
        } else {
            const err = await res.json();
            showToast(`Failed: ${err.detail}`, "error");
            playErrorSound();
        }
    } catch (err) {
        console.error(err);
        playErrorSound();
    }
}

async function processMaintenance(maintId, action) {
    const url = `/api/maintenance/${maintId}/${action}`;
    try {
        const res = await fetch(url, {
            method: "POST",
            headers: getHeaders()
        });
        if (res.ok) {
            showToast(`Repair ticket successfully ${action}ed!`, "success");
            playSuccessSound();
            await refreshAppState();
        } else {
            const err = await res.json();
            showToast(`Failed: ${err.detail}`, "error");
            playErrorSound();
        }
    } catch (e) {
        console.error(e);
        playErrorSound();
    }
}

async function assignTechnicianPrompt(maintId) {
    const tech = prompt("Enter Technician / Vendor Name to assign:");
    if (!tech) return;
    
    try {
        const res = await fetch(`/api/maintenance/${maintId}/assign`, {
            method: "POST",
            headers: getHeaders(),
            body: JSON.stringify({ technician_name: tech })
        });
        if (res.ok) {
            showToast(`Technician ${tech} assigned to ticket.`, "success");
            playSuccessSound();
            await refreshAppState();
        } else {
            const err = await res.json();
            showToast(`Assignment failed: ${err.detail}`, "error");
            playErrorSound();
        }
    } catch (e) {
        console.error(e);
        playErrorSound();
    }
}

async function startMaintenanceWork(maintId) {
    try {
        const res = await fetch(`/api/maintenance/${maintId}/start`, {
            method: "POST",
            headers: getHeaders()
        });
        if (res.ok) {
            showToast("Repair work set to In Progress.", "success");
            playSuccessSound();
            await refreshAppState();
        } else {
            const err = await res.json();
            showToast(err.detail, "error");
            playErrorSound();
        }
    } catch (e) {
        console.error(e);
        playErrorSound();
    }
}

async function resolveMaintenanceWork(maintId) {
    try {
        const res = await fetch(`/api/maintenance/${maintId}/resolve`, {
            method: "POST",
            headers: getHeaders()
        });
        if (res.ok) {
            showToast("Repair resolved! Hardware status reverted to Available.", "success");
            playSuccessSound();
            await refreshAppState();
        } else {
            const err = await res.json();
            showToast(err.detail, "error");
            playErrorSound();
        }
    } catch (e) {
        console.error(e);
        playErrorSound();
    }
}


// --- 8. ASSET COMPLIANCE AUDITS ---

async function loadAuditsData() {
    try {
        await loadGlobalMetadata();
        const res = await fetch("/api/audits");
        if (res.ok) {
            const cycles = await res.json();
            const list = document.getElementById("audit-cycles-list-container");
            list.innerHTML = "";
            
            if (cycles.length === 0) {
                list.innerHTML = '<div class="empty-state text-sm">No compliance audits active.</div>';
                return;
            }
            
            cycles.forEach(c => {
                const statusClass = c.status === "Closed" ? "badge-success" : "badge-info";
                const isSelected = currentAuditCycle && currentAuditCycle.id === c.id ? "active-selected" : "";
                
                list.innerHTML += `
                    <div class="audit-cycle-card ${isSelected}" onclick="selectAuditCycleForVerification('${c.id}')">
                        <div class="panel-header-row">
                            <h4>${c.name}</h4>
                            <span class="badge ${statusClass}">${c.status}</span>
                        </div>
                        <p class="mt-1">Date scope: ${c.date_start} to ${c.date_end}</p>
                        <p class="text-sm text-muted">Auditors: ${c.auditors.join(", ")}</p>
                    </div>
                `;
            });
            
            renderActiveAuditWorkspace();
        }
    } catch (e) {
        console.error(e);
    }
}

async function selectAuditCycleForVerification(cycleId) {
    try {
        const res = await fetch("/api/audits");
        if (res.ok) {
            const cycles = await res.json();
            currentAuditCycle = cycles.find(c => c.id === cycleId);
            loadAuditsData(); 
        }
    } catch (e) {
        console.error(e);
    }
}

function renderActiveAuditWorkspace() {
    const workspace = document.getElementById("audit-verification-workspace");
    const emptyBox = document.getElementById("audit-workspace-empty");
    
    if (!currentAuditCycle) {
        workspace.classList.add("hidden");
        emptyBox.classList.remove("hidden");
        return;
    }
    
    workspace.classList.remove("hidden");
    emptyBox.classList.add("hidden");
    
    document.getElementById("lbl-active-audit-title").innerText = `${currentAuditCycle.name} (${currentAuditCycle.status})`;
    document.getElementById("val-audit-auditors").innerText = currentAuditCycle.auditors.join(", ");
    
    const items = currentAuditCycle.items || [];
    const verifiedCount = items.filter(i => i.status !== "Pending").length;
    document.getElementById("val-audit-progress").innerText = `${verifiedCount}/${items.length} Scoped Items`;
    
    const tbody = document.getElementById("audit-verify-table-body");
    tbody.innerHTML = "";
    
    const isClosed = currentAuditCycle.status === "Closed";
    const closeBtn = document.getElementById("btn-close-audit-cycle");
    
    if (isClosed) {
        closeBtn.classList.add("hidden");
    } else {
        closeBtn.classList.remove("hidden");
    }

    if (items.length === 0) {
        tbody.innerHTML = '<tr><td colspan="7" class="text-center text-muted">No scoped assets in this cycle.</td></tr>';
        return;
    }

    items.forEach(item => {
        const asset = assets.find(a => a.id === item.asset_id);
        const assetName = asset ? asset.name : "Unknown";
        const loc = asset ? asset.location : "Unknown";
        const cond = asset ? asset.condition : "Unknown";
        
        let actionsHtml = "";
        const isAssignedAuditor = currentAuditCycle.auditors.some(a => a.toLowerCase() === currentUser.email.toLowerCase()) || currentUser.role === "Admin";
        
        if (!isClosed && isAssignedAuditor) {
            actionsHtml = `
                <div class="flex-direction-row" style="display:flex; gap: 4px">
                    <button class="btn btn-emerald btn-xs" onclick="verifyAuditItemDirect('${currentAuditCycle.id}', '${item.asset_id}', 'Verified')">Verify</button>
                    <button class="btn btn-warning btn-xs" onclick="verifyAuditItemDirect('${currentAuditCycle.id}', '${item.asset_id}', 'Damaged')">Damage</button>
                    <button class="btn btn-danger btn-xs" onclick="verifyAuditItemDirect('${currentAuditCycle.id}', '${item.asset_id}', 'Missing')">Missing</button>
                </div>
            `;
        } else {
            actionsHtml = `<span class="text-muted text-sm">${isClosed ? 'Closed (Locked)' : 'Auditors Only'}</span>`;
        }

        let statusClass = "text-muted";
        if (item.status === "Verified") statusClass = "success-text font-bold";
        else if (item.status === "Damaged") statusClass = "warning-text font-bold";
        else if (item.status === "Missing") statusClass = "alert-text font-bold";

        tbody.innerHTML += `
            <tr>
                <td class="font-bold">${item.asset_id}</td>
                <td>${assetName}</td>
                <td>${loc}</td>
                <td>${cond}</td>
                <td><span class="${statusClass}">${item.status}</span></td>
                <td>
                    <input type="text" class="premium-input select-sm" style="padding: 4px 8px; width: 140px;" 
                           value="${item.notes || ''}" 
                           placeholder="Add check notes..."
                           onchange="updateAuditItemNotes('${currentAuditCycle.id}', '${item.asset_id}', this.value)"
                           ${isClosed || !isAssignedAuditor ? 'disabled' : ''}>
                </td>
                <td>${actionsHtml}</td>
            </tr>
        `;
    });
    
    if (isClosed && currentAuditCycle.discrepancy_report) {
        tbody.innerHTML += `
            <tr class="glass-panel" style="background-color: rgba(244, 63, 94, 0.04)">
                <td colspan="7" style="padding: 24px;">
                    <div style="display:flex; flex-direction:column; gap: 8px">
                        <h4 class="alert-text"><i data-lucide="alert-triangle"></i> Auto-Generated Compliance Discrepancy Ledger</h4>
                        <pre style="font-family: var(--font-mono); font-size:12.5px; background: rgba(0,0,0,0.35); padding: 16px; border-radius:8px; color: var(--text-primary); border: 1px solid var(--panel-border); white-space: pre-wrap; line-height: 1.6;">${currentAuditCycle.discrepancy_report}</pre>
                    </div>
                </td>
            </tr>
        `;
        lucide.createIcons();
    }
}

async function verifyAuditItemDirect(cycleId, assetId, status) {
    const notesInput = document.querySelector(`input[onchange*="'${assetId}'"]`);
    const notes = notesInput ? notesInput.value : "";
    
    try {
        const res = await fetch(`/api/audits/${cycleId}/items`, {
            method: "POST",
            headers: getHeaders(),
            body: JSON.stringify({ asset_id: assetId, status, notes })
        });
        if (res.ok) {
            playScanBeep();
            showToast(`Asset ${assetId} verified as ${status}`, "success");
            await refreshAppState();
            await selectAuditCycleForVerification(cycleId);
        } else {
            const err = await res.json();
            showToast(err.detail, "error");
            playErrorSound();
        }
    } catch (e) {
        console.error(e);
        playErrorSound();
    }
}

async function updateAuditItemNotes(cycleId, assetId, notesValue) {
    try {
        const item = currentAuditCycle.items.find(i => i.asset_id === assetId);
        const status = item ? item.status : "Pending";
        
        const res = await fetch(`/api/audits/${cycleId}/items`, {
            method: "POST",
            headers: getHeaders(),
            body: JSON.stringify({ asset_id: assetId, status, notes: notesValue })
        });
        if (res.ok) {
            showToast("Notes updated.", "info");
        }
    } catch (e) {
        console.error(e);
    }
}

async function triggerCloseAuditCycle() {
    if (!currentAuditCycle) return;
    if (!confirm("Are you sure you want to CLOSE this audit cycle? This will lock entries and update missing items status to 'Lost' globally.")) return;
    
    try {
        const res = await fetch(`/api/audits/${currentAuditCycle.id}/close`, {
            method: "POST",
            headers: getHeaders()
        });
        if (res.ok) {
            showToast("Audit cycle finalized! Discrepancy report compiled.", "success");
            playSuccessSound();
            await refreshAppState();
            await selectAuditCycleForVerification(currentAuditCycle.id);
        } else {
            const err = await res.json();
            showToast(err.detail, "error");
            playErrorSound();
        }
    } catch (e) {
        console.error(e);
        playErrorSound();
    }
}

async function submitCreateAuditCycle(e) {
    e.preventDefault();
    const name = document.getElementById("audit-name").value;
    const department_id = document.getElementById("audit-dept").value || null;
    const location = document.getElementById("audit-location").value || null;
    const date_start = document.getElementById("audit-start").value;
    const date_end = document.getElementById("audit-end").value;
    
    const auditorSelect = document.getElementById("audit-auditors");
    const auditors = Array.from(auditorSelect.selectedOptions).map(option => option.value);
    
    if (auditors.length === 0) {
        showToast("Please assign at least one auditor.", "warning");
        playErrorSound();
        return;
    }
    
    try {
        const res = await fetch("/api/audits", {
            method: "POST",
            headers: getHeaders(),
            body: JSON.stringify({ name, department_id, location, date_start, date_end, auditors })
        });
        
        if (res.ok) {
            closeModal("modal-create-audit");
            document.getElementById("form-create-audit").reset();
            showToast("Compliance audit cycle scheduled successfully.", "success");
            playSuccessSound();
            await refreshAppState();
        } else {
            const err = await res.json();
            showToast(`Scheduling failed: ${err.detail}`, "error");
            playErrorSound();
        }
    } catch (err) {
        console.error(err);
        playErrorSound();
    }
}


// --- 9. ANALYTICS & REPORTS RENDERING ---

async function loadReportsData() {
    try {
        const res = await fetch("/api/reports/analytics", { headers: getHeaders() });
        if (res.ok) {
            const data = await res.json();
            
            renderStatusChart(data.utilization);
            renderMaintChart(data.maintenance_frequency);
            renderDeptChart(data.department_allocations);
            renderHeatmapChart(data.booking_heatmap);
            
            const tbody = document.getElementById("retirement-table-body");
            tbody.innerHTML = "";
            
            const nearing = data.nearing_retirement || [];
            if (nearing.length === 0) {
                tbody.innerHTML = '<tr><td colspan="6" class="text-center text-muted">All physical assets comply with retirement policies.</td></tr>';
                return;
            }
            
            nearing.forEach(item => {
                let rec = "Continuous custody check";
                if (item.condition === "Poor") {
                    rec = '<span class="alert-text font-bold">Initiate Maintenance / Cycle Out</span>';
                } else if (item.age_years >= 2) {
                    rec = '<span class="warning-text">Schedule rotation replacement</span>';
                }
                
                tbody.innerHTML += `
                    <tr>
                        <td class="font-bold">${item.id}</td>
                        <td>${item.name}</td>
                        <td>${item.acquisition_date}</td>
                        <td>${item.condition}</td>
                        <td>${item.age_years} Years</td>
                        <td>${rec}</td>
                    </tr>
                `;
            });
        }
    } catch (e) {
        console.error(e);
    }
}

// Chart.js helper draws with gold gradient accent lines
function renderStatusChart(stats) {
    const ctx = document.getElementById("chart-status-dist").getContext("2d");
    if (charts.status) charts.status.destroy();
    
    charts.status = new Chart(ctx, {
        type: "pie",
        data: {
            labels: Object.keys(stats),
            datasets: [{
                data: Object.values(stats),
                backgroundColor: [
                    "#eab308", // Gold
                    "#10b981", // Emerald
                    "#06b6d4", // Cyan
                    "#f43f5e", // Rose
                    "#5e6b7e"  // Slate
                ],
                borderWidth: 1,
                borderColor: "rgba(255,255,255,0.08)"
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: "right",
                    labels: { color: "#94a3b8", font: { family: "Outfit" } }
                }
            }
        }
    });
}

function renderMaintChart(stats) {
    const ctx = document.getElementById("chart-maint-freq").getContext("2d");
    if (charts.maint) charts.maint.destroy();
    
    const labels = Object.keys(stats);
    const data = Object.values(stats);
    
    // Create gradient
    const gradient = ctx.createLinearGradient(0, 0, 400, 0);
    gradient.addColorStop(0, 'rgba(234, 179, 8, 0.15)');
    gradient.addColorStop(1, 'rgba(234, 179, 8, 0.7)');

    charts.maint = new Chart(ctx, {
        type: "bar",
        data: {
            labels: labels.length > 0 ? labels : ["No repair events"],
            datasets: [{
                label: "Tickets",
                data: data.length > 0 ? data : [0],
                backgroundColor: gradient,
                borderColor: "#eab308",
                borderWidth: 1.5,
                borderRadius: 4
            }]
        },
        options: {
            indexAxis: "y",
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: { ticks: { color: "#94a3b8", stepSize: 1 }, grid: { color: "rgba(255,255,255,0.04)" } },
                y: { ticks: { color: "#94a3b8" }, grid: { display: false } }
            }
        }
    });
}

function renderDeptChart(stats) {
    const ctx = document.getElementById("chart-dept-alloc").getContext("2d");
    if (charts.dept) charts.dept.destroy();
    
    charts.dept = new Chart(ctx, {
        type: "doughnut",
        data: {
            labels: Object.keys(stats),
            datasets: [{
                data: Object.values(stats),
                backgroundColor: ["#eab308", "#f97316", "#06b6d4", "#d946ef", "#a855f7"],
                borderWidth: 1,
                borderColor: "rgba(255,255,255,0.08)"
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: "right",
                    labels: { color: "#94a3b8", font: { family: "Outfit" } }
                }
            }
        }
    });
}

function renderHeatmapChart(stats) {
    const ctx = document.getElementById("chart-booking-heatmap").getContext("2d");
    if (charts.heatmap) charts.heatmap.destroy();
    
    const gradient = ctx.createLinearGradient(0, 0, 0, 220);
    gradient.addColorStop(0, 'rgba(234, 179, 8, 0.25)');
    gradient.addColorStop(1, 'rgba(234, 179, 8, 0.01)');

    charts.heatmap = new Chart(ctx, {
        type: "line",
        data: {
            labels: Object.keys(stats),
            datasets: [{
                label: "Density",
                data: Object.values(stats),
                backgroundColor: gradient,
                borderColor: "#eab308",
                borderWidth: 2,
                fill: true,
                tension: 0.3
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
                x: { ticks: { color: "#94a3b8" }, grid: { display: false } },
                y: { ticks: { color: "#94a3b8", stepSize: 1 }, grid: { color: "rgba(255,255,255,0.04)" } }
            }
        }
    });
}

// Export CSV trigger
async function triggerExportCSV() {
    try {
        const res = await fetch("/api/reports/export", { headers: getHeaders() });
        if (res.ok) {
            const blob = await res.blob();
            const url = window.URL.createObjectURL(blob);
            const a = document.createElement("a");
            a.href = url;
            a.download = "AssetFlow_Directory_Export.csv";
            document.body.appendChild(a);
            a.click();
            window.URL.revokeObjectURL(url);
            document.body.removeChild(a);
            showToast("Ledger CSV download initialized.", "success");
            playSuccessSound();
        } else {
            showToast("Export failed.", "error");
            playErrorSound();
        }
    } catch (e) {
        console.error(e);
        playErrorSound();
    }
}


// --- 10. NOTIFICATIONS & SECURITY AUDIT LOG ---

async function loadNotificationsAndLogsData() {
    try {
        const nRes = await fetch("/api/notifications", { headers: getHeaders() });
        if (nRes.ok) {
            const notifs = await nRes.json();
            const list = document.getElementById("notif-history-list");
            list.innerHTML = "";
            
            if (notifs.length === 0) {
                list.innerHTML = '<div class="empty-state">No notification logs recorded.</div>';
            } else {
                notifs.forEach(n => {
                    const readClass = n.read ? "read-notif" : "unread-notif";
                    const readBtn = !n.read ? 
                        `<button class="btn btn-secondary btn-xs" onclick="markNotificationRead('${n.id}')">Mark Read</button>` : "";
                        
                    list.innerHTML += `
                        <div class="personal-asset-item mb-2 ${readClass}" style="flex-direction:row; align-items:center; background-color: ${n.read ? 'rgba(255,255,255,0.005)' : 'rgba(234,179,8,0.03)'}">
                            <div class="item-left">
                                <span class="item-title" style="font-size:13.5px">${n.message}</span>
                                <span class="item-meta">${formatDateString(n.timestamp)} | Class: <strong>${n.type}</strong></span>
                            </div>
                            <div class="item-right">
                                ${readBtn}
                            </div>
                        </div>
                    `;
                });
            }
        }

        const lRes = await fetch("/api/activity-logs", { headers: getHeaders() });
        const tbody = document.getElementById("activity-logs-table-body");
        
        if (currentUser.role !== "Admin") {
            tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted">Restricted access. Transaction logs are only visible to Administrator profiles.</td></tr>';
            return;
        }

        if (lRes.ok) {
            const logs = await lRes.json();
            tbody.innerHTML = "";
            
            if (logs.length === 0) {
                tbody.innerHTML = '<tr><td colspan="5" class="text-center text-muted">No security activity logs.</td></tr>';
                return;
            }
            
            logs.forEach(l => {
                tbody.innerHTML += `
                    <tr>
                        <td class="timeline-time">${formatDateString(l.timestamp)}</td>
                        <td><strong>${l.user_name}</strong><br><span class="text-muted text-xs">${l.user_id}</span></td>
                        <td><span class="badge erp-badge">${l.user_role}</span></td>
                        <td><span class="badge badge-info">${l.action}</span></td>
                        <td class="text-sm">${l.details}</td>
                    </tr>
                `;
            });
        }
        
    } catch (e) {
        console.error(e);
    }
}

async function markNotificationRead(notifId) {
    try {
        const res = await fetch(`/api/notifications/${notifId}/read`, {
            method: "POST",
            headers: getHeaders()
        });
        if (res.ok) {
            await refreshAppState();
        }
    } catch (e) {
        console.error(e);
    }
}


// --- DROPDOWNS POPULATORS ---

function populateCategorySelector(selectId) {
    const el = document.getElementById(selectId);
    el.innerHTML = selectId === "asset-filter-category" ? '<option value="">All Categories</option>' : '<option value="">Select Category...</option>';
    categories.forEach(c => {
        el.innerHTML += `<option value="${c.id}">${c.name}</option>`;
    });
}

function populateAvailableAssetsSelector(selectId) {
    const el = document.getElementById(selectId);
    el.innerHTML = '<option value="">Select Asset...</option>';
    assets.filter(a => a.status === "Available" && !a.shared_bookable).forEach(a => {
        el.innerHTML += `<option value="${a.id}">${a.name} (${a.id})</option>`;
    });
}

function populateAllAssetsSelector(selectId) {
    const el = document.getElementById(selectId);
    el.innerHTML = '<option value="">Select Asset...</option>';
    assets.filter(a => !a.shared_bookable).forEach(a => {
        el.innerHTML += `<option value="${a.id}">${a.name} (${a.id})</option>`;
    });
}

function populateDepartmentSelector(selectId) {
    const el = document.getElementById(selectId);
    el.innerHTML = '<option value="">All Departments</option>';
    departments.forEach(d => {
        el.innerHTML += `<option value="${d.id}">${d.name} (${d.code})</option>`;
    });
}

function populateAuditorsSelector(selectId) {
    const el = document.getElementById(selectId);
    el.innerHTML = "";
    employees.forEach(e => {
        el.innerHTML += `<option value="${e.email}">${e.name} (${e.email})</option>`;
    });
}

function populateEmployeeSelector(selectId) {
    const el = document.getElementById(selectId);
    el.innerHTML = '<option value="">Assign Head (Optional)...</option>';
    employees.forEach(e => {
        el.innerHTML += `<option value="${e.email}">${e.name} (${e.email})</option>`;
    });
}

function populateParentDeptSelector(selectId, currentDeptId) {
    const el = document.getElementById(selectId);
    el.innerHTML = '<option value="">No Parent (Root Department)</option>';
    departments.filter(d => d.id !== currentDeptId).forEach(d => {
        el.innerHTML += `<option value="${d.id}">${d.name} (${d.code})</option>`;
    });
}

function populateAllocationHolderOptions(holderType) {
    const el = document.getElementById("alloc-holder-select");
    const label = document.getElementById("lbl-alloc-holder-id");
    el.innerHTML = "";
    
    if (holderType === "Employee") {
        label.innerText = "Holder (Select Employee)";
        employees.forEach(e => {
            el.innerHTML += `<option value="${e.email}">${e.name} (${e.email})</option>`;
        });
    } else if (holderType === "Department") {
        label.innerText = "Holder (Select Department)";
        departments.forEach(d => {
            el.innerHTML += `<option value="${d.id}">${d.name} (${d.code})</option>`;
        });
    }
}

// --- EXPOSE ALL INLINE HTML CLICK HANDLERS GLOBALLY TO WINDOW ---
window.switchTab = switchTab;
window.openModal = openModal;
window.closeModal = closeModal;
window.openAssetDetailModal = openAssetDetailModal;
window.openReturnModal = openReturnModal;
window.openEditDeptModal = openEditDeptModal;
window.changeEmployeeRole = changeEmployeeRole;
window.changeEmployeeStatus = changeEmployeeStatus;
window.processTransfer = processTransfer;
window.cancelBooking = cancelBooking;
window.processMaintenance = processMaintenance;
window.assignTechnicianPrompt = assignTechnicianPrompt;
window.startMaintenanceWork = startMaintenanceWork;
window.resolveMaintenanceWork = resolveMaintenanceWork;
window.selectAuditCycleForVerification = selectAuditCycleForVerification;
window.verifyAuditItemDirect = verifyAuditItemDirect;
window.updateAuditItemNotes = updateAuditItemNotes;
window.markNotificationRead = markNotificationRead;
window.openAllocateModalForAsset = openAllocateModalForAsset;
window.openRaiseRepairForAsset = openRaiseRepairForAsset;
window.triggerRequestTransfer = triggerRequestTransfer;
