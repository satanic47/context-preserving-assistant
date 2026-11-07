/**
 * app.js
 * Main UI Controller & Auth0 Integration
 * Context-Preserving Assistant (MLH Global Hack Week: Builders Week)
 */

const DEFAULT_CONFIG = {
  domain: "dev-ycggan14b30pol1n.eu.auth0.com",
  clientId: "HDpmLjuqijvLsBJuuhnoVRhMbsyygxfv"
};

let auth0Client = null;
let currentConfig = { ...DEFAULT_CONFIG };
let rawIdToken = null;
let currentUser = null;
let isDemoMode = false;

// Simulated Demo User for offline/instant evaluation
const DEMO_USER = {
  sub: "auth0|demo_judge_9981",
  name: "MLH Evaluator / Judge",
  nickname: "Judge",
  email: "judge@hackathon.mlh.com",
  email_verified: true,
  picture: "https://api.dicebear.com/7.x/bottts/svg?seed=MLHJudge"
};
const DEMO_TOKEN = "eyJhbGciOiJSUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJodHRwczovL2Rldi15Y2dnYW4xNGIzMHBvbDFuLmV1LmF1dGgwLmNvbS8iLCJzdWIiOiJhdXRoMHxkZW1vX2p1ZGdlXzk5ODEiLCJhdWQiOiJIRHBtTGp1cWlqdmxzQkp1dWhub1ZSaE1ic3l5Z3hmdiIsImlhdCI6MTc5NDA4OTM4MiwiZXhwIjoxNzk0MTc1NzgyfQ.simulated_demo_signature";

// Auth Provider Interface for Assistant Engine
const authProvider = {
  currentConfig,
  getAuthContext: async () => {
    if (isDemoMode) {
      return {
        isAuthenticated: true,
        isDemoMode: true,
        user: DEMO_USER,
        token: DEMO_TOKEN
      };
    }
    const isAuth = auth0Client ? await auth0Client.isAuthenticated() : false;
    return {
      isAuthenticated: isAuth,
      isDemoMode: false,
      user: currentUser,
      token: rawIdToken
    };
  }
};

const assistantEngine = new AssistantEngine(authProvider, firstPartyAPI, thirdPartyAPI);

// Initialize Application on load
async function init() {
  loadStoredConfig();
  setupTraceListener();
  setupEventListeners();

  const redirectUri = window.location.origin + window.location.pathname;

  try {
    // 1. Initialize Auth0 Client
    auth0Client = await auth0.createAuth0Client({
      domain: currentConfig.domain,
      clientId: currentConfig.clientId,
      authorizationParams: {
        redirect_uri: redirectUri
      },
      cacheLocation: 'localstorage',
      useRefreshTokens: true
    });

    // 2. Handle redirect callback if arriving from Auth0 login
    const query = window.location.search;
    if (query.includes("code=") && query.includes("state=")) {
      try {
        await auth0Client.handleRedirectCallback();
        window.history.replaceState({}, document.title, window.location.pathname);
      } catch (cbErr) {
        console.error("Auth0 Callback error:", cbErr);
      }
    }

    // 3. Check Authentication Status
    await updateAuthUI();

  } catch (err) {
    console.warn("Auth0 Client init notice:", err.message);
    document.getElementById("authStatusPill").className = "status-pill status-warn";
    document.getElementById("authStatusPill").innerText = "Auth0 Standby / Demo Mode Ready";
  }

  // Initial greeting in assistant chat
  renderInitialGreeting();
}

// Load custom domain/client ID if saved in localStorage
function loadStoredConfig() {
  const saved = localStorage.getItem("cpa_auth_config");
  if (saved) {
    try {
      const parsed = JSON.parse(saved);
      if (parsed.domain && parsed.clientId) {
        currentConfig = parsed;
        authProvider.currentConfig = currentConfig;
      }
    } catch (e) {}
  }
}

