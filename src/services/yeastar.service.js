import axios from "axios";

// To make this fully dynamic, you could load these from .env
// We default to the provided API keys.
const DOMAIN = process.env.SIP_DOMAIN;
const CLIENT_ID = process.env.YEASTAR_API_CLIENT_ID;
const CLIENT_SECRET = process.env.YEASTAR_API_SECRET;

// In-Memory Cache Variables
let cachedExtensions = null;
let lastFetchTime = 0;
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes TTL

// Step 1: Request Access Token
async function getAccessToken() {
  try {
    const response = await axios.post(
      `https://${DOMAIN}/openapi/v1.0/get_token`,
      { username: CLIENT_ID, password: CLIENT_SECRET },
      {
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "OpenAPI"
        }
      }
    );

    if (response.data.errcode === 0) {
      return response.data.access_token;
    } else {
      console.error("❌ Yeastar Token Error:", response.data);
      return null;
    }
  } catch (error) {
    console.error("❌ Yeastar Auth Error:", error.response?.data || error.message);
    return null;
  }
}

// Step 2: Fetch Extensions & Filter specific data
async function fetchExtensionsLive() {
  const token = await getAccessToken();
  if (!token) return [];

  try {
    const response = await axios.get(
      `https://${DOMAIN}/openapi/v1.0/extension/list`,
      {
        params: {
          access_token: token,
          page_number: 1,
          page_size: 100
        },
        headers: {
          "Content-Type": "application/json",
          "User-Agent": "OpenAPI"
        }
      }
    );

    if (response.data.errcode === 0) {
      const rawData = response.data.data || [];
      // Filter the required fields
      const formatted = rawData.map(ext => ({
        number: ext.number,
        caller_id_name: ext.caller_id_name,
        role_name: ext.role_name,
        presence_status: ext.presence_status
      }));

      return formatted;
    } else {
      console.error("❌ Yeastar Extension Error:", response.data);
      return [];
    }
  } catch (error) {
    console.error("❌ Yeastar API Request Error:", error.response?.data || error.message);
    return [];
  }
}

// Step 3: Fast Caching Wrapper
export async function getLiveExtensions() {
  const now = Date.now();
  
  // If cache is valid (under 5 mins), return it immediately (0ms delay)
  if (cachedExtensions !== null && (now - lastFetchTime) < CACHE_TTL_MS) {
    return cachedExtensions;
  }

  // Otherwise, fetch from API (1 second delay, but heavily scaled out)
  console.log("⏱️ Retrieving fresh extension list from Yeastar PBX...");
  const freshData = await fetchExtensionsLive();
  
  if (freshData.length > 0) {
    cachedExtensions = freshData;
    lastFetchTime = now;
  }
  
  return cachedExtensions || [];
}
