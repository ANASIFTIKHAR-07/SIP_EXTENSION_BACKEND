import { AIAgent } from "../models/aiagent.model.js";

export const getRelevantContext = async (agentId, query, maxTokens = 2000) => {
  const agent = await AIAgent.findById(agentId);
  if (!agent || !agent.ragFiles.length) return "";

  let context = "";
  let totalTokens = 0;

  for (const file of agent.ragFiles) {
    if (!file.content) continue;
    
    const lines = file.content.split("\n");
    const relevantLines = lines.filter(line => {
      const lowerLine = line.toLowerCase();
      const lowerQuery = query.toLowerCase();
      return lowerLine.includes(lowerQuery) || 
             query.split(" ").some(word => lowerLine.includes(word.toLowerCase()));
    });

    if (relevantLines.length > 0) {
      const fileContext = `\n--- ${file.fileName} ---\n${relevantLines.join("\n")}\n`;
      const estimatedTokens = Math.ceil(fileContext.length / 4);
      
      if (totalTokens + estimatedTokens <= maxTokens) {
        context += fileContext;
        totalTokens += estimatedTokens;
      } else {
        break;
      }
    }
  }

  return context || agent.ragFiles.map(f => f.content).join("\n\n").slice(0, maxTokens * 4);
};