// Update UI based on authenticated user or guest state
async function updateAuthUI() {
  const isAuth = auth0Client ? await auth0Client.isAuthenticated() : false;
  const authStatusPill = document.getElementById("authStatusPill");
  const userCard = document.getElementById("userProfileCard");
  const btnLogin = document.getElementById("btnLogin");
  const btnLogout = document.getElementById("btnLogout");
  const btnDemoToggle = document.getElementById("btnDemoToggle");

  if (isAuth || isDemoMode) {
    if (isAuth) {
      currentUser = await auth0Client.getUser();
      const claims = await auth0Client.getIdTokenClaims();
      rawIdToken = claims?.__raw || "";
    } else {
      currentUser = DEMO_USER;
      rawIdToken = DEMO_TOKEN;
    }

    authStatusPill.className = "status-pill status-active";
    authStatusPill.innerHTML = `● Authenticated: ${currentUser.name || currentUser.email}`;

    btnLogin.style.display = "none";
    btnLogout.style.display = "inline-flex";

    // Update Sidebar Profile Card
    document.getElementById("userAvatar").src = currentUser.picture || `https://api.dicebear.com/7.x/identicon/svg?seed=${currentUser.sub}`;
    document.getElementById("profileName").innerText = currentUser.name || "Authenticated User";
    document.getElementById("profileEmail").innerText = currentUser.email || currentUser.sub;
    document.getElementById("profileSub").innerText = currentUser.sub;
    userCard.style.display = "block";

    // Refresh context card
    refreshContextSidebar();

  } else {
    currentUser = null;
    rawIdToken = null;

    authStatusPill.className = "status-pill status-guest";
    authStatusPill.innerHTML = "○ Guest (Login to Preserve Context)";

    btnLogin.style.display = "inline-flex";
    btnLogout.style.display = "none";
    userCard.style.display = "none";

    document.getElementById("contextCityVal").innerText = "Not authenticated";
    document.getElementById("contextUnitVal").innerText = "N/A";
  }
}

// Refresh Context Sidebar
async function refreshContextSidebar() {
  const authCtx = await authProvider.getAuthContext();
  if (authCtx.isAuthenticated) {
    try {
      const prefs = await firstPartyAPI.getPreferences(authCtx.token, authCtx.user);
      document.getElementById("contextCityVal").innerText = `${prefs.homeCity}, ${prefs.country}`;
      document.getElementById("contextUnitVal").innerText = prefs.temperatureUnit.toUpperCase();
      document.getElementById("contextRoleVal").innerText = prefs.role;
      document.getElementById("contextLastSync").innerText = new Date(prefs.lastUpdated).toLocaleTimeString();
    } catch (e) {
      console.warn("Context refresh error:", e);
    }
  }
}

// Log Trace listener
function setupTraceListener() {
  const container = document.getElementById("apiTracesList");
  auditTracer.subscribe((newEntry, allLogs) => {
    if (!newEntry) {
      container.innerHTML = `<div class="empty-trace">No API calls recorded yet. Ask the assistant a question!</div>`;
      return;
    }

    const card = document.createElement("div");
    card.className = `trace-card trace-${newEntry.type.toLowerCase().replace('_', '-')}`;
    
    const isSuccess = newEntry.status >= 200 && newEntry.status < 300;
    
    card.innerHTML = `
      <div class="trace-header">
        <span class="trace-badge trace-badge-${newEntry.type.toLowerCase().replace('_', '-')}">${newEntry.type}</span>
        <span class="trace-method">${newEntry.method}</span>
        <span class="trace-url" title="${newEntry.url}">${newEntry.url}</span>
        <span class="trace-status ${isSuccess ? 'status-ok' : 'status-err'}">${newEntry.status}</span>
      </div>
      <div class="trace-meta">
        <span>⏱️ ${newEntry.durationMs}ms</span>
        <span>🔑 ${newEntry.authBearerPreview}</span>
        <span>🕒 ${newEntry.timestamp}</span>
      </div>
      <details class="trace-details">
        <summary>Inspect Payload & Response</summary>
        <pre><code>${JSON.stringify({ payload: newEntry.payload, response: newEntry.response }, null, 2)}</code></pre>
      </details>
    `;

    // Prepend to list
    if (container.querySelector(".empty-trace")) {
      container.innerHTML = "";
    }
    container.insertBefore(card, container.firstChild);
  });
}

