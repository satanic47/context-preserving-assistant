/**
 * assistant.js
 * Conversational Context-Preserving Assistant Engine
 * Coordinates Auth0 Identity Context, First-Party Settings API, and Third-Party External APIs.
 */

class AssistantEngine {
  constructor(authProvider, firstPartyApi, thirdPartyApi) {
    this.authProvider = authProvider;
    this.firstPartyApi = firstPartyApi;
    this.thirdPartyApi = thirdPartyApi;
    this.conversationHistory = [];
  }

  /**
   * Process incoming user prompt
   */
  async processMessage(userText) {
    const text = userText.trim();
    if (!text) return null;

    // Add user message to history
    this.conversationHistory.push({ role: 'user', content: text, timestamp: new Date() });

    // Check auth status
    const authContext = await this.authProvider.getAuthContext();
    if (!authContext.isAuthenticated && !authContext.isDemoMode) {
      return {
        reply: `⚠️ **Authentication Required**\n\nTo preserve your personal context securely across APIs, please sign in with **Auth0 Universal Login** using the button in the top navigation bar, or toggle **Demo Mode** to test with a simulated token.`,
        apiCalls: []
      };
    }

    const token = authContext.token;
    const userProfile = authContext.user;

    const lower = text.toLowerCase();
    const executedApiCalls = [];

    // Intent 1: Check Weather in Home City (Full Context Preservation)
    if (lower.includes('weather') || lower.includes('temperature') || lower.includes('forecast') || lower.includes('climate')) {
      // Check if user specifically requested a different city inline (e.g., "weather in Tokyo")
      const cityMatch = text.match(/weather in ([a-zA-Z\s]+)/i) || text.match(/weather for ([a-zA-Z\s]+)/i);
      
      let targetCity = null;
      let targetLat = null;
      let targetLon = null;
      let targetCountry = null;
      let unit = 'celsius';
      let prefs = null;

      // 1. Fetch First-Party API preferences using Bearer token
      try {
        prefs = await this.firstPartyApi.getPreferences(token, userProfile);
        executedApiCalls.push({
          label: '1st-Party API: User Settings',
          endpoint: 'GET /api/v1/user/preferences',
          status: '200 OK',
          details: `Retrieved saved home city: "${prefs.homeCity}", Unit: ${prefs.temperatureUnit}`
        });
        unit = prefs.temperatureUnit || 'celsius';
      } catch (e) {
        return {
          reply: `❌ **First-Party API Error**: ${e.message}`,
          apiCalls: []
        };
      }

      if (cityMatch && cityMatch[1] && !cityMatch[1].toLowerCase().includes('home') && !cityMatch[1].toLowerCase().includes('my')) {
        // User asked for custom city
        const rawCity = cityMatch[1].trim();
        const geo = await this.thirdPartyApi.geocodeCity(rawCity);
        if (geo) {
          targetCity = geo.name;
          targetCountry = geo.country;
          targetLat = geo.latitude;
          targetLon = geo.longitude;
          executedApiCalls.push({
            label: '3rd-Party API: Open-Meteo Geocoding',
            endpoint: `GET geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(rawCity)}`,
            status: '200 OK',
            details: `Resolved coordinates: ${targetLat.toFixed(2)}, ${targetLon.toFixed(2)}`
          });
        }
      }

      // Default to preserved home city from 1st-party API if not overridden
      if (!targetCity) {
        targetCity = prefs.homeCity;
        targetCountry = prefs.country;
        targetLat = prefs.latitude;
        targetLon = prefs.longitude;
      }

      // 2. Call Third-Party API (Open-Meteo) using the resolved coordinates and preferred units
      let weather = null;
      try {
        weather = await this.thirdPartyApi.getWeather(targetLat, targetLon, unit, targetCity);
        executedApiCalls.push({
          label: '3rd-Party API: Open-Meteo Forecast',
          endpoint: `GET api.open-meteo.com/v1/forecast?lat=${targetLat}&lon=${targetLon}`,
          status: '200 OK',
          details: `Weather: ${weather.summary}, Temp: ${weather.temperature}${weather.unit}`
        });
      } catch (err) {
        return {
          reply: `❌ **Third-Party API Error**: Failed to fetch forecast from Open-Meteo: ${err.message}`,
          apiCalls: executedApiCalls
        };
      }

      const isHomeCity = (targetCity.toLowerCase() === prefs.homeCity.toLowerCase());

      const reply = `### 🌤️ Live Weather Report: ${weather.city}${targetCountry ? ', ' + targetCountry : ''}
${isHomeCity ? `> **Identity Context Preserved:** Identified you as **${prefs.preferredName}** (\`${userProfile.sub}\`). Automatically retrieved your registered home city (**${prefs.homeCity}**) and unit preference (**${prefs.temperatureUnit.toUpperCase()}**) from your First-Party API.` : `> Retrieved using your preferred display unit (**${prefs.temperatureUnit.toUpperCase()}**) from your authenticated session.`}

* **Condition:** ${weather.summary}
* **Current Temperature:** \`${weather.temperature} ${weather.unit}\` (Feels like \`${weather.apparentTemperature} ${weather.unit}\`)
* **Relative Humidity:** \`${weather.humidity}%\`
* **Wind Velocity:** \`${weather.windSpeed} ${weather.windUnit}\`
* **Today's Range:** High \`${weather.highToday ?? 'N/A'} ${weather.unit}\` / Low \`${weather.lowToday ?? 'N/A'} ${weather.unit}\`

---
*🔐 Secured by Auth0 Token Bearer verification.*`;

      return { reply, apiCalls: executedApiCalls, rawData: { prefs, weather } };
    }

    // Intent 2: Show User Preferences (1st-Party API)
    if (lower.includes('preference') || lower.includes('setting') || lower.includes('profile') || lower.includes('config')) {
      const prefs = await this.firstPartyApi.getPreferences(token, userProfile);
      executedApiCalls.push({
        label: '1st-Party API: User Settings',
        endpoint: 'GET /api/v1/user/preferences',
        status: '200 OK',
        details: `Loaded preferences for ${prefs.userId}`
      });

      const reply = `### ⚙️ Authenticated User Profile & Preferences
Retrieved securely from your **First-Party Backend Service** via verified Auth0 Bearer token:

| Setting Attribute | Registered Value | Source |
| :--- | :--- | :--- |
| **Auth0 User ID** | \`${prefs.userId}\` | Auth0 OpenID Token |
| **Preferred Name** | **${prefs.preferredName}** | First-Party DB |
| **Email Address** | \`${prefs.email}\` | Auth0 Claims |
| **Home Locus (City)** | **${prefs.homeCity}, ${prefs.country}** | First-Party DB |
| **Coordinates** | \`${prefs.latitude}, ${prefs.longitude}\` | First-Party DB |
| **Temperature Unit**| \`${prefs.temperatureUnit.toUpperCase()}\` | First-Party DB |
| **Assistant Role** | \`${prefs.role}\` | First-Party DB |
| **Last Synchronized** | \`${new Date(prefs.lastUpdated).toLocaleString()}\` | First-Party DB |

💡 *Tip: Say **"Change my city to [City Name]"** or **"Switch to Fahrenheit"** to update your preferences!*`;

      return { reply, apiCalls: executedApiCalls, rawData: { prefs } };
    }

    // Intent 3: Update Home City or Settings (1st-Party API Mutation + 3rd-Party Verification)
    if (lower.includes('change my city to') || lower.includes('set my city to') || lower.includes('update my city to') || lower.includes('change city to') || lower.includes('move to')) {
      const match = text.match(/(?:change|set|update)\s+(?:my\s+)?city\s+to\s+([a-zA-Z\s]+)/i) || text.match(/move to\s+([a-zA-Z\s]+)/i);
      if (match && match[1]) {
        const newCityName = match[1].trim();

        // 1. Resolve coordinates via Third-Party Geocoding
        const geo = await this.thirdPartyApi.geocodeCity(newCityName);
        if (!geo) {
          return {
            reply: `⚠️ Could not find geographical coordinates for **${newCityName}**. Please verify spelling.`,
            apiCalls: []
          };
        }

        executedApiCalls.push({
          label: '3rd-Party API: Geocoding Lookup',
          endpoint: `GET geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(newCityName)}`,
          status: '200 OK',
          details: `Resolved ${geo.name}, ${geo.country} (${geo.latitude}, ${geo.longitude})`
        });

        // 2. Persist update in First-Party API
        const updatedPrefs = await this.firstPartyApi.updatePreferences(token, userProfile, {
          homeCity: geo.name,
          country: geo.country || 'Global',
          latitude: geo.latitude,
          longitude: geo.longitude
        });

        executedApiCalls.push({
          label: '1st-Party API: Update Settings',
          endpoint: 'PUT /api/v1/user/preferences',
          status: '200 OK',
          details: `Updated homeCity to "${geo.name}" for user ${updatedPrefs.userId}`
        });

        // 3. Immediately query 3rd-Party weather for the newly updated city
        const weather = await this.thirdPartyApi.getWeather(geo.latitude, geo.longitude, updatedPrefs.temperatureUnit, geo.name);
        executedApiCalls.push({
          label: '3rd-Party API: Immediate Weather Check',
          endpoint: `GET api.open-meteo.com/v1/forecast?lat=${geo.latitude}&lon=${geo.longitude}`,
          status: '200 OK',
          details: `Current: ${weather.summary}, ${weather.temperature}${weather.unit}`
        });

        const reply = `### ✅ Home City Updated & Context Synchronized!
1. **First-Party API**: Updated your registered home location to **${geo.name}, ${geo.country}** using your authenticated Auth0 token.
2. **Third-Party API**: Queried Open-Meteo using your newly saved context:
   - **Current Weather:** ${weather.summary}
   - **Temperature:** \`${weather.temperature} ${weather.unit}\` (Feels like \`${weather.apparentTemperature} ${weather.unit}\`)
   - **Humidity:** \`${weather.humidity}%\`

Future queries for *"What's my local weather?"* will now automatically use **${geo.name}**!`;

        return { reply, apiCalls: executedApiCalls, rawData: { updatedPrefs, weather } };
      }
    }

    // Intent 4: Switch Temperature Unit
    if (lower.includes('fahrenheit') || lower.includes('celsius')) {
      const targetUnit = lower.includes('fahrenheit') ? 'fahrenheit' : 'celsius';
      const updatedPrefs = await this.firstPartyApi.updatePreferences(token, userProfile, {
        temperatureUnit: targetUnit
      });

      executedApiCalls.push({
        label: '1st-Party API: Update Units',
        endpoint: 'PUT /api/v1/user/preferences',
        status: '200 OK',
        details: `Updated temperatureUnit to "${targetUnit}"`
      });

      return {
        reply: `### ✅ Display Unit Updated
Your preferred temperature unit is now set to **${targetUnit.toUpperCase()}** in your First-Party user profile.\n\nAll subsequent weather delegations will request forecasts in **°${targetUnit === 'fahrenheit' ? 'F' : 'C'}**.`,
        apiCalls: executedApiCalls
      };
    }

    // Intent 5: Token / Identity Inspection
    if (lower.includes('token') || lower.includes('identity') || lower.includes('jwt') || lower.includes('claims') || lower.includes('who am i')) {
      return {
        reply: `### 🔐 Authenticated Identity Context
* **Subject ID (\`sub\`):** \`${userProfile.sub || 'auth0|demo_user'}\`
* **Authenticated Name:** \`${userProfile.name || 'Builder'}\`
* **Email:** \`${userProfile.email || 'N/A'}\`
* **Email Verified:** \`${userProfile.email_verified ? 'Yes (✓)' : 'Pending'}\`
* **Auth0 Tenant:** \`${this.authProvider.currentConfig.domain}\`
* **Client ID:** \`${this.authProvider.currentConfig.clientId}\`
* **Active Bearer Token:** \`${token.substring(0, 20)}...${token.slice(-10)}\`

This identity token is validated by the **First-Party API** on every request to ensure zero unauthorized context leakage.`,
        apiCalls: []
      };
    }

    // Fallback: General Assistant Help / Context Explainer
    const prefs = await this.firstPartyApi.getPreferences(token, userProfile);
    return {
      reply: `Hello **${prefs.preferredName}**! 👋 I am your **Context-Preserving Assistant**.

I demonstrate how your authenticated **Auth0 identity** is securely preserved to orchestrate requests between **First-Party Backend APIs** and **Third-Party External Services**.

### Try Asking Me:
1. 🌦️ **"What is the weather in my home city?"** *(Fetches your registered city from First-Party API, then queries live Open-Meteo)*
2. ⚙️ **"Show my saved preferences"** *(Queries First-Party settings API)*
3. 🔄 **"Change my city to Paris"** or **"Change my city to Tokyo"** *(Mutates 1st-party preferences & verifies live via 3rd-party weather)*
4. 🌡️ **"Switch to Fahrenheit"** or **"Switch to Celsius"**
5. 🔐 **"Inspect my security token"** *(Displays Auth0 claims and token lifecycle)*`,
      apiCalls: []
    };
  }
}
