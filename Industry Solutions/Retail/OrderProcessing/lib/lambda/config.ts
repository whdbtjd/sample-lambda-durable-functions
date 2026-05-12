/**
 * Configuration constants for order processing workflow
 */

/**
 * Bedrock model configuration
 * Default: Amazon Nova Lite — us-east-1 은 파운데이션 ID, 그 외 리전은 CDK에서
 * `apac.*` / `us.*` / `eu.*` 추론 프로필 ID를 BEDROCK_MODEL_ID 로 넣습니다.
 * 수동 배포 시에는 해당 리전에 맞는 프로필 ID로 환경 변수를 덮어쓰세요.
 */
export const BEDROCK_CONFIG = {
    modelId: process.env.BEDROCK_MODEL_ID || 'amazon.nova-lite-v1:0',
    region: process.env.BEDROCK_REGION || 'us-east-1',
    maxTokens: 100,
} as const;

/**
 * Processing delays and timeouts
 */
export const TIMEOUTS = {
    orderProcessingDelaySeconds: 10,
    paymentCallbackTimeoutMinutes: 5,
} as const;

/**
 * Payment processor function configuration
 */
export const PAYMENT_PROCESSOR = {
    functionName: process.env.PAYMENT_PROCESSOR_FUNCTION_NAME || '',
} as const;

/**
 * Retry configuration
 */
export const RETRY_CONFIG = {
    maxAttempts: 10,
    initialDelaySeconds: 1,
    backoffMultiplier: 2,
} as const;

/**
 * Standard retry strategy for steps and invocations
 * Retries up to 10 times with exponential backoff
 */
export function createRetryStrategy() {
    return (error: Error, attemptCount: number) => {
        if (attemptCount >= RETRY_CONFIG.maxAttempts) {
            return { shouldRetry: false };
        }
        
        const delaySeconds = RETRY_CONFIG.initialDelaySeconds * Math.pow(RETRY_CONFIG.backoffMultiplier, attemptCount - 1);
        
        return {
            shouldRetry: true,
            delay: { seconds: delaySeconds }
        };
    };
}
