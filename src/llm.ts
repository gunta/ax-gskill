import { ai } from '@ax-llm/ax';
import type { AxAIAnthropicModel, AxAIAnthropicVertexModel, AxAIOpenAIModel } from '@ax-llm/ax';

type SupportedProvider = 'openai' | 'anthropic';

function normalizeProvider(provider: string): SupportedProvider {
	const normalized = provider.trim().toLowerCase();
	if (normalized === 'openai' || normalized === 'anthropic') {
		return normalized;
	}

	throw new Error(
		`Unsupported provider '${provider}'. Supported providers are: openai, anthropic.`,
	);
}

export function createLlm({
	provider,
	model,
	baseUrl,
}: {
	provider: string;
	model: string;
	baseUrl?: string;
}): ReturnType<typeof ai> {
	const normalizedProvider = normalizeProvider(provider);

	if (normalizedProvider === 'openai') {
		const openaiModel = model as AxAIOpenAIModel;
		const apiKey = process.env.OPENAI_API_KEY || process.env.AX_OPENAI_API_KEY || 'not-set';
		if (baseUrl) {
			return ai({
				name: 'openai',
				apiKey,
				apiURL: baseUrl,
				config: { model: openaiModel },
			});
		}

		return ai({
			name: 'openai',
			apiKey,
			config: { model: openaiModel },
		});
	}

	const anthropicModel = model as AxAIAnthropicModel | AxAIAnthropicVertexModel;
	const anthropicApiKey =
		process.env.ANTHROPIC_API_KEY || process.env.AX_ANTHROPIC_API_KEY || undefined;
	return ai({
		name: 'anthropic',
		apiKey: anthropicApiKey,
		config: { model: anthropicModel },
	});
}
