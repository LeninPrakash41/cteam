import { GoogleGenAI } from "@google/genai";
const ai = new GoogleGenAI({ apiKey: "invalid_key" });
ai.models.generateContent({ model: "gemini-3.1-pro-preview", contents: "hi" }).catch(console.error);
