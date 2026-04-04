import axios from "axios";

const DOMAIN = process.env.SIP_DOMAIN;
const CLIENT_ID     = process.env.YEASTAR_API_CLIENT_ID;
const CLIENT_SECRET = process.env.YEASTAR_API_SECRET;

// Step 1: Token lo
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
      console.log("✅ Token mila:", response.data.access_token);
      return response.data.access_token;
    } else {
      console.error("❌ Token Error:", response.data);
    }
  } catch (error) {
    console.error("❌ Request Error:", error.response?.data || error.message);
  }
}

// Step 2: Extensions ki list lo — ✅ GET method
async function getExtensions(token) {
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
          "User-Agent": "OpenAPI"   // ✅ Zaruri hai
        }
      }
    );

    if (response.data.errcode === 0) {
      console.log("✅ Extensions:", JSON.stringify(response.data, null, 2));
    } else {
      console.error("❌ Extension Error:", response.data);
    }
  } catch (error) {
    console.error("❌ Request Error:", error.response?.data || error.message);
  }
}

// Main
async function main() {
  const token = await getAccessToken();
  if (token) {
    await getExtensions(token);
  }
}

main();