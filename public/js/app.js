/* ============================================
   Meeting Preparation Automation™ — App Logic
   ============================================ */

// ─── Configuration ───
const CONFIG = {
    apiBase: '/api',
    supabaseUrl: null, // Set from server
    supabaseKey: null, // Set from server
};

// ─── State ───
let currentUser = null;
let isMenuOpen = false;

// ─── Theme (Dark Only) ───
function initTheme() {
    document.documentElement.setAttribute('data-theme', 'dark');
}

// ─── Navigation & Pages ───
function showPage(pageId) {
    document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
    const page = document.getElementById(pageId);
    if (page) page.classList.add('active');
}

function showSection(sectionId, event) {
    if (event) event.preventDefault();
    closeUserMenu();
    document.querySelectorAll('.dashboard-section').forEach(s => s.classList.remove('active'));
    const section = document.getElementById(`section-${sectionId}`);
    if (section) {
        section.classList.add('active');
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
}

// ─── User Menu ───
function toggleUserMenu() {
    isMenuOpen = !isMenuOpen;
    const dropdown = document.getElementById('user-dropdown');
    if (dropdown) {
        dropdown.classList.toggle('show', isMenuOpen);
    }
}

function closeUserMenu() {
    isMenuOpen = false;
    const dropdown = document.getElementById('user-dropdown');
    if (dropdown) dropdown.classList.remove('show');
}

// Close menu when clicking outside
document.addEventListener('click', (e) => {
    const menu = document.getElementById('user-menu');
    if (menu && !menu.contains(e.target)) {
        closeUserMenu();
    }
});

// ─── Google Sign In ───
function showSignIn(event) {
    if (event) event.preventDefault();
    showLoading(true);

    // Redirect to our OAuth endpoint
    window.location.href = `${CONFIG.apiBase}/auth-google`;
}

// ─── Auth Session Check ───
async function checkSession() {
    try {
        const response = await fetch(`${CONFIG.apiBase}/auth-session`, {
            credentials: 'include'
        });

        if (response.ok) {
            const data = await response.json();
            if (data.user) {
                currentUser = data.user;
                showDashboard();
                return;
            }
        }
    } catch (err) {
        console.log('No active session');
    }

    // Check URL for OAuth callback
    const params = new URLSearchParams(window.location.search);
    if (params.get('auth') === 'success') {
        // Clear the URL params
        window.history.replaceState({}, '', '/');
        await checkSession();
        return;
    }

    showPage('landing-page');
}

// ─── Dashboard ───
function showDashboard() {
    if (!currentUser) return;

    // Update UI with user data
    updateUserUI();
    showPage('dashboard-page');
    showSection('welcome');
}

function updateUserUI() {
    if (!currentUser) return;

    const name = currentUser.name || currentUser.email.split('@')[0];
    const avatar = currentUser.avatar_url || generateAvatarUrl(name);

    // Nav
    setElementText('user-name-nav', name.split(' ')[0]);
    setElementSrc('user-avatar', avatar);

    // Welcome
    setElementText('welcome-name', name.split(' ')[0]);

    // Status cards
    setElementText('connection-status', 'Google Connected');
    setElementText('brief-time-display', formatTime(currentUser.send_time || '07:00'));
    setElementText('calendar-display', currentUser.calendar_id === 'primary' ? 'Primary' : currentUser.calendar_id);

    // Profile form
    setElementValue('profile-name', currentUser.name || '');
    setElementValue('profile-email', currentUser.email);
    setElementSrc('profile-avatar-preview', avatar);
    setElementValue('profile-calendar', currentUser.calendar_id || 'primary');
    setElementValue('profile-time', currentUser.send_time || '07:00');

    const timezoneSelect = document.getElementById('profile-timezone');
    if (timezoneSelect && currentUser.timezone) {
        timezoneSelect.value = currentUser.timezone;
    }

    const activeToggle = document.getElementById('profile-active');
    if (activeToggle) activeToggle.checked = currentUser.is_active !== false;

    // Strategic goals
    const goalsEl = document.getElementById('profile-strategic-goals');
    if (goalsEl && currentUser.strategic_goals) {
        try {
            const parsed = JSON.parse(currentUser.strategic_goals);
            goalsEl.value = Array.isArray(parsed) ? parsed.join('\n') : currentUser.strategic_goals;
        } catch {
            goalsEl.value = currentUser.strategic_goals;
        }
    }

    // Load history
    loadBriefingHistory();
}

// ─── Profile Save ───
async function saveProfile(event) {
    event.preventDefault();
    showLoading(true);

    // Parse strategic goals from textarea (one per line) into JSON array
    const goalsRaw = document.getElementById('profile-strategic-goals')?.value || '';
    const goalsArray = goalsRaw.split('\n').map(g => g.trim()).filter(g => g.length > 0);

    const profileData = {
        name: document.getElementById('profile-name')?.value,
        calendar_id: document.getElementById('profile-calendar')?.value || 'primary',
        send_time: document.getElementById('profile-time')?.value || '07:00',
        timezone: document.getElementById('profile-timezone')?.value || 'Asia/Dubai',
        is_active: document.getElementById('profile-active')?.checked ?? true,
        strategic_goals: JSON.stringify(goalsArray),
    };

    try {
        const response = await fetch(`${CONFIG.apiBase}/user-profile`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            credentials: 'include',
            body: JSON.stringify(profileData),
        });

        if (response.ok) {
            const data = await response.json();
            currentUser = { ...currentUser, ...profileData };
            updateUserUI();
            showToast('✅ Settings saved successfully!');
        } else {
            showToast('❌ Failed to save settings. Please try again.');
        }
    } catch (err) {
        showToast('❌ Network error. Please check your connection.');
    }

    showLoading(false);
}

