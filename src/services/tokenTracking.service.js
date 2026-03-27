import { RateLimit } from "../models/ratelimit.model.js";
import { countTokens } from "../utils/tokenCounter.js";

const tokenUsage = new Map();

const getUsageKey = (extensionId, provider, period) => `${extensionId}-${provider}-${period}`;

export const trackTokenUsage = async (extensionId, provider, tokens) => {
  const now = Date.now();
  const minuteKey = getUsageKey(extensionId, provider, "minute");
  const hourKey = getUsageKey(extensionId, provider, "hour");

  if (!tokenUsage.has(minuteKey)) {
    tokenUsage.set(minuteKey, { count: 0, resetAt: now + 60000 });
  }
  if (!tokenUsage.has(hourKey)) {
    tokenUsage.set(hourKey, { count: 0, resetAt: now + 3600000 });
  }

  const minuteData = tokenUsage.get(minuteKey);
  const hourData = tokenUsage.get(hourKey);

  if (now > minuteData.resetAt) {
    minuteData.count = 0;
    minuteData.resetAt = now + 60000;
  }
  if (now > hourData.resetAt) {
    hourData.count = 0;
    hourData.resetAt = now + 3600000;
  }

  minuteData.count += tokens;
  hourData.count += tokens;
};

export const checkTokenLimit = async (extensionId, provider, text, model = "gpt-4") => {
  const tokens = countTokens(text, model);
  const limits = await RateLimit.findOne({ extensionId });

  if (!limits) return { allowed: true, tokens };

  const providerLimits = provider === "chatgpt" ? limits.chatgpt : limits.deepgram;
  const minuteKey = getUsageKey(extensionId, provider, "minute");
  const hourKey = getUsageKey(extensionId, provider, "hour");

  const minuteData = tokenUsage.get(minuteKey) || { count: 0 };
  const hourData = tokenUsage.get(hourKey) || { count: 0 };

  if (tokens > providerLimits.maxTokensPerCall) {
    return { allowed: false, reason: "Exceeds per-call limit", tokens };
  }
  if (minuteData.count + tokens > providerLimits.maxTokensPerMinute) {
    return { allowed: false, reason: "Exceeds per-minute limit", tokens };
  }
  if (hourData.count + tokens > providerLimits.maxTokensPerHour) {
    return { allowed: false, reason: "Exceeds per-hour limit", tokens };
  }

  return { allowed: true, tokens };
};
