import type { SpeechToTextProvider } from "./stt-provider.types.js";
import { VoiceError } from "./stt-provider.types.js";
import { MockSpeechToTextProvider } from "./mock-stt.provider.js";
import { GroqSpeechToTextProvider } from "./groq-stt.provider.js";
import { ASSISTANT_CONFIG } from "../assistant.config.js";

/**
 * Speech-To-Text Provider Factory (R41.D)
 *
 * Resolves active STT provider. Fails closed on unknown providers.
 */
export class SttProviderFactory {
  private static cachedProviders: Map<string, SpeechToTextProvider> = new Map();

  public static getProvider(providerName?: string): SpeechToTextProvider {
    const activeProvider = (providerName || ASSISTANT_CONFIG.voiceSttProvider || "groq").toLowerCase();

    // In automated testing environments, default to mock provider unless explicitly overridden
    if (process.env.NODE_ENV === "test" && !providerName && !process.env.VOICE_STT_PROVIDER) {
      return this.resolveProvider("mock");
    }

    return this.resolveProvider(activeProvider);
  }

  private static resolveProvider(name: string): SpeechToTextProvider {
    if (this.cachedProviders.has(name)) {
      return this.cachedProviders.get(name)!;
    }

    let provider: SpeechToTextProvider;
    switch (name) {
      case "mock":
        provider = new MockSpeechToTextProvider();
        break;
      case "groq":
        provider = new GroqSpeechToTextProvider();
        break;
      default:
        throw new VoiceError(
          "VOICE_PROVIDER_UNAVAILABLE",
          `Provedor de transcrição desconhecido: "${name}".`,
          500
        );
    }

    this.cachedProviders.set(name, provider);
    return provider;
  }

  public static reset(): void {
    this.cachedProviders.clear();
  }
}