// ─── Logout ───
async function handleLogout(event) {
    if (event) event.preventDefault();
    closeUserMenu();

    try {
        await fetch(`${CONFIG.apiBase}/auth-logout`, {
            method: 'POST',
            credentials: 'include',
        });
    } catch (err) {
        // Continue with logout even if server call fails
    }

    currentUser = null;
    localStorage.removeItem('meetprep-session');
    showPage('landing-page');
    showToast('👋 Signed out successfully');
}

// ─── Disconnect Account ───
async function handleDisconnect() {
    if (!confirm('Are you sure? This will delete your account and all data. This cannot be undone.')) {
        return;
    }

    showLoading(true);

    try {
        const response = await fetch(`${CONFIG.apiBase}/user-disconnect`, {
            method: 'POST',
            credentials: 'include',
        });

        if (response.ok) {
            currentUser = null;
            localStorage.removeItem('meetprep-session');
            showPage('landing-page');
            showToast('✅ Account deleted and Google disconnected.');
        } else {
            showToast('❌ Failed to disconnect. Please try again.');
        }
    } catch (err) {
        showToast('❌ Network error. Please check your connection.');
    }

    showLoading(false);
}

// ─── Briefing History ───
async function loadBriefingHistory() {
    try {
        const response = await fetch(`${CONFIG.apiBase}/briefing-history`, {
            credentials: 'include',
        });

        if (response.ok) {
            const data = await response.json();
            renderHistory(data.logs || []);

            // Update briefs count
            const successCount = (data.logs || []).filter(l => l.status === 'success').length;
            setElementText('briefs-count', successCount.toString());
        }
    } catch (err) {
        console.error('Failed to load history:', err);
    }
}

function renderHistory(logs) {
    const container = document.getElementById('history-list');
    if (!container) return;

    if (logs.length === 0) {
        container.innerHTML = `
      <div class="empty-state">
        <span class="empty-icon">📊</span>
        <h3>No briefs yet</h3>
        <p>Your briefing history will appear here once your first daily brief is generated.</p>
      </div>
    `;
        return;
    }

    container.innerHTML = logs.map(log => `
    <div class="history-item">
      <div class="history-item-left">
        <span class="history-status ${log.status}"></span>
        <div>
          <div class="history-date">${formatDate(log.generated_at)}</div>
          <div class="history-detail">${log.status === 'success' ? 'Brief sent successfully' : `Failed: ${log.error_message || 'Unknown error'}`}</div>
        </div>
      </div>
      <div class="history-meetings">${log.meeting_count || 0} meeting${log.meeting_count !== 1 ? 's' : ''}</div>
    </div>
  `).join('');
}

// ─── Utility Functions ───
function setElementText(id, text) {
    const el = document.getElementById(id);
    if (el) el.textContent = text;
}

function setElementSrc(id, src) {
    const el = document.getElementById(id);
    if (el) el.src = src;
}

