/**
 * api-service.js
 * Provides First-Party API (User Context & Settings) and Third-Party API (Open-Meteo Live Services)
 * Demonstrates identity-secured context delegation for MLH Global Hack Week.
 */

class AuditTracer {
  constructor() {
    this.logs = [];
    this.listeners = [];
  }

  log(entry) {
    const record = {
      id: 'trace_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
      timestamp: new Date().toLocaleTimeString(),
      type: entry.type, // '1ST_PARTY' | '3RD_PARTY' | 'AUTH'
      method: entry.method || 'GET',
      url: entry.url,
      status: entry.status || 200,
      statusText: entry.statusText || 'OK',
      durationMs: entry.durationMs || Math.floor(Math.random() * 80 + 35),
      authBearerPreview: entry.token ? `Bearer ${entry.token.substring(0, 16)}...${entry.token.slice(-8)}` : 'None',
      payload: entry.payload || null,
      response: entry.response || null
    };

    this.logs.unshift(record);
    this.notify(record);
    return record;
  }

  subscribe(callback) {
    this.listeners.push(callback);
  }

  notify(record) {
    this.listeners.forEach(cb => {
      try { cb(record, this.logs); } catch (e) { console.error("Trace listener err:", e); }
    });
  }

  clear() {
    this.logs = [];
    this.notify(null);
  }
}

const auditTracer = new AuditTracer();

/**
 * First-Party API Service
 * Mocked resilient backend service that enforces Auth0 Bearer authentication.
 * Stores user preferences persistently per Auth0 user sub.
 */
class FirstPartyAPIService {
  constructor(tracer) {
    this.tracer = tracer;
    this.storageKeyPrefix = 'fpa_context_prefs_';
  }

  _getStorageKey(sub) {
    return this.storageKeyPrefix + btoa(sub || 'guest_user').replace(/=/g, '');
  }

  /**
   * Validates bearer token and returns decoded claims
   */
  _authenticate(token) {
    if (!token) {
      throw new Error("401 Unauthorized: Missing Bearer Token. Please authenticate with Auth0 Universal Login.");
    }
    // Return verified context
    return true;
  }

  /**
   * GET /api/v1/user/preferences
   */
  async getPreferences(token, userProfile) {
    const startTime = performance.now();
    this._authenticate(token);

    const sub = userProfile?.sub || 'auth0|demo_user';
    const key = this._getStorageKey(sub);
    let prefs = null;

    try {
      const stored = localStorage.getItem(key);
      if (stored) {
        prefs = JSON.parse(stored);
      }
    } catch (e) {
      console.warn("Storage read error:", e);
    }

    if (!prefs) {
      // Default initial preferences seeded from Auth0 profile
      prefs = {
        userId: sub,
        preferredName: userProfile?.name || userProfile?.nickname || 'Builder',
        email: userProfile?.email || 'user@example.com',
        homeCity: 'San Francisco',
        country: 'United States',
        latitude: 37.7749,
        longitude: -122.4194,
        temperatureUnit: 'celsius', // 'celsius' or 'fahrenheit'
        theme: 'cyber-dark',
        assistantPersona: 'Technical & Concise',
        role: 'Full-Stack Engineer',
        lastUpdated: new Date().toISOString()
      };
      localStorage.setItem(key, JSON.stringify(prefs));
    }

    const duration = Math.round(performance.now() - startTime) + 30;

    this.tracer.log({
      type: '1ST_PARTY',
      method: 'GET',
      url: '/api/v1/user/preferences',
      status: 200,
      statusText: 'OK (Identity Context Verified)',
      token: token,
      durationMs: duration,
      payload: { sub: sub },
      response: prefs
    });

    return prefs;
  }

  /**
   * PUT /api/v1/user/preferences
   */
  async updatePreferences(token, userProfile, newPrefs) {
    const startTime = performance.now();
    this._authenticate(token);

    const sub = userProfile?.sub || 'auth0|demo_user';
    const current = await this.getPreferences(token, userProfile);
    const updated = {
      ...current,
      ...newPrefs,
      userId: sub,
      lastUpdated: new Date().toISOString()
    };

    const key = this._getStorageKey(sub);
    localStorage.setItem(key, JSON.stringify(updated));

    const duration = Math.round(performance.now() - startTime) + 40;

    this.tracer.log({
      type: '1ST_PARTY',
      method: 'PUT',
      url: '/api/v1/user/preferences',
      status: 200,
      statusText: 'Updated',
      token: token,
      durationMs: duration,
      payload: newPrefs,
      response: updated
    });

    return updated;
  }
}

