import type { StoryVoiceProfile } from './story-manager.js';

export interface VoiceResolverOptions {
  provider: string;
  aliases?: Record<string, string>;
}

export class VoiceResolver {
  private readonly provider: string;
  private readonly aliases: Map<string, string>;

  constructor(options: VoiceResolverOptions) {
    this.provider = options.provider.toLowerCase();
    this.aliases = new Map(
      Object.entries(options.aliases ?? {}).map(([key, value]) => [key.toLowerCase(), value]),
    );
  }

  resolve(
    voice?: string,
    directives?: Record<string, string>,
    profile?: StoryVoiceProfile,
  ): string | undefined {
    const providerOverride = directives?.[this.provider]?.trim();
    if (providerOverride) return providerOverride;

    const profileOverride = profile?.providers?.[this.provider]?.trim();
    if (profileOverride) return profileOverride;

    if (!voice) return undefined;
    return this.aliases.get(voice.toLowerCase()) ?? voice;
  }
}
