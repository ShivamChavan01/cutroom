export interface ConversationMessage {
  readonly role: "user" | "assistant";
  readonly content: string;
}

/** Recent conversation is supporting context; it never replaces the current timeline or saved requirements. */
export function recentConversation(messages: readonly ConversationMessage[]): readonly ConversationMessage[] {
  const result: ConversationMessage[] = [];
  let remaining = 12_000;
  for (const message of messages.slice(-12).reverse()) {
    if (!message.content.trim()) continue;
    const content = message.content.slice(0, Math.min(4000, remaining));
    if (!content) break;
    result.unshift({ role: message.role, content });
    remaining -= content.length;
  }
  return result;
}
