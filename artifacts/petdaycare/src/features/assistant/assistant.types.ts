export type AssistantRole = "master_admin" | "creche_admin" | "staff" | "tutor";

export type AssistantVisualState =
  | "idle"
  | "thinking"
  | "executing_action"
  | "waiting_confirmation"
  | "error"
  | "offline";

export interface AssistantCitation {
  title: string;
  category: string;
  path: string;
}

export interface AssistantUIMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  createdAt: string;
  citations?: AssistantCitation[];
  isPending?: boolean;
  error?: string;
}

export interface ScreenContextInfo {
  route: string;
  feature: string;
  title: string;
}
