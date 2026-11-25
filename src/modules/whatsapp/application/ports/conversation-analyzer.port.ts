import type {
  DetectedObjection,
  LeadTemperature,
} from "../../domain/entities/ai-conversation-insight.entity.js";
import type { WhatsAppConversationStatus } from "../../domain/entities/whatsapp-conversation.entity.js";

export interface ConversationAnalysisMessage {
  direction: "INBOUND" | "OUTBOUND";
  senderType: "CLIENT" | "AI_AGENT" | "OWNER";
  content: string;
  sentAt: string;
}

export interface ConversationAnalysisInput {
  companyId: string;
  conversationId: string;
  contactName: string | null;
  phone: string;
  currentStatus: WhatsAppConversationStatus;
  messages: ConversationAnalysisMessage[];
}

export interface ConversationAnalysisOutput {
  leadTemperature: LeadTemperature;
  leadScore: number;
  summary: string;
  detectedObjection: DetectedObjection;
  recommendedNextAction: string;
  suggestedFollowupReply: string;
  appointmentConfirmed: boolean;
  provider: "OPENAI" | "GEMINI" | "HEURISTIC";
}

export interface ConversationAnalyzerPort {
  analyze(
    input: ConversationAnalysisInput,
  ): Promise<ConversationAnalysisOutput>;
}
