import { encoding_for_model } from "tiktoken";

const tokenCounters = {};

const getEncoder = (model) => {
  if (!tokenCounters[model]) {
    try {
      tokenCounters[model] = encoding_for_model(model);
    } catch {
      tokenCounters[model] = encoding_for_model("gpt-4");
    }
  }
  return tokenCounters[model];
};

export const countTokens = (text, model = "gpt-4") => {
  const encoder = getEncoder(model);
  return encoder.encode(text).length;
};

export const enforceTokenLimit = (text, maxTokens, model = "gpt-4") => {
  const encoder = getEncoder(model);
  const tokens = encoder.encode(text);
  if (tokens.length <= maxTokens) return text;
  const truncated = tokens.slice(0, maxTokens);
  return new TextDecoder().decode(encoder.decode(truncated));
};