function setElementValue(id, value) {
    const el = document.getElementById(id);
    if (el) el.value = value;
}

function formatTime(timeStr) {
    if (!timeStr) return '7:00 AM';
    const [hours, minutes] = timeStr.split(':');
    const h = parseInt(hours);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const h12 = h % 12 || 12;
    return `${h12}:${minutes} ${ampm}`;
}

function formatDate(isoStr) {
    if (!isoStr) return '';
    const date = new Date(isoStr);
    return date.toLocaleDateString('en-US', {
        weekday: 'short',
        month: 'short',
        day: 'numeric',
        year: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
    });
}

function generateAvatarUrl(name) {
    // Generate a simple gradient avatar
    const colors = ['FD5811', '152E47', 'e84d0e', '1a3a5c', 'ff7a3d'];
    const color = colors[name.length % colors.length];
    const initial = (name.charAt(0) || '?').toUpperCase();
    return `data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="80" height="80"><rect width="80" height="80" rx="40" fill="#${color}"/><text x="50%" y="54%" dominant-baseline="middle" text-anchor="middle" font-family="Inter,sans-serif" font-size="32" font-weight="600" fill="white">${initial}</text></svg>`)}`;
}

function showLoading(show) {
    const overlay = document.getElementById('loading-overlay');
    if (overlay) overlay.classList.toggle('show', show);
}

function showToast(message) {
    const toast = document.getElementById('toast');
    const msgEl = document.getElementById('toast-message');
    if (toast && msgEl) {
        msgEl.textContent = message;
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 3000);
    }
}

// ─── Generate Brief Now ───
async function handleGenerateBrief() {
    const btn = document.getElementById('generate-brief-btn');
    const resultEl = document.getElementById('generate-brief-result');
    const textEl = btn?.querySelector('.btn-generate-text');
    const iconEl = btn?.querySelector('.btn-generate-icon');
    const loadingEl = btn?.querySelector('.btn-generate-loading');

    // Show loading state
    if (btn) btn.disabled = true;
    if (textEl) textEl.style.display = 'none';
    if (iconEl) iconEl.style.display = 'none';
    if (loadingEl) loadingEl.style.display = 'inline-flex';
    if (resultEl) resultEl.style.display = 'none';

    try {
        const response = await fetch(`${CONFIG.apiBase}/generate-brief`, {
            method: 'POST',
            credentials: 'include',
        });

        const data = await response.json();

        if (response.ok) {
            if (data.meeting_count === 0) {
                showResult(resultEl, 'info', `📅 ${data.message}`);
            } else {
                showResult(resultEl, 'success',
                    `✅ ${data.message}<br>📧 Check your inbox for the full brief!` +
                    (data.meetings ? `<br><br>📋 Meetings covered:<br>• ${data.meetings.join('<br>• ')}` : '')
                );
            }
            // Refresh the briefs count
            loadBriefingHistory();
        } else {
            showResult(resultEl, 'error', `❌ ${data.error || 'Something went wrong. Please try again.'}`);
        }
    } catch (err) {
        showResult(resultEl, 'error', '❌ Network error. Please check your connection and try again.');
    }

    // Reset button
    if (btn) btn.disabled = false;
    if (textEl) textEl.style.display = 'inline';
    if (iconEl) iconEl.style.display = 'inline';
    if (loadingEl) loadingEl.style.display = 'none';
}

function showResult(el, type, message) {
    if (!el) return;
    el.className = `generate-result result-${type}`;
    el.innerHTML = message;
    el.style.display = 'block';
}

// ─── Generate Priorities Now ───
async function handleGeneratePriorities() {
    const btn = document.getElementById('generate-priorities-btn');
    const resultEl = document.getElementById('generate-priorities-result');
    const displayEl = document.getElementById('priorities-display');
    const textEl = btn?.querySelector('.btn-generate-text');
    const iconEl = btn?.querySelector('.btn-generate-icon');
    const loadingEl = btn?.querySelector('.btn-generate-loading');

    // Show loading state
    if (btn) btn.disabled = true;
    if (textEl) textEl.style.display = 'none';
    if (iconEl) iconEl.style.display = 'none';
    if (loadingEl) loadingEl.style.display = 'inline-flex';
    if (resultEl) resultEl.style.display = 'none';
    if (displayEl) displayEl.style.display = 'none';

    try {
        const response = await fetch(`${CONFIG.apiBase}/generate-priorities`, {
            method: 'POST',
            credentials: 'include',
        });

        const data = await response.json();

        if (response.ok) {
            showResult(resultEl, 'success',
                `✅ ${data.message}<br>` +
                `📊 Analyzed: ${data.dataSources?.calendarEvents || 0} calendar events, ` +
                `${data.dataSources?.emailsProcessed || 0} emails, ` +
                `${data.dataSources?.tasksReviewed || 0} tasks`
            );

            // Display the priorities inline
            if (displayEl && data.priorities) {
                displayEl.innerHTML = renderPrioritiesMarkdown(data.priorities, data.metrics);
                displayEl.style.display = 'block';
            }

            loadBriefingHistory();
        } else {
            showResult(resultEl, 'error', `❌ ${data.error || 'Something went wrong. Please try again.'}`);
        }
    } catch (err) {
        showResult(resultEl, 'error', '❌ Network error. Please check your connection and try again.');
    }

    // Reset button
    if (btn) btn.disabled = false;
    if (textEl) textEl.style.display = 'inline';
    if (iconEl) iconEl.style.display = 'inline';
    if (loadingEl) loadingEl.style.display = 'none';
}

function renderPrioritiesMarkdown(markdown, metrics) {
    // Convert markdown to HTML for inline display
    let html = markdown
        .replace(/### (.*)/g, '<h4 class="priorities-h4">$1</h4>')
        .replace(/## (.*)/g, '<h3 class="priorities-h3">$1</h3>')
        .replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
        .replace(/^- (.*)/gm, '<li>$1</li>');

    // Wrap consecutive <li> in <ul>
    html = html.replace(/(<li>.*?<\/li>\n?)+/gs, match => `<ul>${match}</ul>`);

    // Wrap remaining lines as paragraphs
    html = html.split('\n').map(line => {
        const trimmed = line.trim();
        if (!trimmed) return '';
        if (/^<(h[34]|ul|li|strong)/.test(trimmed)) return line;
        return `<p>${trimmed}</p>`;
    }).join('\n');

    // Build metrics bar
    const metricsHtml = metrics ? `
        <div class="priorities-metrics">
            <div class="priorities-metric">
                <span class="priorities-metric-value">${parseFloat((metrics.meetingLoad || 0).toFixed(1))}h</span>
                <span class="priorities-metric-label">Meetings</span>
            </div>
            <div class="priorities-metric">
                <span class="priorities-metric-value">${parseFloat((metrics.availableFocusHours || 0).toFixed(1))}h</span>
                <span class="priorities-metric-label">Focus</span>
            </div>
            <div class="priorities-metric">
                <span class="priorities-metric-value">${metrics.pendingDecisions || 0}</span>
                <span class="priorities-metric-label">Decisions</span>
            </div>
            <div class="priorities-metric">
                <span class="priorities-metric-value">${metrics.overdueItems || 0}</span>
                <span class="priorities-metric-label">Overdue</span>
            </div>
        </div>
    ` : '';

    return metricsHtml + `<div class="priorities-content">${html}</div>`;
}

// ─── Inbox Summary ───
async function handleInboxSummary() {
    const btn = document.getElementById('generate-inbox-btn');
    const resultEl = document.getElementById('generate-inbox-result');
    const displayEl = document.getElementById('inbox-display');
    const textEl = btn?.querySelector('.btn-generate-text');
    const iconEl = btn?.querySelector('.btn-generate-icon');
    const loadingEl = btn?.querySelector('.btn-generate-loading');

    // Show loading state
    if (btn) btn.disabled = true;
    if (textEl) textEl.style.display = 'none';
    if (iconEl) iconEl.style.display = 'none';
    if (loadingEl) loadingEl.style.display = 'inline-flex';
    if (resultEl) resultEl.style.display = 'none';
    if (displayEl) displayEl.style.display = 'none';

    try {
        const response = await fetch(`${CONFIG.apiBase}/inbox-summary`, {
            method: 'POST',
            credentials: 'include',
        });

        const data = await response.json();

        if (response.ok) {
            showResult(resultEl, 'success', `✅ ${data.message}`);

            if (displayEl && data.categories) {
                displayEl.innerHTML = renderInboxSummary(data.categories, data.summary, data.generatedAt);
                displayEl.style.display = 'block';
            }
        } else {
            showResult(resultEl, 'error', `❌ ${data.error || 'Something went wrong. Please try again.'}`);
        }
    } catch (err) {
        showResult(resultEl, 'error', '❌ Network error. Please check your connection and try again.');
    }

    // Reset button
    if (btn) btn.disabled = false;
    if (textEl) textEl.style.display = 'inline';
    if (iconEl) iconEl.style.display = 'inline';
    if (loadingEl) loadingEl.style.display = 'none';
}

function renderInboxSummary(categories, summary, generatedAt) {
    const categoryConfig = {
        highPriority: {
            label: 'High Priority',
            icon: '🔴',
            colorClass: 'inbox-cat-high',
            description: 'Urgent — needs immediate attention',
        },
        actionRequired: {
            label: 'Action Required',
            icon: '🟠',
            colorClass: 'inbox-cat-action',
            description: 'Requires a decision, reply, or task',
        },
        followUp: {
            label: 'Follow-Up',
            icon: '🔵',
            colorClass: 'inbox-cat-follow',
            description: 'Ongoing threads to monitor',
        },
        deadlines: {
            label: 'Deadlines',
            icon: '🟡',
            colorClass: 'inbox-cat-deadline',
            description: 'Time-sensitive with specific dates',
        },
    };

    // Summary bar
    const total = (summary?.highPriority || 0) + (summary?.actionRequired || 0) +
        (summary?.followUp || 0) + (summary?.deadlines || 0);

    let html = `
        <div class="inbox-summary-bar">
            <div class="inbox-summary-stat">
                <span class="inbox-stat-value">${total}</span>
                <span class="inbox-stat-label">Total</span>
            </div>
            <div class="inbox-summary-stat inbox-stat-high">
                <span class="inbox-stat-value">${summary?.highPriority || 0}</span>
                <span class="inbox-stat-label">High Priority</span>
            </div>
            <div class="inbox-summary-stat inbox-stat-action">
                <span class="inbox-stat-value">${summary?.actionRequired || 0}</span>
                <span class="inbox-stat-label">Action</span>
            </div>
            <div class="inbox-summary-stat inbox-stat-follow">
                <span class="inbox-stat-value">${summary?.followUp || 0}</span>
                <span class="inbox-stat-label">Follow-Up</span>
            </div>
            <div class="inbox-summary-stat inbox-stat-deadline">
                <span class="inbox-stat-value">${summary?.deadlines || 0}</span>
                <span class="inbox-stat-label">Deadlines</span>
            </div>
        </div>
    `;

    // Render each category
    for (const [key, config] of Object.entries(categoryConfig)) {
        const emails = categories[key] || [];
        if (emails.length === 0) continue;

        html += `
            <div class="inbox-category ${config.colorClass}">
                <div class="inbox-category-header">
                    <span class="inbox-category-icon">${config.icon}</span>
                    <div>
                        <h3 class="inbox-category-title">${config.label} <span class="inbox-category-count">${emails.length}</span></h3>
                        <p class="inbox-category-desc">${config.description}</p>
                    </div>
                </div>
                <div class="inbox-email-list">
                    ${emails.map(email => `
                        <a href="${email.gmailLink}" target="_blank" rel="noopener noreferrer" class="inbox-email-item">
                            <div class="inbox-email-top">
                                <span class="inbox-email-from">${escapeHtml(email.from)}</span>
                                <span class="inbox-email-date">${email.date}</span>
                            </div>
                            <div class="inbox-email-subject">${escapeHtml(email.subject)}</div>
                            <div class="inbox-email-snippet">${escapeHtml(email.snippet)}</div>
                        </a>
                    `).join('')}
                </div>
            </div>
        `;
    }

    // Empty state
    if (total === 0) {
        html += `
            <div class="inbox-empty">
                <span class="inbox-empty-icon">🎉</span>
                <h3>Inbox Zero!</h3>
                <p>No important emails in the last 24 hours. Enjoy your focus time!</p>
            </div>
        `;
    }

    // Footer
    if (generatedAt) {
        html += `<div class="inbox-footer">Generated ${generatedAt}</div>`;
    }

    return html;
}

function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// ─── Initialization ───
document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    checkSession();
});
