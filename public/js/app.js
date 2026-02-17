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

// ─── Theme Management ───
function initTheme() {
    const saved = localStorage.getItem('meetprep-theme') || 'light';
    applyTheme(saved);

    // Update radio buttons if they exist
    const radio = document.querySelector(`input[name="theme"][value="${saved}"]`);
    if (radio) radio.checked = true;
}

function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme');
    const next = current === 'dark' ? 'light' : 'dark';
    setTheme(next);
}

function setTheme(theme) {
    if (theme === 'system') {
        const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
        applyTheme(prefersDark ? 'dark' : 'light');
    } else {
        applyTheme(theme);
    }
    localStorage.setItem('meetprep-theme', theme);

    // Update radio buttons
    const radio = document.querySelector(`input[name="theme"][value="${theme}"]`);
    if (radio) radio.checked = true;
}

function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
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

    // Theme preference
    if (currentUser.theme_preference) {
        setTheme(currentUser.theme_preference);
    }

    // Load history
    loadBriefingHistory();
}

// ─── Profile Save ───
async function saveProfile(event) {
    event.preventDefault();
    showLoading(true);

    const profileData = {
        name: document.getElementById('profile-name')?.value,
        calendar_id: document.getElementById('profile-calendar')?.value || 'primary',
        send_time: document.getElementById('profile-time')?.value || '07:00',
        timezone: document.getElementById('profile-timezone')?.value || 'Asia/Dubai',
        is_active: document.getElementById('profile-active')?.checked ?? true,
        theme_preference: document.querySelector('input[name="theme"]:checked')?.value || 'light',
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

// ─── Initialization ───
document.addEventListener('DOMContentLoaded', () => {
    initTheme();
    checkSession();

    // Listen for system theme changes
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
        const saved = localStorage.getItem('meetprep-theme');
        if (saved === 'system') {
            setTheme('system');
        }
    });
});