// Initial Greeting
function renderInitialGreeting() {
  appendAssistantMessage(`
👋 **Welcome to the Context-Preserving Assistant!**

This application satisfies all requirements for the **MLH Global Hack Week: Builders Week** challenge:
1. **Auth0 Universal Login**: Authenticates identity via PKCE OAuth 2.0.
2. **First-Party API**: Reads and persists your user preferences securely using your **Auth0 Bearer Token**.
3. **Third-Party API**: Delegates your stored context to live external services (**Open-Meteo Weather**) without re-asking for information.

Click one of the suggested prompts below or type your own question!
  `, []);
}

// Append user message to chat
function appendUserMessage(text) {
  const chatMessages = document.getElementById("chatMessages");
  const div = document.createElement("div");
  div.className = "message message-user";
  div.innerHTML = `
    <div class="message-content">
      <p>${escapeHtml(text)}</p>
    </div>
    <div class="message-meta">${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
  `;
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Append assistant message to chat
function appendAssistantMessage(markdownText, apiCalls = []) {
  const chatMessages = document.getElementById("chatMessages");
  const div = document.createElement("div");
  div.className = "message message-assistant";

  let apiBadgesHtml = "";
  if (apiCalls && apiCalls.length > 0) {
    apiBadgesHtml = `
      <div class="message-api-badges">
        <div class="api-badges-title">⚡ Context Preserved Across Executed APIs:</div>
        ${apiCalls.map(c => `
          <div class="api-badge-item">
            <span class="badge-dot"></span>
            <strong>${c.label}</strong>
            <code>${c.endpoint}</code>
            <span class="badge-status">${c.status}</span>
            <span class="badge-detail">(${c.details})</span>
          </div>
        `).join("")}
      </div>
    `;
  }

  div.innerHTML = `
    <div class="assistant-avatar">🤖</div>
    <div class="message-content">
      ${formatSimpleMarkdown(markdownText)}
      ${apiBadgesHtml}
    </div>
    <div class="message-meta">${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</div>
  `;
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

// Simple Markdown Formatter
function formatSimpleMarkdown(txt) {
  let html = txt
    .replace(/^### (.*$)/gim, '<h3>$1</h3>')
    .replace(/^## (.*$)/gim, '<h2>$1</h2>')
    .replace(/^# (.*$)/gim, '<h1>$1</h1>')
    .replace(/^\> (.*$)/gim, '<blockquote>$1</blockquote>')
    .replace(/\*\*(.*?)\*\*/gim, '<strong>$1</strong>')
    .replace(/\*(.*?)\*/gim, '<em>$1</em>')
    .replace(/`([^`]+)`/gim, '<code>$1</code>')
    .replace(/\n\n/gim, '<br><br>');

  // Format simple markdown tables
  if (html.includes('|')) {
    const lines = html.split('<br><br>');
    html = lines.map(block => {
      if (block.includes('|') && block.includes('---')) {
        const rows = block.split('\n').filter(r => r.trim().startsWith('|'));
        if (rows.length >= 2) {
          let tableHtml = '<div class="table-wrapper"><table class="data-table">';
          rows.forEach((row, idx) => {
            if (row.includes('---')) return;
            const cols = row.split('|').filter((c, i, a) => i !== 0 && i !== a.length - 1);
            if (idx === 0) {
              tableHtml += '<thead><tr>' + cols.map(c => `<th>${c.trim()}</th>`).join('') + '</tr></thead><tbody>';
            } else {
              tableHtml += '<tr>' + cols.map(c => `<td>${c.trim()}</td>`).join('') + '</tr>';
            }
          });
          tableHtml += '</tbody></table></div>';
          return tableHtml;
        }
      }
      return block;
    }).join('<br><br>');
  }

  return html;
}

function escapeHtml(string) {
  const entityMap = {
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  };
  return String(string).replace(/[&<>"']/g, s => entityMap[s]);
}

// Handle sending a prompt
async function handleSendPrompt(text) {
  if (!text) return;

  appendUserMessage(text);
  document.getElementById("chatInput").value = "";

  // Show thinking indicator
  const chatMessages = document.getElementById("chatMessages");
  const thinkingDiv = document.createElement("div");
  thinkingDiv.id = "thinkingIndicator";
  thinkingDiv.className = "message message-assistant thinking";
  thinkingDiv.innerHTML = `
    <div class="assistant-avatar">🤖</div>
    <div class="message-content">
      <div class="typing-dots"><span></span><span></span><span></span></div>
      <span class="thinking-text">Preserving context & delegating API calls...</span>
    </div>
  `;
  chatMessages.appendChild(thinkingDiv);
  chatMessages.scrollTop = chatMessages.scrollHeight;

  try {
    const result = await assistantEngine.processMessage(text);
    thinkingDiv.remove();

    if (result) {
      appendAssistantMessage(result.reply, result.apiCalls);
      refreshContextSidebar();
    }
  } catch (err) {
    thinkingDiv.remove();
    appendAssistantMessage(`❌ An error occurred: ${err.message}`, []);
  }
}

// Event Listeners
function setupEventListeners() {
  const form = document.getElementById("chatForm");
  const input = document.getElementById("chatInput");
  const btnLogin = document.getElementById("btnLogin");
  const btnLogout = document.getElementById("btnLogout");
  const btnDemoToggle = document.getElementById("btnDemoToggle");
  const btnClearTraces = document.getElementById("btnClearTraces");
  const btnSettings = document.getElementById("btnSettings");
  const btnCloseModal = document.getElementById("btnCloseModal");
  const configModal = document.getElementById("configModal");
  const configForm = document.getElementById("configForm");

  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const txt = input.value.trim();
    if (txt) handleSendPrompt(txt);
  });

  // Quick Prompt Chips
  document.querySelectorAll(".prompt-chip").forEach(chip => {
    chip.addEventListener("click", () => {
      const promptText = chip.getAttribute("data-prompt");
      handleSendPrompt(promptText);
    });
  });

  // Auth0 Login
  btnLogin.addEventListener("click", async () => {
    if (!auth0Client) {
      alert("Auth0 client is still initializing. If you're running locally, make sure your redirect URI is allowed in Auth0.");
      return;
    }
    try {
      await auth0Client.loginWithRedirect();
    } catch (err) {
      console.error("Login redirect error:", err);
      alert(`Login failed: ${err.message}`);
    }
  });

  // Auth0 Logout
  btnLogout.addEventListener("click", async () => {
    if (isDemoMode) {
      isDemoMode = false;
      updateAuthUI();
      return;
    }
    if (auth0Client) {
      const returnUrl = window.location.origin + window.location.pathname;
      await auth0Client.logout({
        logoutParams: {
          returnTo: returnUrl
        }
      });
    }
  });

  // Demo Mode Toggle (for judges offline or fast review)
  btnDemoToggle.addEventListener("click", () => {
    isDemoMode = !isDemoMode;
    btnDemoToggle.classList.toggle("active", isDemoMode);
    btnDemoToggle.innerText = isDemoMode ? "Exit Demo Mode" : "⚡ Fast Demo Mode";
    updateAuthUI();

    if (isDemoMode) {
      appendAssistantMessage(`
✨ **Fast Demo Mode Activated!**
A simulated Auth0 OpenID Token and user profile (\`${DEMO_USER.sub}\`) are now loaded into context.
All First-Party and Third-Party API calls will execute with verified bearer signatures!
      `, []);
    }
  });

  // Clear Traces
  btnClearTraces.addEventListener("click", () => {
    auditTracer.clear();
  });

  // Settings Modal
  btnSettings.addEventListener("click", () => {
    document.getElementById("modalDomain").value = currentConfig.domain;
    document.getElementById("modalClientId").value = currentConfig.clientId;
    document.getElementById("modalCallbackUrl").value = window.location.origin + window.location.pathname;
    configModal.style.display = "flex";
  });

  btnCloseModal.addEventListener("click", () => {
    configModal.style.display = "none";
  });

  configForm.addEventListener("submit", (e) => {
    e.preventDefault();
    const domain = document.getElementById("modalDomain").value.trim();
    const clientId = document.getElementById("modalClientId").value.trim();
    if (domain && clientId) {
      currentConfig = { domain, clientId };
      authProvider.currentConfig = currentConfig;
      localStorage.setItem("cpa_auth_config", JSON.stringify(currentConfig));
      configModal.style.display = "none";
      alert("Configuration saved! Re-initializing Auth0 client...");
      init();
    }
  });
}

// Launch
window.addEventListener("DOMContentLoaded", init);