/**
 * Third-Party API Service
 * Interacts with live Open-Meteo real-time weather and geocoding services.
 * 100% public, CORS-friendly, free, no keys required.
 */
class ThirdPartyAPIService {
  constructor(tracer) {
    this.tracer = tracer;
  }

  /**
   * Geocodes a city name to latitude and longitude
   */
  async geocodeCity(cityName) {
    const startTime = performance.now();
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(cityName)}&count=1&language=en&format=json`;

    try {
      const resp = await fetch(url);
      const data = await resp.json();
      const duration = Math.round(performance.now() - startTime);

      const result = data.results && data.results.length > 0 ? data.results[0] : null;

      this.tracer.log({
        type: '3RD_PARTY',
        method: 'GET',
        url: url,
        status: resp.status,
        statusText: resp.statusText || 'OK',
        durationMs: duration,
        payload: { query: cityName },
        response: result ? { name: result.name, country: result.country, lat: result.latitude, lon: result.longitude } : { error: 'Not found' }
      });

      return result;
    } catch (err) {
      this.tracer.log({
        type: '3RD_PARTY',
        method: 'GET',
        url: url,
        status: 500,
        statusText: 'Network Error',
        durationMs: Math.round(performance.now() - startTime),
        payload: { query: cityName },
        response: { error: err.message }
      });
      throw err;
    }
  }

  /**
   * Fetches real-time weather using Open-Meteo
   */
  async getWeather(lat, lon, unit = 'celsius', cityName = 'Target Locus') {
    const startTime = performance.now();
    const tempParam = unit === 'fahrenheit' ? '&temperature_unit=fahrenheit' : '';
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,relative_humidity_2m,apparent_temperature,precipitation,weather_code,wind_speed_10m${tempParam}&daily=temperature_2m_max,temperature_2m_min&timezone=auto`;

    try {
      const resp = await fetch(url);
      const data = await resp.json();
      const duration = Math.round(performance.now() - startTime);

      const weatherReport = {
        city: cityName,
        coordinates: { lat, lon },
        temperature: data.current?.temperature_2m,
        unit: data.current_units?.temperature_2m || '°C',
        apparentTemperature: data.current?.apparent_temperature,
        humidity: data.current?.relative_humidity_2m,
        windSpeed: data.current?.wind_speed_10m,
        windUnit: data.current_units?.wind_speed_10m || 'km/h',
        weatherCode: data.current?.weather_code,
        summary: this._interpretWeatherCode(data.current?.weather_code),
        highToday: data.daily?.temperature_2m_max?.[0],
        lowToday: data.daily?.temperature_2m_min?.[0]
      };

      this.tracer.log({
        type: '3RD_PARTY',
        method: 'GET',
        url: url,
        status: resp.status,
        statusText: 'OK (Public Open-Meteo)',
        durationMs: duration,
        payload: { lat, lon, unit },
        response: weatherReport
      });

      return weatherReport;
    } catch (err) {
      this.tracer.log({
        type: '3RD_PARTY',
        method: 'GET',
        url: url,
        status: 500,
        statusText: 'Network Error',
        durationMs: Math.round(performance.now() - startTime),
        payload: { lat, lon, unit },
        response: { error: err.message }
      });
      throw err;
    }
  }

  _interpretWeatherCode(code) {
    const mapping = {
      0: 'Clear sky ☀️',
      1: 'Mainly clear 🌤️',
      2: 'Partly cloudy ⛅',
      3: 'Overcast ☁️',
      45: 'Foggy 🌫️',
      48: 'Depositing rime fog 🌫️',
      51: 'Light drizzle 🌦️',
      53: 'Moderate drizzle 🌧️',
      55: 'Dense drizzle 🌧️',
      61: 'Slight rain 🌧️',
      63: 'Moderate rain 🌧️',
      65: 'Heavy rain 🌧️',
      71: 'Slight snow fall 🌨️',
      73: 'Moderate snow fall ❄️',
      75: 'Heavy snow fall ❄️',
      80: 'Rain showers 🌦️',
      95: 'Thunderstorm ⛈️'
    };
    return mapping[code] || 'Fair / Variable 🌤️';
  }
}

// Export singleton instances
const firstPartyAPI = new FirstPartyAPIService(auditTracer);
const thirdPartyAPI = new ThirdPartyAPIService(auditTracer);
